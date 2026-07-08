import { existsSync } from 'node:fs';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ProviderAgentRunner,
  buildCursorArgs,
  materializeClaudeTools,
  renderSkillPreamble,
} from '../src/index.js';
import { runProcess } from '../src/process.js';
import type { AgentRunnerConfig, RunToolAssignments } from '../src/types.js';

const TOOLS: RunToolAssignments = {
  skills: [
    { name: 'my-skill', description: 'Does things', body: '# My skill\n\nSteps.' },
  ],
  mcpServers: [
    {
      name: 'aws-tools',
      transport: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', 'aws-mcp'],
        env: { AWS_KEY: 'secret-value' },
      },
    },
    {
      name: 'remote-api',
      transport: { type: 'http', url: 'https://example.com/mcp', headers: { auth: 'tok' } },
    },
  ],
};

describe('materializeClaudeTools', () => {
  let materialized: Awaited<ReturnType<typeof materializeClaudeTools>> | undefined;

  afterEach(async () => {
    await materialized?.cleanup();
    materialized = undefined;
  });

  it('writes a plugin dir with the assigned skills and an mcp config', async () => {
    materialized = await materializeClaudeTools(TOOLS);

    const pluginJson = JSON.parse(
      await readFile(join(materialized.dir, 'plugin', '.claude-plugin', 'plugin.json'), 'utf8'),
    );
    expect(pluginJson.name).toBe('hub-toolbox');

    const skillMd = await readFile(
      join(materialized.dir, 'plugin', 'skills', 'my-skill', 'SKILL.md'),
      'utf8',
    );
    expect(skillMd).toContain('name: my-skill');
    expect(skillMd).toContain('description: Does things');
    expect(skillMd).toContain('# My skill');

    const mcp = JSON.parse(await readFile(join(materialized.dir, 'mcp.json'), 'utf8'));
    expect(mcp.mcpServers['aws-tools']).toEqual({
      command: 'npx',
      args: ['-y', 'aws-mcp'],
      env: { AWS_KEY: 'secret-value' },
    });
    expect(mcp.mcpServers['remote-api']).toEqual({
      type: 'http',
      url: 'https://example.com/mcp',
      headers: { auth: 'tok' },
    });

    expect(materialized.extraArgs).toEqual([
      '--plugin-dir',
      expect.stringContaining('plugin'),
      '--mcp-config',
      expect.stringContaining('mcp.json'),
      '--strict-mcp-config',
    ]);
  });

  it('omits --plugin-dir with no skills and --mcp-config with no servers, keeping strict mode', async () => {
    materialized = await materializeClaudeTools({ skills: [], mcpServers: [] });
    expect(materialized.extraArgs).toEqual(['--strict-mcp-config']);

    const skillsOnly = await materializeClaudeTools({ skills: TOOLS.skills, mcpServers: [] });
    expect(skillsOnly.extraArgs).not.toContain('--mcp-config');
    expect(skillsOnly.extraArgs).toContain('--plugin-dir');
    await skillsOnly.cleanup();
  });

  it('cleanup removes the temp dir', async () => {
    const m = await materializeClaudeTools(TOOLS);
    expect(existsSync(m.dir)).toBe(true);
    await m.cleanup();
    expect(existsSync(m.dir)).toBe(false);
  });
});

describe('renderSkillPreamble', () => {
  it('returns empty for no skills', () => {
    expect(renderSkillPreamble([])).toBe('');
  });

  it('renders name, description, and body', () => {
    const preamble = renderSkillPreamble(TOOLS.skills);
    expect(preamble).toContain('# Available skills');
    expect(preamble).toContain('## my-skill — Does things');
    expect(preamble).toContain('# My skill');
  });
});

describe('cursor runs with tools', () => {
  const config = {
    type: 'cursor' as const,
    enabled: true,
    model: 'gpt-5.5',
    force: false,
    trust: true,
    approveMcps: true,
  };

  it('prepends the skill preamble to the prompt and ignores MCP servers', () => {
    const args = buildCursorArgs(config, { cwd: '/repo', prompt: 'do work', tools: TOOLS });
    const prompt = args[args.length - 1]!;
    expect(prompt).toContain('# Available skills');
    expect(prompt).toContain('## my-skill — Does things');
    expect(prompt.endsWith('do work')).toBe(true);
    expect(args).not.toContain('--mcp-config');
    expect(prompt).not.toContain('aws-tools');
  });

  it('leaves the prompt untouched when tools are absent', () => {
    const args = buildCursorArgs(config, { cwd: '/repo', prompt: 'do work' });
    expect(args[args.length - 1]).toBe('do work');
  });
});

describe('runProcess env merging (the cursor injection path)', () => {
  it('merges opts.env over process.env for the child', async () => {
    const result = await runProcess({
      command: 'node',
      args: ['-e', 'console.log(process.env.VAULT_INJECTED_KEY ?? "absent")'],
      cwd: process.cwd(),
      timeoutMs: 30_000,
      env: { VAULT_INJECTED_KEY: 'vault-value' },
    });
    expect(result.stdout.trim()).toBe('vault-value');

    const without = await runProcess({
      command: 'node',
      args: ['-e', 'console.log(process.env.VAULT_INJECTED_KEY ?? "absent")'],
      cwd: process.cwd(),
      timeoutMs: 30_000,
    });
    expect(without.stdout.trim()).toBe('absent');
  });
});

describe('claude runs with tools (fake CLI)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agent-runner-tools-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('passes --plugin-dir/--mcp-config/--strict-mcp-config and cleans up the temp dir', async () => {
    const runner = new ProviderAgentRunner(configWithClaude(await writeFakeClaude(dir)));

    const result = await runner.runProjectSession({
      provider: 'claude',
      cwd: dir,
      prompt: 'work',
      tools: TOOLS,
    });

    expect(result.ok).toBe(true);
    const argv: string[] = JSON.parse(await readFile(join(dir, 'argv.json'), 'utf8'));
    expect(argv).toContain('--strict-mcp-config');

    const pluginDir = argv[argv.indexOf('--plugin-dir') + 1]!;
    const mcpPath = argv[argv.indexOf('--mcp-config') + 1]!;
    // The fake CLI snapshotted the materialized files while they existed...
    const seen = JSON.parse(await readFile(join(dir, 'seen.json'), 'utf8'));
    expect(seen.skillMd).toContain('name: my-skill');
    expect(seen.mcp.mcpServers['aws-tools'].env.AWS_KEY).toBe('secret-value');
    // ...and the ephemeral dir (secrets included) is gone after the run.
    expect(existsSync(pluginDir)).toBe(false);
    expect(existsSync(mcpPath)).toBe(false);
  });

  it('injects tools.env into the child process environment', async () => {
    const runner = new ProviderAgentRunner(configWithClaude(await writeFakeClaude(dir)));

    const result = await runner.runProjectSession({
      provider: 'claude',
      cwd: dir,
      prompt: 'work',
      tools: { ...TOOLS, env: { VAULT_INJECTED_KEY: 'vault-value' } },
    });

    expect(result.ok).toBe(true);
    const seen = JSON.parse(await readFile(join(dir, 'seen.json'), 'utf8'));
    expect(seen.vaultEnv).toBe('vault-value');
  });

  it('leaves the child environment untouched when tools carry no env', async () => {
    const runner = new ProviderAgentRunner(configWithClaude(await writeFakeClaude(dir)));

    const result = await runner.runProjectSession({
      provider: 'claude',
      cwd: dir,
      prompt: 'work',
      tools: TOOLS,
    });

    expect(result.ok).toBe(true);
    const seen = JSON.parse(await readFile(join(dir, 'seen.json'), 'utf8'));
    expect(seen.vaultEnv).toBeNull();
  });

  it('adds no toolbox flags when tools are absent', async () => {
    const runner = new ProviderAgentRunner(configWithClaude(await writeFakeClaude(dir)));

    const result = await runner.runProjectSession({ provider: 'claude', cwd: dir, prompt: 'work' });

    expect(result.ok).toBe(true);
    const argv: string[] = JSON.parse(await readFile(join(dir, 'argv.json'), 'utf8'));
    expect(argv).not.toContain('--strict-mcp-config');
    expect(argv).not.toContain('--plugin-dir');
    expect(argv).not.toContain('--mcp-config');
  });
});

function configWithClaude(cliPath: string): AgentRunnerConfig {
  return {
    defaultProvider: 'claude',
    providers: {
      claude: { type: 'claude', enabled: true, cliPath, dangerouslySkipPermissions: true },
      cursor: {
        type: 'cursor',
        enabled: true,
        model: 'gpt-5.5',
        force: false,
        trust: true,
        approveMcps: true,
      },
    },
  };
}

/**
 * Fake `claude` CLI: dumps argv, snapshots the materialized plugin/mcp files
 * (they only exist during the run), and prints a success result envelope.
 */
async function writeFakeClaude(dir: string): Promise<string> {
  const script = join(dir, 'fake-claude.mjs');
  await writeFile(
    script,
    `
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const argv = process.argv.slice(2);
writeFileSync(join(process.cwd(), 'argv.json'), JSON.stringify(argv));
const seen = {};
const pluginIdx = argv.indexOf('--plugin-dir');
if (pluginIdx !== -1) {
  seen.skillMd = readFileSync(join(argv[pluginIdx + 1], 'skills', 'my-skill', 'SKILL.md'), 'utf8');
}
const mcpIdx = argv.indexOf('--mcp-config');
if (mcpIdx !== -1) {
  seen.mcp = JSON.parse(readFileSync(argv[mcpIdx + 1], 'utf8'));
}
seen.vaultEnv = process.env.VAULT_INJECTED_KEY ?? null;
writeFileSync(join(process.cwd(), 'seen.json'), JSON.stringify(seen));
console.log(JSON.stringify({
  type: 'result',
  subtype: 'success',
  result: 'done',
  session_id: 'fake-session',
  duration_ms: 1,
}));
`,
    'utf8',
  );
  if (process.platform !== 'win32') {
    await chmod(script, 0o755);
  }
  return `node "${script}"`;
}
