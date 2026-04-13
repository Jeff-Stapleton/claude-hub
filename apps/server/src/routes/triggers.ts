import type { Store, Trigger } from '@claude-hub/core';
import { readRecentTriggerRuns, type TriggerRunner } from '@claude-hub/triggers';
import cron from 'node-cron';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

interface CreateCronBody {
  name: string;
  projectId: string;
  prompt: string;
  cronExpr: string;
  notify?: { channelId: string };
}

/**
 * REST for trigger CRUD. Only cron is wired in this step — webhook CRUD
 * lands next with its dynamic-route registration.
 */
export async function registerTriggerRoutes(
  app: FastifyInstance,
  store: Store,
  runner: TriggerRunner,
): Promise<void> {
  app.post<{ Body: CreateCronBody }>('/api/triggers/cron', async (req, reply) => {
    const { name, projectId, prompt, cronExpr, notify } = req.body ?? ({} as CreateCronBody);
    if (!name || !projectId || !prompt || !cronExpr) {
      return reply
        .code(400)
        .send({ error: 'name, projectId, prompt, and cronExpr are required' });
    }
    if (!cron.validate(cronExpr)) {
      return reply.code(400).send({ error: `invalid cron expression: ${cronExpr}` });
    }
    if (!store.projects().some((p) => p.id === projectId)) {
      return reply.code(400).send({ error: `unknown projectId: ${projectId}` });
    }

    const trigger: Trigger = {
      id: randomUUID(),
      type: 'cron',
      name,
      projectId,
      prompt,
      cronExpr,
      ...(notify ? { notify } : {}),
    };
    await store.update('triggers', (current) => [...current, trigger]);
    return trigger;
  });

  app.delete<{ Params: { id: string } }>('/api/triggers/:id', async (req, reply) => {
    const before = store.triggers().length;
    await store.update('triggers', (current) => current.filter((t) => t.id !== req.params.id));
    if (store.triggers().length === before) {
      return reply.code(404).send({ error: 'not found' });
    }
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/triggers/:id/run', async (req, reply) => {
    const trigger = store.triggers().find((t) => t.id === req.params.id);
    if (!trigger) return reply.code(404).send({ error: 'not found' });
    // Fire-and-forget; caller can re-fetch state for the resulting lastRun.
    void runner.run(trigger);
    return reply.code(202).send({ ok: true });
  });

  app.get<{ Params: { id: string } }>('/api/triggers/:id/runs', async (req, reply) => {
    const trigger = store.triggers().find((t) => t.id === req.params.id);
    if (!trigger) return reply.code(404).send({ error: 'not found' });
    return readRecentTriggerRuns(store.paths, trigger.id, 50);
  });
}
