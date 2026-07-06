import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentRunner } from '@claude-hub/agent-runner';
import { HubPaths, Store, type Project, type CronTrigger } from '@claude-hub/core';
import { TriggerRunner } from '../src/runner.js';

const mockRun = vi.fn<AgentRunner['runProjectSession']>();
const agentRunner: AgentRunner = {
  runProjectSession: mockRun,
};

function makeTrigger(overrides?: Partial<CronTrigger>): CronTrigger {
  return {
    id: 'trig-1',
    type: 'cron',
    name: 'test trigger',
    projectId: 'proj-1',
    prompt: 'say hello',
    cronExpr: '0 0 1 1 *',
    ...overrides,
  };
}

const project: Project = {
  id: 'proj-1',
  path: '/tmp/testproj',
  addedAt: new Date().toISOString(),
};

describe('TriggerRunner', () => {
  let root: string;
  let store: Store;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'runner-test-'));
    store = new Store(new HubPaths(root));
    await store.load();
    await store.update('projects', [project]);
    // Seed a default trigger so markTriggerLast can find and update it.
    await store.update('triggers', [makeTrigger()]);
    mockRun.mockReset();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('sets lastStatus to "running" before agent spawn completes', async () => {
    // Make the spawn hang until we release it so we can inspect
    // intermediate state.
    let resolveSpawn!: (v: unknown) => void;
    mockRun.mockReturnValue(
      new Promise((resolve) => {
        resolveSpawn = resolve;
      }),
    );

    const runner = new TriggerRunner(store, agentRunner);
    const trigger = makeTrigger();

    // Start the run but don't await — we want to inspect mid-flight state.
    const runPromise = runner.run(trigger);

    // Yield to let the runner's async code mark the trigger as running.
    await new Promise((r) => setTimeout(r, 50));

    // The trigger should already show lastStatus='running' in the store.
    const mid = store.triggers().find((t) => t.id === trigger.id);
    expect(mid?.lastStatus).toBe('running');

    // Now let the spawn complete so the test cleans up.
    resolveSpawn({
      ok: true,
      provider: 'claude',
      sessionId: 's1',
      text: 'done',
      durationMs: 10,
      raw: {},
    });
    const result = await runPromise;
    expect(result.status).toBe('success');

    // After completion, lastStatus should flip to 'success'.
    const after = store.triggers().find((t) => t.id === trigger.id);
    expect(after?.lastStatus).toBe('success');
  });

  it('passes timeoutMs from constructor to agent-runner', async () => {
    mockRun.mockResolvedValue({
      ok: true,
      provider: 'claude',
      sessionId: 's1',
      text: 'ok',
      durationMs: 10,
      raw: {} as never,
    });

    const runner = new TriggerRunner(store, agentRunner, { timeoutMs: 999_999 });
    await runner.run(makeTrigger());

    expect(mockRun).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 999_999 }),
    );
  });

  it('records error when project is missing', async () => {
    const runner = new TriggerRunner(store, agentRunner);
    const trigger = makeTrigger({ projectId: 'nonexistent' });
    const result = await runner.run(trigger);

    expect(result.status).toBe('error');
    expect(result.error).toMatch(/not found/);
  });

  it('records error when agent spawn fails', async () => {
    mockRun.mockResolvedValue({
      ok: false,
      provider: 'claude',
      error: 'timed out after 600000ms',
      stderr: '',
      exitCode: null,
    });

    const runner = new TriggerRunner(store, agentRunner);
    const result = await runner.run(makeTrigger());

    expect(result.status).toBe('error');
    expect(result.error).toMatch(/timed out/);
  });

  it('emits started and finished events', async () => {
    mockRun.mockResolvedValue({
      ok: true,
      provider: 'claude',
      sessionId: 's1',
      text: 'done',
      durationMs: 10,
      raw: {} as never,
    });

    const runner = new TriggerRunner(store, agentRunner);
    const events: string[] = [];
    runner.on('started', () => events.push('started'));
    runner.on('finished', () => events.push('finished'));

    await runner.run(makeTrigger());
    expect(events).toEqual(['started', 'finished']);
  });

  it('enqueue-mode triggers file a work item instead of running the agent', async () => {
    const enqueueWorkItem = vi.fn().mockResolvedValue({ id: 'wi-123' });
    await store.update('triggers', [makeTrigger({ mode: 'enqueue' })]);

    const runner = new TriggerRunner(store, agentRunner, { enqueueWorkItem });
    const result = await runner.run(makeTrigger({ mode: 'enqueue' }));

    expect(mockRun).not.toHaveBeenCalled();
    expect(enqueueWorkItem).toHaveBeenCalledWith({
      projectId: 'proj-1',
      title: 'test trigger',
      request: 'say hello',
      source: 'cron',
      sourceRef: 'trig-1',
    });
    expect(result.status).toBe('success');
    expect(result.transcript).toBe('enqueued work item wi-123');
    expect(store.triggers()[0]?.lastStatus).toBe('success');
  });

  it('enqueue-mode records an error when the bridge rejects', async () => {
    const enqueueWorkItem = vi.fn().mockRejectedValue(new Error('pipeline down'));
    await store.update('triggers', [makeTrigger({ mode: 'enqueue' })]);

    const runner = new TriggerRunner(store, agentRunner, { enqueueWorkItem });
    const result = await runner.run(makeTrigger({ mode: 'enqueue' }));

    expect(result.status).toBe('error');
    expect(result.error).toBe('pipeline down');
  });

  it('writes run to history file', async () => {
    mockRun.mockResolvedValue({
      ok: true,
      provider: 'claude',
      sessionId: 's1',
      text: 'result text',
      durationMs: 100,
      raw: {} as never,
    });

    const runner = new TriggerRunner(store, agentRunner);
    const result = await runner.run(makeTrigger());

    // Verify history file was written by reading it back.
    const { readRecentTriggerRuns } = await import('../src/history.js');
    const runs = await readRecentTriggerRuns(store.paths, 'trig-1');
    expect(runs).toHaveLength(1);
    expect(runs[0]?.id).toBe(result.id);
    expect(runs[0]?.transcript).toBe('result text');
  });
});
