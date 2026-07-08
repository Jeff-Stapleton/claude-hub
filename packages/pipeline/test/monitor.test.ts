import { HubPaths, Store, type PipelineConfig, type WorkItem } from '@claude-hub/core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MonitorScheduler } from '../src/monitor.js';
import type { PipelineRunner } from '../src/runner.js';

function monitorPipeline(intervalMinutes: number): PipelineConfig {
  return {
    projectId: 'proj-1',
    machines: [
      {
        key: 'monitor',
        name: 'Monitor',
        templateId: 'builtin-monitor',
        gate: 'auto',
        resultCheck: 'strict',
        monitor: { intervalMinutes, maxChecks: 3 },
      },
    ],
    updatedAt: new Date().toISOString(),
  };
}

function monitoringItem(id: string): WorkItem {
  return {
    id,
    projectId: 'proj-1',
    title: 'shipped',
    request: 'req',
    source: 'manual',
    status: 'monitoring',
    currentStage: 'monitor',
    stages: {
      monitor: { status: 'running', checksPassed: 0 },
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('MonitorScheduler', () => {
  let root: string;
  let store: Store;
  let scheduler: MonitorScheduler;
  const runMonitorCheck = vi.fn<PipelineRunner['runMonitorCheck']>().mockResolvedValue(undefined);
  const runner = { runMonitorCheck } as unknown as PipelineRunner;

  beforeEach(async () => {
    vi.useFakeTimers();
    root = await mkdtemp(join(tmpdir(), 'monitor-test-'));
    store = new Store(new HubPaths(root));
    await store.load();
    runMonitorCheck.mockClear();
  });

  afterEach(async () => {
    scheduler?.stop();
    vi.useRealTimers();
    await rm(root, { recursive: true, force: true });
  });

  it('fires checks on the configured interval for monitoring items', async () => {
    await store.update('pipelines', [monitorPipeline(1)]);
    await store.update('workItems', [monitoringItem('wi-1')]);

    scheduler = new MonitorScheduler(store, runner);
    scheduler.start();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(runMonitorCheck).toHaveBeenCalledTimes(1);
    expect(runMonitorCheck).toHaveBeenCalledWith('wi-1');

    await vi.advanceTimersByTimeAsync(60_000);
    expect(runMonitorCheck).toHaveBeenCalledTimes(2);
  });

  it('disarms when the item leaves monitoring', async () => {
    await store.update('pipelines', [monitorPipeline(1)]);
    await store.update('workItems', [monitoringItem('wi-1')]);

    scheduler = new MonitorScheduler(store, runner);
    scheduler.start();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(runMonitorCheck).toHaveBeenCalledTimes(1);

    // Item completes -> removed from live store -> reconcile clears the timer.
    await store.update('workItems', []);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(runMonitorCheck).toHaveBeenCalledTimes(1);
  });

  it('does not overlap checks when one is still in flight', async () => {
    await store.update('pipelines', [monitorPipeline(1)]);
    await store.update('workItems', [monitoringItem('wi-1')]);

    let releaseCheck!: () => void;
    runMonitorCheck.mockReturnValue(new Promise((resolve) => (releaseCheck = () => resolve())));

    scheduler = new MonitorScheduler(store, runner);
    scheduler.start();

    await vi.advanceTimersByTimeAsync(180_000); // 3 ticks, first check never resolves
    expect(runMonitorCheck).toHaveBeenCalledTimes(1);
    releaseCheck();
  });
});
