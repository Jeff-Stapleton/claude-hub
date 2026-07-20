import {
  TOOLBOX_NAME_PATTERN,
  VAULT_KEY_PATTERN,
  type McpTransport,
  type Store,
  type ToolboxMcpServer,
  type ToolboxSkill,
} from '@claude-hub/core';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { ensureVaultKeys } from './vault.js';

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
  requiredEnv: string[];
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
      ...(asset.requiredEnv.length > 0 ? { requiredEnv: asset.requiredEnv } : {}),
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
  // Declare required keys in the vault (unset) so the vault lamp can warn.
  // ensureVaultKeys never overwrites, so reseeds can't clobber user values.
  await ensureVaultKeys(
    store,
    changes.flatMap((s) => s.requiredEnv ?? []),
  );
}

export interface BundledMcpServerDef {
  slug: string;
  version: number;
  description: string;
  tags: string[];
  requiredEnv: string[];
  transport: McpTransport;
}

/**
 * Bundled MCP servers are code literals rather than markdown assets: their
 * stdio transport needs an absolute entry-point path computed at boot, which
 * frontmatter can't express. Same three-levels-up hop as the hub-mcp path in
 * main.ts — it resolves from both src/ (tsx dev) and dist/ (built).
 */
const GITLAB_MCP_SERVER_PATH = resolve(
  __dirname,
  '../../../packages/gitlab-mcp/dist/server.js',
);

const BUNDLED_MCP_SERVERS: BundledMcpServerDef[] = [
  {
    slug: 'gitlab',
    version: 1,
    description:
      'GitLab workflow tools: clone repos, create/push branches, and create, list, view, and approve merge requests. Defaults to gitlab.com; set GITLAB_URL for self-hosted.',
    tags: ['git', 'gitlab'],
    requiredEnv: ['GITLAB_TOKEN'],
    transport: {
      type: 'stdio',
      command: 'node',
      args: [GITLAB_MCP_SERVER_PATH.replace(/\\/g, '/')],
    },
  },
];

/**
 * Seeds bundled MCP servers with stable `bundled-<slug>` ids, mirroring
 * seedBundledSkills. Also reseeds when the stored transport drifts from the
 * shipped one (e.g. the repo moved and the persisted absolute path is stale).
 * Never touches user-created servers, even if one squats on a bundled name.
 */
export async function seedBundledMcpServers(
  store: Store,
  defs: BundledMcpServerDef[] = BUNDLED_MCP_SERVERS,
): Promise<void> {
  if (defs.length === 0) return;

  const servers = store.toolbox().mcpServers;
  const existing = new Map(servers.map((s) => [s.id, s]));
  const now = new Date().toISOString();
  const changes: ToolboxMcpServer[] = [];

  for (const def of defs) {
    const id = `bundled-${def.slug}`;
    const current = existing.get(id);
    const nameOwner = servers.find((s) => s.name === def.slug && s.id !== id);
    if (nameOwner) {
      console.warn(
        `[toolbox] skipping bundled MCP server "${def.slug}": a user server already owns the name`,
      );
      continue;
    }
    if (
      current &&
      (current.bundledVersion ?? 0) >= def.version &&
      JSON.stringify(current.transport) === JSON.stringify(def.transport)
    ) {
      continue;
    }
    changes.push({
      id,
      name: def.slug,
      description: def.description,
      transport: def.transport,
      tags: def.tags,
      ...(def.requiredEnv.length > 0 ? { requiredEnv: def.requiredEnv } : {}),
      source: 'bundled',
      bundledVersion: def.version,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    });
  }
  if (changes.length === 0) return;

  const changed = new Set(changes.map((s) => s.id));
  await store.update('toolbox', (toolbox) => ({
    ...toolbox,
    mcpServers: [...toolbox.mcpServers.filter((s) => !changed.has(s.id)), ...changes],
  }));
  // Declare required keys in the vault (unset) so the vault lamp can warn.
  // ensureVaultKeys never overwrites, so reseeds can't clobber user values.
  await ensureVaultKeys(
    store,
    changes.flatMap((s) => s.requiredEnv ?? []),
  );
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
  const requiredEnv: string[] = [];
  for (const key of (fields.get('requiredEnv') ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k.length > 0)) {
    if (!VAULT_KEY_PATTERN.test(key)) {
      console.warn(`[toolbox] bundled skill "${name}": dropping invalid requiredEnv key "${key}"`);
      continue;
    }
    if (!requiredEnv.includes(key)) requiredEnv.push(key);
  }

  return { name, description, tags, requiredEnv, version, body: body!.trim() };
}
