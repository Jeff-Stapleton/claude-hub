import { HubPaths, type TriggerRun } from '@claude-hub/core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendTriggerRun, readRecentTriggerRuns } from '../src/history.js';

describe('trigger history', () => {
  let root: string;
  let paths: HubPaths;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'trig-hist-'));
    paths = new HubPaths(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('returns [] for a trigger with no history', async () => {
    expect(await readRecentTriggerRuns(paths, 'nope')).toEqual([]);
  });

  it('appends runs and reads them newest-first', async () => {
    const runs: TriggerRun[] = [
      { id: 'r1', triggerId: 't1', startedAt: 't', status: 'success', prompt: 'a' },
      { id: 'r2', triggerId: 't1', startedAt: 't', status: 'error', prompt: 'b', error: 'x' },
    ];
    for (const r of runs) await appendTriggerRun(paths, r);

    const recent = await readRecentTriggerRuns(paths, 't1');
    expect(recent.map((r) => r.id)).toEqual(['r2', 'r1']);
  });

  it('honors the limit parameter', async () => {
    for (let i = 0; i < 5; i++) {
      await appendTriggerRun(paths, {
        id: `r${i}`,
        triggerId: 't',
        startedAt: 't',
        status: 'success',
        prompt: '',
      });
    }
    const recent = await readRecentTriggerRuns(paths, 't', 2);
    expect(recent.map((r) => r.id)).toEqual(['r4', 'r3']);
  });
});
