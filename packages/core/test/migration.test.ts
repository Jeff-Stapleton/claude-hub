import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
});
