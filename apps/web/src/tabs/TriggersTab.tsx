import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.js';
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
      {webhooks.length === 0 ? (
        <p style={{ opacity: 0.7 }}>
          Webhook triggers land in a later step. They'll post to
          <code> /triggers/webhooks/:id </code>
          with a per-trigger secret.
        </p>
      ) : (
        <ul>
          {webhooks.map((w) => (
            <li key={w.id}>
              {w.name} — project {w.projectId}
            </li>
          ))}
        </ul>
      )}
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
              {p.alias ?? p.path}
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
        placeholder="Prompt (sent to Claude Code in the project's directory on each fire)"
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

  const nameFor = (id: string): string => projects.find((p) => p.id === id)?.alias ?? id;

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
  const runs = useQuery({
    queryKey: ['runs', trigger.id],
    queryFn: () => api.listRuns(trigger.id),
    enabled: showRuns,
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
        <td style={td}>{trigger.lastStatus ?? '—'}</td>
        <td style={td}>
          <button onClick={onRunNow}>Run now</button>{' '}
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
