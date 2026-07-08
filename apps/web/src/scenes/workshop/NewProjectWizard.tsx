import { useState } from 'react';
import type { CreateProjectBody } from '../../api.js';
import type { RedactedGitCredential, Toolbox } from '../../types.js';
import * as s from './panelStyles.js';
import { RepoEditor, emptyRepoDraft, isDraftValid, toRepoInput, type RepoDraft } from './RepoEditor.jsx';
import { ToolPicker } from './MachineConfigPanel.jsx';

type Step = 'basics' | 'repos' | 'extras';

const STEP_ORDER: readonly Step[] = ['basics', 'repos', 'extras'];

/**
 * The new-project wizard, opened by the ghost lane. Three steps over one
 * shared draft (the ToolboxPanel view-state-machine pattern): name +
 * vision (required), repos (at least one, verified), then optional
 * project-level context + tooling every machine in the lane inherits.
 */
export function NewProjectWizard({
  toolbox,
  credentials,
  projectsRoot,
  isPending,
  error,
  onCreate,
  onClose,
}: {
  toolbox: Toolbox;
  credentials: RedactedGitCredential[];
  projectsRoot: string | undefined;
  isPending: boolean;
  error: unknown;
  onCreate: (body: CreateProjectBody) => void;
  onClose: () => void;
}): JSX.Element {
  const [step, setStep] = useState<Step>('basics');
  const [name, setName] = useState('');
  const [vision, setVision] = useState('');
  const [repos, setRepos] = useState<RepoDraft[]>([emptyRepoDraft()]);
  const [context, setContext] = useState('');
  const [skills, setSkills] = useState<string[]>([]);
  const [mcpServers, setMcpServers] = useState<string[]>([]);

  const basicsDone = name.trim() !== '' && vision.trim() !== '';
  const reposDone = repos.length > 0 && repos.every(isDraftValid);
  const stepIndex = STEP_ORDER.indexOf(step);

  const rootPreview = projectsRoot ? `${projectsRoot}/${slugify(name)}` : undefined;

  const toggleTool = (field: 'skills' | 'mcpServers', id: string): void => {
    const [list, set] = field === 'skills' ? [skills, setSkills] : [mcpServers, setMcpServers];
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  const submit = (): void => {
    if (!basicsDone || !reposDone) return;
    onCreate({
      name: name.trim(),
      vision: vision.trim(),
      repos: repos.map(toRepoInput),
      ...(context.trim() !== '' ? { context } : {}),
      ...(skills.length > 0 ? { skills } : {}),
      ...(mcpServers.length > 0 ? { mcpServers } : {}),
    });
  };

  return (
    <foreignObject x={28} y={90} width={470} height={620}>
      <div style={s.panel}>
        <div style={s.panelTitle}>
          <span>
            New project{' '}
            <span style={s.panelHint}>
              step {stepIndex + 1}/3 — {step === 'basics' ? 'name & vision' : step === 'repos' ? 'repositories' : 'context & tooling'}
            </span>
          </span>
          <button type="button" onClick={onClose} style={s.panelButton}>
            ✕
          </button>
        </div>

        {step === 'basics' ? (
          <>
            <label style={s.panelLabel}>
              name
              <input
                placeholder="my-product"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={s.panelInput}
              />
            </label>
            <label style={s.panelLabel}>
              vision statement
              <textarea
                placeholder="The high-level guiding context: what is this project trying to accomplish?"
                value={vision}
                onChange={(e) => setVision(e.target.value)}
                style={{ ...s.panelTextarea, minHeight: 110 }}
              />
            </label>
            <div style={s.panelHint}>
              the vision is injected into every machine's prompt on this line
            </div>
            {rootPreview && name.trim() !== '' ? (
              <div style={s.panelHint}>project root: {rootPreview}</div>
            ) : null}
          </>
        ) : null}

        {step === 'repos' ? (
          <>
            <div style={s.panelHint}>
              a project needs at least one git repo — each becomes a directory under the project
              root, and agents run at the root so they see all of them
            </div>
            {repos.map((draft, i) => (
              <RepoEditor
                key={draft.key}
                draft={draft}
                credentials={credentials}
                onChange={(next) => setRepos(repos.map((r, j) => (j === i ? next : r)))}
                {...(repos.length > 1
                  ? { onRemove: () => setRepos(repos.filter((_, j) => j !== i)) }
                  : {})}
              />
            ))}
            <button
              type="button"
              onClick={() => setRepos([...repos, emptyRepoDraft()])}
              style={s.panelButton}
            >
              + another repo
            </button>
          </>
        ) : null}

        {step === 'extras' ? (
          <>
            <label style={s.panelLabel}>
              project context (optional)
              <textarea
                placeholder="Markdown injected into every machine's prompt — conventions, domain notes, links…"
                value={context}
                onChange={(e) => setContext(e.target.value)}
                style={{ ...s.panelTextarea, minHeight: 90 }}
              />
            </label>
            <ToolPicker
              toolbox={toolbox}
              selectedSkills={skills}
              selectedServers={mcpServers}
              onToggle={toggleTool}
            />
            <div style={s.panelHint}>
              project tools are shared by every machine on the line, on top of each machine's own
              assignments — you can skip this and add them later
            </div>
          </>
        ) : null}

        <div style={{ ...s.panelRow, marginTop: 'auto' }}>
          {stepIndex > 0 ? (
            <button
              type="button"
              onClick={() => setStep(STEP_ORDER[stepIndex - 1]!)}
              style={s.panelButton}
            >
              Back
            </button>
          ) : null}
          {step !== 'extras' ? (
            <button
              type="button"
              onClick={() => setStep(STEP_ORDER[stepIndex + 1]!)}
              disabled={step === 'basics' ? !basicsDone : !reposDone}
              style={s.panelButton}
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={isPending || !basicsDone || !reposDone}
              style={s.panelButton}
            >
              {isPending ? 'Creating…' : 'Create project'}
            </button>
          )}
        </div>
        {error ? <div style={s.panelError}>{String(error)}</div> : null}
      </div>
    </foreignObject>
  );
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'project'
  );
}
