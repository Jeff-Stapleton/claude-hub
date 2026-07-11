import { useState } from 'react';
import type { MonitorBody, MonitorCheckInput } from '../../api.js';
import {
  projectMonitorHealth,
  type AgentProviderId,
  type MonitorCheckStatus,
  type ProjectMonitor,
  type ProjectMonitorCheckType,
} from '../../types.js';
import * as s from './panelStyles.js';

/**
 * Monitoring config for one project — opened from the factory light over
 * its SHIPPED door. A monitor is a list of independent checks (HTTP ping,
 * shell command, agent smoke test), each on its own interval, that run
 * indefinitely while the hub is up. Aggregate health drives the light.
 */
export function MonitorPanel({
  projectLabel,
  monitor,
  isPending,
  error,
  onSave,
  onRunNow,
  onClose,
}: {
  projectLabel: string;
  monitor: ProjectMonitor | undefined;
  isPending: boolean;
  error: unknown;
  onSave: (body: MonitorBody) => void;
  onRunNow: () => void;
  onClose: () => void;
}): JSX.Element {
  const [enabled, setEnabled] = useState(monitor?.enabled ?? false);
  const [fileDefect, setFileDefect] = useState(monitor?.fileDefectOnFailure ?? true);
  const [checks, setChecks] = useState<CheckDraft[]>(
    (monitor?.checks ?? []).map(draftFromCheck),
  );

  const drafts = checks.map((c) => ({ draft: c, error: validateDraft(c) }));
  const firstError = drafts.find((d) => d.error)?.error;
  const canRunNow = (monitor?.enabled ?? false) && (monitor?.checks.length ?? 0) > 0;

  const save = (): void => {
    if (firstError) return;
    onSave({
      enabled,
      fileDefectOnFailure: fileDefect,
      checks: checks.map(checkFromDraft),
    });
  };

  return (
    <foreignObject x={28} y={70} width={500} height={620}>
      <div style={s.panel}>
        <div style={s.panelTitle}>
          <span>
            Monitoring <span style={s.panelHint}>— {projectLabel}</span>
          </span>
          <button type="button" onClick={onClose} style={closeButton} aria-label="Close panel">
            ✕
          </button>
        </div>

        <HealthBanner monitor={monitor} />

        <label style={{ ...s.panelRow, fontSize: 12 }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          monitoring on — checks run on their intervals for as long as the hub is up
        </label>
        <label style={{ ...s.panelRow, fontSize: 12 }}>
          <input
            type="checkbox"
            checked={fileDefect}
            onChange={(e) => setFileDefect(e.target.checked)}
          />
          file a defect work item when a check starts failing (once per outage)
        </label>

        {checks.length === 0 ? (
          <div style={s.panelHint}>
            No checks yet. A small project usually needs just one HTTP ping; add shell smoke
            tests or agent checks as it grows.
          </div>
        ) : null}

        {checks.map((draft, i) => (
          <CheckCard
            key={draft.id ?? `new-${i}`}
            draft={draft}
            status={draft.id !== undefined ? monitor?.status.checks[draft.id] : undefined}
            onChange={(next) => setChecks(checks.map((c, j) => (j === i ? next : c)))}
            onRemove={() => setChecks(checks.filter((_, j) => j !== i))}
          />
        ))}

        <div style={s.panelRow}>
          <span style={s.panelHint}>add check:</span>
          {(['http', 'command', 'agent'] as const).map((type) => (
            <button
              key={type}
              type="button"
              style={smallButton}
              onClick={() => setChecks([...checks, newDraft(type)])}
            >
              + {TYPE_LABEL[type]}
            </button>
          ))}
        </div>

        {firstError ? <div style={s.panelHint}>{firstError}</div> : null}
        <div style={s.panelRow}>
          <button
            type="button"
            style={s.panelButton}
            disabled={isPending || firstError !== undefined}
            onClick={save}
          >
            {isPending ? 'saving…' : 'save'}
          </button>
          <button
            type="button"
            style={{ ...s.panelButton, ...(canRunNow ? {} : { opacity: 0.5 }) }}
            disabled={isPending || !canRunNow}
            title={canRunNow ? undefined : 'save an enabled monitor with checks first'}
            onClick={onRunNow}
          >
            run checks now
          </button>
        </div>
        {error ? <div style={s.panelError}>{String(error)}</div> : null}
      </div>
    </foreignObject>
  );
}

function HealthBanner({ monitor }: { monitor: ProjectMonitor | undefined }): JSX.Element {
  const configured = monitor !== undefined && monitor.enabled && monitor.checks.length > 0;
  const health = configured ? projectMonitorHealth(monitor) : undefined;
  const color =
    health === 'healthy' ? '#5ec27a' : health === 'down' ? '#cf4040' : '#e8b04a';
  const text =
    health === 'healthy'
      ? 'healthy — all checks passing'
      : health === 'down'
        ? 'DOWN — a check is failing'
        : health === 'unknown'
          ? 'awaiting first checks'
          : 'not configured';
  return (
    <div style={{ ...banner, borderColor: configured ? color : '#4a3624' }}>
      <span
        style={{
          ...dot,
          background: configured ? color : 'transparent',
          border: configured ? 'none' : '1px dashed #8a7458',
          ...(health === 'down' ? { animation: 'workshop-led 1.1s ease-in-out infinite' } : {}),
        }}
      />
      <span>{text}</span>
      {monitor?.status.outageOpen ? (
        <span style={s.panelHint}>· defect filed for this outage</span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Check drafts
// ---------------------------------------------------------------------------

const TYPE_LABEL: Record<ProjectMonitorCheckType, string> = {
  http: 'HTTP ping',
  command: 'shell command',
  agent: 'agent check',
};

interface CheckDraft {
  /** Absent for new checks; the server assigns the id. */
  id?: string;
  type: ProjectMonitorCheckType;
  name: string;
  intervalMinutes: string;
  /** Seconds for http/command, minutes for agent; '' = per-type default. */
  timeout: string;
  url: string;
  expectedStatus: string;
  command: string;
  prompt: string;
  provider: '' | AgentProviderId;
}

function newDraft(type: ProjectMonitorCheckType): CheckDraft {
  return {
    type,
    name:
      type === 'http' ? 'health ping' : type === 'command' ? 'smoke test' : 'agent health check',
    intervalMinutes: type === 'agent' ? '30' : '5',
    timeout: '',
    url: '',
    expectedStatus: '',
    command: '',
    prompt: '',
    provider: '',
  };
}

function draftFromCheck(check: ProjectMonitor['checks'][number]): CheckDraft {
  return {
    id: check.id,
    type: check.type,
    name: check.name,
    intervalMinutes: String(check.intervalMinutes),
    timeout:
      check.timeoutMs !== undefined
        ? String(check.type === 'agent' ? check.timeoutMs / 60_000 : check.timeoutMs / 1000)
        : '',
    url: check.type === 'http' ? check.url : '',
    expectedStatus:
      check.type === 'http' && check.expectedStatus !== undefined
        ? String(check.expectedStatus)
        : '',
    command: check.type === 'command' ? check.command : '',
    prompt: check.type === 'agent' ? check.prompt : '',
    provider: check.type === 'agent' ? (check.provider ?? '') : '',
  };
}

function checkFromDraft(draft: CheckDraft): MonitorCheckInput {
  const timeoutNum = Number(draft.timeout);
  const timeoutMs =
    draft.timeout.trim() !== '' && Number.isFinite(timeoutNum) && timeoutNum > 0
      ? draft.type === 'agent'
        ? timeoutNum * 60_000
        : timeoutNum * 1000
      : undefined;
  const base = {
    ...(draft.id !== undefined ? { id: draft.id } : {}),
    name: draft.name.trim(),
    intervalMinutes: Number(draft.intervalMinutes),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  };
  if (draft.type === 'http') {
    const expected = Number(draft.expectedStatus);
    return {
      ...base,
      type: 'http',
      url: draft.url.trim(),
      ...(draft.expectedStatus.trim() !== '' && Number.isInteger(expected)
        ? { expectedStatus: expected }
        : {}),
    };
  }
  if (draft.type === 'command') {
    return { ...base, type: 'command', command: draft.command.trim() };
  }
  return {
    ...base,
    type: 'agent',
    prompt: draft.prompt.trim(),
    ...(draft.provider !== '' ? { provider: draft.provider } : {}),
  };
}

function validateDraft(draft: CheckDraft): string | undefined {
  if (!draft.name.trim()) return 'every check needs a name';
  const interval = Number(draft.intervalMinutes);
  if (!Number.isFinite(interval) || interval < 1) {
    return `"${draft.name.trim()}": interval must be at least 1 minute`;
  }
  if (draft.type === 'http' && !draft.url.trim()) return `"${draft.name.trim()}": url is required`;
  if (draft.type === 'command' && !draft.command.trim()) {
    return `"${draft.name.trim()}": command is required`;
  }
  if (draft.type === 'agent' && !draft.prompt.trim()) {
    return `"${draft.name.trim()}": prompt is required`;
  }
  return undefined;
}

function CheckCard({
  draft,
  status,
  onChange,
  onRemove,
}: {
  draft: CheckDraft;
  status: MonitorCheckStatus | undefined;
  onChange: (next: CheckDraft) => void;
  onRemove: () => void;
}): JSX.Element {
  return (
    <div style={card}>
      <div style={cardHeader}>
        <span style={typeBadge}>{TYPE_LABEL[draft.type]}</span>
        <input
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          placeholder="check name"
          style={{ ...s.panelInput, flex: 1, padding: '4px 7px' }}
        />
        <button type="button" style={removeButton} onClick={onRemove}>
          remove
        </button>
      </div>

      <CheckStatusLine status={status} />

      {draft.type === 'http' ? (
        <>
          <div style={s.panelRow}>
            <input
              value={draft.url}
              onChange={(e) => onChange({ ...draft, url: e.target.value })}
              placeholder="https://example.com/health"
              style={{ ...s.panelInput, flex: 1, fontFamily: 'monospace' }}
            />
          </div>
          <div style={s.panelRow}>
            <label style={inlineLabel}>
              every
              <input
                value={draft.intervalMinutes}
                onChange={(e) => onChange({ ...draft, intervalMinutes: e.target.value })}
                style={numInput}
              />
              min
            </label>
            <label style={inlineLabel}>
              expect status
              <input
                value={draft.expectedStatus}
                onChange={(e) => onChange({ ...draft, expectedStatus: e.target.value })}
                placeholder="2xx"
                style={numInput}
              />
            </label>
            <label style={inlineLabel}>
              timeout
              <input
                value={draft.timeout}
                onChange={(e) => onChange({ ...draft, timeout: e.target.value })}
                placeholder="10"
                style={numInput}
              />
              s
            </label>
          </div>
        </>
      ) : null}

      {draft.type === 'command' ? (
        <>
          <div style={s.panelRow}>
            <input
              value={draft.command}
              onChange={(e) => onChange({ ...draft, command: e.target.value })}
              placeholder="npm run smoke-test"
              style={{ ...s.panelInput, flex: 1, fontFamily: 'monospace' }}
            />
          </div>
          <div style={s.panelHint}>runs in the project root; exit 0 = healthy</div>
          <div style={s.panelRow}>
            <label style={inlineLabel}>
              every
              <input
                value={draft.intervalMinutes}
                onChange={(e) => onChange({ ...draft, intervalMinutes: e.target.value })}
                style={numInput}
              />
              min
            </label>
            <label style={inlineLabel}>
              timeout
              <input
                value={draft.timeout}
                onChange={(e) => onChange({ ...draft, timeout: e.target.value })}
                placeholder="300"
                style={numInput}
              />
              s
            </label>
          </div>
        </>
      ) : null}

      {draft.type === 'agent' ? (
        <>
          <textarea
            value={draft.prompt}
            onChange={(e) => onChange({ ...draft, prompt: e.target.value })}
            placeholder="Exercise the app's core flows and check performance…"
            rows={3}
            style={s.panelTextarea}
          />
          <div style={s.panelHint}>
            the run must end with MACHINE_RESULT: PASS or FAIL — agent checks cost tokens, so
            keep the interval long
          </div>
          <div style={s.panelRow}>
            <label style={inlineLabel}>
              every
              <input
                value={draft.intervalMinutes}
                onChange={(e) => onChange({ ...draft, intervalMinutes: e.target.value })}
                style={numInput}
              />
              min
            </label>
            <label style={inlineLabel}>
              provider
              <select
                value={draft.provider}
                onChange={(e) =>
                  onChange({ ...draft, provider: e.target.value as CheckDraft['provider'] })
                }
                style={{ ...s.panelInput, padding: '4px 6px' }}
              >
                <option value="">default</option>
                <option value="claude">claude</option>
                <option value="cursor">cursor</option>
              </select>
            </label>
            <label style={inlineLabel}>
              timeout
              <input
                value={draft.timeout}
                onChange={(e) => onChange({ ...draft, timeout: e.target.value })}
                placeholder="30"
                style={numInput}
              />
              min
            </label>
          </div>
        </>
      ) : null}
    </div>
  );
}

function CheckStatusLine({ status }: { status: MonitorCheckStatus | undefined }): JSX.Element {
  if (!status) {
    return <div style={s.panelHint}>never checked</div>;
  }
  const ago = timeAgo(status.lastCheckedAt);
  if (status.lastStatus === 'pass') {
    return <div style={{ ...statusLine, color: '#5ec27a' }}>pass {ago}</div>;
  }
  return (
    <div style={{ ...statusLine, color: '#cf4040' }}>
      fail {ago}
      {status.consecutiveFails > 1 ? ` (×${status.consecutiveFails})` : ''}
      {status.lastError ? ` — ${status.lastError}` : ''}
    </div>
  );
}

function timeAgo(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const closeButton: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#c8a888',
  cursor: 'pointer',
  fontSize: 13,
};

const banner: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  fontSize: 12,
  color: '#ead6b8',
  border: '1px solid',
  borderRadius: 6,
  padding: '6px 9px',
  background: '#100b08',
};

const dot: React.CSSProperties = {
  display: 'inline-block',
  width: 9,
  height: 9,
  borderRadius: '50%',
  flexShrink: 0,
};

const card: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '7px 9px',
  border: '1px solid #2a1f17',
  borderRadius: 6,
  background: '#100b08',
};

const cardHeader: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
};

const typeBadge: React.CSSProperties = {
  fontSize: 9,
  padding: '2px 7px',
  borderRadius: 8,
  border: '1px solid #4a3624',
  color: '#c8a888',
  whiteSpace: 'nowrap',
};

const removeButton: React.CSSProperties = {
  fontSize: 10,
  padding: '1px 6px',
  borderRadius: 8,
  border: '1px solid #6a2a2a',
  color: '#f2c0b8',
  background: 'transparent',
  cursor: 'pointer',
};

const inlineLabel: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 11,
  color: '#c8a888',
};

const numInput: React.CSSProperties = {
  width: 52,
  padding: '4px 6px',
  borderRadius: 5,
  border: '1px solid #5a3a22',
  background: '#100b08',
  color: '#eee',
  fontSize: 12,
};

const smallButton: React.CSSProperties = {
  fontSize: 10,
  padding: '2px 8px',
  borderRadius: 8,
  border: '1px solid #4a3624',
  color: '#c8a888',
  background: 'transparent',
  cursor: 'pointer',
};

const statusLine: React.CSSProperties = {
  fontSize: 10,
  fontFamily: 'monospace',
};
