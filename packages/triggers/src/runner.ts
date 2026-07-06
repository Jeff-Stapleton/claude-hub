import type { AgentRunner, RunProjectSessionResult } from '@claude-hub/agent-runner';
import type { Store, Trigger, TriggerRun } from '@claude-hub/core';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { appendTriggerRun } from './history.js';
import { render } from './template.js';

export interface RunTriggerInput {
  /** Optional webhook payload — only used by `type: 'webhook'` triggers. */
  payload?: unknown;
}

export interface TriggerRunnerEvents {
  /** Fired before the configured agent provider is invoked. */
  started: (run: TriggerRun) => void;
  /** Fired after the run completes (success or error). */
  finished: (run: TriggerRun) => void;
}

/**
 * Bridge for `mode: 'enqueue'` triggers, wired in the server's main.ts.
 * Kept as a callback (rather than a dependency on @claude-hub/pipeline)
 * so triggers stays cycle-free.
 */
export type EnqueueWorkItemBridge = (input: {
  projectId: string;
  title: string;
  request: string;
  source: 'cron' | 'webhook';
  sourceRef: string;
}) => Promise<{ id: string }>;

/**
 * Runs a trigger: renders the prompt (webhook only), looks up the project
 * path, spawns CC, writes a history record, and emits events.
 *
 * Does NOT manage scheduling or HTTP routing — those are wired per-type
 * in cron.ts and webhook.ts. This class is the shared core.
 */
export class TriggerRunner extends EventEmitter {
  constructor(
    private readonly store: Store,
    private readonly runner: AgentRunner,
    private readonly opts: { timeoutMs?: number; enqueueWorkItem?: EnqueueWorkItemBridge } = {},
  ) {
    super();
  }

  async run(trigger: Trigger, input: RunTriggerInput = {}): Promise<TriggerRun> {
    const project = this.store.projects().find((p) => p.id === trigger.projectId);

    const runId = randomUUID();
    const startedAt = new Date().toISOString();

    const prompt =
      trigger.type === 'webhook'
        ? render(trigger.promptTemplate, { payload: input.payload })
        : trigger.prompt;

    // Enqueue-mode triggers feed the project's assembly line instead of
    // firing a one-shot agent run. The rendered prompt becomes the work
    // request; the history record documents the handoff.
    if (trigger.mode === 'enqueue' && this.opts.enqueueWorkItem) {
      return this.enqueue(trigger, runId, startedAt, prompt, input);
    }

    console.log(
      `[trigger] starting run ${runId.slice(0, 8)} for "${trigger.name}" (${trigger.type}) project=${trigger.projectId}`,
    );

    const running: TriggerRun = {
      id: runId,
      triggerId: trigger.id,
      startedAt,
      status: 'running',
      prompt,
      ...(input.payload !== undefined ? { payload: input.payload } : {}),
    };
    // Mark the trigger as 'running' immediately so the UI reflects it
    // via the next WS broadcast (before the CC run completes).
    await this.markTriggerLast(trigger.id, running);
    this.emit('started', running);

    if (!project) {
      console.error(`[trigger] run ${runId.slice(0, 8)} error: project not found`);
      const final: TriggerRun = {
        ...running,
        finishedAt: new Date().toISOString(),
        status: 'error',
        error: `project ${trigger.projectId} not found`,
      };
      await appendTriggerRun(this.store.paths, final);
      await this.markTriggerLast(trigger.id, final);
      this.emit('finished', final);
      return final;
    }

    let result: RunProjectSessionResult;
    try {
      result = await this.runner.runProjectSession({
        provider: this.store.config().defaultProvider,
        cwd: project.path,
        prompt,
        ...(this.opts.timeoutMs ? { timeoutMs: this.opts.timeoutMs } : {}),
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[trigger] run ${runId.slice(0, 8)} threw: ${errMsg}`);
      const final: TriggerRun = {
        ...running,
        finishedAt: new Date().toISOString(),
        status: 'error',
        error: errMsg,
      };
      await appendTriggerRun(this.store.paths, final);
      await this.markTriggerLast(trigger.id, final);
      this.emit('finished', final);
      return final;
    }

    const final: TriggerRun = result.ok
      ? {
          ...running,
          finishedAt: new Date().toISOString(),
          status: 'success',
          transcript: result.text,
        }
      : {
          ...running,
          finishedAt: new Date().toISOString(),
          status: 'error',
          error: result.error,
        };

    const elapsed = final.finishedAt
      ? ((new Date(final.finishedAt).getTime() - new Date(startedAt).getTime()) / 1000).toFixed(1)
      : '?';
    console.log(
      `[trigger] run ${runId.slice(0, 8)} ${final.status} in ${elapsed}s${final.error ? ` — ${final.error.slice(0, 100)}` : ''}`,
    );

    await appendTriggerRun(this.store.paths, final);
    await this.markTriggerLast(trigger.id, final);
    this.emit('finished', final);
    return final;
  }

  private async enqueue(
    trigger: Trigger,
    runId: string,
    startedAt: string,
    prompt: string,
    input: RunTriggerInput,
  ): Promise<TriggerRun> {
    const base: TriggerRun = {
      id: runId,
      triggerId: trigger.id,
      startedAt,
      status: 'running',
      prompt,
      ...(input.payload !== undefined ? { payload: input.payload } : {}),
    };
    this.emit('started', base);

    let final: TriggerRun;
    try {
      const item = await this.opts.enqueueWorkItem!({
        projectId: trigger.projectId,
        title: trigger.name,
        request: prompt,
        source: trigger.type,
        sourceRef: trigger.id,
      });
      console.log(
        `[trigger] "${trigger.name}" enqueued work item ${item.id.slice(0, 8)} (mode=enqueue)`,
      );
      final = {
        ...base,
        finishedAt: new Date().toISOString(),
        status: 'success',
        transcript: `enqueued work item ${item.id}`,
      };
    } catch (err) {
      final = {
        ...base,
        finishedAt: new Date().toISOString(),
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      };
    }

    await appendTriggerRun(this.store.paths, final);
    await this.markTriggerLast(trigger.id, final);
    this.emit('finished', final);
    return final;
  }

  private async markTriggerLast(triggerId: string, run: TriggerRun): Promise<void> {
    await this.store.update('triggers', (current) =>
      current.map((t) =>
        t.id === triggerId
          ? ({ ...t, lastRun: run.finishedAt, lastStatus: run.status } as Trigger)
          : t,
      ),
    );
  }
}

export interface TriggerRunner {
  on<E extends keyof TriggerRunnerEvents>(event: E, listener: TriggerRunnerEvents[E]): this;
  off<E extends keyof TriggerRunnerEvents>(event: E, listener: TriggerRunnerEvents[E]): this;
  emit<E extends keyof TriggerRunnerEvents>(
    event: E,
    ...args: Parameters<TriggerRunnerEvents[E]>
  ): boolean;
}
