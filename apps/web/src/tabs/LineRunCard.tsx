import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type StageRunRecord } from '../api.js';
import type { PipelineMachine, WorkItem } from '../types.js';
import type { SceneId } from '../scenes/useSceneRouter.js';
import {
  lineProgress,
  lineProgressFromItem,
  type LineOutcome,
  type LineRunGroup,
} from './activityGroups.js';

/**
 * One line run on the activity feed: a work item's trip down its project's
 * machine line. Header shows the overall outcome and how far the item got;
 * the chip row mirrors the workshop's stage timeline; expanding fetches the
 * authoritative per-stage results (works for archived/done items too).
 */
export function LineRunCard({
  group,
  machines,
  liveItem,
  navigate,
}: {
  group: LineRunGroup;
  machines: PipelineMachine[] | undefined;
  liveItem: WorkItem | undefined;
  navigate: (next: SceneId, param?: string) => void;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();
  const eventProgress = lineProgress(group, machines, liveItem);

  const actionMutation = useMutation({
    mutationFn: (action: 'approve' | 'retry') =>
      action === 'approve'
        ? api.approveWorkItem(group.workItemId)
        : api.retryWorkItem(group.workItemId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['activity'] });
      void queryClient.invalidateQueries({ queryKey: ['state'] });
    },
  });

  // The event window can't tell a finished-then-archived run from a
  // cancelled one (or one that ran under an older line), so fetch the
  // authoritative item eagerly whenever the derived outcome is ambiguous.
  const detailQuery = useQuery({
    queryKey: ['work-item', group.workItemId],
    queryFn: () => api.getWorkItem(group.workItemId, group.projectId),
    enabled: expanded || (!liveItem && eventProgress.outcome === 'incomplete'),
  });

  const progress = detailQuery.data
    ? lineProgressFromItem(detailQuery.data.item, machines)
    : eventProgress;

  const newest = group.events[0];

  return (
    <li style={card}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <StatusDot color={outcomeColor(progress.outcome)} />
        <strong>
          {group.projectName} · {group.workItemTitle}
        </strong>
        <span style={{ ...badge, background: outcomeColor(progress.outcome) }}>
          {outcomeLabel(progress.outcome, liveItem)}
        </span>
        <span style={{ opacity: 0.6, fontSize: 12 }}>
          stage {progress.k} of {progress.n}
        </span>
        {newest ? (
          <span style={{ opacity: 0.5, fontSize: 12 }}>
            {new Date(newest.startedAt).toLocaleString()}
          </span>
        ) : null}
        <button style={linkButton} onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'Hide details' : 'Details'}
        </button>
      </div>

      <div style={chipRow}>
        {progress.chips.map((chip) => (
          <span key={chip.key} style={chipStyle} title={chip.error ?? chip.summary ?? ''}>
            <StatusDot color={chipColor(chip.status)} />
            {chip.name.toUpperCase()}
            {chip.removed ? ' (removed)' : ''}
            <span style={{ opacity: 0.6 }}>· {chip.status}</span>
          </span>
        ))}
      </div>

      {newest?.summary ? <div style={summaryLine}>{newest.summary}</div> : null}
      {newest?.error && !newest.summary ? (
        <div style={{ ...summaryLine, color: 'salmon' }}>{newest.error}</div>
      ) : null}

      <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
        {liveItem?.status === 'failed' ? (
          <button
            style={actionButton}
            disabled={actionMutation.isPending}
            onClick={() => actionMutation.mutate('retry')}
          >
            {actionMutation.isPending ? 'Working…' : 'Retry machine'}
          </button>
        ) : null}
        {liveItem?.status === 'waiting-approval' ? (
          <button
            style={actionButton}
            disabled={actionMutation.isPending}
            onClick={() => actionMutation.mutate('approve')}
          >
            {actionMutation.isPending ? 'Working…' : 'Approve'}
          </button>
        ) : null}
        {liveItem && liveItem.status !== 'failed' && liveItem.status !== 'waiting-approval' ? (
          <button style={linkButton} onClick={() => navigate('workshop')}>
            Open workshop
          </button>
        ) : null}
        {actionMutation.error ? (
          <span style={{ color: 'salmon', fontSize: 12 }}>{String(actionMutation.error)}</span>
        ) : null}
      </div>

      {expanded ? (
        <div style={detailBox}>
          {detailQuery.isLoading ? (
            <p style={{ margin: 0, opacity: 0.7 }}>Loading…</p>
          ) : detailQuery.error ? (
            <p style={{ margin: 0, opacity: 0.7 }}>
              Details no longer available for this run.
            </p>
          ) : detailQuery.data ? (
            <RunDetail
              item={detailQuery.data.item}
              stageRuns={detailQuery.data.stageRuns}
              archived={detailQuery.data.archived}
              machines={machines}
            />
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function RunDetail({
  item,
  stageRuns,
  archived,
  machines,
}: {
  item: WorkItem;
  stageRuns: StageRunRecord[];
  archived: boolean;
  machines: PipelineMachine[] | undefined;
}): JSX.Element {
  const lineKeys = (machines ?? []).map((m) => m.key);
  const orphanKeys = Object.keys(item.stages).filter((key) => !lineKeys.includes(key));
  const timelineKeys = [...lineKeys, ...orphanKeys];
  const nameFor = (key: string): string =>
    machines?.find((m) => m.key === key)?.name.toUpperCase() ?? key.toUpperCase();
  // stageRuns is newest-first; first record per stage is its latest run.
  const latestRun = new Map<string, StageRunRecord>();
  for (const run of stageRuns) {
    if (!latestRun.has(run.stage)) latestRun.set(run.stage, run);
  }

  return (
    <div>
      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
        {item.status === 'done' ? 'Line finished' : `Item is ${item.status}`}
        {archived ? ' · archived' : ''}
        {item.finishedAt ? ` · ${new Date(item.finishedAt).toLocaleString()}` : ''}
      </div>
      {timelineKeys.map((key) => {
        const result = item.stages[key];
        if (!result && !latestRun.has(key)) return null;
        const run = latestRun.get(key);
        const text = result?.summary ?? run?.summary ?? run?.output ?? result?.output;
        const error = result?.error ?? run?.error;
        return (
          <div key={key} style={stageDetail}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <StatusDot color={chipColor(result?.status ?? run?.status ?? 'unknown')} />
              <span style={{ fontFamily: 'monospace', fontSize: 11 }}>
                {nameFor(key)}
                {lineKeys.length > 0 && !lineKeys.includes(key) ? ' (removed)' : ''}
              </span>
              <span style={{ opacity: 0.6, fontSize: 11 }}>{result?.status ?? run?.status}</span>
            </div>
            {text ? <div style={stageText}>{truncate(text, 1600)}</div> : null}
            {error ? <div style={{ ...stageText, color: 'salmon' }}>{truncate(error, 800)}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

function outcomeLabel(outcome: LineOutcome, liveItem: WorkItem | undefined): string {
  switch (outcome) {
    case 'completed':
      return 'line finished';
    case 'failed':
      return 'failed';
    case 'waiting':
      return liveItem?.status === 'monitoring' ? 'monitoring' : 'waiting';
    case 'in-progress':
      return liveItem?.status ?? 'in progress';
    case 'incomplete':
      return 'incomplete';
  }
}

function outcomeColor(outcome: LineOutcome): string {
  switch (outcome) {
    case 'completed':
      return '#3b6';
    case 'failed':
      return 'crimson';
    case 'waiting':
    case 'in-progress':
      return '#fa0';
    case 'incomplete':
      return '#888';
  }
}

function chipColor(status: string): string {
  switch (status) {
    case 'success':
      return '#5ec27a';
    case 'running':
      return '#e8b04a';
    case 'failed':
    case 'interrupted':
      return '#cf4040';
    case 'waiting':
    case 'waiting-approval':
      return '#b48ad6';
    case 'skipped':
      return '#5a4a38';
    default:
      return '#3a3128';
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function StatusDot({ color }: { color: string }): JSX.Element {
  return (
    <span
      style={{
        width: 8,
        height: 8,
        borderRadius: 4,
        background: color,
        display: 'inline-block',
        flexShrink: 0,
      }}
    />
  );
}

// ---------- styles ----------

const card: React.CSSProperties = {
  borderBottom: '1px solid #222',
  padding: '10px 0',
};

const badge: React.CSSProperties = {
  fontSize: 11,
  color: '#15100c',
  padding: '1px 8px',
  borderRadius: 8,
  fontWeight: 600,
};

const chipRow: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
  marginTop: 6,
};

const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  fontSize: 11,
  fontFamily: 'monospace',
  background: '#181310',
  border: '1px solid #2a1f17',
  borderRadius: 10,
  padding: '2px 8px',
};

const summaryLine: React.CSSProperties = {
  marginTop: 6,
  background: '#111',
  padding: 8,
  borderRadius: 4,
  fontSize: 12,
  whiteSpace: 'pre-wrap',
};

const actionButton: React.CSSProperties = {
  background: '#2a1f17',
  color: '#e8c9a8',
  border: '1px solid #4a3624',
  padding: '3px 10px',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 12,
};

const linkButton: React.CSSProperties = {
  background: 'transparent',
  color: '#c8a888',
  border: 'none',
  cursor: 'pointer',
  fontSize: 12,
  textDecoration: 'underline',
};

const detailBox: React.CSSProperties = {
  marginTop: 8,
  background: '#111',
  borderRadius: 4,
  padding: 10,
};

const stageDetail: React.CSSProperties = {
  padding: '6px 0',
  borderTop: '1px solid #1d1712',
};

const stageText: React.CSSProperties = {
  marginTop: 4,
  marginLeft: 16,
  fontSize: 12,
  opacity: 0.85,
  whiteSpace: 'pre-wrap',
};
