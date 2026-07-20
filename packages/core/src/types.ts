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

export type GitProvider = 'github';

/**
 * A hub-level git credential (personal access token), referenced from repos
 * by id. Like a channel's botToken, the token is stored locally and never
 * sent to the UI.
 */
export interface GitCredential {
  id: string;
  /** Friendly label, e.g. "github-personal". */
  name: string;
  provider: GitProvider;
  /** PAT/token. Stored locally; never sent to the UI. */
  token: string;
  createdAt: ISODateString;
}

export type RepoOrigin = 'local' | 'clone' | 'create';

/**
 * Provisioning lifecycle for a repo. `local` repos are born `ready`; clone
 * and create repos start `pending` and are advanced by the server's git job
 * runner, with each transition persisted so the UI sees live progress.
 */
export type RepoStatus = 'pending' | 'cloning' | 'creating' | 'pushing' | 'ready' | 'failed';

export interface ProjectRepo {
  id: string;
  /** Dir-safe name; the subdirectory under the project root for clone/create repos. */
  name: string;
  /** Absolute path to the repo working tree (may sit outside the project root for origin 'local'). */
  path: string;
  origin: RepoOrigin;
  remoteUrl?: string;
  /** GitCredential used for clone/create/push (private remotes). */
  credentialId?: string;
  status: RepoStatus;
  error?: string;
  addedAt: ISODateString;
}

/**
 * A project is a root directory holding one or more git repos as
 * subdirectories. Agent sessions run at the root so they see every repo.
 */
export interface Project {
  id: string;
  /** Absolute path to the project root directory; agent sessions run here. */
  path: string;
  name: string;
  /** High-level guiding statement; injected into every stage prompt. */
  vision: string;
  repos: ProjectRepo[];
  /** Markdown injected into every machine's prompt for this project's runs. */
  context?: string;
  /** Toolbox skill ids unioned with each stage's own assignments at runtime. */
  skills?: string[];
  /** Toolbox MCP server ids, same union semantics. */
  mcpServers?: string[];
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
 * A project's line is an ordered array of machine instances, stamped from
 * templates. The six classic stages survive as built-in templates; users
 * can install any mix, in any order, including duplicates.
 */
export const BUILTIN_MACHINE_SLUGS = ['intake', 'spec', 'code', 'test', 'deploy', 'monitor'] as const;
export type BuiltinMachineSlug = (typeof BUILTIN_MACHINE_SLUGS)[number];

/** Stable template id for a built-in machine template. */
export const builtinTemplateId = (slug: BuiltinMachineSlug): string => `builtin-${slug}`;

/** Machine instance keys and template slugs: same shape as TOOLBOX_NAME_PATTERN. */
export const MACHINE_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Gate applied BEFORE a machine executes. `'approval'` parks the work item
 * until a human approves it via the UI/API; `'auto'` advances immediately.
 */
export type StageGate = 'auto' | 'approval';

export interface MachineMonitorConfig {
  /** Minutes between checks. Default 30. */
  intervalMinutes?: number;
  /** Consecutive passing checks required to complete the machine. Default 3. */
  maxChecks?: number;
}

/**
 * Config shared by templates (as defaults) and machine instances (as
 * actuals). Capability fields (commands, resultCheck, monitor) are
 * materialized onto instances at install time; the only runtime fallbacks
 * are promptTemplate (template chain) and provider/timeoutMs (app config).
 */
export interface MachineBehavior {
  /**
   * Absent on an instance = fall back to the template's prompt. Absent
   * everywhere with commands present = commands-only machine.
   */
  promptTemplate?: string;
  /** Falls back to config.defaultProvider. */
  provider?: AgentProviderId;
  /**
   * Shell commands run sequentially in the project cwd after the agent run.
   * Any machine may have them; execution stops at the first failure.
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
  /**
   * Vault keys (VAULT_KEY_PATTERN) injected as env into the agent run and
   * shell commands — the machine's "variables".
   */
  requiredEnv?: string[];
  /**
   * Agent self-report marker check. 'strict' = the run must print
   * `MACHINE_RESULT: PASS`; 'lenient' = fails only on an explicit FAIL
   * marker. Absent = no check.
   */
  resultCheck?: 'strict' | 'lenient';
  /** Presence turns the machine into a scheduled re-check loop. */
  monitor?: MachineMonitorConfig;
}

/**
 * A reusable machine definition. Built-ins are code constants (never
 * stored); custom templates live in the machineTemplates store file.
 */
export interface MachineTemplate extends MachineBehavior {
  /** `builtin-<slug>` for built-ins; uuid for customs. */
  id: string;
  /** Default instance-key base (MACHINE_KEY_PATTERN). Unique across templates. */
  slug: string;
  /** Display name, e.g. "Code" or "Security scan". */
  name: string;
  description: string;
  source: 'builtin' | 'custom';
  /** Gate stamped onto new instances (built-in deploy defaults to 'approval'). */
  defaultGate: StageGate;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

/**
 * One installed machine on a project's line. Self-contained config except
 * the promptTemplate fallback to its template.
 */
export interface PipelineMachine extends MachineBehavior {
  /**
   * Unique-in-line slug (MACHINE_KEY_PATTERN); duplicates auto-suffix
   * (`code`, `code-2`). Serves as the WorkItem.stages record key, the
   * prompt-context key (`{{stages.<key>.output}}`), and the approval id.
   * Immutable — a changed key is a new machine identity.
   */
  key: string;
  /** Display name; renames freely without touching the key. */
  name: string;
  /**
   * Provenance + prompt fallback. Deleting a custom template snapshots its
   * prompt into instances and clears this.
   */
  templateId?: string;
  gate: StageGate;
}

export interface PipelineConfig {
  projectId: string;
  /** Ordered machine instances; empty = blank line (enqueue rejects). */
  machines: PipelineMachine[];
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
  /** Agent-reported MACHINE_SUMMARY line (1-2 sentences), when present. */
  summary?: string;
  error?: string;
  /** Consecutive passing checks so far. Machines with a monitor loop only. */
  checksPassed?: number;
}

export interface WorkItem {
  id: string;
  projectId: string;
  title: string;
  /** The raw request text driving the pipeline (prompt-template context). */
  request: string;
  source: WorkItemSource;
  /**
   * triggerId | channel conversation key | failed work item id (monitor
   * defects) | `project-monitor:<checkId>` (project-monitor defects).
   */
  sourceRef?: string;
  status: WorkItemStatus;
  /** Key of the machine the item is currently at. */
  currentStage: string;
  /** Results keyed by machine key. Machines never run for this item may be absent. */
  stages: Record<string, StageResult>;
  /**
   * Provider session ids resumed across stages, keyed by provider so a
   * Claude session id is never fed to Cursor or vice versa.
   */
  sessions?: Partial<Record<AgentProviderId, string>>;
  /** Keys of approval-gated machines a human has approved. Survives restarts. */
  approvedStages?: string[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
  finishedAt?: ISODateString;
}

// ---------------------------------------------------------------------------
// Project monitors (continuous post-ship health checks)
// ---------------------------------------------------------------------------

export type ProjectMonitorCheckType = 'http' | 'command' | 'agent';

interface ProjectMonitorCheckBase {
  /** uuid; stable identity — status is keyed by it and survives config edits. */
  id: string;
  name: string;
  /** Minutes between runs of this check. Minimum 1. */
  intervalMinutes: number;
  /** Per-type default when absent: http 10s, command 5min, agent 30min. */
  timeoutMs?: number;
}

export interface HttpMonitorCheck extends ProjectMonitorCheckBase {
  type: 'http';
  url: string;
  /** Exact status expected; absent = any 2xx. */
  expectedStatus?: number;
}

export interface CommandMonitorCheck extends ProjectMonitorCheckBase {
  type: 'command';
  /** Shell command run in the project root; exit 0 = healthy. */
  command: string;
}

export interface AgentMonitorCheck extends ProjectMonitorCheckBase {
  type: 'agent';
  /** Prompt run via agent-runner; the run must end `MACHINE_RESULT: PASS`/`FAIL`. */
  prompt: string;
  /** Falls back to config.defaultProvider. */
  provider?: AgentProviderId;
}

export type ProjectMonitorCheck = HttpMonitorCheck | CommandMonitorCheck | AgentMonitorCheck;

export interface MonitorCheckStatus {
  lastStatus: 'pass' | 'fail';
  lastCheckedAt: ISODateString;
  lastDurationMs?: number;
  /** Truncated check output for the config panel; full detail is not kept. */
  lastOutput?: string;
  lastError?: string;
  consecutiveFails: number;
}

export interface ProjectMonitorStatus {
  /** Keyed by check id. A configured check with no entry hasn't run yet. */
  checks: Record<string, MonitorCheckStatus>;
  /** Once-per-outage defect guard: set when a defect files, cleared on full recovery. */
  outageOpen: boolean;
}

/**
 * Continuous health monitoring for a shipped project. Unlike a machine's
 * bounded monitor loop (soak test on one work item), this runs indefinitely
 * while the hub is up: one timer per check, re-armed from disk on boot.
 */
export interface ProjectMonitor {
  projectId: string;
  enabled: boolean;
  checks: ProjectMonitorCheck[];
  /** File a `source: 'monitor'` defect work item once per outage. */
  fileDefectOnFailure: boolean;
  status: ProjectMonitorStatus;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export type ProjectMonitorHealth = 'healthy' | 'down' | 'unknown';

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
  /** Vault keys (VAULT_KEY_PATTERN) this skill needs at run time. */
  requiredEnv?: string[];
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
  /** Vault keys (VAULT_KEY_PATTERN) this server needs at run time. */
  requiredEnv?: string[];
  /** Absent = user-created. Bundled servers are seeded at boot and read-only. */
  source?: 'bundled' | 'user';
  /** Bundled only: shipped version; a higher shipped version reseeds the entry. */
  bundledVersion?: number;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface Toolbox {
  skills: ToolboxSkill[];
  mcpServers: ToolboxMcpServer[];
}

// ---------------------------------------------------------------------------
// Vault (global key-value config for tool integrations)
// ---------------------------------------------------------------------------

/** Env-var-like vault key: SCREAMING_SNAKE, must start with a letter. */
export const VAULT_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;

export interface VaultEntry {
  /** Unique key (VAULT_KEY_PATTERN). */
  key: string;
  /** null = declared but unset; drives the vault's warning lamp in the UI. */
  value: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
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
export const STORE_SCHEMA_VERSION = 8;

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
  /** Directory new project roots are created under. Defaults to ~/claude-hub/projects. */
  projectsRoot: string;
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
  /** Custom machine templates only; built-ins are code constants. */
  machineTemplates: MachineTemplate[];
  gitCredentials: GitCredential[];
  vault: VaultEntry[];
  /** Per-project continuous health monitors (config + latest check status). */
  monitors: ProjectMonitor[];
}

export type StoreEntityKey = keyof StoreSnapshot;
