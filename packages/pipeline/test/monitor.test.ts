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

function monitoringItem(id: string, lastCheckAt?: string): WorkItem {
  return {
    id,
    projectId: 'proj-1',
    title: 'shipped',
    request: 'req',
    source: 'manual',
    status: 'monitoring',
    currentStage: 'monitor',
    stages: {
      monitor: {
        status: 'running',
        checksPassed: 0,
        ...(lastCheckAt !== undefined ? { lastCheckAt } : {}),
      },
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

  it('fires an immediate first check, then checks on the configured interval', async () => {
    await store.update('pipelines', [monitorPipeline(1)]);
    await store.update('workItems', [monitoringItem('wi-1')]);

    scheduler = new MonitorScheduler(store, runner);
    scheduler.start();

    // Never-checked machine gets its first check at park time.
    expect(runMonitorCheck).toHaveBeenCalledTimes(1);
    expect(runMonitorCheck).toHaveBeenCalledWith('wi-1');

    await vi.advanceTimersByTimeAsync(60_000);
    expect(runMonitorCheck).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(runMonitorCheck).toHaveBeenCalledTimes(3);
  });

  it('skips the immediate check when the machine was already checked', async () => {
    await store.update('pipelines', [monitorPipeline(1)]);
    await store.update('workItems', [monitoringItem('wi-1', new Date().toISOString())]);

    scheduler = new MonitorScheduler(store, runner);
    scheduler.start();

    expect(runMonitorCheck).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runMonitorCheck).toHaveBeenCalledTimes(1);
  });

  it('does not re-fire the immediate check on unrelated reconciles', async () => {
    await store.update('pipelines', [monitorPipeline(1)]);
    await store.update('workItems', [monitoringItem('wi-1')]);

    // Simulate a real check: stamp lastCheckAt like runMonitorCheck does.
    runMonitorCheck.mockImplementation(async (id: string) => {
      await store.update('workItems', (items) =>
        items.map((it) =>
          it.id === id
            ? {
                ...it,
                stages: {
                  ...it.stages,
                  monitor: { ...it.stages['monitor']!, lastCheckAt: new Date().toISOString() },
                },
              }
            : it,
        ),
      );
    });

    scheduler = new MonitorScheduler(store, runner);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0); // let the immediate check settle

    expect(runMonitorCheck).toHaveBeenCalledTimes(1);

    // An unrelated pipelines change triggers reconcile; no second immediate check.
    await store.update('pipelines', [monitorPipeline(1)]);
    await vi.advanceTimersByTimeAsync(0);
    expect(runMonitorCheck).toHaveBeenCalledTimes(1);
    runMonitorCheck.mockResolvedValue(undefined);
  });

  it('disarms when the item leaves monitoring', async () => {
    await store.update('pipelines', [monitorPipeline(1)]);
    await store.update('workItems', [monitoringItem('wi-1')]);

    scheduler = new MonitorScheduler(store, runner);
    scheduler.start();

    expect(runMonitorCheck).toHaveBeenCalledTimes(1); // immediate first check
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runMonitorCheck).toHaveBeenCalledTimes(2);

    // Item completes -> removed from live store -> reconcile clears the timer.
    await store.update('workItems', []);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(runMonitorCheck).toHaveBeenCalledTimes(2);
  });

  it('does not overlap checks when one is still in flight', async () => {
    await store.update('pipelines', [monitorPipeline(1)]);
    await store.update('workItems', [monitoringItem('wi-1')]);

    let releaseCheck!: () => void;
    runMonitorCheck.mockReturnValue(new Promise((resolve) => (releaseCheck = () => resolve())));

    scheduler = new MonitorScheduler(store, runner);
    scheduler.start();

    // Immediate check fires and never resolves; interval ticks are skipped.
    await vi.advanceTimersByTimeAsync(180_000);
    expect(runMonitorCheck).toHaveBeenCalledTimes(1);
    releaseCheck();
  });
});
