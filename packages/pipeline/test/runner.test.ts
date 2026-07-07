import type { AgentRunner, RunProjectSessionResult } from '@claude-hub/agent-runner';
import {
  HubPaths,
  Store,
  type PipelineConfig,
  type Project,
  type WorkItem,
} from '@claude-hub/core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultPipelineConfig } from '../src/defaults.js';
import { readArchivedWorkItems, readWorkItemStageRuns } from '../src/history.js';
import { PipelineRunner, WorkItemStateError } from '../src/runner.js';

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

/**
 * Config with the four agent stages installed, no approval gates, and
 * monitor disabled: runs straight through. (Defaults ship all-disabled —
 * a blank line — so tests must install the machines they exercise.)
 */
function openPipeline(overrides?: (config: PipelineConfig) => void): PipelineConfig {
  const config = defaultPipelineConfig(project.id);
  config.stages.spec.enabled = true;
  config.stages.code.enabled = true;
  config.stages.test.enabled = true;
  config.stages.deploy.enabled = true;
  config.stages.deploy.gate = 'auto';
  config.stages.monitor.enabled = false;
  overrides?.(config);
  return config;
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

  it('runs an item through all stages to done when nothing gates', async () => {
    await store.update('pipelines', [openPipeline()]);
    mockRun.mockResolvedValue(okResult());

    const item = await runner.enqueue({ projectId: project.id, request: 'add a button', source: 'manual' });

    // Terminal items are archived out of the live snapshot.
    await until(() => store.workItems().length === 0);
    const archived = await readArchivedWorkItems(store.paths, project.id);
    expect(archived).toHaveLength(1);
    expect(archived[0]?.id).toBe(item.id);
    expect(archived[0]?.status).toBe('done');
    expect(archived[0]?.stages.intake.status).toBe('skipped'); // disabled by default
    expect(archived[0]?.stages.spec.status).toBe('success');
    expect(archived[0]?.stages.code.status).toBe('success');
    expect(archived[0]?.stages.test.status).toBe('success');
    expect(archived[0]?.stages.deploy.status).toBe('success');
    // 4 enabled agent stages ran.
    expect(mockRun).toHaveBeenCalledTimes(4);
  });

  it('holds at the default deploy approval gate, then advances on approve', async () => {
    // Installed stages keep deploy's default approval gate.
    const config = openPipeline((c) => {
      c.stages.deploy.gate = 'approval';
    });
    await store.update('pipelines', [config]);
    mockRun.mockResolvedValue(okResult());

    const item = await runner.enqueue({ projectId: project.id, request: 'gated change', source: 'manual' });

    const held = await until(() =>
      store.workItems().find((it) => it.id === item.id && it.status === 'waiting-approval'),
    );
    expect(held.currentStage).toBe('deploy');
    expect(held.stages.deploy.status).toBe('waiting-approval');

    await runner.approve(item.id);
    await until(() => store.workItems().length === 0);
    const archived = await readArchivedWorkItems(store.paths, project.id);
    expect(archived[0]?.status).toBe('done');
    expect(archived[0]?.approvedStages).toEqual(['deploy']);
  });

  it('rejects enqueue when the line has no enabled stages (blank default)', async () => {
    // No stored config: the all-disabled defaults apply.
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

  it('marks the item failed when a stage errors, and retry re-runs it', async () => {
    await store.update('pipelines', [openPipeline()]);
    mockRun
      .mockResolvedValueOnce(okResult('plan'))
      .mockResolvedValueOnce({ ok: false, provider: 'claude', error: 'boom' });

    const item = await runner.enqueue({ projectId: project.id, request: 'flaky', source: 'manual' });

    const failed = await until(() =>
      store.workItems().find((it) => it.id === item.id && it.status === 'failed'),
    );
    expect(failed.currentStage).toBe('code');
    expect(failed.stages.code.status).toBe('failed');
    expect(failed.stages.code.error).toBe('boom');

    mockRun.mockResolvedValue(okResult());
    await runner.retry(item.id);
    await until(() => store.workItems().length === 0);
    const archived = await readArchivedWorkItems(store.paths, project.id);
    expect(archived[0]?.status).toBe('done');
  });

  it('fails the test stage when the agent reports TEST_RESULT: FAIL', async () => {
    await store.update('pipelines', [openPipeline()]);
    mockRun.mockImplementation(async (opts) =>
      okResult(opts.prompt.includes('validation station') ? 'ran suite\nTEST_RESULT: FAIL flaky' : 'ok'),
    );

    const item = await runner.enqueue({ projectId: project.id, request: 'x', source: 'manual' });
    const failed = await until(() =>
      store.workItems().find((it) => it.id === item.id && it.status === 'failed'),
    );
    expect(failed.currentStage).toBe('test');
    expect(failed.stages.test.error).toMatch(/TEST_RESULT/);
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

  it('resumes the same provider session across stages', async () => {
    await store.update('pipelines', [openPipeline()]);
    mockRun.mockResolvedValue(okResult('ok', 'session-abc'));

    await runner.enqueue({ projectId: project.id, request: 'x', source: 'manual' });
    await until(() => store.workItems().length === 0);

    // First stage starts fresh; every later stage resumes the session.
    expect(mockRun.mock.calls[0]?.[0]?.sessionId).toBeUndefined();
    for (const call of mockRun.mock.calls.slice(1)) {
      expect(call[0]?.sessionId).toBe('session-abc');
    }
  });

  it('recover() re-queues items that were running and resumes them', async () => {
    await store.update('pipelines', [openPipeline()]);
    // Simulate an item that died mid-code-stage in a previous process.
    const stranded: WorkItem = {
      id: 'wi-stranded',
      projectId: project.id,
      title: 'stranded',
      request: 'finish me',
      source: 'manual',
      status: 'running',
      currentStage: 'code',
      stages: {
        intake: { status: 'skipped' },
        spec: { status: 'success', output: 'the plan' },
        code: { status: 'running' },
        test: { status: 'pending' },
        deploy: { status: 'pending' },
        monitor: { status: 'pending' },
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
    const config = openPipeline();
    config.projectId = 'nope';
    await store.update('pipelines', [config]);
    mockRun.mockResolvedValue(okResult());
    const item = await runner.enqueue({ projectId: 'nope', request: 'x', source: 'manual' });
    const failed = await until(() =>
      store.workItems().find((it) => it.id === item.id && it.status === 'failed'),
    );
    expect(failed.stages.spec.error).toMatch(/not found/);
  });

  it('parks the item in monitoring when the monitor stage is enabled', async () => {
    const config = openPipeline((c) => {
      c.stages.monitor.enabled = true;
    });
    await store.update('pipelines', [config]);
    mockRun.mockResolvedValue(okResult());

    const item = await runner.enqueue({ projectId: project.id, request: 'x', source: 'manual' });
    const monitoring = await until(() =>
      store.workItems().find((it) => it.id === item.id && it.status === 'monitoring'),
    );
    expect(monitoring.stages.monitor.checksPassed).toBe(0);
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

  async function seedMonitoring(source: WorkItem['source'] = 'manual', maxChecks = 2): Promise<WorkItem> {
    const config = defaultPipelineConfig(project.id);
    // Monitor is installed (it's mid-check), spec so a filed defect has an
    // agent stage to park on.
    config.stages.spec.enabled = true;
    config.stages.monitor.enabled = true;
    config.stages.monitor.maxChecks = maxChecks;
    await store.update('pipelines', [config]);
    const item: WorkItem = {
      id: 'wi-mon',
      projectId: project.id,
      title: 'shipped thing',
      request: 'the request',
      source,
      status: 'monitoring',
      currentStage: 'monitor',
      stages: {
        intake: { status: 'skipped' },
        spec: { status: 'success' },
        code: { status: 'success' },
        test: { status: 'success' },
        deploy: { status: 'success' },
        monitor: { status: 'running', checksPassed: 0 },
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await store.update('workItems', [item]);
    return item;
  }

  it('completes the item after maxChecks consecutive passes', async () => {
    const item = await seedMonitoring('manual', 2);
    mockRun.mockResolvedValue(okResult('all good\nMONITOR_RESULT: PASS'));

    await runner.runMonitorCheck(item.id);
    expect(store.workItems()[0]?.stages.monitor.checksPassed).toBe(1);

    await runner.runMonitorCheck(item.id);
    expect(store.workItems()).toHaveLength(0);
    const archived = await readArchivedWorkItems(store.paths, project.id);
    expect(archived[0]?.status).toBe('done');
    expect(archived[0]?.stages.monitor.status).toBe('success');
  });

  it('fails the item and files a defect when a check fails', async () => {
    const item = await seedMonitoring('manual');
    mockRun
      .mockResolvedValueOnce(okResult('something is wrong\nMONITOR_RESULT: FAIL errors in logs'))
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

  it('treats a missing PASS marker as a failure', async () => {
    const item = await seedMonitoring();
    mockRun
      .mockResolvedValueOnce(okResult('looks fine to me'))
      .mockReturnValue(new Promise(() => {}));
    await runner.runMonitorCheck(item.id);
    expect(store.workItems().find((it) => it.id === item.id)?.status).toBe('failed');
  });

  it('does not file a defect for monitor-sourced items (loop guard)', async () => {
    const item = await seedMonitoring('monitor');
    mockRun.mockResolvedValue(okResult('MONITOR_RESULT: FAIL still broken'));
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

  it('passes resolved tools per stage and drops dangling ids', async () => {
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
      openPipeline((c) => {
        c.stages.spec.skills = ['skill-1', 'deleted-skill'];
        c.stages.spec.mcpServers = ['mcp-1'];
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
    // Unassigned stages still get an (empty) payload — deny by default.
    const codeCall = mockRun.mock.calls[1]![0];
    expect(codeCall.tools).toEqual({ skills: [], mcpServers: [] });
  });

  it('unions project-level assignments with stage assignments (deduped)', async () => {
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
      openPipeline((c) => {
        c.stages.spec.skills = ['skill-stage'];
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
    // A stage with no assignments of its own still inherits project tools.
    const codeCall = mockRun.mock.calls[1]![0];
    expect(codeCall.tools?.skills.map((s) => s.name)).toEqual(['project-skill', 'stage-skill']);
    expect(codeCall.tools?.mcpServers.map((m) => m.name)).toEqual(['project-server']);
  });

  it('prepends the project vision/context preamble to every stage prompt', async () => {
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
