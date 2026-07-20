import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { makeScrubber } from './gitlabClient.js';

const execFileAsync = promisify(execFile);

export interface GitRunOptions {
  cwd?: string;
  /** When set, the token is injected per invocation via `-c http.extraHeader`
   * so it never lands in `.git/config` or the stored remote URL. */
  token?: string;
  gitBin?: string;
}

export interface GitResult {
  stdout: string;
  stderr: string;
}

export type GitRunner = (args: string[], opts?: GitRunOptions) => Promise<GitResult>;

export const runGit: GitRunner = async (args, opts = {}) => {
  const scrub = makeScrubber(opts.token);
  const argv: string[] = [];
  if (opts.token) {
    const basic = Buffer.from(`oauth2:${opts.token}`).toString('base64');
    // Disable configured helpers so the injected header is the only credential.
    argv.push('-c', 'credential.helper=', '-c', `http.extraHeader=Authorization: Basic ${basic}`);
  }
  argv.push(...args);
  try {
    const { stdout, stderr } = await execFileAsync(opts.gitBin ?? 'git', argv, {
      ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout: scrub(stdout), stderr: scrub(stderr) };
  } catch (err) {
    const e = err as { message?: string; stderr?: string };
    throw new Error(scrub(e.stderr?.trim() || e.message || 'git command failed'));
  }
};
