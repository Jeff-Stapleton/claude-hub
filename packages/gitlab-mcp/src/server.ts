#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ZodRawShape } from 'zod';
import { GitlabClient, resolveConfig } from './gitlabClient.js';
import { runGit } from './git.js';
import { makeTools } from './tools.js';

/**
 * Stdio MCP server giving agents basic IC git functionality on GitLab:
 * clone, branch, push (git CLI with per-invocation token injection) and
 * create/list/view/approve merge requests (REST v4 API).
 *
 * Config comes from the transport env the hub injects at run time:
 *   GITLAB_TOKEN — required vault key; API tools fail with a readable hint
 *                  until the user pastes a token into the hub vault.
 *   GITLAB_URL   — optional, defaults to https://gitlab.com.
 */

async function main(): Promise<void> {
  const server = new McpServer({
    name: 'gitlab',
    version: '0.0.0',
  });

  const config = resolveConfig();
  const client = new GitlabClient(config);
  const tools = makeTools({ client, git: runGit, config });

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
  console.error('[gitlab mcp] fatal:', err);
  process.exit(1);
});
