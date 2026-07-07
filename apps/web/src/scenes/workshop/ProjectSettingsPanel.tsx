import { useState } from 'react';
import type { RepoInput, UpdateProjectBody } from '../../api.js';
import type { Project, ProjectRepo, RedactedGitCredential, Toolbox } from '../../types.js';
import * as s from './panelStyles.js';
import { RepoEditor, emptyRepoDraft, isDraftValid, toRepoInput, type RepoDraft } from './RepoEditor.jsx';
import { ToolPicker } from './StationConfigPanel.jsx';

/**
 * Post-creation project settings, opened from the head machine's gear
 * button: edit name / vision / context / project-level tooling, and manage
 * repos (live provisioning status, retry failed jobs, add or remove
 * entries). Keyed by project id in the parent so drafts reset per project.
 */
export function ProjectSettingsPanel({
  project,
  toolbox,
  credentials,
  isPending,
  error,
  onSave,
  onAddRepo,
  onRetryRepo,
  onDeleteRepo,
  onClose,
}: {
  project: Project;
  toolbox: Toolbox;
  credentials: RedactedGitCredential[];
  isPending: boolean;
  error: unknown;
  onSave: (body: UpdateProjectBody) => void;
  onAddRepo: (body: RepoInput) => void;
  onRetryRepo: (repoId: string) => void;
  onDeleteRepo: (repoId: string) => void;
  onClose: () => void;
}): JSX.Element {
  const [name, setName] = useState(project.name);
  const [vision, setVision] = useState(project.vision);
  const [context, setContext] = useState(project.context ?? '');
  const [skills, setSkills] = useState<string[]>(project.skills ?? []);
  const [mcpServers, setMcpServers] = useState<string[]>(project.mcpServers ?? []);
  const [newRepo, setNewRepo] = useState<RepoDraft | null>(null);

  const toggleTool = (field: 'skills' | 'mcpServers', id: string): void => {
    const [list, set] = field === 'skills' ? [skills, setSkills] : [mcpServers, setMcpServers];
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  return (
    <foreignObject x={28} y={90} width={470} height={640}>
      <div style={s.panel}>
        <div style={s.panelTitle}>
          <span>
            {project.name} <span style={s.panelHint}>project settings</span>
          </span>
          <button type="button" onClick={onClose} style={s.panelButton}>
            ✕
          </button>
        </div>

        <label style={s.panelLabel}>
          name
          <input value={name} onChange={(e) => setName(e.target.value)} style={s.panelInput} />
        </label>
        <label style={s.panelLabel}>
          vision statement
          <textarea
            value={vision}
            onChange={(e) => setVision(e.target.value)}
            style={s.panelTextarea}
          />
        </label>
        <label style={s.panelLabel}>
          project context
          <textarea
            placeholder="Markdown injected into every machine's prompt on this line"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            style={s.panelTextarea}
          />
        </label>
        <ToolPicker
          toolbox={toolbox}
          selectedSkills={skills}
          selectedServers={mcpServers}
          onToggle={toggleTool}
        />
        <button
          type="button"
          onClick={() => onSave({ name: name.trim(), vision, context, skills, mcpServers })}
          disabled={isPending || !name.trim() || !vision.trim()}
          style={s.panelButton}
        >
          {isPending ? 'Saving…' : 'Save changes'}
        </button>

        <div style={{ ...s.panelTitle, marginTop: 6 }}>
          <span style={{ fontSize: 12 }}>repositories</span>
        </div>
        {project.repos.map((repo) => (
          <RepoRow
            key={repo.id}
            repo={repo}
            canRemove={project.repos.length > 1}
            onRetry={() => onRetryRepo(repo.id)}
            onDelete={() => onDeleteRepo(repo.id)}
          />
        ))}
        {newRepo ? (
          <>
            <RepoEditor
              draft={newRepo}
              credentials={credentials}
              onChange={setNewRepo}
              onRemove={() => setNewRepo(null)}
            />
            <button
              type="button"
              onClick={() => {
                onAddRepo(toRepoInput(newRepo));
                setNewRepo(null);
              }}
              disabled={isPending || !isDraftValid(newRepo)}
              style={s.panelButton}
            >
              Add repo
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setNewRepo(emptyRepoDraft())} style={s.panelButton}>
            + add repo
          </button>
        )}
        {error ? <div style={s.panelError}>{String(error)}</div> : null}
      </div>
    </foreignObject>
  );
}

function RepoRow({
  repo,
  canRemove,
  onRetry,
  onDelete,
}: {
  repo: ProjectRepo;
  canRemove: boolean;
  onRetry: () => void;
  onDelete: () => void;
}): JSX.Element {
  return (
    <div style={repoRow}>
      <span style={{ color: statusColor(repo.status), fontSize: 14, lineHeight: 1 }}>●</span>
      <span style={{ color: '#ead6b8', fontFamily: 'monospace', fontSize: 11 }}>{repo.name}</span>
      <span style={s.panelHint}>
        {repo.origin} · {repo.status}
      </span>
      <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
        {repo.status === 'failed' ? (
          <button type="button" onClick={onRetry} style={{ ...s.panelButton, padding: '2px 8px' }}>
            retry
          </button>
        ) : null}
        {canRemove ? (
          <button
            type="button"
            onClick={onDelete}
            title="Removes the entry only; the directory on disk is untouched"
            style={{ ...s.panelDangerButton, padding: '2px 8px' }}
          >
            remove
          </button>
        ) : null}
      </span>
      {repo.error ? <div style={{ ...s.panelError, width: '100%' }}>{repo.error}</div> : null}
    </div>
  );
}

function statusColor(status: ProjectRepo['status']): string {
  if (status === 'ready') return '#5ec27a';
  if (status === 'failed') return '#cf4040';
  return '#e8b04a';
}

const repoRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
  padding: '5px 8px',
  border: '1px solid #2a1f17',
  borderRadius: 5,
  background: 'rgba(16, 11, 8, 0.5)',
};
