import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import type { OrchestratorState } from '../types.js';

export function OrchestratorTab({ state }: { state: OrchestratorState }): JSX.Element {
  const qc = useQueryClient();
  const clear = useMutation({
    mutationFn: api.clearOrchestratorSessions,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['state'] }),
  });

  const sessions = Object.entries(state.channelSessions);

  return (
    <section>
      <h2>Orchestrator</h2>

      <div style={row}>
        <span style={{ opacity: 0.7 }}>Status: </span>
        <strong style={{ color: statusColor(state.status) }}>{state.status}</strong>
        {state.startedAt ? (
          <span style={{ opacity: 0.5, fontSize: 12, marginLeft: 12 }}>
            since {new Date(state.startedAt).toLocaleString()}
          </span>
        ) : null}
      </div>

      {state.lastError ? (
        <div style={{ color: 'salmon', marginBottom: 12, fontSize: 13 }}>
          Last error: {state.lastError}
        </div>
      ) : null}

      <p style={{ opacity: 0.7, maxWidth: 640 }}>
        The orchestrator turns incoming channel messages into Claude Code runs. Each
        conversation gets its own persistent CC session id so follow-up messages continue
        the same context. Clearing sessions drops that map — the next DM in each
        conversation will start a fresh CC session.
      </p>

      <h3 style={{ marginTop: 24 }}>Active conversations</h3>
      {sessions.length === 0 ? (
        <p style={{ opacity: 0.7 }}>No conversations yet.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Conversation</th>
              <th style={th}>CC session id</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map(([key, sid]) => (
              <tr key={key}>
                <td style={td}>
                  <code>{key}</code>
                </td>
                <td style={td}>
                  <code style={{ fontSize: 11 }}>{sid}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ marginTop: 16 }}>
        <button
          onClick={() => clear.mutate()}
          disabled={clear.isPending || sessions.length === 0}
          style={{ color: 'crimson' }}
        >
          Clear all sessions
        </button>
      </div>
    </section>
  );
}

function statusColor(s: OrchestratorState['status']): string {
  switch (s) {
    case 'running':
      return '#3b6';
    case 'error':
      return 'crimson';
    case 'starting':
      return '#fa0';
    default:
      return '#888';
  }
}

const row: React.CSSProperties = { marginBottom: 8 };
const th: React.CSSProperties = {
  textAlign: 'left',
  borderBottom: '1px solid #444',
  padding: '6px 8px',
  fontWeight: 600,
};
const td: React.CSSProperties = { borderBottom: '1px solid #222', padding: '6px 8px' };
