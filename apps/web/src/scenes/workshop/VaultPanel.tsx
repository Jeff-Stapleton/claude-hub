import { useState } from 'react';
import type { RedactedVaultEntry } from '../../types.js';
import * as s from './panelStyles.js';

export type VaultAction =
  | { type: 'create-key'; key: string; value?: string }
  | { type: 'set-value'; key: string; value: string }
  | { type: 'clear-value'; key: string }
  | { type: 'delete-key'; key: string };

/** Client-side mirror of the server's VAULT_KEY_PATTERN. */
const KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;

/**
 * The vault, docked in the scene's panel slot: the hub's key-value config
 * (tokens, API keys) that skills and MCP servers draw from at run time.
 * Values are write-only — the server never sends one back, so rows only
 * show set/unset. Keys declared by a tool's requiredEnv are created
 * automatically and sort to the top while unset.
 */
export function VaultPanel({
  vault,
  isPending,
  error,
  onAction,
  onClose,
}: {
  vault: RedactedVaultEntry[];
  isPending: boolean;
  error: unknown;
  onAction: (action: VaultAction) => void;
  onClose: () => void;
}): JSX.Element {
  // Unset keys (the ones the lamp is complaining about) sort to the top.
  const entries = [...vault].sort((a, b) =>
    a.valueSet === b.valueSet ? a.key.localeCompare(b.key) : a.valueSet ? 1 : -1,
  );
  const unsetCount = entries.filter((e) => !e.valueSet).length;

  return (
    <foreignObject x={28} y={90} width={470} height={540}>
      <div style={s.panel}>
        <div style={s.panelTitle}>
          <span>
            Vault <span style={s.panelHint}>— keys tools need at run time; values are write-only</span>
          </span>
          <button type="button" onClick={onClose} style={closeButton} aria-label="Close panel">
            ✕
          </button>
        </div>

        {unsetCount > 0 ? (
          <div style={warningBanner}>
            {unsetCount} key{unsetCount === 1 ? '' : 's'} not configured — paste values below to
            turn the lamp off
          </div>
        ) : null}

        {entries.length === 0 ? (
          <div style={s.panelHint}>
            No keys yet. Tools declare the keys they need when added to the tool box, or add one
            manually below.
          </div>
        ) : null}

        {entries.map((entry) => (
          <VaultRow key={entry.key} entry={entry} isPending={isPending} onAction={onAction} />
        ))}

        <AddKeyForm isPending={isPending} existing={vault.map((e) => e.key)} onAction={onAction} />

        {error ? <div style={s.panelError}>{String(error)}</div> : null}
      </div>
    </foreignObject>
  );
}

function VaultRow({
  entry,
  isPending,
  onAction,
}: {
  entry: RedactedVaultEntry;
  isPending: boolean;
  onAction: (action: VaultAction) => void;
}): JSX.Element {
  const [value, setValue] = useState('');
  const requiredBy = [...entry.requiredBy.skills, ...entry.requiredBy.mcpServers];

  const set = (): void => {
    if (value.trim() === '') return;
    onAction({ type: 'set-value', key: entry.key, value });
    setValue('');
  };

  return (
    <div style={rowStyle}>
      <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={rowName}>
          <span
            style={{
              ...statusDot,
              background: entry.valueSet ? '#5ec27a' : '#e8b04a',
              ...(entry.valueSet
                ? {}
                : { animation: 'workshop-led 1.1s ease-in-out infinite' }),
            }}
          />
          <span style={{ fontFamily: 'monospace' }}>{entry.key}</span>
          {!entry.valueSet ? <span style={unsetBadge}>not set</span> : null}
          {requiredBy.map((name) => (
            <span key={name} style={requiredChip} title={`required by ${name}`}>
              {name}
            </span>
          ))}
        </div>
        <div style={s.panelRow}>
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                set();
              }
            }}
            placeholder={entry.valueSet ? 'paste to replace…' : 'paste value…'}
            autoComplete="off"
            style={{ ...s.panelInput, flex: 1 }}
          />
          <button
            type="button"
            disabled={isPending || value.trim() === ''}
            onClick={set}
            style={rowButton}
          >
            set
          </button>
          {entry.valueSet ? (
            <button
              type="button"
              disabled={isPending}
              onClick={() => onAction({ type: 'clear-value', key: entry.key })}
              style={rowButton}
            >
              clear
            </button>
          ) : null}
          <button
            type="button"
            disabled={isPending || requiredBy.length > 0}
            title={
              requiredBy.length > 0
                ? `required by ${requiredBy.join(', ')} — remove it from those tools first`
                : undefined
            }
            onClick={() => onAction({ type: 'delete-key', key: entry.key })}
            style={requiredBy.length > 0 ? rowButtonDisabled : rowDangerButton}
          >
            delete
          </button>
        </div>
      </div>
    </div>
  );
}

function AddKeyForm({
  isPending,
  existing,
  onAction,
}: {
  isPending: boolean;
  existing: string[];
  onAction: (action: VaultAction) => void;
}): JSX.Element {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const trimmed = key.trim();
  const valid = KEY_PATTERN.test(trimmed) && !existing.includes(trimmed);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onAction({
          type: 'create-key',
          key: trimmed,
          ...(value !== '' ? { value } : {}),
        });
        setKey('');
        setValue('');
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}
    >
      <div style={sectionHeader}>add key</div>
      <div style={s.panelRow}>
        <input
          value={key}
          onChange={(e) => setKey(e.target.value.toUpperCase())}
          placeholder="GITHUB_TOKEN"
          style={{ ...s.panelInput, flex: 1, fontFamily: 'monospace' }}
        />
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="value (optional)"
          autoComplete="off"
          style={{ ...s.panelInput, flex: 1 }}
        />
        <button type="submit" disabled={isPending || !valid} style={s.panelButton}>
          add
        </button>
      </div>
      {trimmed !== '' && !KEY_PATTERN.test(trimmed) ? (
        <div style={s.panelHint}>keys are SCREAMING_SNAKE_CASE, starting with a letter</div>
      ) : null}
      {existing.includes(trimmed) ? (
        <div style={s.panelHint}>that key already exists</div>
      ) : null}
    </form>
  );
}

const closeButton: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#c8a888',
  cursor: 'pointer',
  fontSize: 13,
};

const warningBanner: React.CSSProperties = {
  fontSize: 11,
  color: '#e8b04a',
  border: '1px solid rgba(232, 176, 74, 0.4)',
  borderRadius: 6,
  padding: '5px 8px',
  background: 'rgba(232, 176, 74, 0.08)',
};

const sectionHeader: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#f0d8b8',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'flex-start',
  padding: '6px 8px',
  border: '1px solid #2a1f17',
  borderRadius: 6,
  background: '#100b08',
};

const rowName: React.CSSProperties = {
  fontSize: 12,
  color: '#ead6b8',
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  flexWrap: 'wrap',
};

const statusDot: React.CSSProperties = {
  display: 'inline-block',
  width: 8,
  height: 8,
  borderRadius: '50%',
  flexShrink: 0,
};

const unsetBadge: React.CSSProperties = {
  fontSize: 9,
  padding: '1px 6px',
  borderRadius: 8,
  border: '1px solid rgba(232, 176, 74, 0.5)',
  color: '#e8b04a',
};

const requiredChip: React.CSSProperties = {
  fontSize: 9,
  padding: '1px 6px',
  borderRadius: 8,
  border: '1px solid #4a3624',
  color: '#c8a888',
};

const rowButton: React.CSSProperties = {
  fontSize: 10,
  padding: '1px 6px',
  borderRadius: 8,
  border: '1px solid #4a3624',
  color: '#c8a888',
  background: 'transparent',
  cursor: 'pointer',
};

const rowDangerButton: React.CSSProperties = {
  ...rowButton,
  border: '1px solid #6a2a2a',
  color: '#f2c0b8',
};

const rowButtonDisabled: React.CSSProperties = {
  ...rowButton,
  opacity: 0.4,
  cursor: 'not-allowed',
};
