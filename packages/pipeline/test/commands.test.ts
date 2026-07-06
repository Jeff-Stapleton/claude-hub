import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { runCommands } from '../src/commands.js';

const cwd = tmpdir();

describe('runCommands', () => {
  it('runs commands sequentially and captures output', async () => {
    const res = await runCommands(
      ['node -e "console.log(\'one\')"', 'node -e "console.log(\'two\')"'],
      { cwd, timeoutMs: 30_000 },
    );
    expect(res.ok).toBe(true);
    expect(res.output).toContain('one');
    expect(res.output).toContain('two');
  });

  it('stops at the first failing command', async () => {
    const res = await runCommands(
      ['node -e "process.exit(3)"', 'node -e "console.log(\'never\')"'],
      { cwd, timeoutMs: 30_000 },
    );
    expect(res.ok).toBe(false);
    expect(res.exitCode).toBe(3);
    expect(res.failedCommand).toContain('process.exit(3)');
    expect(res.output).not.toContain('never');
  });

  it('captures stderr from failing commands', async () => {
    const res = await runCommands(['node -e "console.error(\'bad thing\'); process.exit(1)"'], {
      cwd,
      timeoutMs: 30_000,
    });
    expect(res.ok).toBe(false);
    expect(res.output).toContain('bad thing');
  });

  it('times out hung commands', async () => {
    const res = await runCommands(['node -e "setTimeout(() => {}, 60000)"'], {
      cwd,
      timeoutMs: 500,
    });
    expect(res.ok).toBe(false);
    expect(res.timedOut).toBe(true);
  }, 15_000);
});
