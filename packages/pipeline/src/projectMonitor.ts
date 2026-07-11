import type { AgentRunner } from '@claude-hub/agent-runner';
import type {
  ProjectMonitor,
  ProjectMonitorCheck,
  ProjectMonitorHealth,
  Store,
} from '@claude-hub/core';
import { runProjectCheck } from './projectChecks.js';
import type { PipelineRunner } from './runner.js';

/**
 * Aggregate health across a monitor's checks: down if any check's last
 * result is a fail, healthy only when every configured check has passed,
 * unknown while any check is still awaiting its first result (or none are
 * configured). Mirrored in apps/web (which doesn't import core).
 */
export function projectMonitorHealth(
  monitor: Pick<ProjectMonitor, 'checks' | 'status'>,
): ProjectMonitorHealth {
  if (monitor.checks.length === 0) return 'unknown';
  const results = monitor.checks.map((c) => monitor.status.checks[c.id]);
  if (results.some((r) => r?.lastStatus === 'fail')) return 'down';
  if (results.every((r) => r?.lastStatus === 'pass')) return 'healthy';
  return 'unknown';
}

/**
 * Owns one interval timer per enabled project-monitor check, mirroring how
 * MonitorScheduler owns timers per `monitoring` work item. Unlike a
 * machine's monitor loop this never completes: checks re-run on their
 * interval indefinitely while the hub is up, and boot-time reconcile()
 * re-arms timers from the persisted monitors file.
 *
 * In-process only: if the hub isn't running, checks don't fire.
 */
export class ProjectMonitorScheduler {
  /** Timers keyed `${projectId}:${checkId}`. */
  private timers = new Map<string, NodeJS.Timeout>();
  /** Interval (ms) currently scheduled per key, for diffing. */
  private intervals = new Map<string, number>();
  /** Checks currently executing — skip overlapping ticks. */
  private inFlight = new Set<string>();

  constructor(
    private readonly store: Store,
    private readonly runner: PipelineRunner,
    private readonly agentRunner: AgentRunner,
  ) {}

  start(): void {
    this.reconcile();
    this.store.on('change', (key) => {
      if (key === 'monitors' || key === 'projects') this.reconcile();
    });
  }

  stop(): void {
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
    this.intervals.clear();
  }

  /** Run every check of a project's monitor immediately (panel "run now"). */
  async runNow(projectId: string): Promise<void> {
    const monitor = this.store.monitors().find((m) => m.projectId === projectId);
    if (!monitor?.enabled) return;
    await Promise.all(
      monitor.checks.map((check) => this.tick(projectId, check.id) ?? Promise.resolve()),
    );
  }

  private reconcile(): void {
    const projectIds = new Set(this.store.projects().map((p) => p.id));

    const seen = new Set<string>();
    for (const monitor of this.store.monitors()) {
      // Tolerate monitors orphaned by project deletion (same precedent as
      // pipelines): arm nothing, keep the entry.
      if (!monitor.enabled || !projectIds.has(monitor.projectId)) continue;
      for (const check of monitor.checks) {
        const key = `${monitor.projectId}:${check.id}`;
        seen.add(key);
        const intervalMs = Math.max(1, check.intervalMinutes) * 60_000;
        if (this.intervals.get(key) === intervalMs) continue; // already armed

        // Kick off an immediate first run only for never-checked checks, so
        // a fresh config lights up within seconds. Boot deliberately skips
        // this for checks with prior results — their interval alone resumes
        // them, avoiding a thundering herd of agent checks on every restart.
        const neverChecked = monitor.status.checks[check.id] === undefined;

        this.unschedule(key);
        const timer = setInterval(() => this.tick(monitor.projectId, check.id), intervalMs);
        // Don't hold the process open just for monitor timers.
        timer.unref?.();
        this.timers.set(key, timer);
        this.intervals.set(key, intervalMs);

        if (neverChecked) {
          const kickoff = setTimeout(() => this.tick(monitor.projectId, check.id), 0);
          kickoff.unref?.();
        }
      }
    }

    for (const key of Array.from(this.timers.keys())) {
      if (!seen.has(key)) this.unschedule(key);
    }
  }

  /** One guarded tick. Returns the run promise, or undefined if skipped. */
  private tick(projectId: string, checkId: string): Promise<void> | undefined {
    const key = `${projectId}:${checkId}`;
    if (this.inFlight.has(key)) return undefined;
    this.inFlight.add(key);
    return this.runCheck(projectId, checkId)
      .catch((err) => console.error(`[monitor] project check error for ${key}:`, err))
      .finally(() => this.inFlight.delete(key));
  }

  private async runCheck(projectId: string, checkId: string): Promise<void> {
    // Re-read everything from the store — config may have changed since the
    // timer was armed, or the check/monitor/project may be gone.
    const monitor = this.store.monitors().find((m) => m.projectId === projectId);
    const check = monitor?.checks.find((c) => c.id === checkId);
    const project = this.store.projects().find((p) => p.id === projectId);
    if (!monitor?.enabled || !check || !project) return;

    const res = await runProjectCheck(
      { store: this.store, agentRunner: this.agentRunner },
      project,
      check,
    );

    // Persist the result and decide defect filing inside one updater, so
    // two checks failing in the same window can't both open the outage.
    let fileDefect = false;
    await this.store.update('monitors', (all) =>
      all.map((m) => {
        if (m.projectId !== projectId) return m;
        if (!m.checks.some((c) => c.id === checkId)) return m; // removed mid-flight
        const prev = m.status.checks[checkId];
        m.status.checks[checkId] = {
          lastStatus: res.ok ? 'pass' : 'fail',
          lastCheckedAt: new Date().toISOString(),
          lastDurationMs: res.durationMs,
          ...(res.output ? { lastOutput: res.output } : {}),
          ...(res.error !== undefined ? { lastError: res.error } : {}),
          consecutiveFails: res.ok ? 0 : (prev?.consecutiveFails ?? 0) + 1,
        };
        if (!res.ok && m.fileDefectOnFailure && !m.status.outageOpen) {
          m.status.outageOpen = true;
          fileDefect = true;
        }
        // Full recovery closes the outage; the next one files a fresh defect.
        if (m.status.outageOpen && projectMonitorHealth(m) === 'healthy') {
          m.status.outageOpen = false;
        }
        m.updatedAt = new Date().toISOString();
        return m;
      }),
    );

    if (res.ok) return;
    console.warn(
      `[monitor] ${project.name}: check "${check.name}" failed: ${res.error ?? 'unknown'}`,
    );
    if (!fileDefect) return;

    try {
      await this.runner.enqueue({
        projectId,
        title: `Defect: ${check.name} check failing`,
        request:
          `The project's continuous health monitor detected an outage.\n\n` +
          `Failing check: ${check.name} (${check.type})\n` +
          `Target: ${checkTarget(check)}\n` +
          `Error: ${res.error ?? 'unknown'}\n\n` +
          (res.output ? `Check output:\n${res.output}\n\n` : '') +
          `Investigate what is causing this health check to fail and fix it.`,
        source: 'monitor',
        sourceRef: `project-monitor:${check.id}`,
      });
    } catch (err) {
      // A blank line (no machines) rejects enqueue; the red light is still
      // the signal — don't crash the tick.
      console.warn(
        `[monitor] ${project.name}: could not file defect work item: ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }

  private unschedule(key: string): void {
    const timer = this.timers.get(key);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(key);
    }
    this.intervals.delete(key);
  }
}

function checkTarget(check: ProjectMonitorCheck): string {
  switch (check.type) {
    case 'http':
      return check.url;
    case 'command':
      return check.command;
    case 'agent':
      return check.prompt.split('\n', 1)[0] ?? '';
  }
}
