import type {
  ActivityEntry,
  MachineRunEvent,
  MachineRunStatus,
  TriggerActivityEntry,
} from '../api.js';
import type { PipelineMachine, WorkItem } from '../types.js';

/**
 * Pure grouping logic for the activity feed: machine-run events fold into one
 * line-run group per work item so a line's progress reads as a single card,
 * while trigger runs pass through untouched.
 */

export interface LineRunGroup {
  kind: 'line-run';
  workItemId: string;
  projectId: string;
  /** Labels are as-of run time (denormalized log); newest event wins. */
  projectName: string;
  workItemTitle: string;
  /** This item's events, newest-first. */
  events: MachineRunEvent[];
  /** Newest event per machine key, so retries show their latest result. */
  latestByMachine: Map<string, MachineRunEvent>;
  /** Sort key for the merged feed. */
  latestStartedAt: string;
}

export type GroupedActivityEntry = TriggerActivityEntry | LineRunGroup;

export function groupActivity(entries: ActivityEntry[]): GroupedActivityEntry[] {
  const groups = new Map<string, LineRunGroup>();
  const merged: GroupedActivityEntry[] = [];

  for (const entry of entries) {
    if (entry.kind === 'trigger-run') {
      merged.push(entry);
      continue;
    }
    const event = entry.event;
    let group = groups.get(event.workItemId);
    if (!group) {
      group = {
        kind: 'line-run',
        workItemId: event.workItemId,
        projectId: event.projectId,
        projectName: event.projectName,
        workItemTitle: event.workItemTitle,
        events: [],
        latestByMachine: new Map(),
        latestStartedAt: event.startedAt,
      };
      groups.set(event.workItemId, group);
      merged.push(group);
    }
    // The feed arrives newest-first, so the first event seen per work item
    // (and per machine key) is the latest one.
    group.events.push(event);
    if (!group.latestByMachine.has(event.machineKey)) {
      group.latestByMachine.set(event.machineKey, event);
    }
  }

  merged.sort((a, b) => (sortKey(b) > sortKey(a) ? 1 : -1));
  return merged;
}

function sortKey(entry: GroupedActivityEntry): string {
  return entry.kind === 'trigger-run' ? entry.run.startedAt : entry.latestStartedAt;
}

export type LineOutcome = 'completed' | 'failed' | 'in-progress' | 'waiting' | 'incomplete';

export interface LineChip {
  key: string;
  name: string;
  /** 'unknown' = no event for this machine in the recent-events window. */
  status: MachineRunStatus | 'unknown';
  summary?: string;
  error?: string;
  /** Machine no longer on the project's current line. */
  removed?: boolean;
}

export interface LineProgress {
  outcome: LineOutcome;
  /** Line machines whose latest event is success/skipped. */
  k: number;
  /** Current line length (orphans excluded). */
  n: number;
  chips: LineChip[];
}

export function lineProgress(
  group: LineRunGroup,
  machines: PipelineMachine[] | undefined,
  liveItem: WorkItem | undefined,
): LineProgress {
  const chips: LineChip[] = [];

  if (machines && machines.length > 0) {
    for (const machine of machines) {
      chips.push(chip(machine.key, machine.name, group.latestByMachine.get(machine.key)));
    }
    const lineKeys = new Set(machines.map((m) => m.key));
    const orphans = [...group.latestByMachine.values()]
      .filter((e) => !lineKeys.has(e.machineKey))
      .sort((a, b) => (a.startedAt > b.startedAt ? 1 : -1));
    for (const event of orphans) {
      chips.push({ ...chip(event.machineKey, event.machineName, event), removed: true });
    }
  } else {
    // Pipeline unknown (project deleted): show what ran, oldest-first.
    const events = [...group.latestByMachine.values()].sort((a, b) =>
      a.startedAt > b.startedAt ? 1 : -1,
    );
    for (const event of events) {
      chips.push(chip(event.machineKey, event.machineName, event));
    }
  }

  const lineChips = chips.filter((c) => !c.removed);
  const n = machines && machines.length > 0 ? machines.length : lineChips.length;
  const k = lineChips.filter((c) => c.status === 'success' || c.status === 'skipped').length;

  return { outcome: deriveOutcome(group, liveItem, k, n), k, n, chips };
}

/**
 * Progress recomputed from an authoritative WorkItem (fetched detail —
 * archived or live). Unlike the event-window view, this knows the run's
 * true final status and which machines were actually on its line: a done
 * item counts only the stages it recorded, so a run that finished under an
 * older, shorter line still reads "stage 3 of 3 · completed" after the line
 * gained machines.
 */
export function lineProgressFromItem(
  item: WorkItem,
  machines: PipelineMachine[] | undefined,
): LineProgress {
  const lineKeys = (machines ?? []).map((m) => m.key);
  const orphanKeys = Object.keys(item.stages).filter((key) => !lineKeys.includes(key));
  const nameFor = (key: string): string =>
    machines?.find((m) => m.key === key)?.name ?? key;

  const chips: LineChip[] = [];
  for (const key of lineKeys) {
    const result = item.stages[key];
    if (!result && item.status === 'done') continue; // added to the line after this run
    chips.push({ key, name: nameFor(key), status: itemChipStatus(result?.status) });
  }
  for (const key of orphanKeys) {
    chips.push({
      key,
      name: nameFor(key),
      status: itemChipStatus(item.stages[key]?.status),
      removed: lineKeys.length > 0,
    });
  }

  const lineChips = chips.filter((c) => !c.removed);
  const n = lineChips.length;
  const k = lineChips.filter((c) => c.status === 'success' || c.status === 'skipped').length;

  let outcome: LineOutcome;
  switch (item.status) {
    case 'done':
      outcome = 'completed';
      break;
    case 'failed':
      outcome = 'failed';
      break;
    case 'waiting-approval':
    case 'monitoring':
      outcome = 'waiting';
      break;
    case 'cancelled':
      outcome = 'incomplete';
      break;
    default:
      outcome = 'in-progress';
  }
  return { outcome, k, n, chips };
}

function itemChipStatus(status: string | undefined): MachineRunStatus | 'unknown' {
  switch (status) {
    case 'success':
    case 'failed':
    case 'skipped':
      return status;
    case 'waiting-approval':
      return 'waiting';
    default:
      return 'unknown';
  }
}

function chip(key: string, name: string, event: MachineRunEvent | undefined): LineChip {
  return {
    key,
    name,
    status: event?.status ?? 'unknown',
    ...(event?.summary !== undefined ? { summary: event.summary } : {}),
    ...(event?.error !== undefined ? { error: event.error } : {}),
  };
}

function deriveOutcome(
  group: LineRunGroup,
  liveItem: WorkItem | undefined,
  k: number,
  n: number,
): LineOutcome {
  // A live item's status is authoritative; events only cover the recent window.
  if (liveItem) {
    switch (liveItem.status) {
      case 'failed':
        return 'failed';
      case 'waiting-approval':
      case 'monitoring':
        return 'waiting';
      case 'done':
        return 'completed';
      case 'cancelled':
        return 'incomplete';
      default:
        return 'in-progress';
    }
  }
  if (n > 0 && k === n) return 'completed';
  const newest = group.events[0];
  if (newest?.status === 'failed') return 'failed';
  if (newest?.status === 'waiting') return 'waiting';
  // Cancelled mid-line, or the event window truncated the run's earlier
  // stages — the expanded detail fetch resolves it from the archive.
  return 'incomplete';
}
