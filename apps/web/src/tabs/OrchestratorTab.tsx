import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.js';
import type { AgentProviderId, AppConfig, OrchestratorState } from '../types.js';

export function OrchestratorTab({
  state,
  config,
}: {
  state: OrchestratorState;
  config: AppConfig;
}): JSX.Element {
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
        The orchestrator turns incoming channel messages into configured agent runs. Each
        conversation gets its own persistent provider session id so follow-up messages
        continue the same context. Clearing sessions drops that map — the next DM in each
        conversation will start a fresh agent session.
      </p>

      <ProviderSettings config={config} />

      <h3 style={{ marginTop: 24 }}>Active conversations</h3>
      {sessions.length === 0 ? (
        <p style={{ opacity: 0.7 }}>No conversations yet.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Conversation</th>
              <th style={th}>Session id</th>
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

function ProviderSettings({ config }: { config: AppConfig }): JSX.Element {
  const qc = useQueryClient();
  const [defaultProvider, setDefaultProvider] = useState<AgentProviderId>(
    config.defaultProvider,
  );
  const [claudePath, setClaudePath] = useState(config.providers.claude.cliPath ?? '');
  const [claudeSkipPerms, setClaudeSkipPerms] = useState(
    config.providers.claude.dangerouslySkipPermissions,
  );
  const [cursorPath, setCursorPath] = useState(config.providers.cursor.cliPath ?? '');
  const [cursorModel, setCursorModel] = useState(config.providers.cursor.model);
  const [cursorForce, setCursorForce] = useState(config.providers.cursor.force);
  const [cursorTrust, setCursorTrust] = useState(config.providers.cursor.trust);
  const [cursorApproveMcps, setCursorApproveMcps] = useState(
    config.providers.cursor.approveMcps,
  );
  const [cursorSandbox, setCursorSandbox] = useState(
    config.providers.cursor.sandbox ?? '',
  );

  const save = useMutation({
    mutationFn: api.saveConfig,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['state'] }),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const { sandbox: _sandbox, ...cursorBase } = config.providers.cursor;
        save.mutate({
          defaultProvider,
          providers: {
            claude: {
              ...config.providers.claude,
              cliPath: claudePath.trim(),
              dangerouslySkipPermissions: claudeSkipPerms,
            },
            cursor: {
              ...cursorBase,
              cliPath: cursorPath.trim(),
              model: cursorModel.trim() || 'gpt-5.5',
              force: cursorForce,
              trust: cursorTrust,
              approveMcps: cursorApproveMcps,
              ...(cursorSandbox === 'enabled' || cursorSandbox === 'disabled'
                ? { sandbox: cursorSandbox }
                : {}),
            },
          },
        });
      }}
      style={settingsBox}
    >
      <h3 style={{ marginTop: 0 }}>Agent Provider</h3>
      <label>
        <div style={labelDiv}>Default provider</div>
        <select
          value={defaultProvider}
          onChange={(e) => setDefaultProvider(e.target.value as AgentProviderId)}
        >
          <option value="claude">Claude Code</option>
          <option value="cursor">Cursor CLI</option>
        </select>
      </label>

      <div style={settingsGrid}>
        <fieldset style={fieldset}>
          <legend>Claude Code</legend>
          <label>
            <div style={labelDiv}>CLI path</div>
            <input
              value={claudePath}
              onChange={(e) => setClaudePath(e.target.value)}
              placeholder="claude"
              style={{ width: '100%' }}
            />
          </label>
          <label style={checkboxLabel}>
            <input
              type="checkbox"
              checked={claudeSkipPerms}
              onChange={(e) => setClaudeSkipPerms(e.target.checked)}
            />
            Skip permission prompts
          </label>
        </fieldset>

        <fieldset style={fieldset}>
          <legend>Cursor CLI</legend>
          <label>
            <div style={labelDiv}>CLI path</div>
            <input
              value={cursorPath}
              onChange={(e) => setCursorPath(e.target.value)}
              placeholder="agent"
              style={{ width: '100%' }}
            />
          </label>
          <label>
            <div style={labelDiv}>Model</div>
            <input
              value={cursorModel}
              onChange={(e) => setCursorModel(e.target.value)}
              placeholder="gpt-5.5"
              style={{ width: '100%' }}
            />
          </label>
          <label>
            <div style={labelDiv}>Sandbox</div>
            <select
              value={cursorSandbox}
              onChange={(e) => setCursorSandbox(e.target.value)}
            >
              <option value="">CLI default</option>
              <option value="enabled">enabled</option>
              <option value="disabled">disabled</option>
            </select>
          </label>
          <label style={checkboxLabel}>
            <input
              type="checkbox"
              checked={cursorTrust}
              onChange={(e) => setCursorTrust(e.target.checked)}
            />
            Trust workspace
          </label>
          <label style={checkboxLabel}>
            <input
              type="checkbox"
              checked={cursorApproveMcps}
              onChange={(e) => setCursorApproveMcps(e.target.checked)}
            />
            Approve MCP servers
          </label>
          <label style={checkboxLabel}>
            <input
              type="checkbox"
              checked={cursorForce}
              onChange={(e) => setCursorForce(e.target.checked)}
            />
            Force/yolo edits in print mode
          </label>
        </fieldset>
      </div>

      <button type="submit" disabled={save.isPending}>
        Save provider settings
      </button>
      {save.error ? (
        <span style={{ color: 'crimson', marginLeft: 8 }}>{String(save.error)}</span>
      ) : null}
    </form>
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
const settingsBox: React.CSSProperties = {
  border: '1px solid #33261a',
  padding: 12,
  margin: '18px 0',
  maxWidth: 820,
};
const settingsGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: 12,
  margin: '12px 0',
};
const fieldset: React.CSSProperties = {
  border: '1px solid #443322',
  display: 'grid',
  gap: 8,
};
const labelDiv: React.CSSProperties = {
  fontWeight: 600,
  marginBottom: 4,
  fontSize: 13,
};
const checkboxLabel: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
};
const th: React.CSSProperties = {
  textAlign: 'left',
  borderBottom: '1px solid #444',
  padding: '6px 8px',
  fontWeight: 600,
};
const td: React.CSSProperties = { borderBottom: '1px solid #222', padding: '6px 8px' };
