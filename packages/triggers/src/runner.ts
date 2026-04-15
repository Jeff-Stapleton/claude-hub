import type { Store, Trigger, TriggerRun } from '@claude-hub/core';
import { spawnProjectSession, type SpawnResult } from '@claude-hub/cc-runner';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { appendTriggerRun } from './history.js';
import { render } from './template.js';

export interface RunTriggerInput {
  /** Optional webhook payload — only used by `type: 'webhook'` triggers. */
  payload?: unknown;
}

export interface TriggerRunnerEvents {
  /** Fired before `spawnProjectSession` is invoked. */
  started: (run: TriggerRun) => void;
  /** Fired after the run completes (success or error). */
  finished: (run: TriggerRun) => void;
}

/**
 * Runs a trigger: renders the prompt (webhook only), looks up the project
 * path, spawns CC, writes a history record, and emits events.
 *
 * Does NOT manage scheduling or HTTP routing — those are wired per-type
 * in cron.ts and webhook.ts. This class is the shared core.
 */
export class TriggerRunner extends EventEmitter {
  constructor(private readonly store: Store) {
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

    let result: SpawnResult;
    try {
      result = await spawnProjectSession({ cwd: project.path, prompt });
    } catch (err) {
      const final: TriggerRun = {
        ...running,
        finishedAt: new Date().toISOString(),
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
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
