import { useState } from 'react';
import type { MachineTemplateBody } from '../../api.js';
import type {
  MachineTemplate,
  PipelineMachine,
  RedactedVaultEntry,
  Toolbox,
} from '../../types.js';
import { machineKeyFor } from './layout.js';
import {
  MachineFormFields,
  behaviorFromDraft,
  type MachineDraft,
} from './MachineConfigPanel.jsx';
import * as s from './panelStyles.js';

/**
 * The add-machine panel, opened by clicking a ghost machine in a hovered
 * belt gap. Two halves: a template gallery (built-ins + the user's saved
 * custom templates + "start blank") that prefills the form, and the
 * machine form itself. Machines stamped from a template keep a templateId
 * reference so a blank prompt falls back to the template's; "save as
 * reusable template" publishes the drafted machine for other lines.
 */
export function AddMachinePanel({
  projectLabel,
  insertIndex,
  machineCount,
  existingKeys,
  templates,
  toolbox,
  vault,
  isPending,
  error,
  onInstall,
  onDeleteTemplate,
  onCreateVaultKey,
  onClose,
}: {
  projectLabel: string;
  /** Where on the line the new machine lands (0 = first). */
  insertIndex: number;
  machineCount: number;
  existingKeys: string[];
  templates: MachineTemplate[];
  toolbox: Toolbox;
  vault: RedactedVaultEntry[];
  isPending: boolean;
  error: unknown;
  onInstall: (machine: PipelineMachine, saveAsTemplate: MachineTemplateBody | null) => void;
  onDeleteTemplate: (id: string) => void;
  onCreateVaultKey: (key: string) => void;
  onClose: () => void;
}): JSX.Element {
  // null = gallery view; 'blank' = custom machine; otherwise a template id.
  const [picked, setPicked] = useState<string | null>(null);
  const [draft, setDraft] = useState<MachineDraft>(blankDraft);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const set = <K extends keyof MachineDraft>(key: K, value: MachineDraft[K]): void =>
    setDraft((d) => ({ ...d, [key]: value }));

  const template = picked !== null && picked !== 'blank' ? templates.find((t) => t.id === picked) : undefined;
  const key = machineKeyFor(draft.name || template?.slug || 'machine', existingKeys);
  const position = `position ${insertIndex + 1} of ${machineCount + 1}`;

  const pick = (t: MachineTemplate | 'blank'): void => {
    setPicked(t === 'blank' ? 'blank' : t.id);
    setDraft(t === 'blank' ? blankDraft() : draftFromTemplate(t));
    setSaveAsTemplate(false);
  };

  const submit = (): void => {
    const machine: PipelineMachine = {
      key,
      name: draft.name.trim() || template?.name || 'Machine',
      ...(template !== undefined ? { templateId: template.id } : {}),
      gate: draft.gate,
      ...behaviorFromDraft(draft),
    };
    let templateBody: MachineTemplateBody | null = null;
    if (saveAsTemplate && picked === 'blank') {
      const behavior = behaviorFromDraft(draft);
      templateBody = {
        slug: machineKeyFor(machine.name, []),
        name: machine.name,
        description: draft.promptTemplate.trim().split('\n', 1)[0]?.slice(0, 120) || machine.name,
        defaultGate: draft.gate,
        ...behavior,
      };
    }
    onInstall(machine, templateBody);
  };

  return (
    <foreignObject x={28} y={90} width={470} height={660}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (picked !== null) submit();
        }}
        style={s.panel}
      >
        <div style={s.panelTitle}>
          <span>
            {projectLabel} <span style={s.panelHint}>— insert a machine at {position}</span>
          </span>
          <button type="button" onClick={onClose} style={closeButton} aria-label="Close panel">
            ✕
          </button>
        </div>

        {picked === null ? (
          <>
            <div style={s.panelHint}>
              Pick a template to stamp a machine from, or start blank and define your own context,
              tooling, and variables.
            </div>
            <div style={gallery}>
              {templates.map((t) => (
                <div key={t.id} style={templateCard}>
                  <button type="button" onClick={() => pick(t)} style={templatePickButton}>
                    <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#f0d8b8' }}>
                      {t.name.toUpperCase()}
                      {t.source === 'custom' ? <span style={s.panelHint}> (yours)</span> : null}
                      {t.defaultGate === 'approval' ? (
                        <span style={s.panelHint}> (gated on approval)</span>
                      ) : null}
                    </span>
                    <span style={s.panelHint}>{t.description}</span>
                  </button>
                  {t.source === 'custom' ? (
                    <button
                      type="button"
                      onClick={() => onDeleteTemplate(t.id)}
                      title="Delete this saved template (installed machines keep working)"
                      style={closeButton}
                      aria-label={`Delete template ${t.name}`}
                    >
                      🗑
                    </button>
                  ) : null}
                </div>
              ))}
              <div style={templateCard}>
                <button type="button" onClick={() => pick('blank')} style={templatePickButton}>
                  <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#f0d8b8' }}>
                    CUSTOM
                  </span>
                  <span style={s.panelHint}>start blank — your context, tooling, and variables</span>
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setPicked(null)} style={backButton}>
              ← templates
            </button>
            <label style={s.panelLabel}>
              name <span style={s.panelHint}>key: {key}</span>
              <input
                value={draft.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder={template?.name ?? 'e.g. Security scan'}
                style={s.panelInput}
                autoFocus
              />
            </label>

            <MachineFormFields
              draft={draft}
              set={set}
              toolbox={toolbox}
              vault={vault}
              promptPlaceholder={
                template !== undefined
                  ? "Leave blank to use the template's prompt"
                  : 'You are the … station. Do … with {{request}}.'
              }
              onCreateVaultKey={onCreateVaultKey}
            />

            {picked === 'blank' ? (
              <label style={{ ...s.panelRow, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={saveAsTemplate}
                  onChange={(e) => setSaveAsTemplate(e.target.checked)}
                />
                save as reusable template{' '}
                <span style={s.panelHint}>— reuse this machine on any line</span>
              </label>
            ) : null}

            <button
              type="submit"
              disabled={isPending || (picked === 'blank' && draft.name.trim() === '')}
              style={s.panelButton}
            >
              {isPending ? 'Installing…' : `Install machine (${position})`}
            </button>
          </>
        )}
        {error ? <div style={s.panelError}>{String(error)}</div> : null}
      </form>
    </foreignObject>
  );
}

function blankDraft(): MachineDraft {
  return {
    name: '',
    gate: 'auto',
    provider: '',
    promptTemplate: '',
    commands: '',
    resultCheck: '',
    monitorEnabled: false,
    intervalMinutes: '',
    maxChecks: '',
    skills: [],
    mcpServers: [],
    requiredEnv: [],
  };
}

/**
 * Prefill from a template: capabilities are materialized onto the instance
 * (commands, resultCheck, monitor, tools, variables); the prompt stays
 * blank so the instance falls back to the template's prompt and picks up
 * template edits.
 */
function draftFromTemplate(t: MachineTemplate): MachineDraft {
  return {
    name: t.name,
    gate: t.defaultGate,
    provider: t.provider ?? '',
    promptTemplate: '',
    commands: (t.commands ?? []).join('\n'),
    resultCheck: t.resultCheck ?? '',
    monitorEnabled: t.monitor !== undefined,
    intervalMinutes:
      t.monitor?.intervalMinutes !== undefined ? String(t.monitor.intervalMinutes) : '',
    maxChecks: t.monitor?.maxChecks !== undefined ? String(t.monitor.maxChecks) : '',
    skills: t.skills ?? [],
    mcpServers: t.mcpServers ?? [],
    requiredEnv: t.requiredEnv ?? [],
  };
}

const gallery: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  maxHeight: 460,
  overflow: 'auto',
};

const templateCard: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  border: '1px solid #2a1f17',
  borderRadius: 6,
  background: 'rgba(16, 11, 8, 0.6)',
};

const templatePickButton: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 2,
  flex: 1,
  minWidth: 0,
  padding: '7px 8px',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  textAlign: 'left',
};

const backButton: React.CSSProperties = {
  alignSelf: 'flex-start',
  background: 'transparent',
  border: 'none',
  color: '#c8a888',
  cursor: 'pointer',
  fontSize: 11,
  padding: 0,
};

const closeButton: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#c8a888',
  cursor: 'pointer',
  fontSize: 13,
};
