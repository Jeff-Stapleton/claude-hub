import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/**
 * Writes an MCP config file that tells `claude` how to spawn our stdio
 * hub-mcp server. The orchestrator passes `--mcp-config <path>` to every
 * spawn so CC can call hub tools (list_projects, spawn_session, ...).
 *
 * The config uses forward-slash paths so it parses as JSON on Windows
 * (backslashes would need double-escaping).
 */
export async function writeOrchestratorMcpConfig(opts: {
  /** Absolute path to the directory the config file should live in. */
  dir: string;
  /** Absolute path to packages/hub-mcp/dist/server.js. */
  hubMcpServerPath: string;
  /** URL the MCP server should talk to — usually the hub itself. */
  hubUrl: string;
}): Promise<string> {
  const configPath = resolve(opts.dir, 'hub-mcp-config.json');
  await mkdir(dirname(configPath), { recursive: true });
  const config = {
    mcpServers: {
      hub: {
        command: 'node',
        args: [toForwardSlashes(opts.hubMcpServerPath)],
        env: { CLAUDE_HUB_URL: opts.hubUrl },
      },
    },
  };
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
  return configPath;
}

/**
 * Cursor CLI discovers MCP servers from .cursor/mcp.json under the workspace.
 * Keeping this inside the orchestrator workdir scopes hub tools to hub-managed
 * orchestrator runs instead of registering them globally.
 */
export async function writeCursorOrchestratorMcpConfig(opts: {
  /** Absolute path to the orchestrator workdir. */
  workdir: string;
  /** Absolute path to packages/hub-mcp/dist/server.js. */
  hubMcpServerPath: string;
  /** URL the MCP server should talk to — usually the hub itself. */
  hubUrl: string;
}): Promise<string> {
  const configPath = resolve(opts.workdir, '.cursor', 'mcp.json');
  await mkdir(dirname(configPath), { recursive: true });
  const config = {
    mcpServers: {
      hub: {
        command: 'node',
        args: [toForwardSlashes(opts.hubMcpServerPath)],
        env: { CLAUDE_HUB_URL: opts.hubUrl },
      },
    },
  };
  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
  return configPath;
}

function toForwardSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}
