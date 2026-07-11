import type { Store, TriggerRun } from '@claude-hub/core';
import { readRecentMachineRunEvents, type MachineRunEvent } from '@claude-hub/pipeline';
import { readRecentTriggerRuns } from '@claude-hub/triggers';
import type { FastifyInstance } from 'fastify';

export type ActivityEntry =
  | { kind: 'trigger-run'; run: TriggerRun; triggerName: string }
  | { kind: 'machine-run'; event: MachineRunEvent };

const startedAt = (e: ActivityEntry): string =>
  e.kind === 'trigger-run' ? e.run.startedAt : e.event.startedAt;

/**
 * Unified activity feed: trigger runs across all triggers interleaved with
 * machine runs from the denormalized machine-run log; a later version will
 * add channel messages. Sorted newest-first.
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
    const machineRuns = await readRecentMachineRunEvents(store.paths, 100);
    const merged: ActivityEntry[] = [
      ...perTrigger.flat(),
      ...machineRuns.map<ActivityEntry>((event) => ({ kind: 'machine-run', event })),
    ];
    merged.sort((a, b) => (startedAt(b) > startedAt(a) ? 1 : -1));
    return merged.slice(0, 100);
  });
}
