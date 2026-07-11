import type { AgentRunner } from '@claude-hub/agent-runner';
import {
  type PipelineMachine,
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
import {
  appendMachineRunEvent,
  appendStageRun,
  archiveWorkItem,
  type MachineRunEventStatus,
} from './history.js';
import { MACHINE_SUMMARY_LIMIT, executeMachine, truncateOutput } from './stages.js';

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
  stageStarted: (item: WorkItem, machineKey: string) => void;
  stageFinished: (item: WorkItem, machineKey: string, ok: boolean) => void;
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
 * Drives work items through a project's ordered machine line. One item runs
 * per project at a time (FIFO); different projects advance in parallel.
 * Items parked at approval gates or in monitoring release their queue slot
 * so a held item never blocks the line.
 *
 * Line edits under an in-flight item reconcile forward-only:
 *   1. While the item's currentStage key still exists, machines inserted
 *      BEFORE it never run for that item; machines inserted after are
 *      picked up naturally as the loop walks the current array.
 *   2. If the currentStage key no longer exists (machine removed), the item
 *      resumes at the first machine in current line order without a
 *      recorded 'success' — if every installed machine has succeeded, the
 *      item completes.
 *   3. Results recorded under keys no longer installed are retained on the
 *      item and in archives, so history stays truthful.
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
    // A blank line (no machines installed) would archive the item as done
    // having done nothing — reject instead so webhook/cron/channel intakes
    // fail visibly. Error code kept as 'no-enabled-stages' for API
    // stability with pre-v7 callers.
    const config = effectivePipelineConfig(this.store, input.projectId);
    const first = config.machines[0];
    if (!first) {
      throw new WorkItemStateError(
        `project ${input.projectId} has no machines on its line; add a machine to its assembly line first`,
        'no-enabled-stages',
      );
    }

    const now = new Date().toISOString();
    const stages: Record<string, StageResult> = {};
    for (const machine of config.machines) stages[machine.key] = { status: 'pending' };

    const item: WorkItem = {
      id: randomUUID(),
      projectId: input.projectId,
      title: input.title?.trim() || deriveTitle(input.request),
      request: input.request,
      source: input.source,
      ...(input.sourceRef !== undefined ? { sourceRef: input.sourceRef } : {}),
      status: 'queued',
      currentStage: first.key,
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
        const startedAt = it.stages[it.currentStage]?.startedAt ?? it.updatedAt;
        const finishedAt = new Date().toISOString();
        await appendStageRun(this.store.paths, {
          workItemId: it.id,
          stage: it.currentStage,
          status: 'interrupted',
          startedAt,
          finishedAt,
          error: 'interrupted by server restart',
        });
        const machineName = effectivePipelineConfig(this.store, it.projectId).machines.find(
          (m) => m.key === it.currentStage,
        )?.name;
        await this.logMachineRun({
          item: it,
          machineKey: it.currentStage,
          ...(machineName !== undefined ? { machineName } : {}),
          status: 'interrupted',
          startedAt,
          finishedAt,
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
   * Called after a project's line is edited. Items parked at an approval
   * gate whose machine was removed can never be approved (the key is gone),
   * so they're re-queued and the drain loop re-reconciles them; the
   * unconditional kick is a no-op when nothing is queued.
   */
  async reconcileLineEdit(projectId: string): Promise<void> {
    const keys = new Set(
      effectivePipelineConfig(this.store, projectId).machines.map((m) => m.key),
    );
    const stuck = this.store
      .workItems()
      .filter(
        (it) =>
          it.projectId === projectId &&
          it.status === 'waiting-approval' &&
          !keys.has(it.currentStage),
      );
    for (const it of stuck) {
      await this.updateItem(it.id, (x) => {
        x.status = 'queued';
      });
      console.log(
        `[pipeline] "${it.title}" (${it.id.slice(0, 8)}) was held at removed machine ${it.currentStage}; re-queued`,
      );
    }
    this.kick(projectId);
  }

  /**
   * One monitor check for a `monitoring` item. Called by MonitorScheduler
   * on its interval. A pass increments the counter; enough consecutive
   * passes complete the machine — the item ships if it's the last machine
   * on the line, or re-queues to continue down the line otherwise (a mid-
   * line soak test). A failure fails the item and auto-files a defect work
   * item at the top of the line (unless this item is itself a monitor-filed
   * defect — that would loop).
   */
  async runMonitorCheck(id: string): Promise<void> {
    const item = this.store.workItems().find((it) => it.id === id);
    if (!item || item.status !== 'monitoring') return;

    const machines = effectivePipelineConfig(this.store, item.projectId).machines;
    const idx = machines.findIndex((m) => m.key === item.currentStage);
    const machine = idx >= 0 ? machines[idx]! : undefined;
    const machineKey = item.currentStage;

    if (!machine) {
      // The monitoring machine was removed from the line. Fail visibly —
      // retry after reconfiguring re-reconciles via the advance loop.
      await this.updateItem(id, (it) => {
        it.stages[machineKey] = {
          ...(it.stages[machineKey] ?? {}),
          status: 'failed',
          error: `monitor machine "${machineKey}" was removed from the line`,
          finishedAt: new Date().toISOString(),
        };
        it.status = 'failed';
      });
      return;
    }
    if (!machine.monitor) {
      // The machine lost its monitor loop mid-watch: hand it back to the
      // advance loop, which re-runs it as a normal machine.
      const requeued = await this.updateItem(id, (it) => {
        it.status = 'queued';
        it.stages[machineKey] = { status: 'pending' };
      });
      if (requeued) this.kick(requeued.projectId);
      return;
    }

    const project = this.store.projects().find((p) => p.id === item.projectId);
    const startedAt = new Date().toISOString();

    let ok = false;
    let output = '';
    let error: string | undefined;
    let prompt: string | undefined;
    let summary: string | undefined;
    let session: Awaited<ReturnType<typeof executeMachine>>['session'];

    if (!project) {
      error = `project ${item.projectId} not found`;
    } else {
      const res = await executeMachine(
        { store: this.store, agentRunner: this.agentRunner, ...(this.opts.timeoutMs ? { defaultTimeoutMs: this.opts.timeoutMs } : {}) },
        item,
        machine,
        machines,
        project,
      );
      ok = res.ok;
      output = res.output;
      error = res.error;
      prompt = res.prompt;
      summary = res.summary ?? fallbackSummary(res.output);
      session = res.session;
    }

    const finishedAt = new Date().toISOString();
    await appendStageRun(this.store.paths, {
      workItemId: item.id,
      stage: machineKey,
      status: ok ? 'success' : 'failed',
      startedAt,
      finishedAt,
      ...(prompt !== undefined ? { prompt } : {}),
      ...(output ? { output } : {}),
      ...(summary !== undefined ? { summary } : {}),
      ...(error !== undefined ? { error } : {}),
    });
    await this.logMachineRun({
      item,
      machineKey,
      machineName: machine.name,
      status: ok ? 'success' : 'failed',
      startedAt,
      finishedAt,
      ...(summary !== undefined ? { summary } : {}),
      ...(error !== undefined ? { error } : {}),
    });

    if (ok) {
      const passed = (item.stages[machineKey]?.checksPassed ?? 0) + 1;
      const maxChecks = machine.monitor.maxChecks ?? DEFAULT_MONITOR_MAX_CHECKS;
      if (passed >= maxChecks) {
        const isLast = idx === machines.length - 1;
        const completed = await this.updateItem(id, (it) => {
          it.stages[machineKey] = {
            status: 'success',
            checksPassed: passed,
            output: truncateOutput(output),
            ...(summary !== undefined ? { summary } : {}),
            finishedAt: new Date().toISOString(),
          };
          if (session) it.sessions = { ...it.sessions, [session.provider]: session.sessionId };
          if (isLast) {
            it.status = 'done';
            it.finishedAt = new Date().toISOString();
          } else {
            it.status = 'queued';
            it.currentStage = machines[idx + 1]!.key;
          }
        });
        if (completed && isLast) {
          await archiveWorkItem(this.store.paths, completed);
          await this.store.update('workItems', (items) => items.filter((it) => it.id !== id));
          console.log(`[pipeline] "${completed.title}" (${id.slice(0, 8)}) shipped after ${passed} healthy checks`);
        } else if (completed) {
          console.log(
            `[pipeline] "${completed.title}" (${id.slice(0, 8)}) passed ${passed} checks at ${machineKey}; continuing down the line`,
          );
          this.kick(completed.projectId);
        }
      } else {
        await this.updateItem(id, (it) => {
          it.stages[machineKey] = {
            ...it.stages[machineKey],
            status: it.stages[machineKey]?.status ?? 'running',
            checksPassed: passed,
            output: truncateOutput(output),
            ...(summary !== undefined ? { summary } : {}),
          };
          if (session) it.sessions = { ...it.sessions, [session.provider]: session.sessionId };
        });
        console.log(`[pipeline] "${item.title}" monitor check ${passed}/${maxChecks} passed`);
      }
      return;
    }

    const failed = await this.updateItem(id, (it) => {
      it.stages[machineKey] = {
        ...it.stages[machineKey],
        status: 'failed',
        output: truncateOutput(output),
        ...(summary !== undefined ? { summary } : {}),
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
   * monitoring, or completion. `startItem.currentStage` is where it
   * resumes; if that machine was removed, the reconciliation rule in the
   * class doc applies. Machines whose recorded result is already 'success'
   * are skipped — that's what lets a mid-line monitor completion and a
   * reconciled item resume without re-running finished work.
   */
  private async advance(startItem: WorkItem): Promise<void> {
    const machines: readonly PipelineMachine[] = effectivePipelineConfig(
      this.store,
      startItem.projectId,
    ).machines;
    const project = this.store.projects().find((p) => p.id === startItem.projectId);
    const id = startItem.id;

    let idx = machines.findIndex((m) => m.key === startItem.currentStage);
    if (idx < 0) {
      // currentStage's machine was removed: resume at the first machine
      // without a recorded success. -1 means everything succeeded (or the
      // line is empty) — fall through to completion below.
      idx = machines.findIndex((m) => startItem.stages[m.key]?.status !== 'success');
      if (idx < 0) idx = machines.length;
    }

    for (; idx < machines.length; idx++) {
      const machine = machines[idx]!;
      const current = this.store.workItems().find((it) => it.id === id);
      if (!current) return; // cancelled underneath us

      if (current.stages[machine.key]?.status === 'success') {
        // Already ran on a previous pass (line edit/reorder resume).
        const now = new Date().toISOString();
        await this.logMachineRun({
          item: current,
          machineKey: machine.key,
          machineName: machine.name,
          status: 'skipped',
          startedAt: now,
          finishedAt: now,
          summary: 'Skipped — already succeeded on a previous pass.',
        });
        continue;
      }

      if (machine.gate === 'approval' && !(current.approvedStages ?? []).includes(machine.key)) {
        await this.updateItem(id, (it) => {
          it.currentStage = machine.key;
          it.status = 'waiting-approval';
          it.stages[machine.key] = { status: 'waiting-approval' };
        });
        console.log(`[pipeline] "${current.title}" (${id.slice(0, 8)}) held for approval at ${machine.key}`);
        return;
      }

      if (machine.monitor) {
        await this.updateItem(id, (it) => {
          it.currentStage = machine.key;
          it.status = 'monitoring';
          it.stages[machine.key] = { status: 'running', checksPassed: 0, startedAt: new Date().toISOString() };
        });
        console.log(`[pipeline] "${current.title}" (${id.slice(0, 8)}) parked at ${machine.key}; monitoring`);
        return; // MonitorScheduler takes over, off the project queue
      }

      const startedAt = new Date().toISOString();
      const runningItem = await this.updateItem(id, (it) => {
        it.currentStage = machine.key;
        it.status = 'running';
        it.stages[machine.key] = { status: 'running', startedAt };
      });
      if (!runningItem) return;
      this.emit('stageStarted', runningItem, machine.key);
      console.log(`[pipeline] "${runningItem.title}" (${id.slice(0, 8)}) running machine ${machine.key}`);

      let ok = false;
      let output = '';
      let prompt: string | undefined;
      let summary: string | undefined;
      let error: string | undefined;
      let session: Awaited<ReturnType<typeof executeMachine>>['session'];

      if (!project) {
        error = `project ${startItem.projectId} not found`;
      } else {
        try {
          const res = await executeMachine(
            {
              store: this.store,
              agentRunner: this.agentRunner,
              ...(this.opts.timeoutMs ? { defaultTimeoutMs: this.opts.timeoutMs } : {}),
            },
            runningItem,
            machine,
            machines,
            project,
          );
          ok = res.ok;
          output = res.output;
          prompt = res.prompt;
          summary = res.summary ?? fallbackSummary(res.output);
          error = res.error;
          session = res.session;
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
        }
      }

      const finishedAt = new Date().toISOString();
      await appendStageRun(this.store.paths, {
        workItemId: id,
        stage: machine.key,
        status: ok ? 'success' : 'failed',
        startedAt,
        finishedAt,
        ...(prompt !== undefined ? { prompt } : {}),
        ...(output ? { output } : {}),
        ...(summary !== undefined ? { summary } : {}),
        ...(error !== undefined ? { error } : {}),
      });
      await this.logMachineRun({
        item: runningItem,
        machineKey: machine.key,
        machineName: machine.name,
        status: ok ? 'success' : 'failed',
        startedAt,
        finishedAt,
        ...(summary !== undefined ? { summary } : {}),
        ...(error !== undefined ? { error } : {}),
      });

      const afterItem = await this.updateItem(id, (it) => {
        it.stages[machine.key] = {
          status: ok ? 'success' : 'failed',
          startedAt,
          finishedAt: new Date().toISOString(),
          output: truncateOutput(output),
          ...(summary !== undefined ? { summary } : {}),
          ...(error !== undefined ? { error } : {}),
        };
        if (session) it.sessions = { ...it.sessions, [session.provider]: session.sessionId };
        if (!ok) it.status = 'failed';
      });
      if (!afterItem) return; // cancelled while the machine ran
      this.emit('stageFinished', afterItem, machine.key, ok);

      if (!ok) {
        console.warn(`[pipeline] "${afterItem.title}" (${id.slice(0, 8)}) failed at ${machine.key}: ${error?.slice(0, 120)}`);
        return;
      }
    }

    // Every machine ran (or already had a success) and none parked the item.
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

  /**
   * Append one denormalized event to the activity-feed log. Best-effort: a
   * feed-log failure must never fail the machine run it describes.
   */
  private async logMachineRun(args: {
    item: WorkItem;
    machineKey: string;
    machineName?: string;
    status: MachineRunEventStatus;
    startedAt: string;
    finishedAt: string;
    summary?: string;
    error?: string;
  }): Promise<void> {
    try {
      const project = this.store.projects().find((p) => p.id === args.item.projectId);
      await appendMachineRunEvent(this.store.paths, {
        id: randomUUID(),
        workItemId: args.item.id,
        workItemTitle: args.item.title,
        projectId: args.item.projectId,
        projectName: project?.name ?? args.item.projectId,
        machineKey: args.machineKey,
        machineName: args.machineName ?? args.machineKey,
        status: args.status,
        startedAt: args.startedAt,
        finishedAt: args.finishedAt,
        ...(args.summary !== undefined ? { summary: args.summary } : {}),
        ...(args.error !== undefined ? { error: args.error } : {}),
      });
    } catch (err) {
      console.warn(`[pipeline] failed to log machine-run event for ${args.item.id}:`, err);
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

/** Feed summary when the agent omitted the MACHINE_SUMMARY marker. */
function fallbackSummary(output: string): string | undefined {
  const flat = output.replace(/\s+/g, ' ').trim();
  if (!flat) return undefined;
  return flat.length > MACHINE_SUMMARY_LIMIT
    ? flat.slice(0, MACHINE_SUMMARY_LIMIT - 1) + '…'
    : flat;
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
