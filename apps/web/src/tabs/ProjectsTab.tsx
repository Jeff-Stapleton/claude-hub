import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.js';
import type { Project, UIState } from '../types.js';

export function ProjectsTab({ projects }: { projects: Project[] }): JSX.Element {
  const qc = useQueryClient();
  const [path, setPath] = useState('');
  const [alias, setAlias] = useState('');

  const addMutation = useMutation({
    mutationFn: api.addProject,
    onSuccess: () => {
      setPath('');
      setAlias('');
      void qc.invalidateQueries({ queryKey: ['state'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteProject,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['state'] }),
  });

  return (
    <section>
      <h2>Projects</h2>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!path.trim()) return;
          addMutation.mutate({
            path: path.trim(),
            ...(alias.trim() ? { alias: alias.trim() } : {}),
          });
        }}
        style={{ display: 'flex', gap: 8, marginBottom: 16 }}
      >
        <input
          placeholder="Absolute project path"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          style={{ flex: 1 }}
        />
        <input
          placeholder="Alias (optional)"
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
          style={{ width: 180 }}
        />
        <button type="submit" disabled={addMutation.isPending || !path.trim()}>
          Add project
        </button>
      </form>

      {addMutation.error ? (
        <p style={{ color: 'crimson' }}>{String(addMutation.error)}</p>
      ) : null}

      {projects.length === 0 ? (
        <p style={{ opacity: 0.7 }}>
          No projects registered. Add one above to associate channels and triggers with it.
        </p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>Alias / Path</th>
              <th style={th}>Agent sessions</th>
              <th style={th}>Last activity</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td style={td}>
                  <div>{p.alias ?? basename(p.path)}</div>
                  <div style={{ opacity: 0.6, fontSize: 12 }}>{p.path}</div>
                </td>
                <td style={td}>
                  {p.agentSessions.length > 0
                    ? p.agentSessions
                        .map((s) => `${s.displayName}: ${s.sessionCount}`)
                        .join(', ')
                    : '—'}
                </td>
                <td style={td}>
                  {latestActivity(p.agentSessions.map((s) => s.lastActivity)) ?? '—'}
                </td>
                <td style={td}>
                  <button onClick={() => deleteMutation.mutate(p.id)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const th: React.CSSProperties = {
  textAlign: 'left',
  borderBottom: '1px solid #444',
  padding: '6px 8px',
  fontWeight: 600,
};
const td: React.CSSProperties = { borderBottom: '1px solid #222', padding: '6px 8px' };

function basename(p: string): string {
  const norm = p.replace(/[\\/]+$/, '');
  const idx = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'));
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function latestActivity(values: Array<string | undefined>): string | null {
  const latest = values.filter((v): v is string => Boolean(v)).sort().at(-1);
  return latest ? fmt(latest) : null;
}

// Helper type to keep consumer imports tidy.
export type _UIState = UIState;
