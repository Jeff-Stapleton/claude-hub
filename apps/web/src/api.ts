import type { CronTrigger, Project, UIState } from './types.js';

export interface TriggerRunRecord {
  id: string;
  triggerId: string;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'success' | 'error';
  prompt: string;
  transcript?: string;
  error?: string;
}

/**
 * Thin fetch wrapper. Throws on non-2xx with the body text so react-query
 * can surface the error.
 */
async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${body ? `: ${body}` : ''}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getState: () => req<UIState>('/api/state'),
  addProject: (body: { path: string; alias?: string }) =>
    req<Project>('/api/projects', { method: 'POST', body: JSON.stringify(body) }),
  deleteProject: (id: string) =>
    req<{ ok: true }>(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  createCronTrigger: (body: {
    name: string;
    projectId: string;
    prompt: string;
    cronExpr: string;
  }) =>
    req<CronTrigger>('/api/triggers/cron', { method: 'POST', body: JSON.stringify(body) }),
  deleteTrigger: (id: string) =>
    req<{ ok: true }>(`/api/triggers/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  runTrigger: (id: string) =>
    req<{ ok: true }>(`/api/triggers/${encodeURIComponent(id)}/run`, { method: 'POST' }),
  listRuns: (id: string) =>
    req<TriggerRunRecord[]>(`/api/triggers/${encodeURIComponent(id)}/runs`),
};
