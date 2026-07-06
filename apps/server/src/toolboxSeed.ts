import { TOOLBOX_NAME_PATTERN, type Store, type ToolboxSkill } from '@claude-hub/core';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Assets live beside src/ and dist/ (plain tsc doesn't copy them), so one
 * `../assets` hop resolves from both the tsx dev entry and the built bundle.
 */
const DEFAULT_ASSETS_DIR = resolve(__dirname, '../assets/bundled-skills');

interface BundledSkillAsset {
  slug: string;
  name: string;
  description: string;
  tags: string[];
  version: number;
  body: string;
}

/**
 * Seeds bundled skills into the store at boot with stable `bundled-<slug>`
 * ids. Inserts missing entries and overwrites ones whose shipped version is
 * newer; user skills and up-to-date bundled entries are never touched, so
 * the seed is idempotent.
 */
export async function seedBundledSkills(
  store: Store,
  assetsDir = DEFAULT_ASSETS_DIR,
): Promise<void> {
  const assets = await readBundledSkillAssets(assetsDir);
  if (assets.length === 0) return;

  const existing = new Map(store.toolbox().skills.map((s) => [s.id, s]));
  const now = new Date().toISOString();
  const changes: ToolboxSkill[] = [];

  for (const asset of assets) {
    const id = `bundled-${asset.slug}`;
    const current = existing.get(id);
    if (current && (current.bundledVersion ?? 0) >= asset.version) continue;
    changes.push({
      id,
      name: asset.name,
      description: asset.description,
      body: asset.body,
      tags: asset.tags,
      source: 'bundled',
      bundledVersion: asset.version,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    });
  }
  if (changes.length === 0) return;

  const changed = new Set(changes.map((s) => s.id));
  await store.update('toolbox', (toolbox) => ({
    ...toolbox,
    skills: [...toolbox.skills.filter((s) => !changed.has(s.id)), ...changes],
  }));
}

async function readBundledSkillAssets(assetsDir: string): Promise<BundledSkillAsset[]> {
  let entries;
  try {
    entries = await readdir(assetsDir, { withFileTypes: true });
  } catch {
    return []; // missing assets dir is not fatal — the toolbox just starts empty
  }

  const assets: BundledSkillAsset[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    let raw: string;
    try {
      raw = await readFile(join(assetsDir, slug, 'SKILL.md'), 'utf8');
    } catch {
      continue;
    }
    const parsed = parseSkillMarkdown(raw);
    if (!parsed) {
      console.warn(`[toolbox] skipping bundled skill "${slug}": invalid SKILL.md frontmatter`);
      continue;
    }
    if (!TOOLBOX_NAME_PATTERN.test(parsed.name)) {
      console.warn(`[toolbox] skipping bundled skill "${slug}": name is not a valid slug`);
      continue;
    }
    assets.push({ slug, ...parsed });
  }
  return assets;
}

/**
 * Minimal frontmatter parser for our own assets: `key: value` lines between
 * `---` fences, tags comma-separated. Not a general YAML parser on purpose.
 */
function parseSkillMarkdown(
  raw: string,
): Omit<BundledSkillAsset, 'slug'> | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) return undefined;
  const [, frontmatter, body] = match;

  const fields = new Map<string, string>();
  for (const line of frontmatter!.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    fields.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
  }

  const name = fields.get('name');
  const description = fields.get('description');
  if (!name || !description) return undefined;
  const version = Number(fields.get('version') ?? '1');
  if (!Number.isFinite(version) || version < 1) return undefined;
  const tags = (fields.get('tags') ?? '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);

  return { name, description, tags, version, body: body!.trim() };
}
