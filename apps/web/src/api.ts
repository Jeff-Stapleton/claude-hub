import type {
  AppConfig,
  CronTrigger,
  McpTransportInput,
  PipelineConfig,
  Project,
  ToolboxMcpServer,
  ToolboxSkill,
  UIState,
  WorkItem,
} from './types.js';

export interface SkillBody {
  name: string;
  description: string;
  body: string;
  tags?: string[];
}

export interface McpServerBody {
  name: string;
  description?: string;
  transport: McpTransportInput;
  tags?: string[];
}

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

export interface ActivityEntry {
  kind: 'trigger-run';
  run: TriggerRunRecord;
  triggerName: string;
}

/**
 * Thin fetch wrapper. Throws on non-2xx with the body text so react-query
 * can surface the error.
 */
async function req<T>(path: string, init?: RequestInit): Promise<T> {
  // Only declare a JSON content-type when there's actually a body — Fastify's
  // JSON parser rejects empty bodies with FST_ERR_CTP_EMPTY_JSON_BODY when the
  // content-type header is set but the body is empty (bites DELETEs).
  const hasBody = init?.body !== undefined && init.body !== null;
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${body ? `: ${body}` : ''}`);
  }
  return res.json() as Promise<T>;
}

export interface WebhookCreateResponse {
  id: string;
  type: 'webhook';
  name: string;
  projectId: string;
  promptTemplate: string;
  secret: string;
  url: string;
}

export const api = {
  getState: () => req<UIState>('/api/state'),
  saveDiscord: (body: { botToken?: string; allowedUserIds?: string[] }) =>
    req<{ ok: true }>('/api/channels/discord', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  saveConfig: (body: Partial<Pick<AppConfig, 'defaultProvider' | 'providers'>>) =>
    req<AppConfig>('/api/config', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
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
  createWebhookTrigger: (body: {
    name: string;
    projectId: string;
    promptTemplate: string;
  }) =>
    req<WebhookCreateResponse>('/api/triggers/webhook', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteTrigger: (id: string) =>
    req<{ ok: true }>(`/api/triggers/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  runTrigger: (id: string) =>
    req<{ ok: true }>(`/api/triggers/${encodeURIComponent(id)}/run`, {
      method: 'POST',
      body: '{}',
    }),
  listRuns: (id: string) =>
    req<TriggerRunRecord[]>(`/api/triggers/${encodeURIComponent(id)}/runs`),
  listActivity: () => req<ActivityEntry[]>('/api/activity'),
  savePipeline: (projectId: string, body: Pick<PipelineConfig, 'stages'>) =>
    req<PipelineConfig>(`/api/projects/${encodeURIComponent(projectId)}/pipeline`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  createWorkItem: (projectId: string, body: { request: string; title?: string }) =>
    req<WorkItem>(`/api/projects/${encodeURIComponent(projectId)}/work-items`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  approveWorkItem: (id: string) =>
    req<WorkItem>(`/api/work-items/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      body: '{}',
    }),
  retryWorkItem: (id: string) =>
    req<WorkItem>(`/api/work-items/${encodeURIComponent(id)}/retry`, {
      method: 'POST',
      body: '{}',
    }),
  cancelWorkItem: (id: string) =>
    req<WorkItem>(`/api/work-items/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      body: '{}',
    }),
  clearOrchestratorSessions: () =>
    req<{ ok: true }>('/api/orchestrator/clear-sessions', { method: 'POST', body: '{}' }),
  createSkill: (body: SkillBody) =>
    req<ToolboxSkill>('/api/toolbox/skills', { method: 'POST', body: JSON.stringify(body) }),
  updateSkill: (id: string, body: SkillBody) =>
    req<ToolboxSkill>(`/api/toolbox/skills/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteSkill: (id: string) =>
    req<{ ok: true }>(`/api/toolbox/skills/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  createMcpServer: (body: McpServerBody) =>
    req<ToolboxMcpServer>('/api/toolbox/mcp-servers', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateMcpServer: (id: string, body: McpServerBody) =>
    req<ToolboxMcpServer>(`/api/toolbox/mcp-servers/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteMcpServer: (id: string) =>
    req<{ ok: true }>(`/api/toolbox/mcp-servers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
};
