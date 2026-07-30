import { HubPaths, type WorkItem } from '@claude-hub/core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { archiveWorkItem, findArchivedWorkItem } from '../src/history.js';

function doneItem(id: string, overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id,
    projectId: 'proj-1',
    title: `item ${id}`,
    request: 'req',
    source: 'manual',
    status: 'done',
    currentStage: 'test',
    stages: { test: { status: 'success' } },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('findArchivedWorkItem', () => {
  let root: string;
  let paths: HubPaths;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'history-test-'));
    paths = new HubPaths(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('finds an archived item by id', async () => {
    await archiveWorkItem(paths, doneItem('a'));
    await archiveWorkItem(paths, doneItem('b'));
    const found = await findArchivedWorkItem(paths, 'proj-1', 'b');
    expect(found?.id).toBe('b');
    expect(found?.status).toBe('done');
  });

  it('returns the newest record when an id was archived twice', async () => {
    await archiveWorkItem(paths, doneItem('a', { status: 'cancelled' }));
    await archiveWorkItem(paths, doneItem('a', { status: 'done' }));
    const found = await findArchivedWorkItem(paths, 'proj-1', 'a');
    expect(found?.status).toBe('done');
  });

  it('returns undefined on miss and for a missing archive file', async () => {
    await archiveWorkItem(paths, doneItem('a'));
    expect(await findArchivedWorkItem(paths, 'proj-1', 'nope')).toBeUndefined();
    expect(await findArchivedWorkItem(paths, 'other-project', 'a')).toBeUndefined();
  });
});
