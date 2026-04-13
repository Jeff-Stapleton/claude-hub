/**
 * UI-side mirror of the server's UIState shape.
 *
 * Kept narrow and local — the UI only reads fields it renders, so a server
 * change that adds fields doesn't need a UI update. We don't pull
 * @claude-hub/core here to avoid dragging Node-only code (fs, etc.) into
 * the browser bundle.
 */

export interface Project {
  id: string;
  path: string;
  alias?: string;
  addedAt: string;
  cc?: {
    sanitizedName: string;
    sessionCount: number;
    lastActivity?: string;
  };
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

export interface UIState {
  projects: Project[];
  channels: Channel[];
  triggers: Trigger[];
  orchestrator: OrchestratorState;
}
