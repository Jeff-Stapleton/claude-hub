import type {
  AppConfig,
  CronTrigger,
  McpTransportInput,
  PipelineConfig,
  Project,
  ProjectRepo,
  RedactedGitCredential,
  RedactedVaultEntry,
  ToolboxMcpServer,
  ToolboxSkill,
  UIState,
  WorkItem,
} from './types.js';

/** One repo entry in a create-project / add-repo request. */
export type RepoInput =
  | { mode: 'local'; path: string }
  | { mode: 'clone'; url: string; name?: string; credentialId?: string }
  | { mode: 'create'; name: string; credentialId: string; private?: boolean };

export interface CreateProjectBody {
  name: string;
  vision: string;
  repos: RepoInput[];
  context?: string;
  skills?: string[];
  mcpServers?: string[];
  rootPath?: string;
}

export interface UpdateProjectBody {
  name?: string;
  vision?: string;
  context?: string;
  skills?: string[];
  mcpServers?: string[];
}

export interface PathInspection {
  exists: boolean;
  isDirectory: boolean;
  isGitRepo: boolean;
  remoteUrl?: string;
}

export interface SkillBody {
  name: string;
  description: string;
  body: string;
  tags?: string[];
  requiredEnv?: string[];
}

export interface McpServerBody {
  name: string;
  description?: string;
  transport: McpTransportInput;
  tags?: string[];
  requiredEnv?: string[];
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
  createProject: (body: CreateProjectBody) =>
    req<Project>('/api/projects', { method: 'POST', body: JSON.stringify(body) }),
  updateProject: (id: string, body: UpdateProjectBody) =>
    req<Project>(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteProject: (id: string) =>
    req<{ ok: true }>(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  addRepo: (projectId: string, body: RepoInput) =>
    req<ProjectRepo>(`/api/projects/${encodeURIComponent(projectId)}/repos`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  retryRepo: (projectId: string, repoId: string) =>
    req<{ ok: true }>(
      `/api/projects/${encodeURIComponent(projectId)}/repos/${encodeURIComponent(repoId)}/retry`,
      { method: 'POST', body: '{}' },
    ),
  deleteRepo: (projectId: string, repoId: string) =>
    req<{ ok: true }>(
      `/api/projects/${encodeURIComponent(projectId)}/repos/${encodeURIComponent(repoId)}`,
      { method: 'DELETE' },
    ),
  inspectPath: (path: string) =>
    req<PathInspection>('/api/git/inspect-path', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  checkRemote: (url: string, credentialId?: string) =>
    req<{ ok: boolean; error?: string }>('/api/git/check-remote', {
      method: 'POST',
      body: JSON.stringify({ url, ...(credentialId ? { credentialId } : {}) }),
    }),
  createGitCredential: (body: { name: string; token: string }) =>
    req<RedactedGitCredential>('/api/git/credentials', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteGitCredential: (id: string) =>
    req<{ ok: true }>(`/api/git/credentials/${encodeURIComponent(id)}`, { method: 'DELETE' }),
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
  createVaultKey: (body: { key: string; value?: string }) =>
    req<RedactedVaultEntry>('/api/vault/keys', { method: 'POST', body: JSON.stringify(body) }),
  setVaultValue: (key: string, value: string) =>
    req<RedactedVaultEntry>(`/api/vault/keys/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),
  clearVaultValue: (key: string) =>
    req<RedactedVaultEntry>(`/api/vault/keys/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value: null }),
    }),
  deleteVaultKey: (key: string) =>
    req<{ ok: true }>(`/api/vault/keys/${encodeURIComponent(key)}`, { method: 'DELETE' }),
};
