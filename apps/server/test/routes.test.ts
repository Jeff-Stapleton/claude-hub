import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { HubPaths, Store, type Trigger } from '@claude-hub/core';
import { registerProjectRoutes } from '../src/routes/projects.js';
import { registerChannelRoutes } from '../src/routes/channels.js';
import { registerOrchestratorRoutes } from '../src/routes/orchestrator.js';
import { registerTriggerRoutes } from '../src/routes/triggers.js';
import type { TriggerRunner } from '@claude-hub/triggers';

describe('project routes', () => {
  let app: FastifyInstance;
  let store: Store;
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'routes-test-'));
    store = new Store(new HubPaths(root));
    await store.load();
    app = Fastify();
    await registerProjectRoutes(app, store);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  it('POST /api/projects creates a project', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { path: '/tmp/myproj', alias: 'myproj' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.path).toBe('/tmp/myproj');
    expect(body.alias).toBe('myproj');
    expect(body.id).toBeDefined();
    expect(store.projects()).toHaveLength(1);
  });

  it('POST /api/projects rejects missing path', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { alias: 'no-path' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/projects returns existing project if path is duplicate', async () => {
    await app.inject({ method: 'POST', url: '/api/projects', payload: { path: '/x' } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { path: '/x' },
    });
    expect(res.statusCode).toBe(200);
    expect(store.projects()).toHaveLength(1);
  });

  it('DELETE /api/projects/:id removes a project', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { path: '/del' },
    });
    const id = JSON.parse(create.body).id;
    const res = await app.inject({ method: 'DELETE', url: `/api/projects/${id}` });
    expect(res.statusCode).toBe(200);
    expect(store.projects()).toHaveLength(0);
  });

  it('DELETE /api/projects/:id returns 404 for unknown id', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/projects/nope' });
    expect(res.statusCode).toBe(404);
  });
});

describe('channel routes', () => {
  let app: FastifyInstance;
  let store: Store;
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'chan-test-'));
    store = new Store(new HubPaths(root));
    await store.load();
    app = Fastify();
    await registerChannelRoutes(app, store);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  it('PUT /api/channels/discord saves config', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/channels/discord',
      payload: { botToken: 'tok', allowedUserIds: ['111', '222'] },
    });
    expect(res.statusCode).toBe(200);
    const ch = store.channels().find((c) => c.type === 'discord');
    expect(ch).toBeDefined();
    expect(ch!.botToken).toBe('tok');
    expect(ch!.allowedUserIds).toEqual(['111', '222']);
  });

  it('PUT with empty botToken removes the Discord channel', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/channels/discord',
      payload: { botToken: 'tok', allowedUserIds: [] },
    });
    expect(store.channels()).toHaveLength(1);

    await app.inject({
      method: 'PUT',
      url: '/api/channels/discord',
      payload: { botToken: '' },
    });
    expect(store.channels()).toHaveLength(0);
  });

  it('PUT preserves existing token when botToken is omitted', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/channels/discord',
      payload: { botToken: 'original' },
    });
    await app.inject({
      method: 'PUT',
      url: '/api/channels/discord',
      payload: { allowedUserIds: ['999'] },
    });
    const ch = store.channels().find((c) => c.type === 'discord');
    expect(ch!.botToken).toBe('original');
    expect(ch!.allowedUserIds).toEqual(['999']);
  });
});

describe('orchestrator routes', () => {
  let app: FastifyInstance;
  let store: Store;
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'orch-routes-'));
    store = new Store(new HubPaths(root));
    await store.load();
    app = Fastify();
    await registerOrchestratorRoutes(app, store);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  it('POST /api/orchestrator/clear-sessions empties channelSessions', async () => {
    await store.update('orchestrator', (cur) => ({
      ...cur,
      channelSessions: { 'discord:alice': 's1', 'discord:bob': 's2' },
    }));
    expect(Object.keys(store.orchestrator().channelSessions)).toHaveLength(2);

    const res = await app.inject({
      method: 'POST',
      url: '/api/orchestrator/clear-sessions',
    });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(store.orchestrator().channelSessions)).toHaveLength(0);
  });
});

describe('trigger routes', () => {
  let app: FastifyInstance;
  let store: Store;
  let root: string;
  let projectId: string;
  const mockRunner = { run: vi.fn() } as unknown as TriggerRunner;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'trig-routes-'));
    store = new Store(new HubPaths(root));
    await store.load();
    // Seed a project so trigger creation succeeds.
    await store.update('projects', [
      { id: 'proj-1', path: '/tmp/proj', addedAt: new Date().toISOString() },
    ]);
    projectId = 'proj-1';
    app = Fastify();
    await registerTriggerRoutes(app, store, mockRunner);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  it('POST /api/triggers/cron creates a trigger', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/triggers/cron',
      payload: {
        name: 'daily',
        projectId,
        prompt: 'summarize',
        cronExpr: '0 9 * * *',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.type).toBe('cron');
    expect(body.name).toBe('daily');
    expect(store.triggers()).toHaveLength(1);
  });

  it('POST /api/triggers/cron rejects missing fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/triggers/cron',
      payload: { name: 'incomplete' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/required/);
  });

  it('POST /api/triggers/cron rejects invalid cron expression', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/triggers/cron',
      payload: {
        name: 'bad',
        projectId,
        prompt: 'x',
        cronExpr: 'not a cron',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/invalid cron/);
  });

  it('POST /api/triggers/cron rejects unknown project', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/triggers/cron',
      payload: {
        name: 'orphan',
        projectId: 'does-not-exist',
        prompt: 'x',
        cronExpr: '* * * * *',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/unknown projectId/);
  });

  it('POST /api/triggers/:id/run returns 202 with JSON body', async () => {
    // Create a trigger first
    const create = await app.inject({
      method: 'POST',
      url: '/api/triggers/cron',
      payload: {
        name: 'test',
        projectId,
        prompt: 'hello',
        cronExpr: '0 0 1 1 *',
      },
    });
    const triggerId = JSON.parse(create.body).id;

    // Run-now: the body MUST be '{}', not empty — otherwise Fastify throws
    // FST_ERR_CTP_EMPTY_JSON_BODY because the content-type is
    // application/json.
    const res = await app.inject({
      method: 'POST',
      url: `/api/triggers/${triggerId}/run`,
      payload: {},
    });
    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body).ok).toBe(true);
  });

  it('POST /api/triggers/:id/run returns 404 for unknown trigger', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/triggers/nonexistent/run',
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE /api/triggers/:id removes a trigger', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/triggers/cron',
      payload: {
        name: 'doomed',
        projectId,
        prompt: 'x',
        cronExpr: '0 0 1 1 *',
      },
    });
    const id = JSON.parse(create.body).id;
    const res = await app.inject({ method: 'DELETE', url: `/api/triggers/${id}` });
    expect(res.statusCode).toBe(200);
    expect(store.triggers()).toHaveLength(0);
  });
});
