import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProviderAgentRunner, buildCursorArgs } from '../src/index.js';
import type { AgentRunnerConfig } from '../src/types.js';

describe('Cursor provider', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agent-runner-'));
  });

  afterEach(async () => {
    // Temp dirs are harmless to leave on Windows; they get cleaned up by OS policy.
  });

  it('builds Cursor print-mode args with model, resume, workspace, and approvals', () => {
    const args = buildCursorArgs(
      {
        type: 'cursor',
        enabled: true,
        model: 'gpt-5.5',
        force: true,
        trust: true,
        approveMcps: true,
        sandbox: 'disabled',
      },
      {
        cwd: 'C:/repo',
        prompt: 'hello world',
        sessionId: 'chat-1',
      },
    );

    expect(args).toEqual([
      '-p',
      '--output-format',
      'json',
      '--model',
      'gpt-5.5',
      '--workspace',
      'C:/repo',
      '--resume',
      'chat-1',
      '--force',
      '--trust',
      '--approve-mcps',
      '--sandbox',
      'disabled',
      'hello world',
    ]);
  });

  it('parses a Cursor JSON envelope', async () => {
    const fake = await writeFakeCli(
      dir,
      `console.log(JSON.stringify({
        result: 'done',
        session_id: 'cursor-session',
        duration_ms: 123
      }));`,
    );
    const runner = new ProviderAgentRunner(configWithCursor(fake));

    const result = await runner.runProjectSession({
      provider: 'cursor',
      cwd: dir,
      prompt: 'reply',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.provider).toBe('cursor');
      expect(result.sessionId).toBe('cursor-session');
      expect(result.text).toBe('done');
      expect(result.durationMs).toBe(123);
    }
  });

  it('reports invalid Cursor stdout as ok:false', async () => {
    const fake = await writeFakeCli(dir, `console.log('not json');`);
    const runner = new ProviderAgentRunner(configWithCursor(fake));

    const result = await runner.runProjectSession({
      provider: 'cursor',
      cwd: dir,
      prompt: 'reply',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not a JSON result envelope/);
  });

  it(
    'honors Cursor timeoutMs',
    async () => {
      const fake = await writeFakeCli(dir, `setTimeout(() => console.log('late'), 5000);`);
      const runner = new ProviderAgentRunner(configWithCursor(fake));

      const result = await runner.runProjectSession({
        provider: 'cursor',
        cwd: dir,
        prompt: 'reply',
        timeoutMs: 150,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/timed out/);
    },
    15_000,
  );
});

function configWithCursor(cliPath: string): AgentRunnerConfig {
  return {
    defaultProvider: 'cursor',
    providers: {
      claude: {
        type: 'claude',
        enabled: true,
        dangerouslySkipPermissions: true,
      },
      cursor: {
        type: 'cursor',
        enabled: true,
        cliPath,
        model: 'gpt-5.5',
        force: false,
        trust: true,
        approveMcps: true,
      },
    },
  };
}

async function writeFakeCli(dir: string, body: string): Promise<string> {
  const script = join(dir, 'fake-agent.mjs');
  await writeFile(script, body, 'utf8');
  if (process.platform !== 'win32') {
    await chmod(script, 0o755);
  }
  return `node "${script}"`;
}
