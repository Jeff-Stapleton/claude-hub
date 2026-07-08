import type { PipelineMachine, WorkItem } from '../../types.js';
import * as s from './panelStyles.js';

/**
 * Detail panel for a selected work item: machine timeline, latest
 * output/error, and the approve / retry / cancel actions. The timeline
 * walks the project's current line in order and appends any orphan result
 * keys (machines since removed) so history stays visible.
 */
export function WorkItemPanel({
  item,
  machines,
  isPending,
  error,
  onApprove,
  onRetry,
  onCancel,
  onClose,
}: {
  item: WorkItem;
  /** The project's current line, for timeline order + display names. */
  machines: PipelineMachine[];
  isPending: boolean;
  error: unknown;
  onApprove: () => void;
  onRetry: () => void;
  onCancel: () => void;
  onClose: () => void;
}): JSX.Element {
  const current = item.stages[item.currentStage];
  const detail = current?.error ?? current?.output;
  const lineKeys = machines.map((m) => m.key);
  const orphanKeys = Object.keys(item.stages).filter((key) => !lineKeys.includes(key));
  const timelineKeys = [...lineKeys, ...orphanKeys];
  const nameFor = (key: string): string =>
    machines.find((m) => m.key === key)?.name.toUpperCase() ?? key.toUpperCase();

  return (
    <foreignObject x={28} y={90} width={470} height={540}>
      <div style={s.panel}>
        <div style={s.panelTitle}>
          <span>{item.title}</span>
          <button type="button" onClick={onClose} style={closeButton} aria-label="Close panel">
            ✕
          </button>
        </div>
        <div style={s.panelHint}>
          {item.source} request · {statusLabel(item, nameFor)}
        </div>

        <div style={timeline}>
          {timelineKeys.map((key) => {
            const result = item.stages[key];
            return (
              <div key={key} style={timelineRow}>
                <span style={{ ...dot, background: dotColor(result?.status) }} />
                <span style={{ fontFamily: 'monospace', fontSize: 11 }}>
                  {nameFor(key)}
                  {lineKeys.includes(key) ? '' : ' (removed)'}
                </span>
                <span style={{ ...s.panelHint, marginLeft: 'auto' }}>
                  {result?.status ?? 'pending'}
                  {result?.checksPassed ? ` (${result.checksPassed} ok)` : ''}
                </span>
              </div>
            );
          })}
        </div>

        {detail ? <div style={s.panelMono}>{truncate(detail, 1600)}</div> : null}

        <div style={s.panelRow}>
          {item.status === 'waiting-approval' ? (
            <button type="button" onClick={onApprove} disabled={isPending} style={s.panelButton}>
              {isPending ? 'Working…' : `Approve ${nameFor(item.currentStage).toLowerCase()}`}
            </button>
          ) : null}
          {item.status === 'failed' ? (
            <button type="button" onClick={onRetry} disabled={isPending} style={s.panelButton}>
              {isPending ? 'Working…' : 'Retry machine'}
            </button>
          ) : null}
          <button type="button" onClick={onCancel} disabled={isPending} style={s.panelDangerButton}>
            Cancel item
          </button>
        </div>
        {error ? <div style={s.panelError}>{String(error)}</div> : null}
      </div>
    </foreignObject>
  );
}

function statusLabel(item: WorkItem, nameFor: (key: string) => string): string {
  switch (item.status) {
    case 'waiting-approval':
      return `waiting for approval at ${nameFor(item.currentStage).toLowerCase()}`;
    case 'running':
      return `running ${nameFor(item.currentStage).toLowerCase()}`;
    case 'failed':
      return `failed at ${nameFor(item.currentStage).toLowerCase()}`;
    case 'monitoring':
      return `parked at ${nameFor(item.currentStage).toLowerCase()} — monitoring`;
    default:
      return item.status;
  }
}

function dotColor(status: string | undefined): string {
  switch (status) {
    case 'success':
      return '#5ec27a';
    case 'running':
      return '#e8b04a';
    case 'failed':
      return '#cf4040';
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

const timeline: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '6px 0',
};

const timelineRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const dot: React.CSSProperties = {
  width: 9,
  height: 9,
  borderRadius: '50%',
  border: '1px solid #15100c',
  flexShrink: 0,
};

const closeButton: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#c8a888',
  cursor: 'pointer',
  fontSize: 13,
};
