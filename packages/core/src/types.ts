/**
 * Shared types for claude-hub.
 *
 * The Trigger discriminated union is the most consequential type: cron and
 * webhook triggers share a runner and history file format, but differ in how
 * they're fired and how their prompt is constructed (literal vs templated).
 */

export type ISODateString = string;

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

/**
 * A user-registered working directory. Sessions, skills, and plans in Claude
 * Code are scoped per directory; a Project is just a friendly handle to one.
 */
export interface Project {
  id: string;
  /** Absolute filesystem path to the project's working directory. */
  path: string;
  /** Optional friendly name; falls back to the basename of `path`. */
  alias?: string;
  addedAt: ISODateString;
}

// ---------------------------------------------------------------------------
// Channels (conversational, orchestrator-mediated)
// ---------------------------------------------------------------------------

export type ChannelType = 'discord';

export interface DiscordChannelConfig {
  id: string;
  type: 'discord';
  /** Discord bot token. Stored locally; never sent to the UI. */
  botToken: string;
  /** Discord user IDs allowed to DM the bot. Anyone else is ignored. */
  allowedUserIds: string[];
  /** Last-known connection state, set by the runtime. */
  status?: 'connected' | 'disconnected' | 'error';
  lastError?: string;
}

export type Channel = DiscordChannelConfig;

/** A single inbound or outbound message recorded for the activity feed. */
export interface ChannelMessage {
  id: string;
  channelId: string;
  direction: 'in' | 'out';
  /** Discord user id or display name, if applicable. */
  user?: string;
  text: string;
  timestamp: ISODateString;
}

/**
 * Runtime message shape handed to the orchestrator. Kept here (rather
 * than in @claude-hub/channels) so the orchestrator package doesn't have
 * to depend on channels just for this type.
 */
export interface IncomingChannelMessage {
  /** Logical channel id, e.g. "discord". */
  channelId: string;
  /** Stable per-conversation id (e.g. Discord user id for DMs). */
  conversationId: string;
  /** Human-readable sender name for logs + UI. */
  user: string;
  text: string;
  receivedAt: ISODateString;
}

// ---------------------------------------------------------------------------
// Triggers (deterministic, non-conversational)
// ---------------------------------------------------------------------------

export type TriggerType = 'cron' | 'webhook';

export interface TriggerNotify {
  /** Channel id to post a one-line summary to when the run finishes. */
  channelId: string;
}

/**
 * What firing a trigger does. `'run'` (the default when absent) executes a
 * one-shot agent run; `'enqueue'` files a work item on the project's
 * pipeline instead, using the rendered prompt as the request text.
 */
export type TriggerMode = 'run' | 'enqueue';

export interface CronTrigger {
  id: string;
  type: 'cron';
  name: string;
  projectId: string;
  /** Literal prompt sent to the configured agent provider. */
  prompt: string;
  /** Standard 5-field cron expression (node-cron compatible). */
  cronExpr: string;
  mode?: TriggerMode;
  notify?: TriggerNotify;
  lastRun?: ISODateString;
  lastStatus?: TriggerRunStatus;
}

export interface WebhookTrigger {
  id: string;
  type: 'webhook';
  name: string;
  projectId: string;
  /** Prompt template; supports `{{payload.path.to.value}}` interpolation. */
  promptTemplate: string;
  /**
   * Per-trigger secret. Sent by the caller in the `X-Hub-Secret` header and
   * compared in constant time. Generated server-side on creation.
   */
  secret: string;
  mode?: TriggerMode;
  notify?: TriggerNotify;
  lastRun?: ISODateString;
  lastStatus?: TriggerRunStatus;
}

export type Trigger = CronTrigger | WebhookTrigger;

export type TriggerRunStatus = 'running' | 'success' | 'error';

export interface TriggerRun {
  id: string;
  triggerId: string;
  startedAt: ISODateString;
  finishedAt?: ISODateString;
  status: TriggerRunStatus;
  /** The actual prompt sent to CC (after template rendering, for webhooks). */
  prompt: string;
  /** Webhook payload, if any. Cron runs leave this undefined. */
  payload?: unknown;
  /** Final assistant text from CC, if the run succeeded. */
  transcript?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Pipelines (per-project assembly line)
// ---------------------------------------------------------------------------

/**
 * The six fixed assembly-line stages, in execution order. Stages cannot be
 * reordered or added to; each can be toggled on/off per project.
 */
export type PipelineStageId = 'intake' | 'spec' | 'code' | 'test' | 'deploy' | 'monitor';

export const PIPELINE_STAGE_ORDER: readonly PipelineStageId[] = [
  'intake',
  'spec',
  'code',
  'test',
  'deploy',
  'monitor',
];

/**
 * Gate applied BEFORE a stage executes. `'approval'` parks the work item
 * until a human approves it via the UI/API; `'auto'` advances immediately.
 */
export type StageGate = 'auto' | 'approval';

export interface StageConfig {
  enabled: boolean;
  gate: StageGate;
  /** Falls back to the built-in default template for the stage. */
  promptTemplate?: string;
  /** Falls back to config.defaultProvider. */
  provider?: AgentProviderId;
  /**
   * Shell commands run sequentially in the project cwd. Honored for
   * test/deploy/monitor stages only; execution stops at the first failure.
   */
  commands?: string[];
  /** Falls back to config.triggerTimeoutMs. */
  timeoutMs?: number;
  /**
   * Toolbox skill ids this machine may use. Absent or empty means the
   * machine gets no hub-managed skills — tools are deny-by-default.
   */
  skills?: string[];
  /** Toolbox MCP server ids this machine may use. Deny-by-default like skills. */
  mcpServers?: string[];
}

export interface MonitorStageConfig extends StageConfig {
  /** Minutes between monitor checks. Default 30. */
  intervalMinutes?: number;
  /** Consecutive passing checks required to mark the item done. Default 3. */
  maxChecks?: number;
}

export interface PipelineStages {
  intake: StageConfig;
  spec: StageConfig;
  code: StageConfig;
  test: StageConfig;
  deploy: StageConfig;
  monitor: MonitorStageConfig;
}

export interface PipelineConfig {
  projectId: string;
  stages: PipelineStages;
  updatedAt: ISODateString;
}

// ---------------------------------------------------------------------------
// Work items (requests flowing through a pipeline)
// ---------------------------------------------------------------------------

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
  startedAt?: ISODateString;
  finishedAt?: ISODateString;
  /** Final agent text / command output, truncated. Full text lives in JSONL. */
  output?: string;
  error?: string;
  /** Consecutive passing monitor checks so far. Monitor stage only. */
  checksPassed?: number;
}

export interface WorkItem {
  id: string;
  projectId: string;
  title: string;
  /** The raw request text driving the pipeline (prompt-template context). */
  request: string;
  source: WorkItemSource;
  /** triggerId | channel conversation key | failed work item id (monitor defects). */
  sourceRef?: string;
  status: WorkItemStatus;
  currentStage: PipelineStageId;
  stages: Record<PipelineStageId, StageResult>;
  /**
   * Provider session ids resumed across stages, keyed by provider so a
   * Claude session id is never fed to Cursor or vice versa.
   */
  sessions?: Partial<Record<AgentProviderId, string>>;
  /** Approval-gated stages a human has approved. Survives restarts. */
  approvedStages?: PipelineStageId[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
  finishedAt?: ISODateString;
}

// ---------------------------------------------------------------------------
// Toolbox (skills + MCP servers assignable per machine)
// ---------------------------------------------------------------------------

/** Slug used for skill/server names: becomes a directory name and JSON key. */
export const TOOLBOX_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface ToolboxSkill {
  /** uuid for user skills; bundled skills use the stable "bundled-<slug>". */
  id: string;
  /** Dir-safe slug (TOOLBOX_NAME_PATTERN); becomes the skill directory name. */
  name: string;
  /** SKILL.md frontmatter description; drives when the model invokes it. */
  description: string;
  /** SKILL.md markdown body. */
  body: string;
  tags: string[];
  source: 'bundled' | 'user';
  /** Bundled only: asset version; a higher shipped version reseeds the entry. */
  bundledVersion?: number;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export type McpTransport =
  | { type: 'stdio'; command: string; args?: string[]; env?: Record<string, string> }
  | { type: 'http'; url: string; headers?: Record<string, string> };

export interface ToolboxMcpServer {
  id: string;
  /** Slug (TOOLBOX_NAME_PATTERN); becomes the mcpServers key in generated config. */
  name: string;
  description?: string;
  /** env values / headers may carry secrets; never sent to the UI. */
  transport: McpTransport;
  tags: string[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface Toolbox {
  skills: ToolboxSkill[];
  mcpServers: ToolboxMcpServer[];
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface OrchestratorState {
  status: 'stopped' | 'starting' | 'running' | 'error';
  /** Provider session id of the current orchestrator session, if any. */
  sessionId?: string;
  startedAt?: ISODateString;
  lastError?: string;
  /** Map of provider/channel conversation key -> provider session id. */
  channelSessions: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Agent providers
// ---------------------------------------------------------------------------

export type AgentProviderId = 'claude' | 'cursor';

export interface ClaudeProviderConfig {
  type: 'claude';
  enabled: boolean;
  /** Override the Claude Code CLI binary. Defaults to `claude`. */
  cliPath?: string;
  /**
   * Bypass interactive permission prompts for unattended runs. Existing
   * claude-hub behavior defaults this to true.
   */
  dangerouslySkipPermissions: boolean;
}

export interface CursorProviderConfig {
  type: 'cursor';
  enabled: boolean;
  /** Override the Cursor CLI binary. Defaults to `agent`. */
  cliPath?: string;
  /** Cursor model id passed via --model. */
  model: string;
  /** Allow unattended edits in print mode. */
  force: boolean;
  /** Trust the workspace for headless runs. */
  trust: boolean;
  /** Auto-approve MCP servers for orchestrator runs. */
  approveMcps: boolean;
  sandbox?: 'enabled' | 'disabled';
}

export type AgentProviderConfig = ClaudeProviderConfig | CursorProviderConfig;

export type AgentProviderConfigs = {
  claude: ClaudeProviderConfig;
  cursor: CursorProviderConfig;
};

// ---------------------------------------------------------------------------
// Top-level store shape
// ---------------------------------------------------------------------------

/**
 * The on-disk schema version. Bumped when a breaking change to any persisted
 * file lands; the store refuses to load mismatched versions to avoid silent
 * data corruption.
 */
export const STORE_SCHEMA_VERSION = 4;

export interface AppConfig {
  schemaVersion: number;
  /** HTTP server bind port. Defaults to 7878. */
  httpPort: number;
  /**
   * Hard timeout (ms) for a single orchestrator CC run — i.e. the time
   * budget for each incoming DM's response. Defaults to 4 hours. DMs that
   * legitimately take longer (deep work, long builds) can bump this by
   * editing ~/.claude-hub/config.json; a server restart applies the change.
   */
  orchestratorTimeoutMs: number;
  /**
   * Hard timeout (ms) for trigger-initiated CC runs (cron + webhooks).
   * Defaults to 4 hours. Triggers that do heavy work (large prompts,
   * multi-step plans) need the headroom.
   */
  triggerTimeoutMs: number;
  /** Provider used when a caller does not explicitly choose one. */
  defaultProvider: AgentProviderId;
  /** Provider-specific CLI settings. */
  providers: AgentProviderConfigs;
}

export interface StoreSnapshot {
  config: AppConfig;
  projects: Project[];
  channels: Channel[];
  triggers: Trigger[];
  orchestrator: OrchestratorState;
  pipelines: PipelineConfig[];
  /** Live work items only (queued/running/waiting/monitoring/failed); terminal items are archived to JSONL. */
  workItems: WorkItem[];
  toolbox: Toolbox;
}

export type StoreEntityKey = keyof StoreSnapshot;
