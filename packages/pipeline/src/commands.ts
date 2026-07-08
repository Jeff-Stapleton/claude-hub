import { spawn } from 'node:child_process';

export interface RunCommandsResult {
  ok: boolean;
  /** Combined stdout+stderr of all commands run, labeled per command. */
  output: string;
  failedCommand?: string;
  exitCode?: number | null;
  timedOut?: boolean;
}

/**
 * Runs shell commands sequentially in the project cwd, stopping at the
 * first non-zero exit. Used by machines configured with commands. The
 * machine's resolved vault variables are layered over process.env so
 * commands see the same env as the agent run.
 *
 * This is generic shell execution, deliberately NOT routed through
 * @claude-hub/agent-runner — that boundary exists for provider CLIs only.
 */
export async function runCommands(
  commands: string[],
  opts: { cwd: string; timeoutMs: number; env?: Record<string, string> },
): Promise<RunCommandsResult> {
  const chunks: string[] = [];
  const deadline = Date.now() + opts.timeoutMs;

  for (const command of commands) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return { ok: false, output: chunks.join('\n'), failedCommand: command, timedOut: true };
    }
    chunks.push(`$ ${command}`);
    const res = await runOne(command, opts.cwd, remaining, opts.env);
    if (res.output) chunks.push(res.output);
    if (res.timedOut) {
      return { ok: false, output: chunks.join('\n'), failedCommand: command, timedOut: true };
    }
    if (res.exitCode !== 0) {
      return {
        ok: false,
        output: chunks.join('\n'),
        failedCommand: command,
        exitCode: res.exitCode,
      };
    }
  }
  return { ok: true, output: chunks.join('\n') };
}

function runOne(
  command: string,
  cwd: string,
  timeoutMs: number,
  env?: Record<string, string>,
): Promise<{ exitCode: number | null; output: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      cwd,
      windowsHide: true,
      ...(env !== undefined ? { env: { ...process.env, ...env } } : {}),
    });
    let output = '';
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, timeoutMs);

    child.stdout.on('data', (d: Buffer) => (output += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (output += d.toString('utf8')));

    const settle = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, output, timedOut });
    };

    child.on('error', (err) => {
      output += `\n${err.message}`;
      settle(-1);
    });
    child.on('close', (code) => settle(code));
  });
}

/** Kill the whole process tree — `shell: true` means our child is a shell. */
function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
  }
}
