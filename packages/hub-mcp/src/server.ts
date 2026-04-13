#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ZodRawShape } from 'zod';
import { HubClient } from './client.js';
import { makeTools } from './tools.js';

/**
 * Stdio MCP server registered with Claude Code via --mcp-config. It
 * exposes hub operations as MCP tools. All tool implementations delegate
 * to the hub's own HTTP API (the hub is the single writer), so secrets
 * stay in the hub process and UI/cron/webhook state stays consistent.
 *
 * Invocation (from the hub's orchestrator config):
 *   {
 *     "mcpServers": {
 *       "hub": {
 *         "command": "node",
 *         "args": ["/abs/path/to/packages/hub-mcp/dist/server.js"],
 *         "env": { "CLAUDE_HUB_URL": "http://127.0.0.1:7878" }
 *       }
 *     }
 *   }
 */

async function main(): Promise<void> {
  const server = new McpServer({
    name: 'claude-hub',
    version: '0.0.0',
  });

  const client = new HubClient();
  const tools = makeTools({ client });

  for (const [name, spec] of Object.entries(tools)) {
    // MCP's registerTool expects a ZodRawShape (Record<string, ZodType>),
    // which is exactly what `.shape` on a ZodObject is.
    const shape = spec.input.shape as ZodRawShape;
    server.registerTool(
      name,
      { description: spec.description, inputSchema: shape },
      async (args: unknown) => {
        // Re-validate input here so a bad tool call surfaces a readable error.
        const parsed = spec.input.parse(args ?? {});
        const result = await (spec.handler as (a: unknown) => Promise<unknown>)(parsed);
        return {
          content: [
            {
              type: 'text' as const,
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
            },
          ],
        };
      },
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  // Stdio servers must not write to stdout — that's the MCP channel. Log
  // to stderr so `claude --debug` can surface it.
  console.error('[claude-hub mcp] fatal:', err);
  process.exit(1);
});
