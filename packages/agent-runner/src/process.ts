import { spawn, type ChildProcess } from 'node:child_process';

export interface ProcessRunOptions {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  /** Extra env vars merged over process.env for the child. */
  env?: Record<string, string>;
}

export interface ProcessRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  spawnError?: string;
}

export function runProcess(opts: ProcessRunOptions): Promise<ProcessRunResult> {
  const useShell = /\s/.test(opts.command);
  return new Promise<ProcessRunResult>((resolve) => {
    const child = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: useShell,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, opts.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        stdout,
        stderr,
        exitCode: null,
        timedOut,
        spawnError: err.message,
      });
    });

    child.on('close', (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ stdout, stderr, exitCode, timedOut });
    });
  });
}

export function lastJsonObject(stdout: string): unknown | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // fall through
  }

  const lines = trimmed.split(/\r?\n/).reverse();
  for (const line of lines) {
    const candidate = line.trim();
    if (!candidate.startsWith('{')) continue;
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // try the next JSON-looking line
    }
  }

  const lastOpen = trimmed.lastIndexOf('{');
  if (lastOpen < 0) return null;
  try {
    return JSON.parse(trimmed.slice(lastOpen)) as unknown;
  } catch {
    return null;
  }
}

/**
 * On Windows, child.kill() can leave CLI grandchildren running. Kill the
 * entire process tree for unattended agent runs.
 */
function killTree(child: ChildProcess): void {
  if (process.platform === 'win32') {
    const pid = child.pid;
    if (pid !== undefined) {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        shell: false,
      }).on('error', () => {
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
