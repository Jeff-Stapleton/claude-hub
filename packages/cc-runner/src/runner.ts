import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { CCResultEnvelope, SpawnOptions, SpawnResult } from './types.js';

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Spawns a single-shot Claude Code run via `claude -p --output-format json`.
 *
 * Returns the assistant's final text plus the session id, so callers that
 * want conversation continuity (e.g. per-Discord-channel sessions) can
 * store the id and pass it back via `sessionId` on the next call.
 *
 * Does not stream intermediate tokens. The orchestrator, which needs
 * streaming, will grow its own streaming runner in a later step and
 * reuse the argv construction from here.
 */
export async function spawnProjectSession(opts: SpawnOptions): Promise<SpawnResult> {
  const claudePath = opts.claudePath ?? 'claude';
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const skipPerms = opts.dangerouslySkipPermissions ?? true;

  const args: string[] = ['-p', '--output-format', 'json'];
  if (skipPerms) args.push('--dangerously-skip-permissions');
  if (opts.sessionId) {
    args.push('--resume', opts.sessionId);
  } else {
    // Pre-generate the session id so the caller knows it before CC exits.
    // CC returns the same id in the result envelope, which we verify.
    args.push('--session-id', randomUUID());
  }
  if (opts.extraArgs) args.push(...opts.extraArgs);
  // `--` terminates option parsing so variadic flags like `--mcp-config
  // <configs...>` don't greedily consume the positional prompt.
  args.push('--', opts.prompt);

  // On Windows, the bundled `claude` is a .cmd shim. Node's spawn() can
  // invoke .cmd files directly as long as we don't use `shell: true` — and
  // we specifically DON'T want shell:true, because node doesn't quote args
  // in shell mode, so prompts with spaces get tokenized by cmd.exe and CC
  // receives only the first word. Node's default spawn quoting handles
  // this correctly when shell is false.
  const useShell = opts.claudePath !== undefined && /\s/.test(opts.claudePath);
  return new Promise<SpawnResult>((resolve) => {
    const child = spawn(claudePath, args, {
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: useShell,
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    const timeout = setTimeout(() => {
      killed = true;
      killTree(child);
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ ok: false, error: `spawn failed: ${err.message}`, stderr });
    });

    child.on('close', (exitCode) => {
      clearTimeout(timeout);
      if (killed) {
        resolve({
          ok: false,
          error: `timed out after ${timeoutMs}ms`,
          stdout,
          stderr,
          exitCode,
        });
        return;
      }

      const parsed = tryParseEnvelope(stdout);
      if (!parsed) {
        resolve({
          ok: false,
          error:
            exitCode === 0
              ? 'claude exited cleanly but stdout was not a JSON result envelope'
              : `claude exited with code ${exitCode}`,
          stdout,
          stderr,
          exitCode,
        });
        return;
      }

      if (parsed.is_error || parsed.subtype !== 'success') {
        resolve({
          ok: false,
          error: parsed.result ?? `claude reported subtype=${parsed.subtype}`,
          stdout,
          stderr,
          exitCode,
        });
        return;
      }

      const sessionId = parsed.session_id;
      if (!sessionId) {
        resolve({
          ok: false,
          error: 'claude result missing session_id',
          stdout,
          stderr,
          exitCode,
        });
        return;
      }

      resolve({
        ok: true,
        sessionId,
        text: parsed.result ?? '',
        durationMs: parsed.duration_ms ?? 0,
        ...(parsed.total_cost_usd !== undefined ? { costUsd: parsed.total_cost_usd } : {}),
        raw: parsed,
      });
    });
  });
}

/**
 * On Windows, `child.kill()` against a shell-launched process only kills
 * cmd.exe — the real grandchild (node, claude.exe) keeps running. Use
 * taskkill /T /F to walk the process tree. On POSIX, a plain SIGKILL
 * against the process group is fine.
 */
function killTree(child: ChildProcess): void {
  if (process.platform === 'win32') {
    const pid = child.pid;
    if (pid !== undefined) {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        shell: false,
      }).on('error', () => {
        // best-effort — fall back to signaling the shell
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
      });
    }
  } else {
    try {
      child.kill('SIGKILL');
    } catch {
      // ignore
    }
  }
}

/**
 * `claude -p --output-format json` is documented to print a single JSON
 * result object. In practice it may emit a trailing newline or
 * occasional log lines on stderr; defensive parsing tries the full
 * stdout as JSON first, then falls back to the last `{...}` block.
 */
function tryParseEnvelope(stdout: string): CCResultEnvelope | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as CCResultEnvelope;
    if (parsed && typeof parsed === 'object' && parsed.type === 'result') return parsed;
  } catch {
    // fall through
  }
  // Fallback: find the last balanced JSON object in the output.
  const lastOpen = trimmed.lastIndexOf('{');
  if (lastOpen < 0) return null;
  const candidate = trimmed.slice(lastOpen);
  try {
    const parsed = JSON.parse(candidate) as CCResultEnvelope;
    if (parsed && typeof parsed === 'object' && parsed.type === 'result') return parsed;
  } catch {
    // give up
  }
  return null;
}
