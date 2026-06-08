import type { AgentRunner } from '@claude-hub/agent-runner';
import type { AgentProviderId, Store } from '@claude-hub/core';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

interface AddProjectBody {
  path: string;
  alias?: string;
}

interface SpawnBody {
  prompt: string;
  sessionId?: string;
  provider?: AgentProviderId;
}

/**
 * Minimal project CRUD. Path validation is intentionally lax here — the UI
 * is local-only, and the user is the only caller.
 */
export async function registerProjectRoutes(
  app: FastifyInstance,
  store: Store,
  runner: AgentRunner,
): Promise<void> {
  app.post<{ Body: AddProjectBody }>('/api/projects', async (req, reply) => {
    const { path, alias } = req.body ?? ({} as AddProjectBody);
    if (!path || typeof path !== 'string') {
      return reply.code(400).send({ error: 'path is required' });
    }
    const existing = store.projects().find((p) => p.path === path);
    if (existing) return existing;

    const project = {
      id: randomUUID(),
      path,
      ...(alias ? { alias } : {}),
      addedAt: new Date().toISOString(),
    };
    await store.update('projects', (current) => [...current, project]);
    return project;
  });

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const { id } = req.params;
    const before = store.projects().length;
    await store.update('projects', (current) => current.filter((p) => p.id !== id));
    if (store.projects().length === before) {
      return reply.code(404).send({ error: 'not found' });
    }
    return { ok: true };
  });

  /**
   * Synchronous one-shot spawn of the configured agent in a project's dir. Intended
   * for the orchestrator's hub-MCP tool, which needs the transcript inline
   * rather than fire-and-forget. Timeout is enforced by agent-runner.
   */
  app.post<{ Params: { id: string }; Body: SpawnBody }>(
    '/api/projects/:id/spawn',
    async (req, reply) => {
      const { id } = req.params;
      const project = store.projects().find((p) => p.id === id);
      if (!project) return reply.code(404).send({ error: 'project not found' });

      const { prompt, sessionId, provider } = req.body ?? ({} as SpawnBody);
      if (!prompt || typeof prompt !== 'string') {
        return reply.code(400).send({ error: 'prompt is required' });
      }

      const result = await runner.runProjectSession({
        ...(provider ? { provider } : {}),
        cwd: project.path,
        prompt,
        ...(sessionId ? { sessionId } : {}),
      });
      if (!result.ok) {
        return reply.code(500).send({ error: result.error, stderr: result.stderr });
      }
      return {
        sessionId: result.sessionId,
        text: result.text,
        durationMs: result.durationMs,
        ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
      };
    },
  );
}
