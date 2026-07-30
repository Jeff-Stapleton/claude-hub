import { describe, expect, it } from 'vitest';
import type { ActivityEntry, MachineRunEvent } from '../api.js';
import type { PipelineMachine, WorkItem } from '../types.js';
import {
  groupActivity,
  lineProgress,
  lineProgressFromItem,
  type LineRunGroup,
} from './activityGroups.js';

function event(overrides: Partial<MachineRunEvent>): MachineRunEvent {
  return {
    id: Math.random().toString(36).slice(2),
    workItemId: 'item-1',
    workItemTitle: 'Item One',
    projectId: 'proj-1',
    projectName: 'Wingman',
    machineKey: 'spec',
    machineName: 'Spec',
    status: 'success',
    startedAt: '2026-07-20T21:00:00.000Z',
    finishedAt: '2026-07-20T21:05:00.000Z',
    ...overrides,
  };
}

function machine(key: string, name: string): PipelineMachine {
  return { key, name, gate: 'auto' } as PipelineMachine;
}

function liveItem(status: WorkItem['status']): WorkItem {
  return {
    id: 'item-1',
    projectId: 'proj-1',
    title: 'Item One',
    request: 'req',
    source: 'manual',
    status,
    currentStage: 'build',
    stages: {},
    createdAt: '2026-07-20T21:00:00.000Z',
    updatedAt: '2026-07-20T21:00:00.000Z',
  };
}

/** Feed is newest-first, like /api/activity. */
function feed(...events: MachineRunEvent[]): ActivityEntry[] {
  return events.map((e) => ({ kind: 'machine-run', event: e }));
}

const LINE = [machine('spec', 'Spec'), machine('build', 'Build'), machine('test', 'Test')];

function fail(): never {
  throw new Error('expected a line-run group');
}

describe('groupActivity', () => {
  it('folds interleaved events from two items into two groups, sorted by newest event', () => {
    const entries = feed(
      event({ workItemId: 'item-2', workItemTitle: 'Item Two', startedAt: '2026-07-20T23:00:00.000Z' }),
      event({ machineKey: 'test', startedAt: '2026-07-20T22:00:00.000Z' }),
      event({ workItemId: 'item-2', machineKey: 'spec', startedAt: '2026-07-20T21:30:00.000Z' }),
      event({ machineKey: 'spec', startedAt: '2026-07-20T21:00:00.000Z' }),
    );
    const grouped = groupActivity(entries);
    expect(grouped).toHaveLength(2);
    const first = grouped[0] as LineRunGroup;
    const second = grouped[1] as LineRunGroup;
    expect(first.workItemId).toBe('item-2');
    expect(first.events).toHaveLength(2);
    expect(second.workItemId).toBe('item-1');
    expect(second.latestStartedAt).toBe('2026-07-20T22:00:00.000Z');
  });

  it('passes trigger runs through, interleaved by start time', () => {
    const trigger: ActivityEntry = {
      kind: 'trigger-run',
      triggerName: 'nightly',
      run: {
        id: 't1',
        triggerId: 'trig-1',
        startedAt: '2026-07-20T21:30:00.000Z',
        status: 'success',
        prompt: 'p',
      },
    };
    const grouped = groupActivity([
      feed(event({ startedAt: '2026-07-20T22:00:00.000Z' }))[0] as ActivityEntry,
      trigger,
    ]);
    expect(grouped[0]?.kind).toBe('line-run');
    expect(grouped[1]?.kind).toBe('trigger-run');
  });

  it('keeps only the latest event per machine (retries)', () => {
    const grouped = groupActivity(
      feed(
        event({ machineKey: 'spec', status: 'success', startedAt: '2026-07-20T22:00:00.000Z' }),
        event({ machineKey: 'spec', status: 'failed', startedAt: '2026-07-20T21:00:00.000Z' }),
      ),
    ) as LineRunGroup[];
    expect((grouped[0] as LineRunGroup).latestByMachine.get('spec')?.status).toBe('success');
    expect((grouped[0] as LineRunGroup).events).toHaveLength(2);
  });
});

describe('lineProgress', () => {
  it('reports completed at k of n when all line machines succeeded', () => {
    const [group = fail()] = groupActivity(
      feed(
        event({ machineKey: 'test', machineName: 'Test', startedAt: '2026-07-20T23:00:00.000Z' }),
        event({ machineKey: 'build', machineName: 'Build', startedAt: '2026-07-20T22:00:00.000Z' }),
        event({ machineKey: 'spec', startedAt: '2026-07-20T21:00:00.000Z' }),
      ),
    ) as LineRunGroup[];
    const progress = lineProgress(group, LINE, undefined);
    expect(progress.outcome).toBe('completed');
    expect(progress.k).toBe(3);
    expect(progress.n).toBe(3);
    expect(progress.chips.map((c) => c.key)).toEqual(['spec', 'build', 'test']);
  });

  it('flags machines removed from the line and excludes them from k/n', () => {
    const [group = fail()] = groupActivity(
      feed(
        event({ machineKey: 'old-review', machineName: 'Old Review', startedAt: '2026-07-20T22:00:00.000Z' }),
        event({ machineKey: 'spec', startedAt: '2026-07-20T21:00:00.000Z' }),
      ),
    ) as LineRunGroup[];
    const progress = lineProgress(group, LINE, undefined);
    expect(progress.n).toBe(3);
    expect(progress.k).toBe(1);
    const orphan = progress.chips.find((c) => c.key === 'old-review');
    expect(orphan?.removed).toBe(true);
    expect(orphan?.name).toBe('Old Review');
  });

  it('falls back to event names/order when the pipeline is unknown', () => {
    const [group = fail()] = groupActivity(
      feed(
        event({ machineKey: 'b', machineName: 'B', startedAt: '2026-07-20T22:00:00.000Z' }),
        event({ machineKey: 'a', machineName: 'A', startedAt: '2026-07-20T21:00:00.000Z' }),
      ),
    ) as LineRunGroup[];
    const progress = lineProgress(group, undefined, undefined);
    expect(progress.chips.map((c) => c.key)).toEqual(['a', 'b']);
    expect(progress.n).toBe(2);
    expect(progress.outcome).toBe('completed');
  });

  it('marks machines with no event in the window as unknown', () => {
    const [group = fail()] = groupActivity(feed(event({ machineKey: 'spec' }))) as LineRunGroup[];
    const progress = lineProgress(group, LINE, undefined);
    expect(progress.chips.find((c) => c.key === 'build')?.status).toBe('unknown');
    expect(progress.k).toBe(1);
  });

  it('lets a live item status override event-derived outcome', () => {
    const [group = fail()] = groupActivity(feed(event({ machineKey: 'spec' }))) as LineRunGroup[];
    expect(lineProgress(group, LINE, liveItem('failed')).outcome).toBe('failed');
    expect(lineProgress(group, LINE, liveItem('waiting-approval')).outcome).toBe('waiting');
    expect(lineProgress(group, LINE, liveItem('monitoring')).outcome).toBe('waiting');
    expect(lineProgress(group, LINE, liveItem('running')).outcome).toBe('in-progress');
  });

  it('reports completed k of k for a done item that ran under an older, shorter line', () => {
    const item = {
      ...liveItem('done'),
      stages: {
        spec: { status: 'success' as const },
        build: { status: 'success' as const },
        test: { status: 'success' as const },
      },
    };
    const longerLine = [...LINE, machine('code-review', 'Code Review')];
    const progress = lineProgressFromItem(item, longerLine);
    expect(progress.outcome).toBe('completed');
    expect(progress.k).toBe(3);
    expect(progress.n).toBe(3);
    expect(progress.chips.map((c) => c.key)).toEqual(['spec', 'build', 'test']);
  });

  it('derives progress from an archived failed/cancelled item against the current line', () => {
    const failed = {
      ...liveItem('failed'),
      stages: {
        spec: { status: 'success' as const },
        build: { status: 'failed' as const },
      },
    };
    const progress = lineProgressFromItem(failed, LINE);
    expect(progress.outcome).toBe('failed');
    expect(progress.k).toBe(1);
    expect(progress.n).toBe(3);

    const cancelled = { ...liveItem('cancelled'), stages: { spec: { status: 'success' as const } } };
    expect(lineProgressFromItem(cancelled, LINE).outcome).toBe('incomplete');
  });

  it('flags orphan stage keys from a removed machine on an archived item', () => {
    const item = {
      ...liveItem('done'),
      stages: {
        spec: { status: 'success' as const },
        'old-review': { status: 'success' as const },
        build: { status: 'success' as const },
        test: { status: 'success' as const },
      },
    };
    const progress = lineProgressFromItem(item, LINE);
    const orphan = progress.chips.find((c) => c.key === 'old-review');
    expect(orphan?.removed).toBe(true);
    expect(progress.n).toBe(3);
  });

  it('derives failed from the newest event and incomplete for truncated windows', () => {
    const [failed = fail()] = groupActivity(
      feed(event({ machineKey: 'build', status: 'failed', startedAt: '2026-07-20T22:00:00.000Z' })),
    ) as LineRunGroup[];
    expect(lineProgress(failed, LINE, undefined).outcome).toBe('failed');

    const [truncated = fail()] = groupActivity(
      feed(event({ machineKey: 'build', status: 'success' })),
    ) as LineRunGroup[];
    expect(lineProgress(truncated, LINE, undefined).outcome).toBe('incomplete');
  });
});
