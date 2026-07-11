import { useQuery } from '@tanstack/react-query';
import { api, type ActivityEntry } from '../api.js';

/**
 * Unified activity feed: trigger runs interleaved with machine runs from
 * the assembly lines — channel messages will land here in a later version.
 * The UI still calls it "Activity" rather than "Runs" so the mental model
 * is stable.
 */
export function ActivityTab(): JSX.Element {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['activity'],
    queryFn: api.listActivity,
    refetchInterval: 10_000,
  });

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
      ) : !data || data.length === 0 ? (
        <p style={{ opacity: 0.7, marginTop: 16 }}>
          No activity yet. Fire a trigger or enqueue a work request on an assembly line
          to see entries here.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, marginTop: 16 }}>
          {data.map((e) =>
            e.kind === 'trigger-run' ? (
              <li key={e.run.id} style={entry}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <StatusDot color={statusColor(e.run.status)} />
                  <strong>{e.triggerName}</strong>
                  <span style={{ opacity: 0.5, fontSize: 12 }}>
                    {new Date(e.run.startedAt).toLocaleString()}
                  </span>
                </div>
                <div style={promptLine}>{e.run.prompt}</div>
                {e.run.transcript ? (
                  <div style={transcript}>{e.run.transcript}</div>
                ) : e.run.error ? (
                  <div style={{ ...transcript, color: 'salmon' }}>{e.run.error}</div>
                ) : null}
              </li>
            ) : (
              <li key={e.event.id} style={entry}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <StatusDot color={statusColor(e.event.status)} />
                  <strong>
                    {e.event.projectName} · {e.event.machineName}
                  </strong>
                  <span style={{ opacity: 0.6, fontSize: 12 }}>{e.event.status}</span>
                  <span style={{ opacity: 0.5, fontSize: 12 }}>
                    {new Date(e.event.startedAt).toLocaleString()}
                  </span>
                </div>
                <div style={promptLine}>{e.event.workItemTitle}</div>
                {e.event.summary ? (
                  <div style={transcript}>{e.event.summary}</div>
                ) : e.event.error ? (
                  <div style={{ ...transcript, color: 'salmon' }}>{e.event.error}</div>
                ) : null}
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}

function statusColor(
  status: 'running' | 'success' | 'error' | 'failed' | 'interrupted' | 'skipped',
): string {
  switch (status) {
    case 'success':
      return '#3b6';
    case 'error':
    case 'failed':
      return 'crimson';
    case 'running':
    case 'interrupted':
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

const entry: React.CSSProperties = {
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
