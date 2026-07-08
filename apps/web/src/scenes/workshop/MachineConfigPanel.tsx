import { useState } from 'react';
import type {
  AgentProviderId,
  MachineBehavior,
  PipelineMachine,
  RedactedVaultEntry,
  StageGate,
  Toolbox,
} from '../../types.js';
import * as s from './panelStyles.js';

/**
 * Shared editable draft for a machine's behavior — used by this config
 * panel and by AddMachinePanel's custom-machine form so the two stay in
 * lockstep.
 */
export interface MachineDraft {
  name: string;
  gate: StageGate;
  provider: '' | AgentProviderId;
  promptTemplate: string;
  /** One command per line. */
  commands: string;
  resultCheck: '' | 'lenient' | 'strict';
  monitorEnabled: boolean;
  intervalMinutes: string;
  maxChecks: string;
  skills: string[];
  mcpServers: string[];
  requiredEnv: string[];
}

export function draftFromMachine(machine: PipelineMachine): MachineDraft {
  return {
    name: machine.name,
    gate: machine.gate,
    provider: machine.provider ?? '',
    promptTemplate: machine.promptTemplate ?? '',
    commands: (machine.commands ?? []).join('\n'),
    resultCheck: machine.resultCheck ?? '',
    monitorEnabled: machine.monitor !== undefined,
    intervalMinutes:
      machine.monitor?.intervalMinutes !== undefined ? String(machine.monitor.intervalMinutes) : '',
    maxChecks: machine.monitor?.maxChecks !== undefined ? String(machine.monitor.maxChecks) : '',
    skills: machine.skills ?? [],
    mcpServers: machine.mcpServers ?? [],
    requiredEnv: machine.requiredEnv ?? [],
  };
}

/** Draft -> behavior fields, omitting empty optionals. */
export function behaviorFromDraft(draft: MachineDraft): MachineBehavior {
  const commands = draft.commands
    .split('\n')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  const interval = Number(draft.intervalMinutes);
  const maxChecks = Number(draft.maxChecks);
  return {
    ...(draft.provider !== '' ? { provider: draft.provider } : {}),
    ...(draft.promptTemplate.trim() !== '' ? { promptTemplate: draft.promptTemplate } : {}),
    ...(commands.length > 0 ? { commands } : {}),
    ...(draft.resultCheck !== '' ? { resultCheck: draft.resultCheck } : {}),
    ...(draft.monitorEnabled
      ? {
          monitor: {
            ...(draft.intervalMinutes !== '' && Number.isFinite(interval) && interval >= 1
              ? { intervalMinutes: interval }
              : {}),
            ...(draft.maxChecks !== '' && Number.isFinite(maxChecks) && maxChecks >= 1
              ? { maxChecks }
              : {}),
          },
        }
      : {}),
    ...(draft.skills.length > 0 ? { skills: draft.skills } : {}),
    ...(draft.mcpServers.length > 0 ? { mcpServers: draft.mcpServers } : {}),
    ...(draft.requiredEnv.length > 0 ? { requiredEnv: draft.requiredEnv } : {}),
  };
}

/**
 * The behavior section of the machine form: gate, provider, prompt,
 * commands, result check, monitor loop, tools, and vault variables — every
 * capability on every machine, per the "machines differ only in context
 * and access" model.
 */
export function MachineFormFields({
  draft,
  set,
  toolbox,
  vault,
  promptPlaceholder,
  onCreateVaultKey,
}: {
  draft: MachineDraft;
  set: <K extends keyof MachineDraft>(key: K, value: MachineDraft[K]) => void;
  toolbox: Toolbox;
  vault: RedactedVaultEntry[];
  promptPlaceholder: string;
  onCreateVaultKey: (key: string) => void;
}): JSX.Element {
  const toggleTool = (field: 'skills' | 'mcpServers', id: string): void =>
    set(field, draft[field].includes(id) ? draft[field].filter((x) => x !== id) : [...draft[field], id]);
  const toggleVaultKey = (key: string): void =>
    set(
      'requiredEnv',
      draft.requiredEnv.includes(key)
        ? draft.requiredEnv.filter((k) => k !== key)
        : [...draft.requiredEnv, key],
    );

  return (
    <>
      <div style={s.panelRow}>
        <label style={{ ...s.panelRow, fontSize: 12 }}>
          gate
          <select value={draft.gate} onChange={(e) => set('gate', e.target.value as StageGate)} style={s.panelInput}>
            <option value="auto">auto — advance on its own</option>
            <option value="approval">approval — hold for a human</option>
          </select>
        </label>
        <label style={{ ...s.panelRow, fontSize: 12, marginLeft: 12 }}>
          agent provider
          <select
            value={draft.provider}
            onChange={(e) => set('provider', e.target.value as MachineDraft['provider'])}
            style={s.panelInput}
          >
            <option value="">default provider</option>
            <option value="claude">claude</option>
            <option value="cursor">cursor</option>
          </select>
        </label>
      </div>

      <label style={s.panelLabel}>
        prompt template{' '}
        <span style={s.panelHint}>
          vars: {'{{request}} {{title}} {{previous.output}} {{stages.<key>.output}}'}
        </span>
        <textarea
          value={draft.promptTemplate}
          onChange={(e) => set('promptTemplate', e.target.value)}
          placeholder={promptPlaceholder}
          style={s.panelTextarea}
          rows={4}
        />
      </label>

      <label style={s.panelLabel}>
        shell commands{' '}
        <span style={s.panelHint}>
          one per line, run in the project directory after the agent; commands only when no prompt
        </span>
        <textarea
          value={draft.commands}
          onChange={(e) => set('commands', e.target.value)}
          placeholder="pnpm test"
          style={s.panelTextarea}
          rows={2}
        />
      </label>

      <div style={s.panelRow}>
        <label style={{ ...s.panelRow, fontSize: 12 }}>
          result check
          <select
            value={draft.resultCheck}
            onChange={(e) => set('resultCheck', e.target.value as MachineDraft['resultCheck'])}
            style={s.panelInput}
          >
            <option value="">off</option>
            <option value="lenient">lenient — fail only on MACHINE_RESULT: FAIL</option>
            <option value="strict">strict — require MACHINE_RESULT: PASS</option>
          </select>
        </label>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ ...s.panelRow, fontSize: 12 }}>
          <input
            type="checkbox"
            checked={draft.monitorEnabled}
            onChange={(e) => set('monitorEnabled', e.target.checked)}
          />
          monitor loop{' '}
          <span style={s.panelHint}>— park here and re-check on a schedule instead of running once</span>
        </label>
        {draft.monitorEnabled ? (
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
              healthy checks to pass
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
      </div>

      <ToolPicker
        toolbox={toolbox}
        selectedSkills={draft.skills}
        selectedServers={draft.mcpServers}
        onToggle={toggleTool}
      />

      <VaultKeyPicker
        vault={vault}
        selected={draft.requiredEnv}
        onToggle={toggleVaultKey}
        onCreateKey={(key) => {
          onCreateVaultKey(key);
          if (!draft.requiredEnv.includes(key)) set('requiredEnv', [...draft.requiredEnv, key]);
        }}
      />
    </>
  );
}

/**
 * The machine configuration form, docked in the scene's top-left panel
 * slot. Keyed by project+machine key in the parent so the draft resets
 * when the user clicks a different machine. The key is immutable identity;
 * the display name renames freely. Removing the machine deletes it from
 * the line (results on past work items are kept).
 */
export function MachineConfigPanel({
  projectLabel,
  machine,
  templateBlurb,
  toolbox,
  vault,
  isPending,
  error,
  onSave,
  onRemove,
  onCreateVaultKey,
  onClose,
}: {
  projectLabel: string;
  machine: PipelineMachine;
  /** Description of the machine's template, when known. */
  templateBlurb?: string | undefined;
  toolbox: Toolbox;
  vault: RedactedVaultEntry[];
  isPending: boolean;
  error: unknown;
  onSave: (next: PipelineMachine) => void;
  onRemove: () => void;
  onCreateVaultKey: (key: string) => void;
  onClose: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState<MachineDraft>(() => draftFromMachine(machine));
  const [confirmRemove, setConfirmRemove] = useState(false);
  const set = <K extends keyof MachineDraft>(key: K, value: MachineDraft[K]): void =>
    setDraft((d) => ({ ...d, [key]: value }));

  return (
    <foreignObject x={28} y={90} width={470} height={640}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSave({
            key: machine.key,
            name: draft.name.trim() || machine.name,
            ...(machine.templateId !== undefined ? { templateId: machine.templateId } : {}),
            gate: draft.gate,
            ...behaviorFromDraft(draft),
          });
        }}
        style={s.panel}
      >
        <div style={s.panelTitle}>
          <span>
            {projectLabel} · {machine.name.toUpperCase()}
            {templateBlurb ? <span style={s.panelHint}> — {templateBlurb}</span> : null}
          </span>
          <button type="button" onClick={onClose} style={closeButton} aria-label="Close panel">
            ✕
          </button>
        </div>

        <label style={s.panelLabel}>
          name <span style={s.panelHint}>key: {machine.key} (fixed)</span>
          <input
            value={draft.name}
            onChange={(e) => set('name', e.target.value)}
            style={s.panelInput}
          />
        </label>

        <MachineFormFields
          draft={draft}
          set={set}
          toolbox={toolbox}
          vault={vault}
          promptPlaceholder={
            machine.templateId !== undefined
              ? "Leave blank to use the template's prompt"
              : 'This machine has no template — write its prompt here'
          }
          onCreateVaultKey={onCreateVaultKey}
        />

        <div style={s.panelRow}>
          <button type="submit" disabled={isPending} style={s.panelButton}>
            {isPending ? 'Saving…' : 'Save machine'}
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              if (confirmRemove) onRemove();
              else setConfirmRemove(true);
            }}
            style={{ ...s.panelButton, marginLeft: 'auto', borderColor: '#6a2a24', color: '#e8a49a' }}
          >
            {confirmRemove ? 'Click again to confirm' : 'Remove machine'}
          </button>
        </div>
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

/**
 * Vault-key variables: which vault keys are injected into this machine's
 * runs as env. Keys the vault doesn't know yet can be declared inline —
 * they're created unset (lighting the vault's warning lamp) so the value
 * can be filled in at the safe.
 */
export function VaultKeyPicker({
  vault,
  selected,
  onToggle,
  onCreateKey,
}: {
  vault: RedactedVaultEntry[];
  selected: string[];
  onToggle: (key: string) => void;
  onCreateKey: (key: string) => void;
}): JSX.Element {
  const [newKey, setNewKey] = useState('');
  const keyPattern = /^[A-Z][A-Z0-9_]{0,127}$/;
  const cleaned = newKey.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  const canAdd = keyPattern.test(cleaned) && !vault.some((e) => e.key === cleaned);
  const add = (): void => {
    if (!canAdd) return;
    onCreateKey(cleaned);
    setNewKey('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 11, color: '#c8a888' }}>
        variables{' '}
        <span style={s.panelHint}>
          — vault keys injected into this machine's runs as env ({selected.length} assigned)
        </span>
      </div>
      {vault.length > 0 ? (
        <div style={toolList}>
          {vault.map((entry) => (
            <label key={entry.key} style={toolCheckRow}>
              <input
                type="checkbox"
                checked={selected.includes(entry.key)}
                onChange={() => onToggle(entry.key)}
              />
              <span style={{ color: '#ead6b8', fontFamily: 'monospace' }}>{entry.key}</span>
              <span
                title={entry.valueSet ? 'value set' : 'value not set yet'}
                style={{ color: entry.valueSet ? '#5ec27a' : '#cf4040', fontSize: 9 }}
              >
                ●
              </span>
            </label>
          ))}
        </div>
      ) : (
        <div style={s.panelHint}>the vault is empty — declare a key below or use the safe</div>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          placeholder="NEW_KEY_NAME"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          style={{ ...s.panelInput, fontFamily: 'monospace', flex: 1 }}
        />
        <button type="button" disabled={!canAdd} onClick={add} style={s.panelButton}>
          declare
        </button>
      </div>
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
