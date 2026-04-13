import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnProjectSession } from '../src/runner.js';

/**
 * Integration-style tests that swap in a fake `claude` binary. We don't
 * actually shell out to real Claude in unit tests — that lives in the
 * separate smoke-test script.
 */
describe('spawnProjectSession', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cc-runner-'));
  });

  afterEach(async () => {
    // Leaving the temp dir around is fine on Windows; it'll get GC'd.
  });

  it('parses a success envelope and returns sessionId + text', async () => {
    const envelope = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'hello there',
      session_id: '11111111-1111-1111-1111-111111111111',
      duration_ms: 42,
      total_cost_usd: 0.01,
    };
    const fake = await writeFakeClaude(dir, `console.log(${JSON.stringify(JSON.stringify(envelope))});`);

    const res = await spawnProjectSession({
      cwd: dir,
      prompt: 'ignored',
      claudePath: fake,
      dangerouslySkipPermissions: false,
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.sessionId).toBe(envelope.session_id);
      expect(res.text).toBe('hello there');
      expect(res.durationMs).toBe(42);
      expect(res.costUsd).toBe(0.01);
    }
  });

  it('reports an error envelope as ok:false', async () => {
    const envelope = {
      type: 'result',
      subtype: 'error',
      is_error: true,
      result: 'something went wrong',
      session_id: '22222222-2222-2222-2222-222222222222',
    };
    const fake = await writeFakeClaude(dir, `console.log(${JSON.stringify(JSON.stringify(envelope))});`);

    const res = await spawnProjectSession({ cwd: dir, prompt: '.', claudePath: fake });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('something went wrong');
  });

  it('returns ok:false if stdout is not a result envelope', async () => {
    const fake = await writeFakeClaude(dir, `console.log("not json");`);
    const res = await spawnProjectSession({ cwd: dir, prompt: '.', claudePath: fake });
    expect(res.ok).toBe(false);
  });

  it(
    'honors timeoutMs and kills the child',
    async () => {
      const fake = await writeFakeClaude(
        dir,
        `setTimeout(() => console.log("too late"), 5000);`,
      );
      const res = await spawnProjectSession({
        cwd: dir,
        prompt: '.',
        claudePath: fake,
        timeoutMs: 150,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(/timed out/);
    },
    15_000,
  );
});

/**
 * Writes a Node script that prints whatever code we embed and returns the
 * path as if it were the `claude` binary. On Windows we emit a `.cmd`
 * shim too so `spawn` with `shell: true` resolves it the same way the real
 * claude CLI does.
 */
async function writeFakeClaude(dir: string, body: string): Promise<string> {
  const script = join(dir, 'fake-claude.mjs');
  await writeFile(script, body, 'utf8');
  // Some node versions require executable bit on POSIX.
  if (process.platform !== 'win32') {
    await chmod(script, 0o755);
  }
  // Return a shell-invocable command. On Windows with shell:true, a plain
  // path to a .mjs script won't run; use `node <script>` instead.
  return `node "${script}"`;
}
