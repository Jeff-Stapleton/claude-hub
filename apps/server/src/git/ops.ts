import { execFile } from 'node:child_process';
import { access, readdir, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export interface RunGitOptions {
  cwd?: string;
  /** PAT injected per-invocation; never written into any git config file. */
  token?: string;
  timeoutMs?: number;
}

/**
 * Runs git via execFile (no shell). Auth for https remotes is injected with
 * `-c http.extraHeader=...` so the token exists only in this process's argv,
 * and GIT_TERMINAL_PROMPT=0 turns would-be credential prompts into fast
 * failures. Any token that leaks into git's output (e.g. a URL echo) is
 * scrubbed before the error propagates.
 */
export async function runGit(
  args: string[],
  opts: RunGitOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  const authArgs = opts.token
    ? ['-c', `http.extraHeader=Authorization: Bearer ${opts.token}`]
    : [];
  try {
    return await execFileAsync('git', [...authArgs, ...args], {
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err) {
    throw new Error(scrubToken(errorText(err), opts.token));
  }
}

export function scrubToken(text: string, token?: string): string {
  if (!token) return text;
  return text.split(token).join('***');
}

function errorText(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { stderr?: string; message?: string };
    const stderr = typeof e.stderr === 'string' ? e.stderr.trim() : '';
    if (stderr) return stderr;
    if (typeof e.message === 'string') return e.message;
  }
  return String(err);
}

export interface LocalPathInfo {
  exists: boolean;
  isDirectory: boolean;
  isGitRepo: boolean;
  remoteUrl?: string;
}

/** Wizard-side validation for "use an existing local directory" repos. */
export async function inspectLocalPath(path: string): Promise<LocalPathInfo> {
  let isDirectory = false;
  try {
    isDirectory = (await stat(path)).isDirectory();
  } catch {
    return { exists: false, isDirectory: false, isGitRepo: false };
  }
  if (!isDirectory) return { exists: true, isDirectory: false, isGitRepo: false };

  let isGitRepo = false;
  try {
    const { stdout } = await runGit(['-C', path, 'rev-parse', '--is-inside-work-tree'], {
      timeoutMs: 15_000,
    });
    isGitRepo = stdout.trim() === 'true';
  } catch {
    // Not a repo — still a usable directory.
  }
  let remoteUrl: string | undefined;
  if (isGitRepo) {
    try {
      const { stdout } = await runGit(['-C', path, 'remote', 'get-url', 'origin'], {
        timeoutMs: 15_000,
      });
      remoteUrl = stdout.trim() || undefined;
    } catch {
      // No origin remote — fine.
    }
  }
  return { exists: true, isDirectory: true, isGitRepo, ...(remoteUrl ? { remoteUrl } : {}) };
}

/** Fast reachability probe for a remote URL (wizard-side validation). */
export async function checkRemote(url: string, token?: string): Promise<void> {
  await runGit(['ls-remote', url, 'HEAD'], { ...(token ? { token } : {}), timeoutMs: 60_000 });
}

export async function cloneRepo(url: string, dest: string, token?: string): Promise<void> {
  await runGit(['clone', url, dest], token ? { token } : {});
}

/**
 * Creates a repository on GitHub via the REST API and returns its https
 * clone URL. Uses fetch so we don't take on an SDK dependency.
 */
export async function createGithubRepo(
  name: string,
  token: string,
  opts: { private?: boolean } = {},
): Promise<{ cloneUrl: string }> {
  const res = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'claude-hub',
    },
    body: JSON.stringify({ name, private: opts.private ?? true }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      scrubToken(`GitHub repo creation failed (${res.status}): ${body.slice(0, 500)}`, token),
    );
  }
  const json = (await res.json()) as { clone_url?: string };
  if (!json.clone_url) throw new Error('GitHub repo creation returned no clone_url');
  return { cloneUrl: json.clone_url };
}

/**
 * Initializes `dir` as a git repo (seeding a README from the project's
 * name + vision when the directory is empty), wires `origin`, and pushes
 * the initial commit.
 */
export async function initAndPush(
  dir: string,
  remoteUrl: string,
  token: string,
  seed: { name: string; vision: string },
): Promise<void> {
  const hasGit = await pathExists(join(dir, '.git'));
  if (!hasGit) await runGit(['init', '-b', 'main'], { cwd: dir });

  const entries = (await readdir(dir)).filter((e) => e !== '.git');
  if (entries.length === 0) {
    const readme = `# ${seed.name}\n\n${seed.vision}\n`;
    await writeFile(join(dir, 'README.md'), readme, 'utf8');
  }

  await runGit(['add', '-A'], { cwd: dir });
  // Committing with nothing staged fails; tolerate re-runs after a partial push.
  try {
    await runGit(['commit', '-m', 'Initial commit'], { cwd: dir });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('nothing to commit')) throw err;
  }
  try {
    await runGit(['remote', 'add', 'origin', remoteUrl], { cwd: dir });
  } catch {
    await runGit(['remote', 'set-url', 'origin', remoteUrl], { cwd: dir });
  }
  await runGit(['push', '-u', 'origin', 'main'], { cwd: dir, token });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
