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
      for (const skill of tools.skills) {
        const skillDir = join(pluginDir, 'skills', skill.name);
        await mkdir(skillDir, { recursive: true });
        await writeFile(join(skillDir, 'SKILL.md'), renderSkillMd(skill), 'utf8');
      }
      extraArgs.push('--plugin-dir', toForwardSlashes(pluginDir));
    }

    if (tools.mcpServers.length > 0) {
      const mcpPath = join(dir, 'mcp.json');
      await writeFile(mcpPath, JSON.stringify(buildMcpConfig(tools.mcpServers), null, 2), 'utf8');
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

/**
 * Renders assigned skills as a prompt preamble for providers with no
 * skill-loading mechanism (Cursor). Loses progressive disclosure but keeps
 * the assignment semantics identical across providers.
 */
export function renderSkillPreamble(skills: RunToolAssignments['skills']): string {
  if (skills.length === 0) return '';
  const sections = skills.map(
    (s) => `## ${s.name} — ${s.description}\n\n${s.body}`,
  );
  return `# Available skills\n\nUse these when relevant to the task.\n\n${sections.join('\n\n')}\n\n---\n\n`;
}

function toForwardSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}
