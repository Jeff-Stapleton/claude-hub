import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeOrchestratorMcpConfig } from '../src/mcpConfig.js';

describe('writeOrchestratorMcpConfig', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mcp-cfg-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes a valid JSON config with forward slashes', async () => {
    const path = await writeOrchestratorMcpConfig({
      dir,
      hubMcpServerPath: 'C:\\Users\\x\\hub-mcp\\dist\\server.js',
      hubUrl: 'http://127.0.0.1:7878',
    });

    const raw = await readFile(path, 'utf8');
    const config = JSON.parse(raw);

    expect(config.mcpServers.hub.command).toBe('node');
    expect(config.mcpServers.hub.args[0]).toBe(
      'C:/Users/x/hub-mcp/dist/server.js',
    );
    expect(config.mcpServers.hub.env.CLAUDE_HUB_URL).toBe(
      'http://127.0.0.1:7878',
    );
    // No backslashes in the args — important for JSON validity on Windows.
    expect(raw).not.toContain('\\\\');
  });

  it('returns the path to the written config', async () => {
    const path = await writeOrchestratorMcpConfig({
      dir,
      hubMcpServerPath: '/usr/local/bin/server.js',
      hubUrl: 'http://localhost:8080',
    });
    expect(path).toContain('hub-mcp-config.json');
  });
});
