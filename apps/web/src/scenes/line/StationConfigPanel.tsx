import { useState } from 'react';
import type { AgentProviderId, PipelineStageId, StageConfig, StageGate } from '../../types.js';
import { STAGE_META } from './layout.js';
import * as s from './panelStyles.js';

const COMMAND_STAGES: ReadonlySet<PipelineStageId> = new Set(['test', 'deploy', 'monitor']);

interface Draft {
  enabled: boolean;
  gate: StageGate;
  provider: '' | AgentProviderId;
  promptTemplate: string;
  commands: string;
  intervalMinutes: string;
  maxChecks: string;
}

function toDraft(config: StageConfig): Draft {
  return {
    enabled: config.enabled,
    gate: config.gate,
    provider: config.provider ?? '',
    promptTemplate: config.promptTemplate ?? '',
    commands: (config.commands ?? []).join('\n'),
    intervalMinutes: config.intervalMinutes !== undefined ? String(config.intervalMinutes) : '',
    maxChecks: config.maxChecks !== undefined ? String(config.maxChecks) : '',
  };
}

/** Draft -> StageConfig, omitting empty optionals (server merges defaults). */
function fromDraft(stage: PipelineStageId, draft: Draft): StageConfig {
  const commands = draft.commands
    .split('\n')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  const interval = Number(draft.intervalMinutes);
  const maxChecks = Number(draft.maxChecks);
  return {
    enabled: draft.enabled,
    gate: draft.gate,
    ...(draft.provider !== '' ? { provider: draft.provider } : {}),
    ...(draft.promptTemplate.trim() !== '' ? { promptTemplate: draft.promptTemplate } : {}),
    ...(COMMAND_STAGES.has(stage) && commands.length > 0 ? { commands } : {}),
    ...(stage === 'monitor' && draft.intervalMinutes !== '' && Number.isFinite(interval) && interval >= 1
      ? { intervalMinutes: interval }
      : {}),
    ...(stage === 'monitor' && draft.maxChecks !== '' && Number.isFinite(maxChecks) && maxChecks >= 1
      ? { maxChecks: maxChecks }
      : {}),
  };
}

/**
 * The station configuration form, docked in the hall's left screen
 * region. Keyed by stage in the parent so the draft resets when the
 * user clicks a different station.
 */
export function StationConfigPanel({
  stage,
  config,
  isPending,
  error,
  onSave,
  onClose,
}: {
  stage: PipelineStageId;
  config: StageConfig;
  isPending: boolean;
  error: unknown;
  onSave: (next: StageConfig) => void;
  onClose: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState<Draft>(() => toDraft(config));
  const meta = STAGE_META[stage];
  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void =>
    setDraft((d) => ({ ...d, [key]: value }));

  return (
    <foreignObject x={28} y={90} width={470} height={540}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSave(fromDraft(stage, draft));
        }}
        style={s.panel}
      >
        <div style={s.panelTitle}>
          <span>
            {meta.label} station <span style={s.panelHint}>— {meta.blurb}</span>
          </span>
          <button type="button" onClick={onClose} style={closeButton} aria-label="Close panel">
            ✕
          </button>
        </div>

        <div style={s.panelRow}>
          <label style={{ ...s.panelRow, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => set('enabled', e.target.checked)}
            />
            enabled
          </label>
          <label style={{ ...s.panelRow, fontSize: 12, marginLeft: 12 }}>
            gate
            <select value={draft.gate} onChange={(e) => set('gate', e.target.value as StageGate)} style={s.panelInput}>
              <option value="auto">auto — advance on its own</option>
              <option value="approval">approval — hold for a human</option>
            </select>
          </label>
        </div>

        <label style={s.panelLabel}>
          agent provider
          <select
            value={draft.provider}
            onChange={(e) => set('provider', e.target.value as Draft['provider'])}
            style={s.panelInput}
          >
            <option value="">default provider</option>
            <option value="claude">claude</option>
            <option value="cursor">cursor</option>
          </select>
        </label>

        <label style={s.panelLabel}>
          prompt template <span style={s.panelHint}>vars: {'{{request}} {{title}} {{stages.spec.output}} …'} — blank = built-in</span>
          <textarea
            value={draft.promptTemplate}
            onChange={(e) => set('promptTemplate', e.target.value)}
            placeholder="Leave blank to use the built-in stage prompt"
            style={s.panelTextarea}
            rows={4}
          />
        </label>

        {COMMAND_STAGES.has(stage) ? (
          <label style={s.panelLabel}>
            shell commands <span style={s.panelHint}>one per line, run in the project directory; with commands set and no template, the agent step is skipped</span>
            <textarea
              value={draft.commands}
              onChange={(e) => set('commands', e.target.value)}
              placeholder={stage === 'test' ? 'pnpm test' : stage === 'deploy' ? 'pnpm run deploy' : 'curl -sf http://localhost:3000/health'}
              style={s.panelTextarea}
              rows={3}
            />
          </label>
        ) : null}

        {stage === 'monitor' ? (
          <div style={s.panelRow}>
            <label style={s.panelLabel}>
              check interval (min)
              <input
                type="number"
                min={1}
                value={draft.intervalMinutes}
                onChange={(e) => set('intervalMinutes', e.target.value)}
                placeholder="30"
                style={s.panelInput}
              />
            </label>
            <label style={s.panelLabel}>
              healthy checks to ship
              <input
                type="number"
                min={1}
                value={draft.maxChecks}
                onChange={(e) => set('maxChecks', e.target.value)}
                placeholder="3"
                style={s.panelInput}
              />
            </label>
          </div>
        ) : null}

        <button type="submit" disabled={isPending} style={s.panelButton}>
          {isPending ? 'Saving…' : 'Save station'}
        </button>
        {error ? <div style={s.panelError}>{String(error)}</div> : null}
      </form>
    </foreignObject>
  );
}

const closeButton: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#c8a888',
  cursor: 'pointer',
  fontSize: 13,
};
