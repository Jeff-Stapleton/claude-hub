import { useState } from 'react';
import { api, type RepoInput } from '../../api.js';
import type { RedactedGitCredential } from '../../types.js';
import * as s from './panelStyles.js';

/**
 * One repo entry being drafted in the new-project wizard or the project
 * settings panel: a three-way mode toggle (existing local directory /
 * clone a remote / create a brand-new repo) with per-mode fields and an
 * async Verify step for the modes that can be checked up front.
 */
export interface RepoDraft {
  key: string;
  mode: RepoInput['mode'];
  /** local: absolute directory path. */
  path: string;
  /** clone: remote URL. */
  url: string;
  /** clone (optional override) / create (required): dir-safe repo name. */
  name: string;
  credentialId: string;
  isPrivate: boolean;
  /** Async check result; reset whenever a field changes. */
  verified: 'unchecked' | 'checking' | 'ok' | 'failed';
  verifyError?: string;
}

let repoDraftSeq = 0;

export function emptyRepoDraft(): RepoDraft {
  return {
    key: `repo-${++repoDraftSeq}`,
    mode: 'local',
    path: '',
    url: '',
    name: '',
    credentialId: '',
    isPrivate: true,
    verified: 'unchecked',
  };
}

const REPO_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Sync completeness: all required fields for the draft's mode are filled. */
export function isDraftComplete(draft: RepoDraft): boolean {
  if (draft.mode === 'local') return draft.path.startsWith('/');
  if (draft.mode === 'clone') {
    return draft.url.trim() !== '' && (draft.name === '' || REPO_NAME_PATTERN.test(draft.name));
  }
  return REPO_NAME_PATTERN.test(draft.name) && draft.credentialId !== '';
}

/** Full validity: complete, and verified for the async-checkable modes. */
export function isDraftValid(draft: RepoDraft): boolean {
  if (!isDraftComplete(draft)) return false;
  if (draft.mode === 'create') return true; // created remotely; nothing to probe yet
  return draft.verified === 'ok';
}

export function toRepoInput(draft: RepoDraft): RepoInput {
  if (draft.mode === 'local') return { mode: 'local', path: draft.path.trim() };
  if (draft.mode === 'clone') {
    return {
      mode: 'clone',
      url: draft.url.trim(),
      ...(draft.name !== '' ? { name: draft.name } : {}),
      ...(draft.credentialId !== '' ? { credentialId: draft.credentialId } : {}),
    };
  }
  return {
    mode: 'create',
    name: draft.name,
    credentialId: draft.credentialId,
    private: draft.isPrivate,
  };
}

export function RepoEditor({
  draft,
  credentials,
  onChange,
  onRemove,
}: {
  draft: RepoDraft;
  credentials: RedactedGitCredential[];
  onChange: (next: RepoDraft) => void;
  onRemove?: () => void;
}): JSX.Element {
  // Any field edit invalidates a previous verification result.
  const patch = (fields: Partial<RepoDraft>): void =>
    onChange({ ...draft, ...fields, verified: 'unchecked' });

  const verify = async (): Promise<void> => {
    onChange({ ...draft, verified: 'checking' });
    try {
      if (draft.mode === 'local') {
        const info = await api.inspectPath(draft.path.trim());
        if (!info.exists) throw new Error('path does not exist');
        if (!info.isDirectory) throw new Error('path is not a directory');
        onChange({ ...draft, verified: 'ok' });
      } else {
        const res = await api.checkRemote(
          draft.url.trim(),
          draft.credentialId !== '' ? draft.credentialId : undefined,
        );
        if (!res.ok) throw new Error(res.error ?? 'remote is not reachable');
        onChange({ ...draft, verified: 'ok' });
      }
    } catch (err) {
      onChange({
        ...draft,
        verified: 'failed',
        verifyError: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div style={repoCard}>
      <div style={s.panelRow}>
        {(['local', 'clone', 'create'] as const).map((mode) => (
          <label key={mode} style={{ fontSize: 11, color: '#c8a888', display: 'flex', gap: 4 }}>
            <input
              type="radio"
              checked={draft.mode === mode}
              onChange={() => patch({ mode })}
            />
            {mode === 'local' ? 'existing dir' : mode === 'clone' ? 'clone remote' : 'create new'}
          </label>
        ))}
        {onRemove ? (
          <button type="button" onClick={onRemove} style={{ ...s.panelDangerButton, marginLeft: 'auto', padding: '2px 8px' }}>
            remove
          </button>
        ) : null}
      </div>

      {draft.mode === 'local' ? (
        <input
          placeholder="/absolute/path/to/repo"
          value={draft.path}
          onChange={(e) => patch({ path: e.target.value })}
          style={s.panelInput}
        />
      ) : null}

      {draft.mode === 'clone' ? (
        <>
          <input
            placeholder="https://github.com/org/repo.git"
            value={draft.url}
            onChange={(e) => patch({ url: e.target.value })}
            style={s.panelInput}
          />
          <div style={s.panelRow}>
            <input
              placeholder="dir name (optional)"
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              style={{ ...s.panelInput, flex: 1 }}
            />
            <CredentialSelect
              credentials={credentials}
              value={draft.credentialId}
              optional
              onChange={(credentialId) => patch({ credentialId })}
            />
          </div>
        </>
      ) : null}

      {draft.mode === 'create' ? (
        <>
          <div style={s.panelRow}>
            <input
              placeholder="repo-name"
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              style={{ ...s.panelInput, flex: 1 }}
            />
            <label style={{ fontSize: 11, color: '#c8a888', display: 'flex', gap: 4 }}>
              <input
                type="checkbox"
                checked={draft.isPrivate}
                onChange={(e) => patch({ isPrivate: e.target.checked })}
              />
              private
            </label>
          </div>
          <CredentialSelect
            credentials={credentials}
            value={draft.credentialId}
            onChange={(credentialId) => patch({ credentialId })}
          />
          <div style={s.panelHint}>creates the repo on GitHub and pushes an initial commit</div>
        </>
      ) : null}

      {draft.mode !== 'create' ? (
        <div style={s.panelRow}>
          <button
            type="button"
            onClick={() => void verify()}
            disabled={!isDraftComplete(draft) || draft.verified === 'checking'}
            style={s.panelButton}
          >
            {draft.verified === 'checking' ? 'Checking…' : 'Verify'}
          </button>
          {draft.verified === 'ok' ? (
            <span style={{ fontSize: 11, color: '#5ec27a' }}>looks good</span>
          ) : null}
          {draft.verified === 'failed' ? (
            <span style={s.panelError}>{draft.verifyError}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Credential dropdown plus an inline "paste token" mini-form so a wizard
 * run never has to leave the panel to register a PAT.
 */
export function CredentialSelect({
  credentials,
  value,
  optional,
  onChange,
}: {
  credentials: RedactedGitCredential[];
  value: string;
  optional?: boolean;
  onChange: (credentialId: string) => void;
}): JSX.Element {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    setPending(true);
    setError(null);
    try {
      const cred = await api.createGitCredential({ name: name.trim(), token: token.trim() });
      onChange(cred.id);
      setAdding(false);
      setName('');
      setToken('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  if (adding) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
        <div style={s.panelRow}>
          <input
            placeholder="label (e.g. github-personal)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ ...s.panelInput, flex: 1 }}
          />
          <input
            placeholder="GitHub token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            style={{ ...s.panelInput, flex: 1 }}
          />
          <button
            type="button"
            onClick={() => void save()}
            disabled={pending || !name.trim() || !token.trim()}
            style={s.panelButton}
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={() => setAdding(false)} style={s.panelButton}>
            Cancel
          </button>
        </div>
        {error ? <div style={s.panelError}>{error}</div> : null}
      </div>
    );
  }

  return (
    <div style={s.panelRow}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...s.panelInput, flex: 1 }}
      >
        <option value="">{optional ? 'no credential (public)' : 'select credential…'}</option>
        {credentials.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <button type="button" onClick={() => setAdding(true)} style={s.panelButton}>
        + token
      </button>
    </div>
  );
}

const repoCard: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: 8,
  border: '1px solid #3a2a1c',
  borderRadius: 6,
  background: 'rgba(16, 11, 8, 0.5)',
};
