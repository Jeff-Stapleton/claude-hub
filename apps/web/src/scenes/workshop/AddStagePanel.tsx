import type { PipelineConfig, PipelineStageId } from '../../types.js';
import { PIPELINE_STAGE_ORDER } from '../../types.js';
import { STAGE_META } from './layout.js';
import * as s from './panelStyles.js';

/**
 * Picker for the lane's "+" ghost slot: the not-yet-installed stages, in
 * pipeline order, each installable with one click. Installing a machine
 * just flips that stage's `enabled` flag — its gate/cadence defaults are
 * already sensible (deploy installs pre-gated on approval).
 */
export function AddStagePanel({
  projectLabel,
  config,
  isPending,
  error,
  onInstall,
  onClose,
}: {
  projectLabel: string;
  config: PipelineConfig;
  isPending: boolean;
  error: unknown;
  onInstall: (stage: PipelineStageId) => void;
  onClose: () => void;
}): JSX.Element {
  const remaining = PIPELINE_STAGE_ORDER.filter((stage) => !config.stages[stage].enabled);

  return (
    <foreignObject x={28} y={90} width={470} height={470}>
      <div style={s.panel}>
        <div style={s.panelTitle}>
          <span>
            {projectLabel} <span style={s.panelHint}>— add a machine</span>
          </span>
          <button type="button" onClick={onClose} style={closeButton} aria-label="Close panel">
            ✕
          </button>
        </div>
        <div style={s.panelHint}>
          Work flows through the machines in fixed order: intake → spec → code → test → deploy →
          monitor. Install the ones this line should run.
        </div>

        {remaining.map((stage) => {
          const meta = STAGE_META[stage];
          return (
            <div key={stage} style={stageRow}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#f0d8b8' }}>
                  {meta.label}
                  {stage === 'deploy' ? <span style={s.panelHint}> (installs gated on approval)</span> : null}
                </span>
                <span style={s.panelHint}>{meta.blurb}</span>
              </div>
              <button
                type="button"
                disabled={isPending}
                onClick={() => onInstall(stage)}
                style={{ ...s.panelButton, marginLeft: 'auto', flexShrink: 0 }}
              >
                {isPending ? 'Installing…' : 'Install'}
              </button>
            </div>
          );
        })}

        {remaining.length === 0 ? (
          <div style={s.panelHint}>every machine is installed — this line is fully built</div>
        ) : null}
        {error ? <div style={s.panelError}>{String(error)}</div> : null}
      </div>
    </foreignObject>
  );
}

const stageRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '7px 8px',
  border: '1px solid #2a1f17',
  borderRadius: 6,
  background: 'rgba(16, 11, 8, 0.6)',
};

const closeButton: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#c8a888',
  cursor: 'pointer',
  fontSize: 13,
};
