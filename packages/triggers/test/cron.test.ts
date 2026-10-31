import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HubPaths, Store, type CronTrigger } from '@claude-hub/core';

// Mock node-cron so we can drive reconcile without real timers. Module-scoped
// array captures every cron.schedule() call across the suite.
const scheduledTasks: Array<{
  expr: string;
  cb: () => void;
  stop: ReturnType<typeof vi.fn>;
}> = [];

vi.mock('node-cron', () => ({
  default: {
    validate: vi.fn((expr: string) => expr !== 'totally not cron'),
    schedule: vi.fn((expr: string, cb: () => void) => {
      const stop = vi.fn();
      scheduledTasks.push({ expr, cb, stop });
      return { stop };
    }),
  },
}));

// Import AFTER vi.mock — required so the SUT picks up the mocked node-cron.
const { CronScheduler } = await import('../src/cron.js');
import type { TriggerRunner } from '../src/runner.js';

function makeTrigger(overrides?: Partial<CronTrigger>): CronTrigger {
  return {
    id: 'trig-1',
    type: 'cron',
    name: 'test',
    projectId: 'proj-1',
    prompt: 'hi',
    cronExpr: '0 0 1 1 *',
    ...overrides,
  };
}

describe('CronScheduler', () => {
  let root: string;
  let store: Store;
  let scheduler: InstanceType<typeof CronScheduler>;
  const fakeRunner = { run: vi.fn() } as unknown as TriggerRunner;

  beforeEach(async () => {
    scheduledTasks.length = 0;
    vi.mocked(fakeRunner.run).mockReset();
    root = await mkdtemp(join(tmpdir(), 'cron-test-'));
    store = new Store(new HubPaths(root));
    await store.load();
    scheduler = new CronScheduler(store, fakeRunner);
    scheduler.start();
  });

  afterEach(async () => {
    scheduler.stop();
    await rm(root, { recursive: true, force: true });
  });

  it('schedules a task when a cron trigger is added to the store', async () => {
    await store.update('triggers', () => [makeTrigger({ cronExpr: '0 18 * * *' })]);
    expect(scheduledTasks).toHaveLength(1);
    expect(scheduledTasks[0]?.expr).toBe('0 18 * * *');
  });

  it('does not schedule a paused trigger', async () => {
    await store.update('triggers', () => [makeTrigger({ enabled: false })]);
    expect(scheduledTasks).toHaveLength(0);
  });

  it('unschedules when paused and schedules again when resumed', async () => {
    await store.update('triggers', () => [makeTrigger()]);
    const firstStop = scheduledTasks[0]!.stop;

    await store.update('triggers', () => [makeTrigger({ enabled: false })]);
    expect(firstStop).toHaveBeenCalledOnce();
    expect(scheduledTasks).toHaveLength(1);

    await store.update('triggers', () => [makeTrigger({ enabled: true })]);
    expect(scheduledTasks).toHaveLength(2);
  });

  it('unschedules the task when the trigger is deleted', async () => {
    await store.update('triggers', () => [makeTrigger()]);
    const stopFn = scheduledTasks[0]!.stop;

    await store.update('triggers', () => []);
    expect(stopFn).toHaveBeenCalledOnce();
  });

  it('reschedules when the cron expression changes', async () => {
    await store.update('triggers', () => [makeTrigger({ cronExpr: '* * * * *' })]);
    expect(scheduledTasks).toHaveLength(1);
    const firstStop = scheduledTasks[0]!.stop;

    await store.update('triggers', () => [makeTrigger({ cronExpr: '*/5 * * * *' })]);

    expect(firstStop).toHaveBeenCalledOnce();
    expect(scheduledTasks).toHaveLength(2);
    expect(scheduledTasks[1]?.expr).toBe('*/5 * * * *');
  });

  it('does NOT re-schedule when reconcile sees the same expression', async () => {
    // Same trigger written twice — second write is a no-op for scheduling
    // even though the store emits 'change'. Without this guard we'd churn
    // tasks on every unrelated triggers-list update.
    await store.update('triggers', () => [makeTrigger()]);
    await store.update('triggers', () => [makeTrigger()]);
    expect(scheduledTasks).toHaveLength(1);
  });

  it('skips invalid cron expressions without throwing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await store.update('triggers', () => [
      makeTrigger({ cronExpr: 'totally not cron' }),
    ]);
    expect(scheduledTasks).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('invokes runner.run with the latest trigger data without rescheduling', async () => {
    const trigger = makeTrigger();
    await store.update('triggers', () => [trigger]);
    await store.update('triggers', (triggers) =>
      triggers.map((current) =>
        current.id === trigger.id
          ? { ...current, prompt: 'updated prompt', projectId: 'proj-2', provider: 'cursor' }
          : current,
      ),
    );
    expect(scheduledTasks).toHaveLength(1);

    // Simulate cron firing by invoking the captured callback directly.
    scheduledTasks[0]!.cb();

    expect(fakeRunner.run).toHaveBeenCalledWith(
      expect.objectContaining({
        id: trigger.id,
        cronExpr: trigger.cronExpr,
        prompt: 'updated prompt',
        projectId: 'proj-2',
        provider: 'cursor',
      }),
    );
  });

  it.each(['disabled', 'deleted'])(
    'ignores a callback whose trigger was just %s',
    async (state) => {
      const trigger = makeTrigger();
      await store.update('triggers', () => [trigger]);
      const callback = scheduledTasks[0]!.cb;

      await store.update('triggers', () =>
        state === 'disabled' ? [makeTrigger({ enabled: false })] : [],
      );
      callback();

      expect(fakeRunner.run).not.toHaveBeenCalled();
    },
  );

  it('ignores non-cron triggers (webhook entries do not schedule)', async () => {
    await store.update('triggers', () => [
      {
        id: 'wh-1',
        type: 'webhook',
        name: 'wh',
        projectId: 'proj-1',
        promptTemplate: 'hi',
        secret: 'a'.repeat(64),
      },
    ]);
    expect(scheduledTasks).toHaveLength(0);
  });
});
