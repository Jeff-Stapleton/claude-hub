import type { AgentRunner, RunProjectSessionResult } from '@claude-hub/agent-runner';
import {
  HubPaths,
  Store,
  type BuiltinMachineSlug,
  type PipelineConfig,
  type PipelineMachine,
  type Project,
  type WorkItem,
} from '@claude-hub/core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_MACHINE_TEMPLATES } from '../src/defaults.js';
import {
  readArchivedWorkItems,
  readRecentMachineRunEvents,
  readWorkItemStageRuns,
} from '../src/history.js';
import { PipelineRunner, WorkItemStateError } from '../src/runner.js';
import { extractMachineSummary, resolveTransportSecrets } from '../src/stages.js';

const mockRun = vi.fn<AgentRunner['runProjectSession']>();
const agentRunner: AgentRunner = { runProjectSession: mockRun };

const project: Project = {
  id: 'proj-1',
  path: '/tmp/testproj',
  name: 'testproj',
  vision: '',
  repos: [
    {
      id: 'repo-1',
      name: 'testproj',
      path: '/tmp/testproj',
      origin: 'local',
      status: 'ready',
      addedAt: new Date().toISOString(),
    },
  ],
  addedAt: new Date().toISOString(),
};

function okResult(text = 'done', sessionId = 's1'): RunProjectSessionResult {
  return { ok: true, provider: 'claude', sessionId, text, durationMs: 5, raw: {} };
}

/** Poll until the predicate returns a truthy value or time runs out. */
async function until<T>(fn: () => T | undefined | false, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('until(): timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** A machine instance stamped from a built-in template, capabilities materialized. */
function builtinMachine(
  slug: BuiltinMachineSlug,
  overrides: Partial<PipelineMachine> = {},
): PipelineMachine {
  const t = BUILTIN_MACHINE_TEMPLATES.find((tt) => tt.slug === slug)!;
  return {
    key: slug,
    name: t.name,
    templateId: t.id,
    gate: 'auto',
    ...(t.resultCheck !== undefined ? { resultCheck: t.resultCheck } : {}),
    ...(t.monitor !== undefined ? { monitor: { ...t.monitor } } : {}),
    ...overrides,
  };
}

function linePipeline(machines: PipelineMachine[], projectId = project.id): PipelineConfig {
  return { projectId, machines, updatedAt: new Date().toISOString() };
}

/**
 * A line with the four agent machines, no approval gates, no monitor:
 * runs straight through. (A project with no stored config has a blank
 * line — tests must install the machines they exercise.)
 */
function openPipeline(mutate?: (machines: PipelineMachine[]) => void): PipelineConfig {
  const machines = [
    builtinMachine('spec'),
    builtinMachine('code'),
    builtinMachine('test'),
    builtinMachine('deploy'),
  ];
  mutate?.(machines);
  return linePipeline(machines);
}

describe('PipelineRunner', () => {
  let root: string;
  let store: Store;
  let runner: PipelineRunner;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pipeline-test-'));
    store = new Store(new HubPaths(root));
    await store.load();
    await store.update('projects', [project]);
    mockRun.mockReset();
    runner = new PipelineRunner(store, agentRunner);
  });

  afterEach(async () => {
    // Background drains may still be flushing a write; retry the removal
    // instead of racing it (Windows throws ENOTEMPTY/EPERM on the race).
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it('runs an item through every machine to done when nothing gates', async () => {
    await store.update('pipelines', [openPipeline()]);
    mockRun.mockResolvedValue(okResult());

    const item = await runner.enqueue({ projectId: project.id, request: 'add a button', source: 'manual' });

    // Terminal items are archived out of the live snapshot.
    await until(() => store.workItems().length === 0);
    const archived = await readArchivedWorkItems(store.paths, project.id);
    expect(archived).toHaveLength(1);
    expect(archived[0]?.id).toBe(item.id);
    expect(archived[0]?.status).toBe('done');
    // Only installed machines get result entries — no phantom slots.
    expect(archived[0]?.stages.intake).toBeUndefined();
    expect(archived[0]?.stages.spec?.status).toBe('success');
    expect(archived[0]?.stages.code?.status).toBe('success');
    expect(archived[0]?.stages.test?.status).toBe('success');
    expect(archived[0]?.stages.deploy?.status).toBe('success');
    expect(mockRun).toHaveBeenCalledTimes(4);
  });

  it('holds at an approval gate, then advances on approve', async () => {
    const config = openPipeline((machines) => {
      machines[3]!.gate = 'approval'; // deploy
    });
    await store.update('pipelines', [config]);
    mockRun.mockResolvedValue(okResult());

    const item = await runner.enqueue({ projectId: project.id, request: 'gated change', source: 'manual' });

    const held = await until(() =>
      store.workItems().find((it) => it.id === item.id && it.status === 'waiting-approval'),
    );
    expect(held.currentStage).toBe('deploy');
    expect(held.stages.deploy?.status).toBe('waiting-approval');

    await runner.approve(item.id);
    await until(() => store.workItems().length === 0);
    const archived = await readArchivedWorkItems(store.paths, project.id);
    expect(archived[0]?.status).toBe('done');
    expect(archived[0]?.approvedStages).toEqual(['deploy']);
  });

  it('rejects enqueue when the line has no machines (blank default)', async () => {
    // No stored config: the blank-line default applies.
    await expect(
      runner.enqueue({ projectId: project.id, request: 'x', source: 'manual' }),
    ).rejects.toMatchObject({ name: 'WorkItemStateError', code: 'no-enabled-stages' });
    expect(store.workItems()).toHaveLength(0);
  });

  it('rejects approve when the item is not waiting', async () => {
    await store.update('pipelines', [openPipeline()]);
    mockRun.mockResolvedValue(okResult());
    const item = await runner.enqueue({ projectId: project.id, request: 'x', source: 'manual' });
    await until(() => store.workItems().length === 0);
    await expect(runner.approve(item.id)).rejects.toThrow(WorkItemStateError);
  });

  it('marks the item failed when a machine errors, and retry re-runs it', async () => {
    await store.update('pipelines', [openPipeline()]);
    mockRun
      .mockResolvedValueOnce(okResult('plan'))
      .mockResolvedValueOnce({ ok: false, provider: 'claude', error: 'boom' });

    const item = await runner.enqueue({ projectId: project.id, request: 'flaky', source: 'manual' });

    const failed = await until(() =>
      store.workItems().find((it) => it.id === item.id && it.status === 'failed'),
    );
    expect(failed.currentStage).toBe('code');
    expect(failed.stages.code?.status).toBe('failed');
    expect(failed.stages.code?.error).toBe('boom');

    mockRun.mockResolvedValue(okResult());
    await runner.retry(item.id);
    await until(() => store.workItems().length === 0);
    const archived = await readArchivedWorkItems(store.paths, project.id);
    expect(archived[0]?.status).toBe('done');
  });

  it('fails a lenient resultCheck machine on an explicit FAIL marker (legacy marker honored)', async () => {
    await store.update('pipelines', [openPipeline()]);
    mockRun.mockImplementation(async (opts) =>
      okResult(opts.prompt.includes('validation station') ? 'ran suite\nTEST_RESULT: FAIL flaky' : 'ok'),
    );

    const item = await runner.enqueue({ projectId: project.id, request: 'x', source: 'manual' });
    const failed = await until(() =>
      store.workItems().find((it) => it.id === item.id && it.status === 'failed'),
    );
    expect(failed.currentStage).toBe('test');
    expect(failed.stages.test?.error).toMatch(/MACHINE_RESULT/);
  });

  it('runs duplicate machines of the same template independently', async () => {
    // A review-then-fix-then-review chain: two code machines.
    const config = linePipeline([
      builtinMachine('code'),
      builtinMachine('code', { key: 'code-2', name: 'Code (round 2)' }),
    ]);
    await store.update('pipelines', [config]);
    mockRun.mockResolvedValueOnce(okResult('first pass')).mockResolvedValueOnce(okResult('second pass'));

    await runner.enqueue({ projectId: project.id, request: 'x', source: 'manual' });
    await until(() => store.workItems().length === 0);

    const archived = await readArchivedWorkItems(store.paths, project.id);
    expect(archived[0]?.stages.code?.output).toBe('first pass');
    expect(archived[0]?.stages['code-2']?.output).toBe('second pass');
    expect(mockRun).toHaveBeenCalledTimes(2);
  });

  it('renders {{previous.output}} and {{stages.<key>.output}} against machine keys', async () => {
    const config = linePipeline([
      builtinMachine('spec', { promptTemplate: 'Plan for: {{request}}' }),
      builtinMachine('code', {
        key: 'implement',
        promptTemplate: 'Prev: {{previous.output}} | Spec said: {{stages.spec.output}}',
      }),
    ]);
    await store.update('pipelines', [config]);
    mockRun.mockResolvedValueOnce(okResult('THE PLAN')).mockResolvedValue(okResult());

    await runner.enqueue({ projectId: project.id, request: 'x', source: 'manual' });
    await until(() => store.workItems().length === 0);

    const secondPrompt = mockRun.mock.calls[1]![0].prompt;
    expect(secondPrompt).toContain('Prev: THE PLAN');
    expect(secondPrompt).toContain('Spec said: THE PLAN');
  });

  it('runs a commands-only machine without an agent run', async () => {
    // Commands actually spawn a shell — the project cwd must exist.
    await store.update('projects', [{ ...project, path: root }]);
    const config = linePipeline([
      {
        key: 'checks',
        name: 'Checks',
        gate: 'auto',
        commands: ['echo command-ran'],
      },
    ]);
    await store.update('pipelines', [config]);

    await runner.enqueue({ projectId: project.id, request: 'x', source: 'manual' });
    await until(() => store.workItems().length === 0);

    expect(mockRun).not.toHaveBeenCalled();
    const archived = await readArchivedWorkItems(store.paths, project.id);
    expect(archived[0]?.stages.checks?.status).toBe('success');
    expect(archived[0]?.stages.checks?.output).toContain('command-ran');
  });

  it('fails a machine with no prompt template and no commands', async () => {
    const config = linePipeline([{ key: 'blank', name: 'Blank', gate: 'auto' }]);
    await store.update('pipelines', [config]);

    const item = await runner.enqueue({ projectId: project.id, request: 'x', source: 'manual' });
    const failed = await until(() =>
      store.workItems().find((it) => it.id === item.id && it.status === 'failed'),
    );
    expect(failed.stages.blank?.error).toMatch(/no prompt template and no commands/);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('reconciles forward when the current machine was removed from the line', async () => {
    await store.update('pipelines', [linePipeline([builtinMachine('spec'), builtinMachine('code')])]);
    // Item parked on a machine that no longer exists; spec already succeeded.
    const orphaned: WorkItem = {
      id: 'wi-orphan',
      projectId: project.id,
      title: 'orphaned',
      request: 'finish me',
      source: 'manual',
      status: 'queued',
      currentStage: 'removed-machine',
      stages: {
        spec: { status: 'success', output: 'the plan' },
        'removed-machine': { status: 'waiting-approval' },
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await store.update('workItems', [orphaned]);
    mockRun.mockResolvedValue(okResult());

    await runner.recover();
    await until(() => store.workItems().length === 0);

    const archived = await readArchivedWorkItems(store.paths, project.id);
    expect(archived[0]?.status).toBe('done');
    // spec had already succeeded — only code ran.
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(archived[0]?.stages.code?.status).toBe('success');
    // The orphaned result is retained for history.
    expect(archived[0]?.stages['removed-machine']?.status).toBe('waiting-approval');
  });

  it('runs items FIFO within a project', async () => {
    await store.update('pipelines', [openPipeline()]);
    let release!: (v: RunProjectSessionResult) => void;
    mockRun.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    mockRun.mockResolvedValue(okResult());

    const first = await runner.enqueue({ projectId: project.id, request: 'first', source: 'manual' });
    const second = await runner.enqueue({ projectId: project.id, request: 'second', source: 'manual' });

    await until(() => store.workItems().find((it) => it.id === first.id)?.status === 'running');
    expect(store.workItems().find((it) => it.id === second.id)?.status).toBe('queued');

    release(okResult());
    await until(() => store.workItems().length === 0);
    const archived = await readArchivedWorkItems(store.paths, project.id);
    expect(archived).toHaveLength(2);
  });

  it('resumes the same provider session across machines', async () => {
    await store.update('pipelines', [openPipeline()]);
    mockRun.mockResolvedValue(okResult('ok', 'session-abc'));

    await runner.enqueue({ projectId: project.id, request: 'x', source: 'manual' });
    await until(() => store.workItems().length === 0);

    // First machine starts fresh; every later machine resumes the session.
    expect(mockRun.mock.calls[0]?.[0]?.sessionId).toBeUndefined();
    for (const call of mockRun.mock.calls.slice(1)) {
      expect(call[0]?.sessionId).toBe('session-abc');
    }
  });

  it('recover() re-queues items that were running and resumes them', async () => {
    await store.update('pipelines', [openPipeline()]);
    // Simulate an item that died mid-code-machine in a previous process.
    const stranded: WorkItem = {
      id: 'wi-stranded',
      projectId: project.id,
      title: 'stranded',
      request: 'finish me',
      source: 'manual',
      status: 'running',
      currentStage: 'code',
      stages: {
        spec: { status: 'success', output: 'the plan' },
        code: { status: 'running' },
        test: { status: 'pending' },
        deploy: { status: 'pending' },
      },
      sessions: { claude: 'session-old' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await store.update('workItems', [stranded]);
    mockRun.mockResolvedValue(okResult());

    await runner.recover();
    await until(() => store.workItems().length === 0);

    const archived = await readArchivedWorkItems(store.paths, project.id);
    expect(archived[0]?.status).toBe('done');
    // Resumed the persisted session, and spec was NOT re-run.
    expect(mockRun.mock.calls[0]?.[0]?.sessionId).toBe('session-old');
    const runs = await readWorkItemStageRuns(store.paths, 'wi-stranded');
    expect(runs.some((r) => r.status === 'interrupted' && r.stage === 'code')).toBe(true);
    expect(runs.filter((r) => r.stage === 'spec')).toHaveLength(0);
  });

  it('cancel archives the item and discards the in-flight result', async () => {
    await store.update('pipelines', [openPipeline()]);
    let release!: (v: RunProjectSessionResult) => void;
    mockRun.mockReturnValue(new Promise((resolve) => (release = resolve)));

    const item = await runner.enqueue({ projectId: project.id, request: 'x', source: 'manual' });
    await until(() => store.workItems().find((it) => it.id === item.id)?.status === 'running');

    await runner.cancel(item.id);
    expect(store.workItems()).toHaveLength(0);
    release(okResult());
    // Give the drain loop a beat — the item must not reappear.
    await new Promise((r) => setTimeout(r, 100));
    expect(store.workItems()).toHaveLength(0);
    const archived = await readArchivedWorkItems(store.paths, project.id);
    expect(archived[0]?.status).toBe('cancelled');
  });

  it('fails the item when the project is missing', async () => {
    const config = linePipeline(
      [builtinMachine('spec'), builtinMachine('code')],
      'nope',
    );
    await store.update('pipelines', [config]);
    mockRun.mockResolvedValue(okResult());
    const item = await runner.enqueue({ projectId: 'nope', request: 'x', source: 'manual' });
    const failed = await until(() =>
      store.workItems().find((it) => it.id === item.id && it.status === 'failed'),
    );
    expect(failed.stages.spec?.error).toMatch(/not found/);
  });

  it('parks the item in monitoring when a machine has a monitor loop', async () => {
    const config = openPipeline((machines) => {
      machines.push(builtinMachine('monitor'));
    });
    await store.update('pipelines', [config]);
    mockRun.mockResolvedValue(okResult());

    const item = await runner.enqueue({ projectId: project.id, request: 'x', source: 'manual' });
    const monitoring = await until(() =>
      store.workItems().find((it) => it.id === item.id && it.status === 'monitoring'),
    );
    expect(monitoring.currentStage).toBe('monitor');
    expect(monitoring.stages.monitor?.checksPassed).toBe(0);
  });
});

describe('machine-run activity log', () => {
  let root: string;
  let store: Store;
  let runner: PipelineRunner;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pipeline-act-'));
    store = new Store(new HubPaths(root));
    await store.load();
    await store.update('projects', [project]);
    mockRun.mockReset();
    runner = new PipelineRunner(store, agentRunner);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it('logs one denormalized event per machine run, newest-first', async () => {
    await store.update('pipelines', [openPipeline()]);
    mockRun.mockResolvedValue(okResult());

    const item = await runner.enqueue({ projectId: project.id, request: 'add a button', source: 'manual' });
    await until(() => store.workItems().length === 0);

    const events = await readRecentMachineRunEvents(store.paths);
    expect(events).toHaveLength(4);
    // Newest-first: deploy ran last.
    expect(events.map((e) => e.machineKey)).toEqual(['deploy', 'test', 'code', 'spec']);
    expect(events.every((e) => e.status === 'success')).toBe(true);
    const spec = events[3]!;
    expect(spec.workItemId).toBe(item.id);
    expect(spec.workItemTitle).toBe(item.title);
    expect(spec.projectId).toBe(project.id);
    expect(spec.projectName).toBe(project.name);
    expect(spec.machineName).toBe('Spec');
  });

  it('carries the MACHINE_SUMMARY marker into the event and stage result, without stripping output', async () => {
    await store.update('pipelines', [linePipeline([builtinMachine('spec')])]);
    mockRun.mockResolvedValue(okResult('I planned it.\nMACHINE_SUMMARY: Wrote the plan.'));

    await runner.enqueue({ projectId: project.id, request: 'x', source: 'manual' });
    await until(() => store.workItems().length === 0);

    const events = await readRecentMachineRunEvents(store.paths);
    expect(events[0]?.summary).toBe('Wrote the plan.');
    const archived = await readArchivedWorkItems(store.paths, project.id);
    expect(archived[0]?.stages.spec?.summary).toBe('Wrote the plan.');
    // The marker line stays verbatim in the output (template context/history).
    expect(archived[0]?.stages.spec?.output).toContain('MACHINE_SUMMARY: Wrote the plan.');
  });

  it('falls back to truncated output when the marker is missing', async () => {
    await store.update('pipelines', [linePipeline([builtinMachine('spec')])]);
    mockRun.mockResolvedValue(okResult('did some\nmultiline work'));

    await runner.enqueue({ projectId: project.id, request: 'x', source: 'manual' });
    await until(() => store.workItems().length === 0);

    const events = await readRecentMachineRunEvents(store.paths);
    expect(events[0]?.summary).toBe('did some multiline work');
  });

  it('logs a failed event with the error when a machine errors', async () => {
    await store.update('pipelines', [linePipeline([builtinMachine('spec'), builtinMachine('code')])]);
    mockRun
      .mockResolvedValueOnce(okResult('plan'))
      .mockResolvedValueOnce({ ok: false, provider: 'claude', error: 'boom' });

    const item = await runner.enqueue({ projectId: project.id, request: 'x', source: 'manual' });
    await until(() => store.workItems().find((it) => it.id === item.id)?.status === 'failed');

    const events = await readRecentMachineRunEvents(store.paths);
    expect(events[0]?.machineKey).toBe('code');
    expect(events[0]?.status).toBe('failed');
    expect(events[0]?.error).toBe('boom');
  });

  it('appends the summary instruction to every agent prompt, including custom templates', async () => {
    await store.update('pipelines', [
      linePipeline([
        builtinMachine('spec'),
        { key: 'custom', name: 'Custom', gate: 'auto', promptTemplate: 'Do {{request}}' },
      ]),
    ]);
    mockRun.mockResolvedValue(okResult());

    await runner.enqueue({ projectId: project.id, request: 'x', source: 'manual' });
    await until(() => store.workItems().length === 0);

    expect(mockRun).toHaveBeenCalledTimes(2);
    for (const call of mockRun.mock.calls) {
      expect(call[0].prompt).toContain('MACHINE_SUMMARY: ');
    }
  });

  it('logs a skipped event when a machine already succeeded on a previous pass', async () => {
    await store.update('pipelines', [linePipeline([builtinMachine('spec'), builtinMachine('code')])]);
    // An item re-queued at a machine that already succeeded (line reorder).
    const requeued: WorkItem = {
      id: 'wi-requeued',
      projectId: project.id,
      title: 'requeued',
      request: 'x',
      source: 'manual',
      status: 'queued',
      currentStage: 'spec',
      stages: { spec: { status: 'success', output: 'the plan' }, code: { status: 'pending' } },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await store.update('workItems', [requeued]);
    mockRun.mockResolvedValue(okResult());

    await runner.recover();
    await until(() => store.workItems().length === 0);

    const events = await readRecentMachineRunEvents(store.paths);
    const skipped = events.find((e) => e.status === 'skipped');
    expect(skipped?.machineKey).toBe('spec');
    expect(skipped?.summary).toMatch(/already succeeded/);
    // code actually ran.
    expect(events.some((e) => e.machineKey === 'code' && e.status === 'success')).toBe(true);
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it('logs an interrupted event for items recovered mid-machine', async () => {
    await store.update('pipelines', [linePipeline([builtinMachine('spec')])]);
    const stranded: WorkItem = {
      id: 'wi-stranded',
      projectId: project.id,
      title: 'stranded',
      request: 'x',
      source: 'manual',
      status: 'running',
      currentStage: 'spec',
      stages: { spec: { status: 'running' } },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await store.update('workItems', [stranded]);
    mockRun.mockResolvedValue(okResult());

    await runner.recover();
    await until(() => store.workItems().length === 0);

    const events = await readRecentMachineRunEvents(store.paths);
    const interrupted = events.find((e) => e.status === 'interrupted');
    expect(interrupted?.machineKey).toBe('spec');
    expect(interrupted?.machineName).toBe('Spec');
    expect(interrupted?.error).toMatch(/server restart/);
  });
});

describe('extractMachineSummary', () => {
  it('extracts the marker line from multiline text, before a MACHINE_RESULT line', () => {
    const text = 'Ran the suite.\nAll green.\nMACHINE_SUMMARY: Ran 42 tests, all passing.\nMACHINE_RESULT: PASS';
    expect(extractMachineSummary(text)).toBe('Ran 42 tests, all passing.');
  });

  it('returns undefined when the marker is absent or empty', () => {
    expect(extractMachineSummary('no marker here')).toBeUndefined();
    expect(extractMachineSummary('MACHINE_SUMMARY:   ')).toBeUndefined();
  });

  it('takes the first marker line and trims whitespace', () => {
    const text = 'MACHINE_SUMMARY:  first thing  \nMACHINE_SUMMARY: second thing';
    expect(extractMachineSummary(text)).toBe('first thing');
  });

  it('truncates over-limit summaries with an ellipsis', () => {
    const long = 'x'.repeat(400);
    const summary = extractMachineSummary(`MACHINE_SUMMARY: ${long}`);
    expect(summary).toHaveLength(280);
    expect(summary?.endsWith('…')).toBe(true);
  });
});

describe('PipelineRunner.runMonitorCheck', () => {
  let root: string;
  let store: Store;
  let runner: PipelineRunner;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pipeline-mon-'));
    store = new Store(new HubPaths(root));
    await store.load();
    await store.update('projects', [project]);
    mockRun.mockReset();
    runner = new PipelineRunner(store, agentRunner);
  });

  afterEach(async () => {
    // Background drains may still be flushing a write; retry the removal
    // instead of racing it (Windows throws ENOTEMPTY/EPERM on the race).
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  async function seedMonitoring(
    source: WorkItem['source'] = 'manual',
    maxChecks = 2,
    machines?: PipelineMachine[],
  ): Promise<WorkItem> {
    // Monitor is installed (it's mid-check); spec so a filed defect has an
    // agent machine to park on.
    const line =
      machines ??
      [
        builtinMachine('spec'),
        builtinMachine('monitor', { monitor: { intervalMinutes: 30, maxChecks } }),
      ];
    await store.update('pipelines', [linePipeline(line)]);
    const item: WorkItem = {
      id: 'wi-mon',
      projectId: project.id,
      title: 'shipped thing',
      request: 'the request',
      source,
      status: 'monitoring',
      currentStage: 'monitor',
      stages: {
        spec: { status: 'success' },
        monitor: { status: 'running', checksPassed: 0 },
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await store.update('workItems', [item]);
    return item;
  }

  it('completes the item after maxChecks consecutive passes on the last machine', async () => {
    const item = await seedMonitoring('manual', 2);
    mockRun.mockResolvedValue(okResult('all good\nMACHINE_RESULT: PASS'));

    await runner.runMonitorCheck(item.id);
    expect(store.workItems()[0]?.stages.monitor?.checksPassed).toBe(1);

    await runner.runMonitorCheck(item.id);
    expect(store.workItems()).toHaveLength(0);
    const archived = await readArchivedWorkItems(store.paths, project.id);
    expect(archived[0]?.status).toBe('done');
    expect(archived[0]?.stages.monitor?.status).toBe('success');

    // Each check is a real machine execution: one activity event apiece.
    const events = await readRecentMachineRunEvents(store.paths);
    expect(events.filter((e) => e.machineKey === 'monitor' && e.status === 'success')).toHaveLength(2);
  });

  it('accepts the legacy MONITOR_RESULT markers from migrated prompts', async () => {
    const item = await seedMonitoring('manual', 1);
    mockRun.mockResolvedValue(okResult('all good\nMONITOR_RESULT: PASS'));
    await runner.runMonitorCheck(item.id);
    const archived = await readArchivedWorkItems(store.paths, project.id);
    expect(archived[0]?.status).toBe('done');
  });

  it('continues down the line after a mid-line monitor completes (soak test)', async () => {
    const soak = builtinMachine('monitor', {
      key: 'soak',
      name: 'Soak',
      monitor: { intervalMinutes: 30, maxChecks: 1 },
    });
    const item = await seedMonitoring('manual', 1, [
      builtinMachine('spec'),
      soak,
      builtinMachine('deploy'),
    ]);
    await store.update('workItems', [
      { ...item, currentStage: 'soak', stages: { spec: { status: 'success' }, soak: { status: 'running', checksPassed: 0 } } },
    ]);
    mockRun.mockResolvedValue(okResult('healthy\nMACHINE_RESULT: PASS'));

    await runner.runMonitorCheck(item.id);
    // The soak machine succeeded and the item continued through deploy.
    await until(() => store.workItems().length === 0);
    const archived = await readArchivedWorkItems(store.paths, project.id);
    expect(archived[0]?.status).toBe('done');
    expect(archived[0]?.stages.soak?.status).toBe('success');
    expect(archived[0]?.stages.deploy?.status).toBe('success');
  });

  it('fails the item when the monitoring machine was removed from the line', async () => {
    const item = await seedMonitoring();
    await store.update('pipelines', [linePipeline([builtinMachine('spec')])]);

    await runner.runMonitorCheck(item.id);
    const failed = store.workItems().find((it) => it.id === item.id);
    expect(failed?.status).toBe('failed');
    expect(failed?.stages.monitor?.error).toMatch(/removed from the line/);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('fails the item and files a defect when a check fails', async () => {
    const item = await seedMonitoring('manual');
    mockRun
      .mockResolvedValueOnce(okResult('something is wrong\nMACHINE_RESULT: FAIL errors in logs'))
      // The filed defect starts draining in the background; park it on a
      // never-resolving run so it can't race the assertions or cleanup.
      .mockReturnValue(new Promise(() => {}));

    await runner.runMonitorCheck(item.id);

    const failed = store.workItems().find((it) => it.id === item.id);
    expect(failed?.status).toBe('failed');
    const defect = store.workItems().find((it) => it.source === 'monitor');
    expect(defect).toBeDefined();
    expect(defect?.sourceRef).toBe(item.id);
    expect(defect?.title).toMatch(/^Defect:/);
  });

  it('treats a missing PASS marker as a failure (strict resultCheck)', async () => {
    const item = await seedMonitoring();
    mockRun
      .mockResolvedValueOnce(okResult('looks fine to me'))
      .mockReturnValue(new Promise(() => {}));
    await runner.runMonitorCheck(item.id);
    expect(store.workItems().find((it) => it.id === item.id)?.status).toBe('failed');
  });

  it('does not file a defect for monitor-sourced items (loop guard)', async () => {
    const item = await seedMonitoring('monitor');
    mockRun.mockResolvedValue(okResult('MACHINE_RESULT: FAIL still broken'));
    await runner.runMonitorCheck(item.id);
    expect(store.workItems().find((it) => it.id === item.id)?.status).toBe('failed');
    expect(store.workItems().filter((it) => it.id !== item.id)).toHaveLength(0);
  });
});

describe('toolbox assignment resolution', () => {
  let root: string;
  let store: Store;
  let runner: PipelineRunner;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pipeline-tools-'));
    store = new Store(new HubPaths(root));
    await store.load();
    await store.update('projects', [project]);
    mockRun.mockReset();
    runner = new PipelineRunner(store, agentRunner);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  it('passes resolved tools per machine and drops dangling ids', async () => {
    const now = new Date().toISOString();
    await store.update('toolbox', {
      skills: [
        {
          id: 'skill-1',
          name: 'my-skill',
          description: 'Does things',
          body: '# Body',
          tags: [],
          source: 'user',
          createdAt: now,
          updatedAt: now,
        },
      ],
      mcpServers: [
        {
          id: 'mcp-1',
          name: 'aws-tools',
          transport: { type: 'stdio', command: 'npx' },
          tags: [],
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    await store.update('pipelines', [
      openPipeline((machines) => {
        machines[0]!.skills = ['skill-1', 'deleted-skill'];
        machines[0]!.mcpServers = ['mcp-1'];
      }),
    ]);
    mockRun.mockResolvedValue(okResult());

    await runner.enqueue({ projectId: project.id, request: 'tool run', source: 'manual' });
    await until(() => store.workItems().length === 0);

    expect(mockRun).toHaveBeenCalledTimes(4);
    const specCall = mockRun.mock.calls[0]![0];
    expect(specCall.tools).toEqual({
      skills: [{ name: 'my-skill', description: 'Does things', body: '# Body' }],
      mcpServers: [{ name: 'aws-tools', transport: { type: 'stdio', command: 'npx' } }],
    });
    // Unassigned machines still get an (empty) payload — deny by default.
    const codeCall = mockRun.mock.calls[1]![0];
    expect(codeCall.tools).toEqual({ skills: [], mcpServers: [] });
  });

  it('unions project-level assignments with machine assignments (deduped)', async () => {
    const now = new Date().toISOString();
    await store.update('toolbox', {
      skills: [
        {
          id: 'skill-project',
          name: 'project-skill',
          description: 'Everywhere',
          body: '# P',
          tags: [],
          source: 'user',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'skill-stage',
          name: 'stage-skill',
          description: 'Spec only',
          body: '# S',
          tags: [],
          source: 'user',
          createdAt: now,
          updatedAt: now,
        },
      ],
      mcpServers: [
        {
          id: 'mcp-project',
          name: 'project-server',
          transport: { type: 'stdio', command: 'npx' },
          tags: [],
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    await store.update('projects', [
      {
        ...project,
        skills: ['skill-project', 'skill-stage'], // skill-stage also assigned on spec -> dedupe
        mcpServers: ['mcp-project'],
      },
    ]);
    await store.update('pipelines', [
      openPipeline((machines) => {
        machines[0]!.skills = ['skill-stage'];
      }),
    ]);
    mockRun.mockResolvedValue(okResult());

    await runner.enqueue({ projectId: project.id, request: 'union run', source: 'manual' });
    await until(() => store.workItems().length === 0);

    const specCall = mockRun.mock.calls[0]![0];
    expect(specCall.tools?.skills.map((s) => s.name).sort()).toEqual([
      'project-skill',
      'stage-skill',
    ]);
    expect(specCall.tools?.skills).toHaveLength(2); // deduped, not doubled
    expect(specCall.tools?.mcpServers.map((m) => m.name)).toEqual(['project-server']);
    // A machine with no assignments of its own still inherits project tools.
    const codeCall = mockRun.mock.calls[1]![0];
    expect(codeCall.tools?.skills.map((s) => s.name)).toEqual(['project-skill', 'stage-skill']);
    expect(codeCall.tools?.mcpServers.map((m) => m.name)).toEqual(['project-server']);
  });

  it('injects vault values for assigned tools only, skipping unset keys', async () => {
    const now = new Date().toISOString();
    await store.update('vault', [
      { key: 'GITHUB_TOKEN', value: 'gh-secret', createdAt: now, updatedAt: now },
      { key: 'UNSET_KEY', value: null, createdAt: now, updatedAt: now },
      { key: 'UNRELATED_SECRET', value: 'leak-me-not', createdAt: now, updatedAt: now },
    ]);
    await store.update('toolbox', {
      skills: [
        {
          id: 'skill-1',
          name: 'gh-skill',
          description: 'Uses GitHub',
          body: '# B',
          tags: [],
          requiredEnv: ['GITHUB_TOKEN', 'UNSET_KEY'],
          source: 'user',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'skill-unassigned',
          name: 'other-skill',
          description: 'Not assigned',
          body: '# O',
          tags: [],
          requiredEnv: ['UNRELATED_SECRET'],
          source: 'user',
          createdAt: now,
          updatedAt: now,
        },
      ],
      mcpServers: [],
    });
    await store.update('pipelines', [
      openPipeline((machines) => {
        machines[0]!.skills = ['skill-1'];
      }),
    ]);
    mockRun.mockResolvedValue(okResult());

    await runner.enqueue({ projectId: project.id, request: 'vault run', source: 'manual' });
    await until(() => store.workItems().length === 0);

    const specCall = mockRun.mock.calls[0]![0];
    // Set + required key injected; unset key skipped (run proceeds anyway);
    // an unassigned tool's key never leaks into the run.
    expect(specCall.tools?.env).toEqual({ GITHUB_TOKEN: 'gh-secret' });
    // Machines with no assigned tools get no env at all.
    const codeCall = mockRun.mock.calls[1]![0];
    expect(codeCall.tools?.env).toBeUndefined();
  });

  it("injects the machine's own requiredEnv variables into the run env", async () => {
    const now = new Date().toISOString();
    await store.update('vault', [
      { key: 'TARGET_ENV', value: 'staging', createdAt: now, updatedAt: now },
    ]);
    await store.update('pipelines', [
      openPipeline((machines) => {
        machines[0]!.requiredEnv = ['TARGET_ENV'];
      }),
    ]);
    mockRun.mockResolvedValue(okResult());

    await runner.enqueue({ projectId: project.id, request: 'var run', source: 'manual' });
    await until(() => store.workItems().length === 0);

    const specCall = mockRun.mock.calls[0]![0];
    expect(specCall.tools?.env).toEqual({ TARGET_ENV: 'staging' });
    const codeCall = mockRun.mock.calls[1]![0];
    expect(codeCall.tools?.env).toBeUndefined();
  });

  it('resolves MCP transports against the vault (stdio env + ${KEY} headers)', async () => {
    const now = new Date().toISOString();
    await store.update('vault', [
      { key: 'AWS_SECRET', value: 'aws-value', createdAt: now, updatedAt: now },
      { key: 'CLICKUP_API_KEY', value: 'cu-value', createdAt: now, updatedAt: now },
    ]);
    await store.update('toolbox', {
      skills: [],
      mcpServers: [
        {
          id: 'mcp-stdio',
          name: 'aws-tools',
          // Literal env overrides the vault-resolved value for the same key.
          transport: { type: 'stdio', command: 'npx', env: { AWS_SECRET: 'literal-wins' } },
          tags: [],
          requiredEnv: ['AWS_SECRET', 'CLICKUP_API_KEY'],
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'mcp-http',
          name: 'clickup',
          transport: {
            type: 'http',
            url: 'https://example.com/mcp',
            headers: { Authorization: 'Bearer ${CLICKUP_API_KEY}' },
          },
          tags: [],
          requiredEnv: ['CLICKUP_API_KEY'],
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    await store.update('pipelines', [
      openPipeline((machines) => {
        machines[0]!.mcpServers = ['mcp-stdio', 'mcp-http'];
      }),
    ]);
    mockRun.mockResolvedValue(okResult());

    await runner.enqueue({ projectId: project.id, request: 'mcp vault run', source: 'manual' });
    await until(() => store.workItems().length === 0);

    const specCall = mockRun.mock.calls[0]![0];
    const [stdio, http] = specCall.tools!.mcpServers;
    expect(stdio!.transport).toEqual({
      type: 'stdio',
      command: 'npx',
      env: { AWS_SECRET: 'literal-wins', CLICKUP_API_KEY: 'cu-value' },
    });
    expect(http!.transport).toEqual({
      type: 'http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer cu-value' },
    });
  });

  it('prepends the project vision/context preamble to every machine prompt', async () => {
    await store.update('projects', [
      { ...project, vision: 'Build the best widget.', context: 'Use pnpm.' },
    ]);
    await store.update('pipelines', [openPipeline()]);
    mockRun.mockResolvedValue(okResult());

    await runner.enqueue({ projectId: project.id, request: 'preamble run', source: 'manual' });
    await until(() => store.workItems().length === 0);

    for (const call of mockRun.mock.calls) {
      const prompt = call[0].prompt;
      expect(prompt.startsWith('# Project: testproj')).toBe(true);
      expect(prompt).toContain('## Vision\n\nBuild the best widget.');
      expect(prompt).toContain('## Project context\n\nUse pnpm.');
      expect(call[0].cwd).toBe(project.path);
    }
  });

  it('omits the preamble entirely for migrated projects with no vision or context', async () => {
    await store.update('pipelines', [openPipeline()]);
    mockRun.mockResolvedValue(okResult());

    await runner.enqueue({ projectId: project.id, request: 'no preamble', source: 'manual' });
    await until(() => store.workItems().length === 0);

    const prompt = mockRun.mock.calls[0]![0].prompt;
    expect(prompt.startsWith('# Project:')).toBe(false);
  });
});

describe('resolveTransportSecrets', () => {
  it('leaves placeholders for unset keys untouched so failures are visible', () => {
    const resolved = resolveTransportSecrets(
      { type: 'http', url: 'https://x', headers: { Authorization: 'Bearer ${MISSING_KEY}' } },
      ['MISSING_KEY'],
      {},
    );
    expect(resolved).toEqual({
      type: 'http',
      url: 'https://x',
      headers: { Authorization: 'Bearer ${MISSING_KEY}' },
    });
  });

  it('never substitutes keys the server did not declare in requiredEnv', () => {
    const resolved = resolveTransportSecrets(
      { type: 'http', url: 'https://x', headers: { Authorization: 'Bearer ${OTHER_KEY}' } },
      [],
      { OTHER_KEY: 'should-not-appear' },
    );
    expect(resolved.type === 'http' && resolved.headers!.Authorization).toBe(
      'Bearer ${OTHER_KEY}',
    );
  });

  it('injects only declared keys into stdio env and preserves args', () => {
    const resolved = resolveTransportSecrets(
      { type: 'stdio', command: 'npx', args: ['-y', 'x'] },
      ['DECLARED_KEY'],
      { DECLARED_KEY: 'v1', UNDECLARED_KEY: 'v2' },
    );
    expect(resolved).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'x'],
      env: { DECLARED_KEY: 'v1' },
    });
  });
});
