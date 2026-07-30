import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { HubPaths, Store, type Project, type WorkItem } from '@claude-hub/core';
import { appendStageRun, archiveWorkItem, type PipelineRunner } from '@claude-hub/pipeline';
import { registerPipelineRoutes } from '../src/routes/pipeline.js';

function project(id: string): Project {
  return {
    id,
    path: `/tmp/${id}`,
    name: id,
    vision: '',
    repos: [],
    addedAt: new Date().toISOString(),
  };
}

function workItem(id: string, projectId: string, overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id,
    projectId,
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

describe('work-item detail route', () => {
  let app: FastifyInstance;
  let store: Store;
  let root: string;
  const runner = {
    enqueue: vi.fn(),
    approve: vi.fn(),
    retry: vi.fn(),
    cancel: vi.fn(),
    reconcileLineEdit: vi.fn(),
  } as unknown as PipelineRunner;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pipeline-routes-test-'));
    store = new Store(new HubPaths(root));
    await store.load();
    await store.update('projects', () => [project('proj-1'), project('proj-2')]);
    app = Fastify();
    await registerPipelineRoutes(app, store, runner);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  it('returns a live item with archived: false', async () => {
    const live = workItem('live-1', 'proj-1', { status: 'running' });
    await store.update('workItems', () => [live]);
    const res = await app.inject({ method: 'GET', url: '/api/work-items/live-1' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.item.id).toBe('live-1');
    expect(body.archived).toBe(false);
  });

  it('falls back to the archive with ?projectId and returns stage runs', async () => {
    const done = workItem('done-1', 'proj-2');
    await archiveWorkItem(store.paths, done);
    await appendStageRun(store.paths, {
      workItemId: 'done-1',
      stage: 'test',
      status: 'success',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      output: 'full output',
      summary: 'it worked',
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/work-items/done-1?projectId=proj-2',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.item.status).toBe('done');
    expect(body.archived).toBe(true);
    expect(body.stageRuns).toHaveLength(1);
    expect(body.stageRuns[0].summary).toBe('it worked');
  });

  it('finds an archived item without projectId by scanning project archives', async () => {
    await archiveWorkItem(store.paths, workItem('done-2', 'proj-2'));
    const res = await app.inject({ method: 'GET', url: '/api/work-items/done-2' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.item.id).toBe('done-2');
    expect(body.archived).toBe(true);
  });

  it('404s for an unknown id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/work-items/nope' });
    expect(res.statusCode).toBe(404);
  });
});
