import type { Store } from '@claude-hub/core';
import { DEFAULT_MONITOR_INTERVAL_MINUTES, effectivePipelineConfig } from './defaults.js';
import type { PipelineRunner } from './runner.js';

/**
 * Owns one interval timer per `monitoring` work item, mirroring how
 * CronScheduler owns node-cron tasks per trigger. Reconciles on every
 * workItems/pipelines store change (items entering/leaving monitoring,
 * interval edits). The actual check semantics live in
 * PipelineRunner.runMonitorCheck — this class is purely timing.
 *
 * In-process only: if the hub isn't running, monitor checks don't fire.
 */
export class MonitorScheduler {
  private timers = new Map<string, NodeJS.Timeout>();
  /** Interval (ms) currently scheduled per item id, for diffing. */
  private intervals = new Map<string, number>();
  /** Items with a check currently executing — skip overlapping ticks. */
  private inFlight = new Set<string>();

  constructor(
    private readonly store: Store,
    private readonly runner: PipelineRunner,
  ) {}

  start(): void {
    this.reconcile();
    this.store.on('change', (key) => {
      if (key === 'workItems' || key === 'pipelines') this.reconcile();
    });
  }

  stop(): void {
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
    this.intervals.clear();
  }

  private reconcile(): void {
    const monitoring = this.store.workItems().filter((it) => it.status === 'monitoring');

    const seen = new Set<string>();
    for (const item of monitoring) {
      seen.add(item.id);
      const machine = effectivePipelineConfig(this.store, item.projectId).machines.find(
        (m) => m.key === item.currentStage,
      );
      // A removed machine (or a removed monitor loop) still gets one timer:
      // the next tick's runMonitorCheck owns failing/re-queuing the item,
      // keeping that logic in one place.
      const minutes = machine?.monitor?.intervalMinutes ?? DEFAULT_MONITOR_INTERVAL_MINUTES;
      const intervalMs = Math.max(1, minutes) * 60_000;

      if (this.intervals.get(item.id) === intervalMs) continue; // already armed

      this.unschedule(item.id);
      const timer = setInterval(() => {
        if (this.inFlight.has(item.id)) return;
        this.inFlight.add(item.id);
        void this.runner
          .runMonitorCheck(item.id)
          .catch((err) => console.error(`[pipeline] monitor check error for ${item.id}:`, err))
          .finally(() => this.inFlight.delete(item.id));
      }, intervalMs);
      // Don't hold the process open just for monitor timers.
      timer.unref?.();
      this.timers.set(item.id, timer);
      this.intervals.set(item.id, intervalMs);
    }

    for (const id of Array.from(this.timers.keys())) {
      if (!seen.has(id)) this.unschedule(id);
    }
  }

  private unschedule(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(id);
    }
    this.intervals.delete(id);
  }
}
