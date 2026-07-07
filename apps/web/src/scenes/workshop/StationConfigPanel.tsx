import { useState } from 'react';
import type {
  AgentProviderId,
  PipelineStageId,
  StageConfig,
  StageGate,
  Toolbox,
} from '../../types.js';
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
  skills: string[];
  mcpServers: string[];
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
    skills: config.skills ?? [],
    mcpServers: config.mcpServers ?? [],
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
    ...(draft.skills.length > 0 ? { skills: draft.skills } : {}),
    ...(draft.mcpServers.length > 0 ? { mcpServers: draft.mcpServers } : {}),
  };
}

/**
 * The stage machine configuration form, docked in the scene's top-left
 * panel slot. Keyed by project+stage in the parent so the draft resets
 * when the user clicks a different machine. Unchecking "installed" is
 * how a machine is removed from the lane.
 */
export function StationConfigPanel({
  projectLabel,
  stage,
  config,
  toolbox,
  isPending,
  error,
  onSave,
  onClose,
}: {
  projectLabel: string;
  stage: PipelineStageId;
  config: StageConfig;
  toolbox: Toolbox;
  isPending: boolean;
  error: unknown;
  onSave: (next: StageConfig) => void;
  onClose: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState<Draft>(() => toDraft(config));
  const meta = STAGE_META[stage];
  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void =>
    setDraft((d) => ({ ...d, [key]: value }));
  const toggleTool = (field: 'skills' | 'mcpServers', id: string): void =>
    setDraft((d) => ({
      ...d,
      [field]: d[field].includes(id) ? d[field].filter((x) => x !== id) : [...d[field], id],
    }));

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
            {projectLabel} · {meta.label} <span style={s.panelHint}>— {meta.blurb}</span>
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
            installed
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

        <ToolPicker
          toolbox={toolbox}
          selectedSkills={draft.skills}
          selectedServers={draft.mcpServers}
          onToggle={toggleTool}
        />

        <button type="submit" disabled={isPending} style={s.panelButton}>
          {isPending ? 'Saving…' : 'Save station'}
        </button>
        {error ? <div style={s.panelError}>{String(error)}</div> : null}
      </form>
    </foreignObject>
  );
}

/**
 * Tool assignment: a tag-filterable checkbox list over the toolbox
 * catalog. Nothing is granted unless checked here — that keeps agents away
 * from tools they shouldn't touch and out of context they don't need.
 * Shared with the project wizard/settings, where the same list assigns
 * project-level tools every machine in the lane inherits.
 */
export function ToolPicker({
  toolbox,
  selectedSkills,
  selectedServers,
  onToggle,
}: {
  toolbox: Toolbox;
  selectedSkills: string[];
  selectedServers: string[];
  onToggle: (field: 'skills' | 'mcpServers', id: string) => void;
}): JSX.Element {
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();
  const matches = (tool: { name: string; description?: string; tags: string[] }): boolean =>
    q === '' ||
    tool.name.toLowerCase().includes(q) ||
    (tool.description ?? '').toLowerCase().includes(q) ||
    tool.tags.some((tag) => tag.includes(q));

  const skills = toolbox.skills.filter(matches);
  const servers = toolbox.mcpServers.filter(matches);
  const empty = toolbox.skills.length === 0 && toolbox.mcpServers.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 11, color: '#c8a888' }}>
        tools{' '}
        <span style={s.panelHint}>
          — machines get no tools unless assigned here ({selectedSkills.length +
            selectedServers.length}{' '}
          assigned)
        </span>
      </div>
      {empty ? (
        <div style={s.panelHint}>the tool box is empty — click the red chest to add tools</div>
      ) : (
        <>
          <input
            placeholder="Filter by name or tag…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={s.panelInput}
          />
          <div style={toolList}>
            {skills.map((skill) => (
              <ToolCheckRow
                key={skill.id}
                checked={selectedSkills.includes(skill.id)}
                name={skill.name}
                hint={skill.description}
                tags={skill.tags}
                onToggle={() => onToggle('skills', skill.id)}
              />
            ))}
            {servers.map((server) => (
              <ToolCheckRow
                key={server.id}
                checked={selectedServers.includes(server.id)}
                name={`${server.name} (MCP)`}
                hint={server.description ?? ''}
                tags={server.tags}
                onToggle={() => onToggle('mcpServers', server.id)}
              />
            ))}
            {skills.length === 0 && servers.length === 0 ? (
              <div style={s.panelHint}>no tools match the filter</div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function ToolCheckRow({
  checked,
  name,
  hint,
  tags,
  onToggle,
}: {
  checked: boolean;
  name: string;
  hint: string;
  tags: string[];
  onToggle: () => void;
}): JSX.Element {
  return (
    <label style={toolCheckRow}>
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <span style={{ color: '#ead6b8' }}>{name}</span>
      {tags.map((tag) => (
        <span key={tag} style={toolTag}>
          {tag}
        </span>
      ))}
      <span style={{ ...s.panelHint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {hint}
      </span>
    </label>
  );
}

const toolList: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  maxHeight: 130,
  overflow: 'auto',
  border: '1px solid #2a1f17',
  borderRadius: 5,
  padding: 6,
  background: '#100b08',
};

const toolCheckRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 11,
  cursor: 'pointer',
  minWidth: 0,
};

const toolTag: React.CSSProperties = {
  fontSize: 9,
  padding: '0px 5px',
  borderRadius: 8,
  border: '1px solid #4a3624',
  color: '#c8a888',
  flexShrink: 0,
};

const closeButton: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#c8a888',
  cursor: 'pointer',
  fontSize: 13,
};
