import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ResolvedMcpServer, RunToolAssignments } from './types.js';

export interface MaterializedClaudeTools {
  /** Root temp dir holding the plugin + mcp config; removed by cleanup(). */
  dir: string;
  /** Flags to append to the claude CLI invocation. */
  extraArgs: string[];
  cleanup: () => Promise<void>;
}

export interface MaterializedCursorTools {
  /** Root temp dir holding the Cursor plugin; removed by cleanup(). */
  dir: string;
  /** Flags to append to the Cursor CLI invocation. */
  extraArgs: string[];
  cleanup: () => Promise<void>;
}

/**
 * Materializes one run's tool assignments into an ephemeral directory the
 * claude CLI can consume:
 *
 *   <tmp>/plugin/.claude-plugin/plugin.json   loaded via --plugin-dir
 *   <tmp>/plugin/skills/<name>/SKILL.md       (only assigned skills)
 *   <tmp>/mcp.json                            loaded via --mcp-config
 *
 * --strict-mcp-config is always passed — even with zero assigned servers —
 * so a stage run can't inherit MCP servers from the project's .mcp.json or
 * the user's global config. That is what makes tools deny-by-default.
 *
 * Nothing is ever written into the project working tree, and the temp dir
 * only lives for the duration of one CLI invocation (mcp.json can carry
 * secrets in env/headers).
 */
export async function materializeClaudeTools(
  tools: RunToolAssignments,
): Promise<MaterializedClaudeTools> {
  const dir = await mkdtemp(join(tmpdir(), 'claude-hub-tools-'));
  const extraArgs: string[] = [];

  try {
    if (tools.skills.length > 0) {
      const pluginDir = join(dir, 'plugin');
      await mkdir(join(pluginDir, '.claude-plugin'), { recursive: true });
      await writeFile(
        join(pluginDir, '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name: 'hub-toolbox', version: '0.0.0' }, null, 2),
        'utf8',
      );
      await writeSkills(pluginDir, tools.skills);
      extraArgs.push('--plugin-dir', toForwardSlashes(pluginDir));
    }

    if (tools.mcpServers.length > 0) {
      const mcpPath = join(dir, 'mcp.json');
      await writeFile(mcpPath, JSON.stringify(buildMcpConfig(tools.mcpServers), null, 2), {
        encoding: 'utf8',
        mode: 0o600,
      });
      extraArgs.push('--mcp-config', toForwardSlashes(mcpPath));
    }
    extraArgs.push('--strict-mcp-config');
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }

  return {
    dir,
    extraArgs,
    cleanup: () => rm(dir, { recursive: true, force: true }).catch(() => undefined),
  };
}

/**
 * Materializes one run's assignments as an ephemeral Cursor plugin. Cursor
 * discovers both skills and the root mcp.json through --plugin-dir, so the
 * user's project and global Cursor configuration remain untouched.
 */
export async function materializeCursorTools(
  tools: RunToolAssignments,
): Promise<MaterializedCursorTools> {
  const dir = await mkdtemp(join(tmpdir(), 'claude-hub-cursor-tools-'));
  const pluginDir = join(dir, 'plugin');

  try {
    await mkdir(join(pluginDir, '.cursor-plugin'), { recursive: true });
    await writeFile(
      join(pluginDir, '.cursor-plugin', 'plugin.json'),
      JSON.stringify({ name: 'hub-toolbox', version: '0.0.0' }, null, 2),
      'utf8',
    );
    await writeSkills(pluginDir, tools.skills);

    if (tools.mcpServers.length > 0) {
      await writeFile(
        join(pluginDir, 'mcp.json'),
        JSON.stringify(buildMcpConfig(tools.mcpServers), null, 2),
        { encoding: 'utf8', mode: 0o600 },
      );
    }
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }

  return {
    dir,
    extraArgs: ['--plugin-dir', toForwardSlashes(pluginDir)],
    cleanup: () => rm(dir, { recursive: true, force: true }).catch(() => undefined),
  };
}

async function writeSkills(
  pluginDir: string,
  skills: RunToolAssignments['skills'],
): Promise<void> {
  for (const skill of skills) {
    const skillDir = join(pluginDir, 'skills', skill.name);
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), renderSkillMd(skill), 'utf8');
  }
}

function renderSkillMd(skill: { name: string; description: string; body: string }): string {
  return `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n${skill.body}\n`;
}

function buildMcpConfig(servers: ResolvedMcpServer[]): {
  mcpServers: Record<string, unknown>;
} {
  const mcpServers: Record<string, unknown> = {};
  for (const server of servers) {
    const t = server.transport;
    mcpServers[server.name] =
      t.type === 'stdio'
        ? {
            command: t.command,
            ...(t.args !== undefined ? { args: t.args } : {}),
            ...(t.env !== undefined ? { env: t.env } : {}),
          }
        : {
            type: 'http',
            url: t.url,
            ...(t.headers !== undefined ? { headers: t.headers } : {}),
          };
  }
  return { mcpServers };
}

function toForwardSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}
