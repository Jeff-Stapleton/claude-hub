import type { HubPaths, TriggerRun } from '@claude-hub/core';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Trigger run history is append-only JSONL per trigger id. Each line is
 * one `TriggerRun` record. Keeps writes cheap and tailing / rotation
 * trivial later.
 */
export async function appendTriggerRun(paths: HubPaths, run: TriggerRun): Promise<void> {
  const file = paths.triggerHistoryFile(run.triggerId);
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, JSON.stringify(run) + '\n', 'utf8');
}

/**
 * Read the most recent N runs for a trigger. Returns them newest-first.
 */
export async function readRecentTriggerRuns(
  paths: HubPaths,
  triggerId: string,
  limit = 20,
): Promise<TriggerRun[]> {
  const file = paths.triggerHistoryFile(triggerId);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (err) {
    if (isEnoent(err)) return [];
    throw err;
  }
  const lines = raw.split('\n').filter((l) => l.length > 0);
  const tail = lines.slice(-limit).reverse();
  return tail
    .map((line) => {
      try {
        return JSON.parse(line) as TriggerRun;
      } catch {
        return null;
      }
    })
    .filter((r): r is TriggerRun => r !== null);
}

function isEnoent(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT';
}
