import type { Store } from '@claude-hub/core';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

interface AddProjectBody {
  path: string;
  alias?: string;
}

/**
 * Minimal project CRUD. Path validation is intentionally lax here — the UI
 * is local-only, and the user is the only caller.
 */
export async function registerProjectRoutes(app: FastifyInstance, store: Store): Promise<void> {
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
}
