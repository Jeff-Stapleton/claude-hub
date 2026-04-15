import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { HubPaths, Store, type Trigger } from '@claude-hub/core';
import { registerProjectRoutes } from '../src/routes/projects.js';
import { registerChannelRoutes } from '../src/routes/channels.js';
import { registerOrchestratorRoutes } from '../src/routes/orchestrator.js';

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
