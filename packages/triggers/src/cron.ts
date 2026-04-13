import type { CronTrigger, Store } from '@claude-hub/core';
import cron from 'node-cron';
import type { TriggerRunner } from './runner.js';

/**
 * Owns a live node-cron schedule per CronTrigger. Reconciles when the
 * triggers list changes (add / remove / cron expression edit).
 *
 * Scheduling is in-process. If the hub isn't running, cron triggers don't
 * fire — document this in the README so users don't expect daemon-like
 * behavior.
 */
export class CronScheduler {
  private tasks = new Map<string, cron.ScheduledTask>();
  /** Map of trigger id -> cron expression currently scheduled, for diffing. */
  private expressions = new Map<string, string>();

  constructor(
    private readonly store: Store,
    private readonly runner: TriggerRunner,
  ) {}

  start(): void {
    this.reconcile();
    this.store.on('change', (key) => {
      if (key === 'triggers') this.reconcile();
    });
  }

  stop(): void {
    for (const task of this.tasks.values()) task.stop();
    this.tasks.clear();
    this.expressions.clear();
  }

  /**
   * Diffs current store triggers against scheduled tasks and brings the two
   * in sync. Cheap enough to run on every change event — the N here is
   * small (dozens of triggers max for a single user).
   */
  private reconcile(): void {
    const crons = this.store
      .triggers()
      .filter((t): t is CronTrigger => t.type === 'cron');

    const seen = new Set<string>();
    for (const trigger of crons) {
      seen.add(trigger.id);

      // Validate cron expression; skip with a warn if invalid (a bad edit
      // in the UI shouldn't crash the server).
      if (!cron.validate(trigger.cronExpr)) {
        console.warn(
          `[cron] trigger ${trigger.id} (${trigger.name}) has invalid cron expression: ${trigger.cronExpr}`,
        );
        this.unschedule(trigger.id);
        continue;
      }

      const currentExpr = this.expressions.get(trigger.id);
      if (currentExpr === trigger.cronExpr) continue; // already scheduled correctly

      this.unschedule(trigger.id);

      const task = cron.schedule(trigger.cronExpr, () => {
        void this.runner.run(trigger);
      });
      this.tasks.set(trigger.id, task);
      this.expressions.set(trigger.id, trigger.cronExpr);
    }

    // Remove tasks for triggers that no longer exist or are no longer cron.
    for (const id of Array.from(this.tasks.keys())) {
      if (!seen.has(id)) this.unschedule(id);
    }
  }

  private unschedule(id: string): void {
    const task = this.tasks.get(id);
    if (task) {
      task.stop();
      this.tasks.delete(id);
    }
    this.expressions.delete(id);
  }
}
