/**
 * UI-side mirror of the server's UIState shape.
 *
 * Kept narrow and local — the UI only reads fields it renders, so a server
 * change that adds fields doesn't need a UI update. We don't pull
 * @claude-hub/core here to avoid dragging Node-only code (fs, etc.) into
 * the browser bundle.
 */

export type RepoOrigin = 'local' | 'clone' | 'create';

export type RepoStatus = 'pending' | 'cloning' | 'creating' | 'pushing' | 'ready' | 'failed';

export interface ProjectRepo {
  id: string;
  name: string;
  path: string;
  origin: RepoOrigin;
  remoteUrl?: string;
  credentialId?: string;
  status: RepoStatus;
  error?: string;
  addedAt: string;
}

export interface Project {
  id: string;
  /** Project root directory; agent sessions run here. */
  path: string;
  name: string;
  vision: string;
  repos: ProjectRepo[];
  context?: string;
  /** Project-level toolbox assignments, unioned with each machine's own. */
  skills?: string[];
  mcpServers?: string[];
  addedAt: string;
  agentSessions: ProjectAgentSessionSummary[];
  /** Back-compat field retained by the server for older bundles. */
  cc?: {
    sanitizedName: string;
    sessionCount: number;
    lastActivity?: string;
  };
}

/** Git credential as the server exposes it: token stripped. */
export interface RedactedGitCredential {
  id: string;
  name: string;
  provider: 'github';
  tokenSet: true;
  createdAt: string;
}

export type AgentProviderId = 'claude' | 'cursor';

export interface ProjectAgentSessionSummary {
  provider: AgentProviderId;
  displayName: string;
  sessionCount: number;
  lastActivity?: string;
}

export interface ClaudeProviderConfig {
  type: 'claude';
  enabled: boolean;
  cliPath?: string;
  dangerouslySkipPermissions: boolean;
}

export interface CursorProviderConfig {
  type: 'cursor';
  enabled: boolean;
  cliPath?: string;
  model: string;
  force: boolean;
  trust: boolean;
  approveMcps: boolean;
  sandbox?: 'enabled' | 'disabled';
}

export interface AppConfig {
  schemaVersion: number;
  httpPort: number;
  orchestratorTimeoutMs: number;
  triggerTimeoutMs: number;
  defaultProvider: AgentProviderId;
  providers: {
    claude: ClaudeProviderConfig;
    cursor: CursorProviderConfig;
  };
  /** Optional so payloads from a pre-v5 server still render. */
  projectsRoot?: string;
}

export interface DiscordChannel {
  id: string;
  type: 'discord';
  allowedUserIds: string[];
  status?: 'connected' | 'disconnected' | 'error';
  lastError?: string;
  botTokenSet: boolean;
}

export type Channel = DiscordChannel;

export type TriggerRunStatus = 'running' | 'success' | 'error';

export interface CronTrigger {
  id: string;
  type: 'cron';
  name: string;
  projectId: string;
  prompt: string;
  cronExpr: string;
  notify?: { channelId: string };
  lastRun?: string;
  lastStatus?: TriggerRunStatus;
}

export interface WebhookTrigger {
  id: string;
  type: 'webhook';
  name: string;
  projectId: string;
  promptTemplate: string;
  notify?: { channelId: string };
  lastRun?: string;
  lastStatus?: TriggerRunStatus;
  secretSet: true;
}

export type Trigger = CronTrigger | WebhookTrigger;

export interface OrchestratorState {
  status: 'stopped' | 'starting' | 'running' | 'error';
  sessionId?: string;
  startedAt?: string;
  lastError?: string;
  channelSessions: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Pipelines / work items (assembly line)
// ---------------------------------------------------------------------------

export type PipelineStageId = 'intake' | 'spec' | 'code' | 'test' | 'deploy' | 'monitor';

export const PIPELINE_STAGE_ORDER: readonly PipelineStageId[] = [
  'intake',
  'spec',
  'code',
  'test',
  'deploy',
  'monitor',
];

export type StageGate = 'auto' | 'approval';

export interface StageConfig {
  enabled: boolean;
  gate: StageGate;
  promptTemplate?: string;
  provider?: AgentProviderId;
  commands?: string[];
  timeoutMs?: number;
  /** Monitor stage only. */
  intervalMinutes?: number;
  /** Monitor stage only. */
  maxChecks?: number;
  /** Toolbox skill ids this machine may use. Absent/empty = none. */
  skills?: string[];
  /** Toolbox MCP server ids this machine may use. Absent/empty = none. */
  mcpServers?: string[];
}

// ---------------------------------------------------------------------------
// Toolbox (skills + MCP servers assignable per machine)
// ---------------------------------------------------------------------------

export interface ToolboxSkill {
  id: string;
  name: string;
  description: string;
  body: string;
  tags: string[];
  requiredEnv?: string[];
  source: 'bundled' | 'user';
  bundledVersion?: number;
  createdAt: string;
  updatedAt: string;
}

/** MCP env/header values are secrets; the server only sends key names. */
export type RedactedMcpTransport =
  | { type: 'stdio'; command: string; args?: string[]; envKeys: string[] }
  | { type: 'http'; url: string; headerKeys: string[] };

export interface ToolboxMcpServer {
  id: string;
  name: string;
  description?: string;
  transport: RedactedMcpTransport;
  tags: string[];
  requiredEnv?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Toolbox {
  skills: ToolboxSkill[];
  mcpServers: ToolboxMcpServer[];
}

/** Vault entry as the UI sees it: value stripped to a set/unset flag. */
export interface RedactedVaultEntry {
  key: string;
  valueSet: boolean;
  requiredBy: { skills: string[]; mcpServers: string[] };
  createdAt: string;
  updatedAt: string;
}

/** Plaintext transport shape sent TO the server on create/update. */
export type McpTransportInput =
  | { type: 'stdio'; command: string; args?: string[]; env?: Record<string, string> }
  | { type: 'http'; url: string; headers?: Record<string, string> };

export interface PipelineConfig {
  projectId: string;
  stages: Record<PipelineStageId, StageConfig>;
  updatedAt: string;
}

export type WorkItemSource = 'manual' | 'webhook' | 'cron' | 'channel' | 'monitor';

export type WorkItemStatus =
  | 'queued'
  | 'running'
  | 'waiting-approval'
  | 'monitoring'
  | 'failed'
  | 'done'
  | 'cancelled';

export type StageRunStatus =
  | 'pending'
  | 'skipped'
  | 'running'
  | 'waiting-approval'
  | 'success'
  | 'failed';

export interface StageResult {
  status: StageRunStatus;
  startedAt?: string;
  finishedAt?: string;
  output?: string;
  error?: string;
  checksPassed?: number;
}

export interface WorkItem {
  id: string;
  projectId: string;
  title: string;
  request: string;
  source: WorkItemSource;
  sourceRef?: string;
  status: WorkItemStatus;
  currentStage: PipelineStageId;
  stages: Record<PipelineStageId, StageResult>;
  approvedStages?: PipelineStageId[];
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
}

export interface UIState {
  config: AppConfig;
  projects: Project[];
  channels: Channel[];
  triggers: Trigger[];
  orchestrator: OrchestratorState;
  /** Optional so payloads from a pre-pipeline server still render. */
  pipelines?: PipelineConfig[];
  workItems?: WorkItem[];
  /** Optional so payloads from a pre-toolbox server still render. */
  toolbox?: Toolbox;
  /** Optional so payloads from a pre-git-credentials server still render. */
  gitCredentials?: RedactedGitCredential[];
  /** Optional so payloads from a pre-vault server still render. */
  vault?: RedactedVaultEntry[];
}
