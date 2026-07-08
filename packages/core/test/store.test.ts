import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HubPaths } from '../src/paths.js';
import { Store } from '../src/store.js';
import { STORE_SCHEMA_VERSION, type Project } from '../src/types.js';

describe('Store', () => {
  let root: string;
  let store: Store;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'claude-hub-test-'));
    store = new Store(new HubPaths(root));
    await store.load();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('initializes with empty defaults on first load', () => {
    expect(store.projects()).toEqual([]);
    expect(store.channels()).toEqual([]);
    expect(store.triggers()).toEqual([]);
    expect(store.vault()).toEqual([]);
    expect(store.orchestrator().status).toBe('stopped');
    expect(store.config().schemaVersion).toBe(STORE_SCHEMA_VERSION);
  });

  it('persists vault entries and reloads them', async () => {
    const now = '2026-01-01T00:00:00.000Z';
    await store.update('vault', [
      { key: 'GITHUB_TOKEN', value: 'tok', createdAt: now, updatedAt: now },
      { key: 'AWS_REGION', value: null, createdAt: now, updatedAt: now },
    ]);

    const onDisk = JSON.parse(await readFile(join(root, 'vault.json'), 'utf8'));
    expect(onDisk).toHaveLength(2);

    const fresh = new Store(new HubPaths(root));
    await fresh.load();
    expect(fresh.vault()).toEqual([
      { key: 'GITHUB_TOKEN', value: 'tok', createdAt: now, updatedAt: now },
      { key: 'AWS_REGION', value: null, createdAt: now, updatedAt: now },
    ]);
  });

  it('persists projects and emits change', async () => {
    const project: Project = {
      id: 'p1',
      path: '/tmp/example',
      addedAt: new Date().toISOString(),
    };

    let changedKey: string | null = null;
    store.on('change', (key) => {
      changedKey = key;
    });

    await store.update('projects', (current) => [...current, project]);

    expect(store.projects()).toEqual([project]);
    expect(changedKey).toBe('projects');

    const onDisk = JSON.parse(await readFile(join(root, 'projects.json'), 'utf8'));
    expect(onDisk).toEqual([project]);
  });

  it('reload from disk recovers state', async () => {
    await store.update('projects', [
      { id: 'p1', path: '/a', addedAt: '2026-01-01T00:00:00.000Z' },
    ]);

    const fresh = new Store(new HubPaths(root));
    await fresh.load();
    expect(fresh.projects()).toHaveLength(1);
    expect(fresh.projects()[0]?.id).toBe('p1');
  });

  it('refuses to load on schema version mismatch', async () => {
    await store.update('config', (current) => ({ ...current, schemaVersion: 999 }));

    const next = new Store(new HubPaths(root));
    await expect(next.load()).rejects.toThrow(/schema version mismatch/);
  });

  it('updater receives a clone — mutating it does not corrupt prior snapshot', async () => {
    await store.update('projects', [
      { id: 'p1', path: '/a', addedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    const before = store.projects();

    await store.update('projects', (current) => {
      // Mutate the clone — should not affect `before`.
      current[0]!.path = '/mutated';
      return current;
    });

    expect(before[0]?.path).toBe('/a');
    expect(store.projects()[0]?.path).toBe('/mutated');
  });
});
