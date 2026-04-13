import type { Store } from '@claude-hub/core';
import type { FastifyInstance } from 'fastify';

/**
 * Orchestrator control endpoints. "Clear sessions" drops the
 * per-conversation session map so the next DM starts fresh — useful when
 * a conversation has drifted or a session id is otherwise wedged.
 */
export async function registerOrchestratorRoutes(
  app: FastifyInstance,
  store: Store,
): Promise<void> {
  app.post('/api/orchestrator/clear-sessions', async () => {
    await store.update('orchestrator', (current) => ({
      ...current,
      channelSessions: {},
    }));
    return { ok: true };
  });
}
