#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ZodRawShape } from 'zod';
import { ClickUpClient, resolveConfig } from './clickupClient.js';
import { makeTools } from './tools.js';

/**
 * Stdio MCP server giving agents ClickUp task functionality via the REST v2
 * API: browse workspaces/spaces/folders/lists, list and search tasks (with
 * status/assignee/tag/custom-field filters and subtask support), read task
 * details, discover custom fields, and create/update tasks.
 *
 * Config comes from the transport env the hub injects at run time:
 *   CLICKUP_TOKEN   — required vault key; tools fail with a readable hint
 *                     until the user pastes a token into the hub vault.
 *   CLICKUP_API_URL — optional, defaults to https://api.clickup.com.
 */

async function main(): Promise<void> {
  const server = new McpServer({
    name: 'clickup',
    version: '0.0.0',
  });

  const config = resolveConfig();
  const client = new ClickUpClient(config);
  const tools = makeTools({ client, config });

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
  // to stderr so the provider CLI can surface it.
  console.error('[clickup mcp] fatal:', err);
  process.exit(1);
});
