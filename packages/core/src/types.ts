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

export interface CronTrigger {
  id: string;
  type: 'cron';
  name: string;
  projectId: string;
  /** Literal prompt sent to Claude Code. */
  prompt: string;
  /** Standard 5-field cron expression (node-cron compatible). */
  cronExpr: string;
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
// Orchestrator
// ---------------------------------------------------------------------------

export interface OrchestratorState {
  status: 'stopped' | 'starting' | 'running' | 'error';
  /** Claude Code session id of the current orchestrator session, if any. */
  sessionId?: string;
  startedAt?: ISODateString;
  lastError?: string;
  /** Map of channel id -> CC session id, for per-channel conversation continuity. */
  channelSessions: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Top-level store shape
// ---------------------------------------------------------------------------

/**
 * The on-disk schema version. Bumped when a breaking change to any persisted
 * file lands; the store refuses to load mismatched versions to avoid silent
 * data corruption.
 */
export const STORE_SCHEMA_VERSION = 1;

export interface AppConfig {
  schemaVersion: number;
  /** HTTP server bind port. Defaults to 7878. */
  httpPort: number;
}

export interface StoreSnapshot {
  config: AppConfig;
  projects: Project[];
  channels: Channel[];
  triggers: Trigger[];
  orchestrator: OrchestratorState;
}

export type StoreEntityKey = keyof StoreSnapshot;
