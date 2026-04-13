import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { encodeProjectPath } from './encode.js';

/**
 * One subdirectory under `~/.claude/projects/`.
 *
 * `path` is left undefined when we can't unambiguously map the sanitized
 * name back to a real filesystem path. Callers that have a list of
 * user-registered projects can fill it in by encoding each candidate and
 * looking for an exact match against `sanitizedName`.
 */
export interface CCProjectEntry {
  sanitizedName: string;
  /** Number of `*.jsonl` session files at the top level of the project dir. */
  sessionCount: number;
  /** Most recent mtime across the session files (ISO string), if any. */
  lastActivity?: string;
}

export interface CCSettings {
  global: unknown | null;
  local: unknown | null;
}

export class CCConfigReader {
  readonly root: string;

  constructor(root?: string) {
    this.root = root ?? join(homedir(), '.claude');
  }

  projectsDir(): string {
    return join(this.root, 'projects');
  }

  skillsDir(): string {
    return join(this.root, 'skills');
  }

  /**
   * Returns the directory CC uses for a given project path, whether or not
   * it currently exists on disk. Useful for "open project transcript" links.
   */
  projectDirFor(absolutePath: string): string {
    return join(this.projectsDir(), encodeProjectPath(absolutePath));
  }

  async listProjects(): Promise<CCProjectEntry[]> {
    const entries = await safeReaddir(this.projectsDir(), { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());

    return Promise.all(
      dirs.map(async (entry): Promise<CCProjectEntry> => {
        const dir = join(this.projectsDir(), entry.name);
        const children = await safeReaddir(dir);
        const sessionFiles = children.filter((name) => name.endsWith('.jsonl'));
        let lastActivity: string | undefined;
        for (const file of sessionFiles) {
          try {
            const s = await stat(join(dir, file));
            const iso = s.mtime.toISOString();
            if (!lastActivity || iso > lastActivity) lastActivity = iso;
          } catch {
            // ignore — file may have been deleted between readdir and stat
          }
        }
        return {
          sanitizedName: entry.name,
          sessionCount: sessionFiles.length,
          ...(lastActivity ? { lastActivity } : {}),
        };
      }),
    );
  }

  async listSessions(sanitizedName: string): Promise<string[]> {
    const dir = join(this.projectsDir(), sanitizedName);
    const children = await safeReaddir(dir);
    return children.filter((n) => n.endsWith('.jsonl'));
  }

  async readSettings(): Promise<CCSettings> {
    return {
      global: await readJsonOrNull(join(this.root, 'settings.json')),
      local: await readJsonOrNull(join(this.root, 'settings.local.json')),
    };
  }

  /** Lists global skill directories under `~/.claude/skills/`. */
  async listGlobalSkills(): Promise<string[]> {
    const entries = await safeReaddir(this.skillsDir(), { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  }

  /** Lists project-local skills under `<projectPath>/.claude/skills/`. */
  async listProjectSkills(projectPath: string): Promise<string[]> {
    const entries = await safeReaddir(join(projectPath, '.claude', 'skills'), {
      withFileTypes: true,
    });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  }
}

// ---------------------------------------------------------------------------
// fs helpers — gracefully treat missing dirs/files as empty/null
// ---------------------------------------------------------------------------

async function safeReaddir(path: string): Promise<string[]>;
async function safeReaddir(
  path: string,
  opts: { withFileTypes: true },
): Promise<import('node:fs').Dirent[]>;
async function safeReaddir(
  path: string,
  opts?: { withFileTypes: true },
): Promise<string[] | import('node:fs').Dirent[]> {
  try {
    return opts ? await readdir(path, opts) : await readdir(path);
  } catch (err) {
    if (isNodeError(err) && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return [];
    throw err;
  }
}

async function readJsonOrNull(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') return null;
    throw err;
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
