import type { Project, UIState } from './types.js';

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
};
