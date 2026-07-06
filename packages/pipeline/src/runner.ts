import type { AgentRunner } from '@claude-hub/agent-runner';
import {
  PIPELINE_STAGE_ORDER,
  type PipelineStageId,
  type StageResult,
  type Store,
  type WorkItem,
  type WorkItemSource,
} from '@claude-hub/core';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  DEFAULT_MONITOR_MAX_CHECKS,
  effectivePipelineConfig,
} from './defaults.js';
import { appendStageRun, archiveWorkItem } from './history.js';
import { executeStage, truncateOutput } from './stages.js';

export interface EnqueueWorkItemInput {
  projectId: string;
  title?: string;
  request: string;
  source: WorkItemSource;
  sourceRef?: string;
}

export interface PipelineRunnerEvents {
  /** Fired on every persisted work item state change. */
  itemChanged: (item: WorkItem) => void;
  stageStarted: (item: WorkItem, stage: PipelineStageId) => void;
  stageFinished: (item: WorkItem, stage: PipelineStageId, ok: boolean) => void;
}

/** Thrown for invalid work item operations; routes map codes to 404/409. */
export class WorkItemStateError extends Error {
  constructor(
    message: string,
    readonly code: 'not-found' | 'wrong-state' | 'no-enabled-stages',
  ) {
    super(message);
    this.name = 'WorkItemStateError';
  }
}

const TITLE_LIMIT = 60;

/**
 * Drives work items through the fixed assembly-line stages. One item runs
 * per project at a time (FIFO); different projects advance in parallel.
 * Items parked at approval gates or in monitoring release their queue slot
 * so a held item never blocks the line.
 *
 * Every state transition goes through `Store.update('workItems', …)`, which
 * the server already fans out to the UI over the WS fat-patch.
 */
export class PipelineRunner extends EventEmitter {
  /** Projects with an active drain loop. */
  private draining = new Set<string>();

  constructor(
    private readonly store: Store,
    private readonly agentRunner: AgentRunner,
    private readonly opts: { timeoutMs?: number } = {},
  ) {
    super();
  }

  async enqueue(input: EnqueueWorkItemInput): Promise<WorkItem> {
    // A blank line (no machines installed) would run every stage as skipped
    // and archive the item as done having done nothing — reject instead so
    // webhook/cron/channel intakes fail visibly.
    const config = effectivePipelineConfig(this.store, input.projectId);
    if (PIPELINE_STAGE_ORDER.every((stage) => !config.stages[stage].enabled)) {
      throw new WorkItemStateError(
        `project ${input.projectId} has no enabled pipeline stages; add a machine to its assembly line first`,
        'no-enabled-stages',
      );
    }

    const now = new Date().toISOString();
    const stages = {} as Record<PipelineStageId, StageResult>;
    for (const stage of PIPELINE_STAGE_ORDER) stages[stage] = { status: 'pending' };

    const item: WorkItem = {
      id: randomUUID(),
      projectId: input.projectId,
      title: input.title?.trim() || deriveTitle(input.request),
      request: input.request,
      source: input.source,
      ...(input.sourceRef !== undefined ? { sourceRef: input.sourceRef } : {}),
      status: 'queued',
      currentStage: PIPELINE_STAGE_ORDER[0]!,
      stages,
      createdAt: now,
      updatedAt: now,
    };

    await this.store.update('workItems', (items) => [...items, item]);
    console.log(
      `[pipeline] enqueued "${item.title}" (${item.id.slice(0, 8)}) project=${item.projectId} source=${item.source}`,
    );
    this.emit('itemChanged', item);
    this.kick(input.projectId);
    return item;
  }

  async approve(id: string): Promise<WorkItem> {
    const item = this.requireItem(id);
    if (item.status !== 'waiting-approval') {
      throw new WorkItemStateError(`work item ${id} is ${item.status}, not waiting-approval`, 'wrong-state');
    }
    const updated = await this.updateItem(id, (it) => {
      it.approvedStages = [...(it.approvedStages ?? []), it.currentStage];
      it.status = 'queued';
      it.stages[it.currentStage] = { status: 'pending' };
    });
    if (updated) this.kick(updated.projectId);
    return updated ?? item;
  }

  async retry(id: string): Promise<WorkItem> {
    const item = this.requireItem(id);
    if (item.status !== 'failed') {
      throw new WorkItemStateError(`work item ${id} is ${item.status}, not failed`, 'wrong-state');
    }
    const updated = await this.updateItem(id, (it) => {
      it.stages[it.currentStage] = { status: 'pending' };
      it.status = 'queued';
    });
    if (updated) this.kick(updated.projectId);
    return updated ?? item;
  }

  async cancel(id: string): Promise<WorkItem> {
    const item = this.requireItem(id);
    const cancelled: WorkItem = {
      ...item,
      status: 'cancelled',
      updatedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };
    // Archive first, then drop from the live snapshot. Any in-flight agent
    // run for this item finishes on its own; its result is discarded when
    // the advance loop finds the item gone.
    await archiveWorkItem(this.store.paths, cancelled);
    await this.store.update('workItems', (items) => items.filter((it) => it.id !== id));
    this.emit('itemChanged', cancelled);
    return cancelled;
  }

  /**
   * Boot-time recovery: items that were mid-stage when the server died are
   * re-queued at that stage (session ids survive on the item, so the agent
   * resumes with context). Queued/waiting/monitoring items need nothing.
   */
  async recover(): Promise<void> {
    const interrupted = this.store.workItems().filter((it) => it.status === 'running');
    if (interrupted.length > 0) {
      await this.store.update('workItems', (items) =>
        items.map((it) =>
          it.status === 'running'
            ? {
                ...it,
                status: 'queued' as const,
                stages: { ...it.stages, [it.currentStage]: { status: 'pending' as const } },
                updatedAt: new Date().toISOString(),
              }
            : it,
        ),
      );
      for (const it of interrupted) {
        await appendStageRun(this.store.paths, {
          workItemId: it.id,
          stage: it.currentStage,
          status: 'interrupted',
          startedAt: it.stages[it.currentStage]?.startedAt ?? it.updatedAt,
          finishedAt: new Date().toISOString(),
          error: 'interrupted by server restart',
        });
      }
      console.log(`[pipeline] recovered ${interrupted.length} interrupted work item(s)`);
    }
    for (const projectId of new Set(this.store.workItems().map((it) => it.projectId))) {
      this.kick(projectId);
    }
  }

  /**
   * One monitor check for a `monitoring` item. Called by MonitorScheduler
   * on its interval. A pass increments the counter; enough consecutive
   * passes complete the item. A failure fails the item and auto-files a
   * defect work item at the top of the line (unless this item is itself a
   * monitor-filed defect — that would loop).
   */
  async runMonitorCheck(id: string): Promise<void> {
    const item = this.store.workItems().find((it) => it.id === id);
    if (!item || item.status !== 'monitoring') return;

    const project = this.store.projects().find((p) => p.id === item.projectId);
    const cfg = effectivePipelineConfig(this.store, item.projectId).stages.monitor;
    const startedAt = new Date().toISOString();

    let ok = false;
    let output = '';
    let error: string | undefined;
    let prompt: string | undefined;
    let session: Awaited<ReturnType<typeof executeStage>>['session'];

    if (!project) {
      error = `project ${item.projectId} not found`;
    } else {
      const res = await executeStage(
        { store: this.store, agentRunner: this.agentRunner, ...(this.opts.timeoutMs ? { defaultTimeoutMs: this.opts.timeoutMs } : {}) },
        item,
        'monitor',
        cfg,
        project.path,
      );
      ok = res.ok;
      output = res.output;
      error = res.error;
      prompt = res.prompt;
      session = res.session;
    }

    await appendStageRun(this.store.paths, {
      workItemId: item.id,
      stage: 'monitor',
      status: ok ? 'success' : 'failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      ...(prompt !== undefined ? { prompt } : {}),
      ...(output ? { output } : {}),
      ...(error !== undefined ? { error } : {}),
    });

    if (ok) {
      const passed = (item.stages.monitor.checksPassed ?? 0) + 1;
      const maxChecks = cfg.maxChecks ?? DEFAULT_MONITOR_MAX_CHECKS;
      if (passed >= maxChecks) {
        const done = await this.updateItem(id, (it) => {
          it.stages.monitor = {
            status: 'success',
            checksPassed: passed,
            output: truncateOutput(output),
            finishedAt: new Date().toISOString(),
          };
          it.status = 'done';
          it.finishedAt = new Date().toISOString();
          if (session) it.sessions = { ...it.sessions, [session.provider]: session.sessionId };
        });
        if (done) {
          await archiveWorkItem(this.store.paths, done);
          await this.store.update('workItems', (items) => items.filter((it) => it.id !== id));
          console.log(`[pipeline] "${done.title}" (${id.slice(0, 8)}) shipped after ${passed} healthy checks`);
        }
      } else {
        await this.updateItem(id, (it) => {
          it.stages.monitor = {
            ...it.stages.monitor,
            checksPassed: passed,
            output: truncateOutput(output),
          };
          if (session) it.sessions = { ...it.sessions, [session.provider]: session.sessionId };
        });
        console.log(`[pipeline] "${item.title}" monitor check ${passed}/${maxChecks} passed`);
      }
      return;
    }

    const failed = await this.updateItem(id, (it) => {
      it.stages.monitor = {
        ...it.stages.monitor,
        status: 'failed',
        output: truncateOutput(output),
        ...(error !== undefined ? { error } : {}),
        finishedAt: new Date().toISOString(),
      };
      it.status = 'failed';
    });
    console.warn(`[pipeline] "${item.title}" (${id.slice(0, 8)}) monitor check failed: ${error ?? 'unknown'}`);

    // Auto-file a defect back at the top of the line. Loop guard: defects
    // found while monitoring a defect fix don't file further defects.
    if (failed && item.source !== 'monitor') {
      await this.enqueue({
        projectId: item.projectId,
        title: `Defect: ${item.title}`.slice(0, TITLE_LIMIT + 8),
        request:
          `A production monitor check failed after shipping "${item.title}".\n\n` +
          `Original request:\n${item.request}\n\n` +
          `Monitor failure:\n${error ?? 'unknown'}\n\n` +
          `Check output:\n${truncateOutput(output)}\n\n` +
          `Investigate and fix the defect.`,
        source: 'monitor',
        sourceRef: item.id,
      });
    }
  }

  // -- internals --------------------------------------------------------------

  /** Start the drain loop for a project unless one is already running. */
  private kick(projectId: string): void {
    if (this.draining.has(projectId)) return;
    this.draining.add(projectId);
    void this.drain(projectId)
      .catch((err) => console.error(`[pipeline] drain error for project ${projectId}:`, err))
      .finally(() => this.draining.delete(projectId));
  }

  private async drain(projectId: string): Promise<void> {
    for (;;) {
      const next = this.store
        .workItems()
        .find((it) => it.projectId === projectId && it.status === 'queued');
      if (!next) return;
      await this.advance(next);
    }
  }

  /**
   * Runs one work item forward until it parks: a gate, a failure,
   * monitoring, or completion. `startItem.currentStage` is where it resumes.
   */
  private async advance(startItem: WorkItem): Promise<void> {
    const config = effectivePipelineConfig(this.store, startItem.projectId);
    const project = this.store.projects().find((p) => p.id === startItem.projectId);
    const id = startItem.id;

    let idx = PIPELINE_STAGE_ORDER.indexOf(startItem.currentStage);
    if (idx < 0) idx = 0;

    for (; idx < PIPELINE_STAGE_ORDER.length; idx++) {
      const stage = PIPELINE_STAGE_ORDER[idx]!;
      const cfg = config.stages[stage];
      const current = this.store.workItems().find((it) => it.id === id);
      if (!current) return; // cancelled underneath us

      if (!cfg.enabled) {
        await this.updateItem(id, (it) => {
          it.currentStage = stage;
          it.status = 'running';
          it.stages[stage] = { status: 'skipped' };
        });
        continue;
      }

      if (cfg.gate === 'approval' && !(current.approvedStages ?? []).includes(stage)) {
        await this.updateItem(id, (it) => {
          it.currentStage = stage;
          it.status = 'waiting-approval';
          it.stages[stage] = { status: 'waiting-approval' };
        });
        console.log(`[pipeline] "${current.title}" (${id.slice(0, 8)}) held for approval at ${stage}`);
        return;
      }

      if (stage === 'monitor') {
        await this.updateItem(id, (it) => {
          it.currentStage = 'monitor';
          it.status = 'monitoring';
          it.stages.monitor = { status: 'running', checksPassed: 0, startedAt: new Date().toISOString() };
        });
        console.log(`[pipeline] "${current.title}" (${id.slice(0, 8)}) deployed; monitoring`);
        return; // MonitorScheduler takes over, off the project queue
      }

      const startedAt = new Date().toISOString();
      const runningItem = await this.updateItem(id, (it) => {
        it.currentStage = stage;
        it.status = 'running';
        it.stages[stage] = { status: 'running', startedAt };
      });
      if (!runningItem) return;
      this.emit('stageStarted', runningItem, stage);
      console.log(`[pipeline] "${runningItem.title}" (${id.slice(0, 8)}) running stage ${stage}`);

      let ok = false;
      let output = '';
      let prompt: string | undefined;
      let error: string | undefined;
      let session: Awaited<ReturnType<typeof executeStage>>['session'];

      if (!project) {
        error = `project ${startItem.projectId} not found`;
      } else {
        try {
          const res = await executeStage(
            {
              store: this.store,
              agentRunner: this.agentRunner,
              ...(this.opts.timeoutMs ? { defaultTimeoutMs: this.opts.timeoutMs } : {}),
            },
            runningItem,
            stage,
            cfg,
            project.path,
          );
          ok = res.ok;
          output = res.output;
          prompt = res.prompt;
          error = res.error;
          session = res.session;
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
        }
      }

      await appendStageRun(this.store.paths, {
        workItemId: id,
        stage,
        status: ok ? 'success' : 'failed',
        startedAt,
        finishedAt: new Date().toISOString(),
        ...(prompt !== undefined ? { prompt } : {}),
        ...(output ? { output } : {}),
        ...(error !== undefined ? { error } : {}),
      });

      const afterItem = await this.updateItem(id, (it) => {
        it.stages[stage] = {
          status: ok ? 'success' : 'failed',
          startedAt,
          finishedAt: new Date().toISOString(),
          output: truncateOutput(output),
          ...(error !== undefined ? { error } : {}),
        };
        if (session) it.sessions = { ...it.sessions, [session.provider]: session.sessionId };
        if (!ok) it.status = 'failed';
      });
      if (!afterItem) return; // cancelled while the stage ran
      this.emit('stageFinished', afterItem, stage, ok);

      if (!ok) {
        console.warn(`[pipeline] "${afterItem.title}" (${id.slice(0, 8)}) failed at ${stage}: ${error?.slice(0, 120)}`);
        return;
      }
    }

    // Every stage ran or was skipped and monitor never took over (disabled).
    const done = await this.updateItem(id, (it) => {
      it.status = 'done';
      it.finishedAt = new Date().toISOString();
    });
    if (done) {
      await archiveWorkItem(this.store.paths, done);
      await this.store.update('workItems', (items) => items.filter((it) => it.id !== id));
      console.log(`[pipeline] "${done.title}" (${id.slice(0, 8)}) completed`);
    }
  }

  private requireItem(id: string): WorkItem {
    const item = this.store.workItems().find((it) => it.id === id);
    if (!item) throw new WorkItemStateError(`work item ${id} not found`, 'not-found');
    return item;
  }

  /**
   * Read-modify-write one live item. Returns the updated item, or undefined
   * if it left the live snapshot (cancelled/archived) in the meantime.
   */
  private async updateItem(
    id: string,
    mutate: (item: WorkItem) => void,
  ): Promise<WorkItem | undefined> {
    let updated: WorkItem | undefined;
    await this.store.update('workItems', (items) =>
      items.map((it) => {
        if (it.id !== id) return it;
        mutate(it);
        it.updatedAt = new Date().toISOString();
        updated = it;
        return it;
      }),
    );
    if (updated) this.emit('itemChanged', updated);
    return updated;
  }
}

function deriveTitle(request: string): string {
  const firstLine = request.trim().split('\n', 1)[0] ?? '';
  return firstLine.length > TITLE_LIMIT ? `${firstLine.slice(0, TITLE_LIMIT - 1)}…` : firstLine || 'work request';
}

export interface PipelineRunner {
  on<E extends keyof PipelineRunnerEvents>(event: E, listener: PipelineRunnerEvents[E]): this;
  off<E extends keyof PipelineRunnerEvents>(event: E, listener: PipelineRunnerEvents[E]): this;
  emit<E extends keyof PipelineRunnerEvents>(
    event: E,
    ...args: Parameters<PipelineRunnerEvents[E]>
  ): boolean;
}
