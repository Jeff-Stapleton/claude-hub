import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.js';
import type { Channel } from '../types.js';

/**
 * Channels tab doubles as the "Discord settings" page in v1 — Discord is
 * the only supported channel. The bot token input is write-only: once
 * saved, the server redacts it to `botTokenSet: true` and we just show a
 * masked placeholder with a "Replace" action.
 */
export function ChannelsTab({ channels }: { channels: Channel[] }): JSX.Element {
  const discord = channels.find((c) => c.type === 'discord');
  const qc = useQueryClient();

  const [token, setToken] = useState('');
  const [editingToken, setEditingToken] = useState(!discord?.botTokenSet);
  const [allowlistText, setAllowlistText] = useState(
    discord?.allowedUserIds.join('\n') ?? '',
  );

  const save = useMutation({
    mutationFn: api.saveDiscord,
    onSuccess: () => {
      setToken('');
      setEditingToken(false);
      void qc.invalidateQueries({ queryKey: ['state'] });
    },
  });

  const disable = useMutation({
    mutationFn: () => api.saveDiscord({ botToken: '' }),
    onSuccess: () => {
      setToken('');
      setEditingToken(true);
      setAllowlistText('');
      void qc.invalidateQueries({ queryKey: ['state'] });
    },
  });

  return (
    <section>
      <h2>Channels</h2>
      <h3 style={{ marginTop: 16 }}>Discord</h3>

      <div style={statusRow}>
        <StatusPill status={discord?.status} />
        {discord?.lastError ? (
          <span style={{ color: 'crimson', marginLeft: 12, fontSize: 12 }}>
            {discord.lastError}
          </span>
        ) : null}
      </div>

      <p style={{ opacity: 0.7, maxWidth: 640 }}>
        Paste a Discord bot token and the user IDs allowed to DM the bot. The bot must have
        the <code>MessageContent</code> and <code>DirectMessages</code> intents enabled in the
        Discord developer portal.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const ids = allowlistText
            .split(/[\s,]+/)
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          save.mutate({
            ...(editingToken && token ? { botToken: token } : {}),
            allowedUserIds: ids,
          });
        }}
        style={{ display: 'grid', gap: 8, maxWidth: 640 }}
      >
        <label>
          <div style={labelDiv}>Bot token</div>
          {editingToken ? (
            <input
              type="password"
              placeholder="Paste bot token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              style={{ width: '100%' }}
            />
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                value="••••••••••••••••••••"
                readOnly
                style={{ flex: 1, fontFamily: 'monospace' }}
              />
              <button type="button" onClick={() => setEditingToken(true)}>
                Replace
              </button>
            </div>
          )}
        </label>

        <label>
          <div style={labelDiv}>Allowed Discord user IDs (one per line)</div>
          <textarea
            rows={4}
            value={allowlistText}
            onChange={(e) => setAllowlistText(e.target.value)}
            style={{ width: '100%', fontFamily: 'monospace' }}
            placeholder="123456789012345678"
          />
        </label>

        <div>
          <button
            type="submit"
            disabled={save.isPending || (editingToken && !token.trim() && !discord?.botTokenSet)}
          >
            Save
          </button>{' '}
          {discord?.botTokenSet ? (
            <button
              type="button"
              onClick={() => disable.mutate()}
              disabled={disable.isPending}
              style={{ color: 'crimson' }}
            >
              Disable Discord
            </button>
          ) : null}
          {save.error ? (
            <span style={{ color: 'crimson', marginLeft: 8 }}>{String(save.error)}</span>
          ) : null}
        </div>
      </form>
    </section>
  );
}

function StatusPill({
  status,
}: {
  status: 'connected' | 'disconnected' | 'error' | undefined;
}): JSX.Element {
  const color =
    status === 'connected' ? '#3b6' : status === 'error' ? 'crimson' : '#888';
  const label = status ?? 'disconnected';
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 12,
        background: color,
        color: '#fff',
        fontSize: 12,
      }}
    >
      {label}
    </span>
  );
}

const statusRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  marginBottom: 12,
};
const labelDiv: React.CSSProperties = {
  fontWeight: 600,
  marginBottom: 4,
  fontSize: 13,
};
