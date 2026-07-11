import {
  HubPaths,
  Store,
  type AgentMonitorCheck,
  type HttpMonitorCheck,
  type Project,
  type ProjectMonitor,
} from '@claude-hub/core';
import type { AgentRunner } from '@claude-hub/agent-runner';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectMonitorScheduler, projectMonitorHealth } from '../src/projectMonitor.js';
import type { PipelineRunner } from '../src/runner.js';

function project(): Project {
  return {
    id: 'proj-1',
    path: 'C:/tmp/proj-1',
    name: 'demo',
    vision: '',
    repos: [],
    addedAt: new Date().toISOString(),
  };
}

function agentCheck(id: string, intervalMinutes = 1): AgentMonitorCheck {
  return { id, name: `check-${id}`, type: 'agent', prompt: 'is it healthy?', intervalMinutes };
}

function httpCheck(id: string, intervalMinutes = 1): HttpMonitorCheck {
  return {
    id,
    name: `ping-${id}`,
    type: 'http',
    url: 'http://127.0.0.1:9/health',
    intervalMinutes,
  };
}

function monitorEntry(
  checks: ProjectMonitor['checks'],
  overrides: Partial<ProjectMonitor> = {},
): ProjectMonitor {
  const now = new Date().toISOString();
  return {
    projectId: 'proj-1',
    enabled: true,
    checks,
    fileDefectOnFailure: true,
    status: { checks: {}, outageOpen: false },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** Pre-seeded pass status so reconcile skips the immediate first run. */
function passedStatus(checkIds: string[]): ProjectMonitor['status'] {
  return {
    checks: Object.fromEntries(
      checkIds.map((id) => [
        id,
        { lastStatus: 'pass' as const, lastCheckedAt: new Date().toISOString(), consecutiveFails: 0 },
      ]),
    ),
    outageOpen: false,
  };
}

/**
 * The scheduler persists every check result, and its inFlight guard holds
 * until the (real, un-faked) disk write finishes — so after advancing fake
 * timers, await the store change events those ticks produce before
 * asserting or advancing further.
 */
function waitForChanges(store: Store, count: number): Promise<void> {
  return new Promise((resolve) => {
    let seen = 0;
    const listener = (): void => {
      if (++seen >= count) {
        store.off('change', listener);
        resolve();
      }
    };
    store.on('change', listener);
  });
}

/** Flush microtasks so post-write continuations (defect enqueue) land. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('ProjectMonitorScheduler', () => {
  let root: string;
  let store: Store;
  let scheduler: ProjectMonitorScheduler;
  const runProjectSession = vi.fn<AgentRunner['runProjectSession']>();
  const agentRunner: AgentRunner = { runProjectSession };
  const enqueue = vi.fn<PipelineRunner['enqueue']>();
  const runner = { enqueue } as unknown as PipelineRunner;

  const passResult = {
    ok: true as const,
    provider: 'claude' as const,
    sessionId: 's1',
    text: 'all good\nMACHINE_RESULT: PASS',
    durationMs: 5,
    raw: {},
  };
  const failResult = { ...passResult, text: 'redis is down\nMACHINE_RESULT: FAIL' };

  /** Advance fake time, then wait for the resulting status writes. */
  async function tick(ms: number, expectedWrites: number): Promise<void> {
    const changed = waitForChanges(store, expectedWrites);
    await vi.advanceTimersByTimeAsync(ms);
    await changed;
    await flushMicrotasks();
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    root = await mkdtemp(join(tmpdir(), 'project-monitor-test-'));
    store = new Store(new HubPaths(root));
    await store.load();
    await store.update('projects', [project()]);
    runProjectSession.mockReset();
    runProjectSession.mockResolvedValue(passResult);
    enqueue.mockReset();
    enqueue.mockResolvedValue({} as never);
  });

  afterEach(async () => {
    scheduler?.stop();
    vi.useRealTimers();
    await rm(root, { recursive: true, force: true });
  });

  it('runs a never-checked check immediately, then on its interval', async () => {
    await store.update('monitors', [monitorEntry([agentCheck('c1', 1)])]);

    scheduler = new ProjectMonitorScheduler(store, runner, agentRunner);
    scheduler.start();

    await tick(0, 1); // immediate kickoff for new checks
    expect(runProjectSession).toHaveBeenCalledTimes(1);

    await tick(60_000, 1);
    expect(runProjectSession).toHaveBeenCalledTimes(2);

    const status = store.monitors()[0]?.status.checks['c1'];
    expect(status?.lastStatus).toBe('pass');
    expect(status?.consecutiveFails).toBe(0);
  });

  it('resumes checks with prior results on the interval only (no boot herd)', async () => {
    await store.update('monitors', [
      monitorEntry([agentCheck('c1', 1)], { status: passedStatus(['c1']) }),
    ]);

    scheduler = new ProjectMonitorScheduler(store, runner, agentRunner);
    scheduler.start();

    await vi.advanceTimersByTimeAsync(0);
    expect(runProjectSession).not.toHaveBeenCalled();

    await tick(60_000, 1);
    expect(runProjectSession).toHaveBeenCalledTimes(1);
  });

  it('disarms when the monitor is disabled', async () => {
    await store.update('monitors', [
      monitorEntry([agentCheck('c1', 1)], { status: passedStatus(['c1']) }),
    ]);

    scheduler = new ProjectMonitorScheduler(store, runner, agentRunner);
    scheduler.start();

    await tick(60_000, 1);
    expect(runProjectSession).toHaveBeenCalledTimes(1);

    await store.update('monitors', (all) => all.map((m) => ({ ...m, enabled: false })));
    await vi.advanceTimersByTimeAsync(180_000);
    expect(runProjectSession).toHaveBeenCalledTimes(1);
  });

  it('does not overlap ticks while a check is in flight', async () => {
    await store.update('monitors', [
      monitorEntry([agentCheck('c1', 1)], { status: passedStatus(['c1']) }),
    ]);
    let release!: () => void;
    runProjectSession.mockReturnValue(
      new Promise((resolve) => (release = () => resolve(passResult))),
    );

    scheduler = new ProjectMonitorScheduler(store, runner, agentRunner);
    scheduler.start();

    await vi.advanceTimersByTimeAsync(180_000); // 3 ticks, first never resolves
    expect(runProjectSession).toHaveBeenCalledTimes(1);

    // Release and let the pending status write land before cleanup.
    const changed = waitForChanges(store, 1);
    release();
    await changed;
  });

  it('files exactly one defect per outage, and a new one after recovery', async () => {
    await store.update('monitors', [
      monitorEntry([agentCheck('c1', 1)], { status: passedStatus(['c1']) }),
    ]);
    runProjectSession.mockResolvedValue(failResult);

    scheduler = new ProjectMonitorScheduler(store, runner, agentRunner);
    scheduler.start();

    await tick(60_000, 1); // first failing tick
    await tick(60_000, 1); // second failing tick
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'monitor', sourceRef: 'project-monitor:c1' }),
    );
    expect(store.monitors()[0]?.status.outageOpen).toBe(true);
    expect(store.monitors()[0]?.status.checks['c1']?.consecutiveFails).toBe(2);

    // Recovery closes the outage…
    runProjectSession.mockResolvedValue(passResult);
    await tick(60_000, 1);
    expect(store.monitors()[0]?.status.outageOpen).toBe(false);
    expect(projectMonitorHealth(store.monitors()[0]!)).toBe('healthy');

    // …so the next outage files a second defect.
    runProjectSession.mockResolvedValue(failResult);
    await tick(60_000, 1);
    expect(enqueue).toHaveBeenCalledTimes(2);
  });

  it('files one defect when two checks fail together', async () => {
    await store.update('monitors', [
      monitorEntry([agentCheck('c1', 1), agentCheck('c2', 1)], {
        status: passedStatus(['c1', 'c2']),
      }),
    ]);
    runProjectSession.mockResolvedValue(failResult);

    scheduler = new ProjectMonitorScheduler(store, runner, agentRunner);
    scheduler.start();

    await tick(60_000, 2); // both checks tick and persist
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('respects fileDefectOnFailure=false', async () => {
    await store.update('monitors', [
      monitorEntry([agentCheck('c1', 1)], {
        fileDefectOnFailure: false,
        status: passedStatus(['c1']),
      }),
    ]);
    runProjectSession.mockResolvedValue(failResult);

    scheduler = new ProjectMonitorScheduler(store, runner, agentRunner);
    scheduler.start();

    await tick(60_000, 1);
    await tick(60_000, 1);
    expect(enqueue).not.toHaveBeenCalled();
    expect(store.monitors()[0]?.status.checks['c1']?.lastStatus).toBe('fail');
    expect(store.monitors()[0]?.status.outageOpen).toBe(false);
  });

  it('survives a rejecting enqueue (blank line) without crashing the tick', async () => {
    await store.update('monitors', [
      monitorEntry([agentCheck('c1', 1)], { status: passedStatus(['c1']) }),
    ]);
    runProjectSession.mockResolvedValue(failResult);
    enqueue.mockRejectedValue(new Error('no machines on the line'));

    scheduler = new ProjectMonitorScheduler(store, runner, agentRunner);
    scheduler.start();

    await tick(60_000, 1);
    await tick(60_000, 1);
    // Status still recorded on both ticks despite the failed defect filing.
    expect(store.monitors()[0]?.status.checks['c1']?.consecutiveFails).toBe(2);
  });

  it('records an http failure with an error and marks the project down', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      body: undefined,
    });
    vi.stubGlobal('fetch', fetchMock);
    await store.update('monitors', [
      monitorEntry([httpCheck('h1', 1)], { status: passedStatus(['h1']) }),
    ]);

    scheduler = new ProjectMonitorScheduler(store, runner, agentRunner);
    scheduler.start();

    await tick(60_000, 1);
    const entry = store.monitors()[0]!;
    expect(entry.status.checks['h1']?.lastStatus).toBe('fail');
    expect(entry.status.checks['h1']?.lastError).toContain('503');
    expect(projectMonitorHealth(entry)).toBe('down');
    vi.unstubAllGlobals();
  });

  it('arms nothing for monitors whose project was deleted', async () => {
    await store.update('projects', []);
    await store.update('monitors', [monitorEntry([agentCheck('c1', 1)])]);

    scheduler = new ProjectMonitorScheduler(store, runner, agentRunner);
    scheduler.start();

    await vi.advanceTimersByTimeAsync(120_000);
    expect(runProjectSession).not.toHaveBeenCalled();
  });
});

describe('projectMonitorHealth', () => {
  const base = { checks: [agentCheck('a'), agentCheck('b')] };
  const status = (entries: Record<string, 'pass' | 'fail'>) => ({
    checks: Object.fromEntries(
      Object.entries(entries).map(([id, lastStatus]) => [
        id,
        { lastStatus, lastCheckedAt: new Date().toISOString(), consecutiveFails: 0 },
      ]),
    ),
    outageOpen: false,
  });

  it('is unknown with no checks configured', () => {
    expect(projectMonitorHealth({ checks: [], status: status({}) })).toBe('unknown');
  });

  it('is unknown until every check has reported', () => {
    expect(projectMonitorHealth({ ...base, status: status({ a: 'pass' }) })).toBe('unknown');
  });

  it('is healthy when all checks pass', () => {
    expect(projectMonitorHealth({ ...base, status: status({ a: 'pass', b: 'pass' }) })).toBe(
      'healthy',
    );
  });

  it('is down when any check fails', () => {
    expect(projectMonitorHealth({ ...base, status: status({ a: 'pass', b: 'fail' }) })).toBe(
      'down',
    );
  });
});
