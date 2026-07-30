import { useQuery } from '@tanstack/react-query';
import { api, type TriggerActivityEntry } from '../api.js';
import type { SceneId } from '../scenes/useSceneRouter.js';
import type { UIState } from '../types.js';
import { groupActivity } from './activityGroups.js';
import { LineRunCard } from './LineRunCard.jsx';

/**
 * Unified activity feed: trigger runs interleaved with line runs from the
 * assembly lines — channel messages will land here in a later version.
 * Machine-run events are grouped into one card per work item so a line's
 * progress ("stage k of n", finished or not, retry) reads at a glance.
 */
export function ActivityTab({
  state,
  navigate,
}: {
  state: UIState;
  navigate: (next: SceneId, param?: string) => void;
}): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['activity'],
    queryFn: api.listActivity,
    refetchInterval: 10_000,
  });

  const grouped = data ? groupActivity(data) : [];

  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Activity</h2>
        <button onClick={() => void refetch()} disabled={isLoading}>
          Refresh
        </button>
      </div>

      {isLoading ? (
        <p>Loading…</p>
      ) : error ? (
        <p style={{ color: 'crimson' }}>{String(error)}</p>
      ) : grouped.length === 0 ? (
        <p style={{ opacity: 0.7, marginTop: 16 }}>
          No activity yet. Fire a trigger or enqueue a work request on an assembly line
          to see entries here.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, marginTop: 16 }}>
          {grouped.map((entry) =>
            entry.kind === 'trigger-run' ? (
              <TriggerRunEntry key={entry.run.id} entry={entry} />
            ) : (
              <LineRunCard
                key={entry.workItemId}
                group={entry}
                machines={
                  state.pipelines?.find((p) => p.projectId === entry.projectId)?.machines
                }
                liveItem={state.workItems?.find((it) => it.id === entry.workItemId)}
                navigate={navigate}
              />
            ),
          )}
        </ul>
      )}
    </section>
  );
}

function TriggerRunEntry({ entry }: { entry: TriggerActivityEntry }): JSX.Element {
  return (
    <li style={entryStyle}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <StatusDot color={statusColor(entry.run.status)} />
        <strong>{entry.triggerName}</strong>
        <span style={{ opacity: 0.5, fontSize: 12 }}>
          {new Date(entry.run.startedAt).toLocaleString()}
        </span>
      </div>
      <div style={promptLine}>{entry.run.prompt}</div>
      {entry.run.transcript ? (
        <div style={transcript}>{entry.run.transcript}</div>
      ) : entry.run.error ? (
        <div style={{ ...transcript, color: 'salmon' }}>{entry.run.error}</div>
      ) : null}
    </li>
  );
}

function statusColor(
  status: 'running' | 'success' | 'error' | 'failed' | 'interrupted' | 'skipped' | 'waiting',
): string {
  switch (status) {
    case 'success':
      return '#3b6';
    case 'error':
    case 'failed':
      return 'crimson';
    case 'running':
    case 'interrupted':
    case 'waiting':
      return '#fa0';
    case 'skipped':
      return '#888';
  }
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
      }}
    />
  );
}

const entryStyle: React.CSSProperties = {
  borderBottom: '1px solid #222',
  padding: '10px 0',
};
const promptLine: React.CSSProperties = {
  opacity: 0.75,
  fontSize: 13,
  marginTop: 4,
  fontStyle: 'italic',
};
const transcript: React.CSSProperties = {
  marginTop: 6,
  background: '#111',
  padding: 8,
  borderRadius: 4,
  fontSize: 12,
  whiteSpace: 'pre-wrap',
};
