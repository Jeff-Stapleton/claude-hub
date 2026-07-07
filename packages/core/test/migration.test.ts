import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HubPaths, STORE_SCHEMA_VERSION, Store } from '../src/index.js';

describe('store schema migration v2 -> v3', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'migration-test-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('loads a v2 store (no pipelines/workItems files) cleanly', async () => {
    const paths = new HubPaths(root);
    await writeFile(
      paths.file('config'),
      JSON.stringify({ schemaVersion: 2, httpPort: 7878 }),
      'utf8',
    );
    await writeFile(
      paths.file('triggers'),
      JSON.stringify([
        {
          id: 't1',
          type: 'cron',
          name: 'old trigger',
          projectId: 'p1',
          prompt: 'hi',
          cronExpr: '* * * * *',
          // no `mode` — absent means 'run'
        },
      ]),
      'utf8',
    );

    const store = new Store(paths);
    await store.load();

    expect(store.config().schemaVersion).toBe(STORE_SCHEMA_VERSION);
    expect(store.pipelines()).toEqual([]);
    expect(store.workItems()).toEqual([]);
    expect(store.triggers()[0]?.mode).toBeUndefined();
  });

  it('loads a v3 store (no toolbox file) with an empty toolbox', async () => {
    const paths = new HubPaths(root);
    await writeFile(
      paths.file('config'),
      JSON.stringify({ schemaVersion: 3, httpPort: 7878 }),
      'utf8',
    );

    const store = new Store(paths);
    await store.load();

    expect(store.config().schemaVersion).toBe(STORE_SCHEMA_VERSION);
    expect(store.toolbox()).toEqual({ skills: [], mcpServers: [] });
  });

  it('still refuses to load a future schema version', async () => {
    const paths = new HubPaths(root);
    await writeFile(
      paths.file('config'),
      JSON.stringify({ schemaVersion: STORE_SCHEMA_VERSION + 1 }),
      'utf8',
    );
    const store = new Store(paths);
    await expect(store.load()).rejects.toThrow(/schema version mismatch/);
  });

  it('migrates v4 projects ({path, alias}) to the v5 repo shape and persists once', async () => {
    const paths = new HubPaths(root);
    await writeFile(
      paths.file('config'),
      JSON.stringify({ schemaVersion: 4, httpPort: 7878 }),
      'utf8',
    );
    await writeFile(
      paths.file('projects'),
      JSON.stringify([
        { id: 'p1', path: '/home/me/code/frontend', alias: 'web', addedAt: '2026-01-01T00:00:00Z' },
        { id: 'p2', path: '/home/me/code/api', addedAt: '2026-01-02T00:00:00Z' },
      ]),
      'utf8',
    );

    const store = new Store(paths);
    await store.load();

    expect(store.config().schemaVersion).toBe(STORE_SCHEMA_VERSION);
    expect(store.config().projectsRoot).toBeTruthy();
    expect(store.gitCredentials()).toEqual([]);

    const [p1, p2] = store.projects();
    expect(p1).toMatchObject({ id: 'p1', path: '/home/me/code/frontend', name: 'web', vision: '' });
    expect(p1!.repos).toHaveLength(1);
    expect(p1!.repos[0]).toMatchObject({
      name: 'frontend',
      path: '/home/me/code/frontend',
      origin: 'local',
      status: 'ready',
      addedAt: '2026-01-01T00:00:00Z',
    });
    // No alias -> name falls back to the path basename.
    expect(p2).toMatchObject({ id: 'p2', name: 'api', vision: '' });

    // The migrated shape is persisted at load time, so a second load
    // (fresh Store) sees v5 data without re-migrating.
    const raw = JSON.parse(await readFile(paths.file('projects'), 'utf8'));
    expect(raw[0].repos).toHaveLength(1);
    expect(raw[0].alias).toBeUndefined();
  });

  it('leaves already-v5 projects untouched', async () => {
    const paths = new HubPaths(root);
    const project = {
      id: 'p1',
      path: '/root/proj',
      name: 'proj',
      vision: 'do things',
      repos: [
        {
          id: 'r1',
          name: 'proj',
          path: '/root/proj',
          origin: 'local',
          status: 'ready',
          addedAt: '2026-01-01T00:00:00Z',
        },
      ],
      addedAt: '2026-01-01T00:00:00Z',
    };
    await writeFile(paths.file('projects'), JSON.stringify([project]), 'utf8');

    const store = new Store(paths);
    await store.load();
    expect(store.projects()[0]).toEqual(project);
  });
});
