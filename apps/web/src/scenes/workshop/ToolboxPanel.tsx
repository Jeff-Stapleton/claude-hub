import { useState } from 'react';
import type { McpServerBody, SkillBody } from '../../api.js';
import type { RedactedVaultEntry, Toolbox, ToolboxMcpServer, ToolboxSkill } from '../../types.js';
import * as s from './panelStyles.js';

export type ToolboxAction =
  | { type: 'create-skill'; body: SkillBody }
  | { type: 'update-skill'; id: string; body: SkillBody }
  | { type: 'delete-skill'; id: string }
  | { type: 'create-server'; body: McpServerBody }
  | { type: 'update-server'; id: string; body: McpServerBody }
  | { type: 'delete-server'; id: string };

type View =
  | { mode: 'list' }
  | { mode: 'skill-form'; editing?: ToolboxSkill; initial: SkillDraft }
  | { mode: 'server-form'; editing?: ToolboxMcpServer; initial: ServerDraft };

interface SkillDraft {
  name: string;
  description: string;
  tags: string;
  requiredEnv: string;
  body: string;
}

interface ServerDraft {
  name: string;
  description: string;
  tags: string;
  requiredEnv: string;
  transportType: 'stdio' | 'http';
  command: string;
  args: string;
  env: string;
  url: string;
  headers: string;
}

const BLANK_SKILL: SkillDraft = { name: '', description: '', tags: '', requiredEnv: '', body: '' };
const BLANK_SERVER: ServerDraft = {
  name: '',
  description: '',
  tags: '',
  requiredEnv: '',
  transportType: 'stdio',
  command: '',
  args: '',
  env: '',
  url: '',
  headers: '',
};

/**
 * The tool box catalog, docked in the scene's panel slot: search/filter
 * skills and MCP servers by tag, create and edit them. Machines get no
 * tools by default — each machine's station config picks from this
 * catalog. Bundled skills are read-only; "duplicate" copies one into an
 * editable user skill.
 */
export function ToolboxPanel({
  toolbox,
  vault = [],
  isPending,
  error,
  onAction,
  onClose,
}: {
  toolbox: Toolbox;
  vault?: RedactedVaultEntry[];
  isPending: boolean;
  error: unknown;
  onAction: (action: ToolboxAction) => void;
  onClose: () => void;
}): JSX.Element {
  const [view, setView] = useState<View>({ mode: 'list' });
  const [search, setSearch] = useState('');
  const [activeTags, setActiveTags] = useState<ReadonlySet<string>>(new Set());

  const allTags = [
    ...new Set([...toolbox.skills, ...toolbox.mcpServers].flatMap((t) => t.tags)),
  ].sort();

  const matches = (tool: { name: string; description?: string; tags: string[] }): boolean => {
    const q = search.trim().toLowerCase();
    const textHit =
      q === '' ||
      tool.name.toLowerCase().includes(q) ||
      (tool.description ?? '').toLowerCase().includes(q) ||
      tool.tags.some((tag) => tag.includes(q));
    const tagHit = activeTags.size === 0 || tool.tags.some((tag) => activeTags.has(tag));
    return textHit && tagHit;
  };

  const skills = toolbox.skills.filter(matches);
  const servers = toolbox.mcpServers.filter(matches);

  const submit = (action: ToolboxAction): void => {
    onAction(action);
    setView({ mode: 'list' });
  };

  return (
    <foreignObject x={28} y={90} width={470} height={540}>
      <div style={s.panel}>
        <div style={s.panelTitle}>
          <span>
            Tool box{' '}
            <span style={s.panelHint}>— machines only get the tools you assign them</span>
          </span>
          <button type="button" onClick={onClose} style={closeButton} aria-label="Close panel">
            ✕
          </button>
        </div>

        {view.mode === 'list' ? (
          <>
            <input
              placeholder="Search skills and MCP servers…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={s.panelInput}
            />
            {allTags.length > 0 ? (
              <div style={chipRow}>
                {allTags.map((tag) => (
                  <TagChip
                    key={tag}
                    tag={tag}
                    active={activeTags.has(tag)}
                    onToggle={() =>
                      setActiveTags((current) => {
                        const next = new Set(current);
                        if (next.has(tag)) next.delete(tag);
                        else next.add(tag);
                        return next;
                      })
                    }
                  />
                ))}
              </div>
            ) : null}

            <div style={sectionHeader}>
              <span>skills ({skills.length})</span>
              <button
                type="button"
                style={s.panelButton}
                onClick={() => setView({ mode: 'skill-form', initial: BLANK_SKILL })}
              >
                + new skill
              </button>
            </div>
            {skills.map((skill) => (
              <ToolRow
                key={skill.id}
                name={skill.name}
                description={skill.description}
                tags={skill.tags}
                requiredEnv={skill.requiredEnv ?? []}
                vault={vault}
                badge={skill.source === 'bundled' ? 'bundled' : undefined}
                actions={
                  skill.source === 'bundled'
                    ? [
                        {
                          label: 'duplicate',
                          onClick: () =>
                            setView({
                              mode: 'skill-form',
                              initial: {
                                name: `${skill.name}-copy`,
                                description: skill.description,
                                tags: skill.tags.join(', '),
                                requiredEnv: (skill.requiredEnv ?? []).join(', '),
                                body: skill.body,
                              },
                            }),
                        },
                      ]
                    : [
                        {
                          label: 'edit',
                          onClick: () =>
                            setView({
                              mode: 'skill-form',
                              editing: skill,
                              initial: {
                                name: skill.name,
                                description: skill.description,
                                tags: skill.tags.join(', '),
                                requiredEnv: (skill.requiredEnv ?? []).join(', '),
                                body: skill.body,
                              },
                            }),
                        },
                        {
                          label: 'delete',
                          danger: true,
                          onClick: () => submit({ type: 'delete-skill', id: skill.id }),
                        },
                      ]
                }
              />
            ))}

            <div style={sectionHeader}>
              <span>MCP servers ({servers.length})</span>
              <button
                type="button"
                style={s.panelButton}
                onClick={() => setView({ mode: 'server-form', initial: BLANK_SERVER })}
              >
                + new server
              </button>
            </div>
            <div style={s.panelHint}>MCP servers apply to claude machines only for now</div>
            {servers.map((server) => (
              <ToolRow
                key={server.id}
                name={server.name}
                description={
                  server.description ??
                  (server.transport.type === 'stdio'
                    ? server.transport.command
                    : server.transport.url)
                }
                tags={server.tags}
                requiredEnv={server.requiredEnv ?? []}
                vault={vault}
                badge={server.source === 'bundled' ? 'bundled' : undefined}
                actions={
                  server.source === 'bundled'
                    ? [
                        {
                          label: 'duplicate',
                          onClick: () =>
                            setView({
                              mode: 'server-form',
                              initial: {
                                ...toServerDraft(server),
                                name: `${server.name}-copy`,
                              },
                            }),
                        },
                      ]
                    : [
                        {
                          label: 'edit',
                          onClick: () =>
                            setView({
                              mode: 'server-form',
                              editing: server,
                              initial: toServerDraft(server),
                            }),
                        },
                        {
                          label: 'delete',
                          danger: true,
                          onClick: () => submit({ type: 'delete-server', id: server.id }),
                        },
                      ]
                }
              />
            ))}
          </>
        ) : null}

        {view.mode === 'skill-form' ? (
          <SkillForm
            editing={view.editing}
            initial={view.initial}
            isPending={isPending}
            onCancel={() => setView({ mode: 'list' })}
            onSubmit={(body) =>
              submit(
                view.editing
                  ? { type: 'update-skill', id: view.editing.id, body }
                  : { type: 'create-skill', body },
              )
            }
          />
        ) : null}

        {view.mode === 'server-form' ? (
          <ServerForm
            editing={view.editing}
            initial={view.initial}
            isPending={isPending}
            onCancel={() => setView({ mode: 'list' })}
            onSubmit={(body) =>
              submit(
                view.editing
                  ? { type: 'update-server', id: view.editing.id, body }
                  : { type: 'create-server', body },
              )
            }
          />
        ) : null}

        {error ? <div style={s.panelError}>{String(error)}</div> : null}
      </div>
    </foreignObject>
  );
}

function SkillForm({
  editing,
  initial,
  isPending,
  onSubmit,
  onCancel,
}: {
  editing?: ToolboxSkill | undefined;
  initial: SkillDraft;
  isPending: boolean;
  onSubmit: (body: SkillBody) => void;
  onCancel: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState<SkillDraft>(initial);
  const set = <K extends keyof SkillDraft>(key: K, value: SkillDraft[K]): void =>
    setDraft((d) => ({ ...d, [key]: value }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          name: draft.name.trim(),
          description: draft.description.trim(),
          body: draft.body,
          tags: parseTags(draft.tags),
          requiredEnv: parseRequiredEnv(draft.requiredEnv),
        });
      }}
      style={formStack}
    >
      <div style={sectionHeader}>{editing ? `edit skill: ${editing.name}` : 'new skill'}</div>
      <label style={s.panelLabel}>
        name <span style={s.panelHint}>lowercase slug, e.g. react-conventions</span>
        <input value={draft.name} onChange={(e) => set('name', e.target.value)} style={s.panelInput} />
      </label>
      <label style={s.panelLabel}>
        description{' '}
        <span style={s.panelHint}>the agent decides when to use the skill from this — be specific</span>
        <input
          value={draft.description}
          onChange={(e) => set('description', e.target.value)}
          style={s.panelInput}
        />
      </label>
      <label style={s.panelLabel}>
        tags <span style={s.panelHint}>comma-separated, e.g. react, frontend</span>
        <input value={draft.tags} onChange={(e) => set('tags', e.target.value)} style={s.panelInput} />
      </label>
      <label style={s.panelLabel}>
        required vault keys{' '}
        <span style={s.panelHint}>comma-separated, e.g. GITHUB_TOKEN — created unset in the vault</span>
        <input
          value={draft.requiredEnv}
          onChange={(e) => set('requiredEnv', e.target.value)}
          placeholder="GITHUB_TOKEN, AWS_ACCESS_KEY_ID"
          style={s.panelInput}
        />
      </label>
      <label style={s.panelLabel}>
        instructions (markdown)
        <textarea
          value={draft.body}
          onChange={(e) => set('body', e.target.value)}
          style={s.panelTextarea}
          rows={7}
        />
      </label>
      <FormButtons
        isPending={isPending}
        disabled={!draft.name.trim() || !draft.description.trim() || !draft.body.trim()}
        onCancel={onCancel}
      />
    </form>
  );
}

function ServerForm({
  editing,
  initial,
  isPending,
  onSubmit,
  onCancel,
}: {
  editing?: ToolboxMcpServer | undefined;
  initial: ServerDraft;
  isPending: boolean;
  onSubmit: (body: McpServerBody) => void;
  onCancel: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState<ServerDraft>(initial);
  const set = <K extends keyof ServerDraft>(key: K, value: ServerDraft[K]): void =>
    setDraft((d) => ({ ...d, [key]: value }));

  const valid =
    draft.name.trim() !== '' &&
    (draft.transportType === 'stdio' ? draft.command.trim() !== '' : draft.url.trim() !== '');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(fromServerDraft(draft));
      }}
      style={formStack}
    >
      <div style={sectionHeader}>
        {editing ? `edit MCP server: ${editing.name}` : 'new MCP server'}
      </div>
      <label style={s.panelLabel}>
        name <span style={s.panelHint}>lowercase slug, e.g. aws-tools</span>
        <input value={draft.name} onChange={(e) => set('name', e.target.value)} style={s.panelInput} />
      </label>
      <label style={s.panelLabel}>
        description (optional)
        <input
          value={draft.description}
          onChange={(e) => set('description', e.target.value)}
          style={s.panelInput}
        />
      </label>
      <label style={s.panelLabel}>
        tags <span style={s.panelHint}>comma-separated</span>
        <input value={draft.tags} onChange={(e) => set('tags', e.target.value)} style={s.panelInput} />
      </label>
      <label style={s.panelLabel}>
        required vault keys{' '}
        <span style={s.panelHint}>
          comma-separated — injected as env / ${'{'}KEY{'}'} substitution at run time
        </span>
        <input
          value={draft.requiredEnv}
          onChange={(e) => set('requiredEnv', e.target.value)}
          placeholder="CLICKUP_API_KEY"
          style={s.panelInput}
        />
      </label>
      <div style={s.panelRow}>
        {(['stdio', 'http'] as const).map((t) => (
          <label key={t} style={{ ...s.panelRow, fontSize: 12 }}>
            <input
              type="radio"
              checked={draft.transportType === t}
              onChange={() => set('transportType', t)}
            />
            {t}
          </label>
        ))}
      </div>
      {draft.transportType === 'stdio' ? (
        <>
          <label style={s.panelLabel}>
            command
            <input
              value={draft.command}
              onChange={(e) => set('command', e.target.value)}
              placeholder="npx"
              style={s.panelInput}
            />
          </label>
          <label style={s.panelLabel}>
            args <span style={s.panelHint}>one per line</span>
            <textarea
              value={draft.args}
              onChange={(e) => set('args', e.target.value)}
              placeholder={'-y\nsome-mcp-server'}
              style={s.panelTextarea}
              rows={2}
            />
          </label>
          <label style={s.panelLabel}>
            env <span style={s.panelHint}>KEY=value per line{editing ? '; blank value keeps the stored secret' : ''}</span>
            <textarea
              value={draft.env}
              onChange={(e) => set('env', e.target.value)}
              placeholder="API_KEY=…"
              style={s.panelTextarea}
              rows={2}
            />
          </label>
        </>
      ) : (
        <>
          <label style={s.panelLabel}>
            url
            <input
              value={draft.url}
              onChange={(e) => set('url', e.target.value)}
              placeholder="https://example.com/mcp"
              style={s.panelInput}
            />
          </label>
          <label style={s.panelLabel}>
            headers <span style={s.panelHint}>KEY=value per line{editing ? '; blank value keeps the stored secret' : ''}</span>
            <textarea
              value={draft.headers}
              onChange={(e) => set('headers', e.target.value)}
              placeholder="Authorization=Bearer …"
              style={s.panelTextarea}
              rows={2}
            />
          </label>
        </>
      )}
      <FormButtons isPending={isPending} disabled={!valid} onCancel={onCancel} />
    </form>
  );
}

function FormButtons({
  isPending,
  disabled,
  onCancel,
}: {
  isPending: boolean;
  disabled: boolean;
  onCancel: () => void;
}): JSX.Element {
  return (
    <div style={s.panelRow}>
      <button type="submit" disabled={isPending || disabled} style={s.panelButton}>
        {isPending ? 'Saving…' : 'Save'}
      </button>
      <button type="button" onClick={onCancel} style={s.panelButton}>
        Cancel
      </button>
    </div>
  );
}

function ToolRow({
  name,
  description,
  tags,
  requiredEnv = [],
  vault = [],
  badge,
  actions,
}: {
  name: string;
  description: string;
  tags: string[];
  requiredEnv?: string[];
  vault?: RedactedVaultEntry[];
  badge?: string | undefined;
  actions: Array<{ label: string; danger?: boolean; onClick: () => void }>;
}): JSX.Element {
  return (
    <div style={toolRow}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={toolRowName}>
          {name}
          {badge ? <span style={badgeStyle}>{badge}</span> : null}
          {tags.map((tag) => (
            <span key={tag} style={tagStyle}>
              {tag}
            </span>
          ))}
          {requiredEnv.map((key) => {
            const isSet = vault.some((e) => e.key === key && e.valueSet);
            return (
              <span
                key={key}
                style={isSet ? envChipSet : envChipUnset}
                title={isSet ? `${key} is configured in the vault` : `${key} is not set — open the vault`}
              >
                {key}
              </span>
            );
          })}
        </div>
        <div style={toolRowDescription}>{description}</div>
      </div>
      <div style={{ ...s.panelRow, flexShrink: 0 }}>
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={action.onClick}
            style={action.danger ? rowDangerButton : rowButton}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function TagChip({
  tag,
  active,
  onToggle,
}: {
  tag: string;
  active: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        ...tagStyle,
        cursor: 'pointer',
        border: `1px solid ${active ? '#e8b04a' : '#4a3624'}`,
        color: active ? '#e8b04a' : '#c8a888',
        background: active ? 'rgba(232, 176, 74, 0.12)' : 'transparent',
      }}
    >
      {tag}
    </button>
  );
}

function toServerDraft(server: ToolboxMcpServer): ServerDraft {
  const t = server.transport;
  return {
    name: server.name,
    description: server.description ?? '',
    tags: server.tags.join(', '),
    requiredEnv: (server.requiredEnv ?? []).join(', '),
    transportType: t.type,
    command: t.type === 'stdio' ? t.command : '',
    args: t.type === 'stdio' ? (t.args ?? []).join('\n') : '',
    // Secrets never reach the UI: render stored keys with blank values,
    // which the server interprets as "keep what's stored".
    env: t.type === 'stdio' ? t.envKeys.map((k) => `${k}=`).join('\n') : '',
    url: t.type === 'http' ? t.url : '',
    headers: t.type === 'http' ? t.headerKeys.map((k) => `${k}=`).join('\n') : '',
  };
}

function fromServerDraft(draft: ServerDraft): McpServerBody {
  const tags = parseTags(draft.tags);
  const requiredEnv = parseRequiredEnv(draft.requiredEnv);
  const description = draft.description.trim();
  if (draft.transportType === 'stdio') {
    const args = draft.args
      .split('\n')
      .map((a) => a.trim())
      .filter((a) => a.length > 0);
    const env = parseKeyValues(draft.env);
    return {
      name: draft.name.trim(),
      ...(description !== '' ? { description } : {}),
      tags,
      requiredEnv,
      transport: {
        type: 'stdio',
        command: draft.command.trim(),
        ...(args.length > 0 ? { args } : {}),
        ...(env !== undefined ? { env } : {}),
      },
    };
  }
  const headers = parseKeyValues(draft.headers);
  return {
    name: draft.name.trim(),
    ...(description !== '' ? { description } : {}),
    tags,
    requiredEnv,
    transport: {
      type: 'http',
      url: draft.url.trim(),
      ...(headers !== undefined ? { headers } : {}),
    },
  };
}

function parseTags(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0),
    ),
  ];
}

/** Comma-separated vault key names; case is preserved (keys are UPPER_SNAKE). */
function parseRequiredEnv(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(',')
        .map((k) => k.trim())
        .filter((k) => k.length > 0),
    ),
  ];
}

/** "KEY=value" per line; blank values are sent as-is (server keeps stored secrets). */
function parseKeyValues(raw: string): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const closeButton: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#c8a888',
  cursor: 'pointer',
  fontSize: 13,
};

const chipRow: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
};

const sectionHeader: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontSize: 12,
  fontWeight: 600,
  color: '#f0d8b8',
  marginTop: 6,
};

const formStack: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const toolRow: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'flex-start',
  padding: '6px 8px',
  border: '1px solid #2a1f17',
  borderRadius: 6,
  background: '#100b08',
};

const toolRowName: React.CSSProperties = {
  fontSize: 12,
  color: '#ead6b8',
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  flexWrap: 'wrap',
};

const toolRowDescription: React.CSSProperties = {
  fontSize: 10,
  color: '#8a7458',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const tagStyle: React.CSSProperties = {
  fontSize: 9,
  padding: '1px 6px',
  borderRadius: 8,
  border: '1px solid #4a3624',
  color: '#c8a888',
  background: 'transparent',
};

const badgeStyle: React.CSSProperties = {
  fontSize: 9,
  padding: '1px 6px',
  borderRadius: 8,
  border: '1px solid #5a7a4a',
  color: '#9ec27a',
};

const envChipSet: React.CSSProperties = {
  ...tagStyle,
  fontFamily: 'monospace',
  border: '1px solid #3a5a3a',
  color: '#9ec27a',
};

const envChipUnset: React.CSSProperties = {
  ...tagStyle,
  fontFamily: 'monospace',
  border: '1px solid rgba(232, 176, 74, 0.5)',
  color: '#e8b04a',
};

const rowButton: React.CSSProperties = {
  ...tagStyle,
  cursor: 'pointer',
  fontSize: 10,
};

const rowDangerButton: React.CSSProperties = {
  ...rowButton,
  border: '1px solid #6a2a2a',
  color: '#f2c0b8',
};
