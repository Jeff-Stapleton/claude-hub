import type { HubPaths, ISODateString, PipelineStageId, WorkItem } from '@claude-hub/core';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Pipeline history is append-only JSONL, mirroring trigger history:
 *   - one file per work item with a record per stage execution (full
 *     prompts/outputs — the live WorkItem only keeps truncated output)
 *   - one file per project archiving terminal (done/cancelled) work items
 */

export interface StageRunRecord {
  workItemId: string;
  stage: PipelineStageId;
  status: 'success' | 'failed' | 'interrupted';
  startedAt: ISODateString;
  finishedAt: ISODateString;
  prompt?: string;
  output?: string;
  error?: string;
}

export async function appendStageRun(paths: HubPaths, record: StageRunRecord): Promise<void> {
  const file = paths.workItemHistoryFile(record.workItemId);
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, JSON.stringify(record) + '\n', 'utf8');
}

/** Most recent N stage records for a work item, newest-first. */
export async function readWorkItemStageRuns(
  paths: HubPaths,
  workItemId: string,
  limit = 50,
): Promise<StageRunRecord[]> {
  return readJsonl<StageRunRecord>(paths.workItemHistoryFile(workItemId), limit);
}

/** Append a terminal work item to its project's archive. */
export async function archiveWorkItem(paths: HubPaths, item: WorkItem): Promise<void> {
  const file = paths.pipelineArchiveFile(item.projectId);
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, JSON.stringify(item) + '\n', 'utf8');
}

/** Most recent N archived work items for a project, newest-first. */
export async function readArchivedWorkItems(
  paths: HubPaths,
  projectId: string,
  limit = 50,
): Promise<WorkItem[]> {
  return readJsonl<WorkItem>(paths.pipelineArchiveFile(projectId), limit);
}

async function readJsonl<T>(file: string, limit: number): Promise<T[]> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (err) {
    if (isEnoent(err)) return [];
    throw err;
  }
  const lines = raw.split('\n').filter((l) => l.length > 0);
  return lines
    .slice(-limit)
    .reverse()
    .map((line) => {
      try {
        return JSON.parse(line) as T;
      } catch {
        return null;
      }
    })
    .filter((r): r is T => r !== null);
}

function isEnoent(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT';
}
