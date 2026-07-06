import type { WorkItem } from '../../types.js';
import { PIPELINE_STAGE_ORDER } from '../../types.js';
import { STAGE_META } from './layout.js';
import * as s from './panelStyles.js';

/**
 * Detail panel for a selected work item: stage timeline, latest
 * output/error, and the approve / retry / cancel actions.
 */
export function WorkItemPanel({
  item,
  isPending,
  error,
  onApprove,
  onRetry,
  onCancel,
  onClose,
}: {
  item: WorkItem;
  isPending: boolean;
  error: unknown;
  onApprove: () => void;
  onRetry: () => void;
  onCancel: () => void;
  onClose: () => void;
}): JSX.Element {
  const current = item.stages[item.currentStage];
  const detail = current?.error ?? current?.output;

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
          {item.source} request · {statusLabel(item)}
        </div>

        <div style={timeline}>
          {PIPELINE_STAGE_ORDER.map((stage) => {
            const result = item.stages[stage];
            return (
              <div key={stage} style={timelineRow}>
                <span style={{ ...dot, background: dotColor(result?.status) }} />
                <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{STAGE_META[stage].label}</span>
                <span style={{ ...s.panelHint, marginLeft: 'auto' }}>
                  {result?.status ?? 'pending'}
                  {stage === 'monitor' && result?.checksPassed ? ` (${result.checksPassed} ok)` : ''}
                </span>
              </div>
            );
          })}
        </div>

        {detail ? <div style={s.panelMono}>{truncate(detail, 1600)}</div> : null}

        <div style={s.panelRow}>
          {item.status === 'waiting-approval' ? (
            <button type="button" onClick={onApprove} disabled={isPending} style={s.panelButton}>
              {isPending ? 'Working…' : `Approve ${STAGE_META[item.currentStage].label.toLowerCase()}`}
            </button>
          ) : null}
          {item.status === 'failed' ? (
            <button type="button" onClick={onRetry} disabled={isPending} style={s.panelButton}>
              {isPending ? 'Working…' : 'Retry stage'}
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

function statusLabel(item: WorkItem): string {
  switch (item.status) {
    case 'waiting-approval':
      return `waiting for approval at ${STAGE_META[item.currentStage].label.toLowerCase()}`;
    case 'running':
      return `running ${STAGE_META[item.currentStage].label.toLowerCase()}`;
    case 'failed':
      return `failed at ${STAGE_META[item.currentStage].label.toLowerCase()}`;
    case 'monitoring':
      return 'deployed — monitoring production';
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
