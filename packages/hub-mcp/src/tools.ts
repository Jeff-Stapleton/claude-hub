import { z } from 'zod';
import { HubClient } from './client.js';

/**
 * MCP tool handlers. Each handler returns a value that will be serialized
 * into the MCP content response. Errors throw; the MCP server runtime
 * catches them and reports a tool error to the caller.
 */

export interface ToolContext {
  client: HubClient;
}

export function makeTools(ctx: ToolContext) {
  return {
    list_projects: {
      description:
        'List all user-registered projects in the hub. Each project is a working directory CC can run in.',
      input: z.object({}).strict(),
      handler: async () => {
        const state = await ctx.client.get<{ projects: unknown[] }>('/api/state');
        return state.projects;
      },
    },

    add_project: {
      description: 'Register a new project path with the hub.',
      input: z
        .object({
          path: z.string().describe('Absolute path to the project working directory.'),
          alias: z.string().optional().describe('Friendly name (defaults to basename).'),
        })
        .strict(),
      handler: async (args: { path: string; alias?: string }) =>
        ctx.client.post('/api/projects', args),
    },

    spawn_session: {
      description:
        'Run Claude Code with the given prompt inside the project’s directory. Returns the final assistant text plus the session id so follow-ups can resume the conversation.',
      input: z
        .object({
          projectId: z.string(),
          prompt: z.string(),
          sessionId: z
            .string()
            .optional()
            .describe('If set, resume that CC session instead of starting fresh.'),
        })
        .strict(),
      handler: async (args: { projectId: string; prompt: string; sessionId?: string }) => {
        const { projectId, ...body } = args;
        return ctx.client.post(`/api/projects/${encodeURIComponent(projectId)}/spawn`, body);
      },
    },

    list_triggers: {
      description: 'List all configured triggers (cron + webhook).',
      input: z.object({}).strict(),
      handler: async () => {
        const state = await ctx.client.get<{ triggers: unknown[] }>('/api/state');
        return state.triggers;
      },
    },

    create_cron_trigger: {
      description:
        'Create a cron trigger that fires Claude Code against a project on a schedule. Cron expression is a standard 5-field expression (node-cron compatible).',
      input: z
        .object({
          name: z.string(),
          projectId: z.string(),
          prompt: z.string(),
          cronExpr: z.string(),
        })
        .strict(),
      handler: async (args: {
        name: string;
        projectId: string;
        prompt: string;
        cronExpr: string;
      }) => ctx.client.post('/api/triggers/cron', args),
    },

    create_webhook_trigger: {
      description:
        'Create a webhook trigger. Returns the URL plus a one-time plaintext secret that must be passed as the X-Hub-Secret header when the webhook is called. The secret is not recoverable later — share it now.',
      input: z
        .object({
          name: z.string(),
          projectId: z.string(),
          promptTemplate: z
            .string()
            .describe(
              'Template rendered with {{payload.field}} substitutions on each call.',
            ),
        })
        .strict(),
      handler: async (args: { name: string; projectId: string; promptTemplate: string }) =>
        ctx.client.post('/api/triggers/webhook', args),
    },

    delete_trigger: {
      description: 'Remove a trigger by id.',
      input: z.object({ id: z.string() }).strict(),
      handler: async (args: { id: string }) =>
        ctx.client.del(`/api/triggers/${encodeURIComponent(args.id)}`),
    },
  };
}
