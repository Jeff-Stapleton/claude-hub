import type { Store, TriggerRun } from '@claude-hub/core';
import { readRecentTriggerRuns } from '@claude-hub/triggers';
import type { FastifyInstance } from 'fastify';

export interface ActivityEntry {
  kind: 'trigger-run';
  run: TriggerRun;
  triggerName: string;
}

/**
 * Unified activity feed. v1 merges trigger runs across all triggers; a
 * later version will interleave channel messages. Sorted newest-first.
 */
export async function registerActivityRoutes(
  app: FastifyInstance,
  store: Store,
): Promise<void> {
  app.get('/api/activity', async () => {
    const triggers = store.triggers();
    const perTrigger = await Promise.all(
      triggers.map(async (t) => {
        const runs = await readRecentTriggerRuns(store.paths, t.id, 25);
        return runs.map<ActivityEntry>((run) => ({
          kind: 'trigger-run',
          run,
          triggerName: t.name,
        }));
      }),
    );
    const merged = perTrigger.flat();
    merged.sort((a, b) => (b.run.startedAt > a.run.startedAt ? 1 : -1));
    return merged.slice(0, 100);
  });
}
