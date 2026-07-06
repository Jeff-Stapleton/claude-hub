import type { Store, Trigger, WebhookTrigger } from '@claude-hub/core';
import {
  generateWebhookSecret,
  readRecentTriggerRuns,
  verifyWebhookSecret,
  type TriggerRunner,
} from '@claude-hub/triggers';
import cron from 'node-cron';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

interface CreateCronBody {
  name: string;
  projectId: string;
  prompt: string;
  cronExpr: string;
  mode?: 'run' | 'enqueue';
  notify?: { channelId: string };
}

interface CreateWebhookBody {
  name: string;
  projectId: string;
  promptTemplate: string;
  mode?: 'run' | 'enqueue';
  notify?: { channelId: string };
}

function validMode(mode: unknown): mode is 'run' | 'enqueue' | undefined {
  return mode === undefined || mode === 'run' || mode === 'enqueue';
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
    const { name, projectId, prompt, cronExpr, mode, notify } =
      req.body ?? ({} as CreateCronBody);
    if (!name || !projectId || !prompt || !cronExpr) {
      return reply
        .code(400)
        .send({ error: 'name, projectId, prompt, and cronExpr are required' });
    }
    if (!validMode(mode)) {
      return reply.code(400).send({ error: `invalid mode: ${String(mode)}` });
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
      ...(mode !== undefined ? { mode } : {}),
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

  // ---------------------------------------------------------------------
  // Webhook triggers
  // ---------------------------------------------------------------------

  app.post<{ Body: CreateWebhookBody }>('/api/triggers/webhook', async (req, reply) => {
    const { name, projectId, promptTemplate, mode, notify } =
      req.body ?? ({} as CreateWebhookBody);
    if (!name || !projectId || !promptTemplate) {
      return reply
        .code(400)
        .send({ error: 'name, projectId, and promptTemplate are required' });
    }
    if (!validMode(mode)) {
      return reply.code(400).send({ error: `invalid mode: ${String(mode)}` });
    }
    if (!store.projects().some((p) => p.id === projectId)) {
      return reply.code(400).send({ error: `unknown projectId: ${projectId}` });
    }

    const trigger: WebhookTrigger = {
      id: randomUUID(),
      type: 'webhook',
      name,
      projectId,
      promptTemplate,
      secret: generateWebhookSecret(),
      ...(mode !== undefined ? { mode } : {}),
      ...(notify ? { notify } : {}),
    };
    await store.update('triggers', (current) => [...current, trigger]);

    // The POST response is the ONE time we return the plaintext secret.
    // All subsequent state fetches redact it to {secretSet: true}.
    const host = req.headers.host ?? `127.0.0.1:${store.config().httpPort}`;
    return {
      ...trigger,
      url: `http://${host}/triggers/webhooks/${trigger.id}`,
    };
  });

  // ---------------------------------------------------------------------
  // The public webhook firing endpoint
  //
  // Mounted under /triggers/webhooks/:id (NOT /api) so it's clearly part
  // of the public, secret-auth'd surface area rather than the same-origin
  // UI API.
  // ---------------------------------------------------------------------

  app.post<{
    Params: { id: string };
    Headers: { 'x-hub-secret'?: string };
  }>('/triggers/webhooks/:id', async (req, reply) => {
    const trigger = store.triggers().find((t) => t.id === req.params.id);
    if (!trigger || trigger.type !== 'webhook') {
      // 404 rather than 401 so we don't confirm/deny trigger existence
      // to unauthenticated probers.
      return reply.code(404).send({ error: 'not found' });
    }

    const provided = req.headers['x-hub-secret'];
    if (!verifyWebhookSecret(trigger.secret, typeof provided === 'string' ? provided : undefined)) {
      return reply.code(401).send({ error: 'bad secret' });
    }

    // Fire-and-forget. The trigger runner is slow (CC can take minutes);
    // synchronous response would tie up the caller's HTTP connection.
    const payload = req.body;
    void runner.run(trigger, { payload });

    return reply.code(202).send({ ok: true });
  });
}
