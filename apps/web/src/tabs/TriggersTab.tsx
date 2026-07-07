import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type WebhookCreateResponse } from '../api.js';
import type { CronTrigger, Project, Trigger, WebhookTrigger } from '../types.js';

/**
 * Triggers tab: Cron subsection is fully wired. Webhooks are listed
 * read-only until step 8 adds their create/list-with-URL routes.
 */
export function TriggersTab({
  triggers,
  projects,
}: {
  triggers: Trigger[];
  projects: Project[];
}): JSX.Element {
  const cron = triggers.filter((t): t is CronTrigger => t.type === 'cron');
  const webhooks = triggers.filter((t): t is WebhookTrigger => t.type === 'webhook');

  return (
    <section>
      <h2>Triggers</h2>

      <h3 style={{ marginTop: 24 }}>Cron</h3>
      <CronCreateForm projects={projects} />
      <CronList cron={cron} projects={projects} />

      <h3 style={{ marginTop: 32 }}>Webhooks</h3>
      <WebhookCreateForm projects={projects} />
      <WebhookList webhooks={webhooks} projects={projects} />
    </section>
  );
}

function CronCreateForm({ projects }: { projects: Project[] }): JSX.Element {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [cronExpr, setCronExpr] = useState('*/5 * * * *');
  const [prompt, setPrompt] = useState('');

  const mutation = useMutation({
    mutationFn: api.createCronTrigger,
    onSuccess: () => {
      setName('');
      setPrompt('');
      void qc.invalidateQueries({ queryKey: ['state'] });
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || !projectId || !cronExpr.trim() || !prompt.trim()) return;
        mutation.mutate({
          name: name.trim(),
          projectId,
          cronExpr: cronExpr.trim(),
          prompt: prompt.trim(),
        });
      }}
      style={{ display: 'grid', gap: 8, marginBottom: 16 }}
    >
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ flex: 1 }}
        />
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="" disabled>
            (select project)
          </option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input
          placeholder="Cron expression (e.g. */5 * * * *)"
          value={cronExpr}
          onChange={(e) => setCronExpr(e.target.value)}
          style={{ width: 220 }}
        />
      </div>
      <textarea
        placeholder="Prompt (sent to the configured agent in the project's directory on each fire)"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={3}
      />
      <div>
        <button
          type="submit"
          disabled={mutation.isPending || !name.trim() || !projectId || !prompt.trim()}
        >
          Add cron trigger
        </button>
        {mutation.error ? (
          <span style={{ color: 'crimson', marginLeft: 8 }}>{String(mutation.error)}</span>
        ) : null}
      </div>
    </form>
  );
}

function CronList({
  cron,
  projects,
}: {
  cron: CronTrigger[];
  projects: Project[];
}): JSX.Element {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: api.deleteTrigger,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['state'] }),
  });
  const runNow = useMutation({ mutationFn: api.runTrigger });

  if (cron.length === 0) {
    return <p style={{ opacity: 0.7 }}>No cron triggers.</p>;
  }

  const nameFor = (id: string): string => projects.find((p) => p.id === id)?.name ?? id;

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={th}>Name</th>
          <th style={th}>Project</th>
          <th style={th}>Cron</th>
          <th style={th}>Last run</th>
          <th style={th}>Status</th>
          <th style={th}></th>
        </tr>
      </thead>
      <tbody>
        {cron.map((c) => (
          <CronRow
            key={c.id}
            trigger={c}
            projectName={nameFor(c.projectId)}
            onDelete={() => del.mutate(c.id)}
            onRunNow={() => runNow.mutate(c.id)}
          />
        ))}
      </tbody>
    </table>
  );
}

function CronRow({
  trigger,
  projectName,
  onDelete,
  onRunNow,
}: {
  trigger: CronTrigger;
  projectName: string;
  onDelete: () => void;
  onRunNow: () => void;
}): JSX.Element {
  const [showRuns, setShowRuns] = useState(false);
  const isRunning = trigger.lastStatus === 'running';
  const runs = useQuery({
    queryKey: ['runs', trigger.id],
    queryFn: () => api.listRuns(trigger.id),
    enabled: showRuns,
    // Poll while a run is in progress so the list updates when it finishes.
    refetchInterval: isRunning ? 3_000 : showRuns ? 10_000 : false,
  });

  return (
    <>
      <tr>
        <td style={td}>
          <div>{trigger.name}</div>
          <div style={{ opacity: 0.6, fontSize: 12 }}>{trigger.prompt.slice(0, 80)}</div>
        </td>
        <td style={td}>{projectName}</td>
        <td style={td}>
          <code>{trigger.cronExpr}</code>
        </td>
        <td style={td}>{trigger.lastRun ? new Date(trigger.lastRun).toLocaleString() : '—'}</td>
        <td style={td}>
          <StatusBadge status={trigger.lastStatus} />
        </td>
        <td style={td}>
          <button onClick={onRunNow} disabled={isRunning}>
            {isRunning ? 'Running...' : 'Run now'}
          </button>{' '}
          <button onClick={() => setShowRuns((v) => !v)}>
            {showRuns ? 'Hide runs' : 'Runs'}
          </button>{' '}
          <button onClick={onDelete}>Delete</button>
        </td>
      </tr>
      {showRuns ? (
        <tr>
          <td colSpan={6} style={td}>
            {runs.isLoading ? (
              <em>Loading…</em>
            ) : runs.data && runs.data.length > 0 ? (
              <pre style={runsPre}>
                {runs.data
                  .map(
                    (r) =>
                      `[${r.status}] ${r.startedAt}${
                        r.transcript ? ` → ${r.transcript.slice(0, 200)}` : ''
                      }${r.error ? ` !! ${r.error}` : ''}`,
                  )
                  .join('\n')}
              </pre>
            ) : (
              <em>No runs yet.</em>
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}

function WebhookCreateForm({ projects }: { projects: Project[] }): JSX.Element {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [promptTemplate, setPromptTemplate] = useState('');
  /** The newly-created trigger — secret shown ONCE here, then dismissed. */
  const [justCreated, setJustCreated] = useState<WebhookCreateResponse | null>(null);

  const mutation = useMutation({
    mutationFn: api.createWebhookTrigger,
    onSuccess: (created) => {
      setJustCreated(created);
      setName('');
      setPromptTemplate('');
      void qc.invalidateQueries({ queryKey: ['state'] });
    },
  });

  return (
    <div style={{ marginBottom: 16 }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim() || !projectId || !promptTemplate.trim()) return;
          mutation.mutate({
            name: name.trim(),
            projectId,
            promptTemplate: promptTemplate.trim(),
          });
        }}
        style={{ display: 'grid', gap: 8 }}
      >
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ flex: 1 }}
          />
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="" disabled>
              (select project)
            </option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <textarea
          placeholder="Prompt template — e.g. &quot;Investigate PR {{payload.number}} in repo {{payload.repo}}&quot;"
          value={promptTemplate}
          onChange={(e) => setPromptTemplate(e.target.value)}
          rows={3}
        />
        <div>
          <button
            type="submit"
            disabled={mutation.isPending || !name.trim() || !projectId || !promptTemplate.trim()}
          >
            Add webhook trigger
          </button>
          {mutation.error ? (
            <span style={{ color: 'crimson', marginLeft: 8 }}>{String(mutation.error)}</span>
          ) : null}
        </div>
      </form>

      {justCreated ? (
        <JustCreatedBanner trigger={justCreated} onDismiss={() => setJustCreated(null)} />
      ) : null}
    </div>
  );
}

function JustCreatedBanner({
  trigger,
  onDismiss,
}: {
  trigger: WebhookCreateResponse;
  onDismiss: () => void;
}): JSX.Element {
  return (
    <div
      style={{
        marginTop: 12,
        padding: 12,
        border: '1px solid #3b6',
        borderRadius: 4,
        background: '#051',
      }}
    >
      <div style={{ marginBottom: 6 }}>
        <strong>Created "{trigger.name}".</strong> Copy the secret now — it won't be shown
        again.
      </div>
      <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
        <div>
          <span style={{ opacity: 0.7 }}>URL: </span>
          <code>{trigger.url}</code>
          <button onClick={() => void navigator.clipboard.writeText(trigger.url)}>copy</button>
        </div>
        <div>
          <span style={{ opacity: 0.7 }}>Secret (header X-Hub-Secret): </span>
          <code>{trigger.secret}</code>
          <button onClick={() => void navigator.clipboard.writeText(trigger.secret)}>copy</button>
        </div>
        <div style={{ marginTop: 6, opacity: 0.7 }}>
          <code>
            curl -X POST {trigger.url} -H &quot;X-Hub-Secret: {trigger.secret}&quot; -H
            &quot;Content-Type: application/json&quot; -d &apos;{'{}'}&apos;
          </code>
        </div>
      </div>
      <button style={{ marginTop: 8 }} onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

function WebhookList({
  webhooks,
  projects,
}: {
  webhooks: WebhookTrigger[];
  projects: Project[];
}): JSX.Element {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: api.deleteTrigger,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['state'] }),
  });

  if (webhooks.length === 0) {
    return <p style={{ opacity: 0.7 }}>No webhook triggers.</p>;
  }
  const nameFor = (id: string): string => projects.find((p) => p.id === id)?.name ?? id;

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={th}>Name</th>
          <th style={th}>Project</th>
          <th style={th}>URL</th>
          <th style={th}>Last run</th>
          <th style={th}>Status</th>
          <th style={th}></th>
        </tr>
      </thead>
      <tbody>
        {webhooks.map((w) => {
          const url = `${window.location.origin}/triggers/webhooks/${w.id}`;
          return (
            <tr key={w.id}>
              <td style={td}>
                <div>{w.name}</div>
                <div style={{ opacity: 0.6, fontSize: 12 }}>
                  {w.promptTemplate.slice(0, 80)}
                </div>
              </td>
              <td style={td}>{nameFor(w.projectId)}</td>
              <td style={td}>
                <code style={{ fontSize: 11 }}>…/{w.id.slice(0, 8)}</code>{' '}
                <button onClick={() => void navigator.clipboard.writeText(url)}>copy URL</button>
              </td>
              <td style={td}>{w.lastRun ? new Date(w.lastRun).toLocaleString() : '—'}</td>
              <td style={td}>{w.lastStatus ?? '—'}</td>
              <td style={td}>
                <button onClick={() => del.mutate(w.id)}>Delete</button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function StatusBadge({
  status,
}: {
  status: 'running' | 'success' | 'error' | undefined;
}): JSX.Element {
  if (!status) return <span style={{ opacity: 0.5 }}>—</span>;
  const colors: Record<string, string> = {
    running: '#fa0',
    success: '#3b6',
    error: '#e44',
  };
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 8px',
        borderRadius: 10,
        background: colors[status] ?? '#888',
        color: '#fff',
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      {status}
    </span>
  );
}

const th: React.CSSProperties = {
  textAlign: 'left',
  borderBottom: '1px solid #444',
  padding: '6px 8px',
  fontWeight: 600,
};
const td: React.CSSProperties = { borderBottom: '1px solid #222', padding: '6px 8px' };
const runsPre: React.CSSProperties = {
  background: '#111',
  color: '#ddd',
  padding: 8,
  margin: 0,
  fontSize: 12,
  whiteSpace: 'pre-wrap',
};
