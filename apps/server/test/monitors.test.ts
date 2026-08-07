import { HubPaths, Store, type Project } from '@claude-hub/core';
import type { ProjectMonitorScheduler } from '@claude-hub/pipeline';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerMonitorRoutes } from '../src/routes/monitors.js';

describe('monitor routes', () => {
  let root: string;
  let store: Store;
  let app: FastifyInstance;
  const scheduler = { runNow: vi.fn() } as unknown as ProjectMonitorScheduler;
  const project: Project = {
    id: 'proj-1',
    path: '/tmp/proj-1',
    name: 'demo',
    vision: '',
    repos: [],
    addedAt: new Date().toISOString(),
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'monitor-routes-test-'));
    store = new Store(new HubPaths(root));
    await store.load();
    await store.update('projects', [project]);
    app = Fastify();
    await registerMonitorRoutes(app, store, scheduler);
  });

  afterEach(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  it('persists command check cwd relative to the project root', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/projects/proj-1/monitor',
      payload: {
        enabled: true,
        fileDefectOnFailure: true,
        checks: [
          {
            name: 'smoke',
            type: 'command',
            intervalMinutes: 15,
            timeoutMs: 60_000,
            cwd: 'operations-back-end/readonly-api',
            command: 'make smoke-prod',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().checks[0]).toMatchObject({
      type: 'command',
      cwd: 'operations-back-end/readonly-api',
      command: 'make smoke-prod',
    });
  });

  it('rejects command check cwd values outside the project root', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/projects/proj-1/monitor',
      payload: {
        enabled: true,
        fileDefectOnFailure: true,
        checks: [
          {
            name: 'smoke',
            type: 'command',
            intervalMinutes: 15,
            cwd: '../readonly-api',
            command: 'make smoke-prod',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('cwd cannot leave the project root');
  });
});
