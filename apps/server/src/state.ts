import { CCConfigReader, type CCProjectEntry } from '@claude-hub/cc-config-reader';
import { encodeProjectPath } from '@claude-hub/cc-config-reader';
import type { ChannelManager } from '@claude-hub/channels';
import type { AgentProviderId, AppConfig, Project, Store, StoreSnapshot } from '@claude-hub/core';

/**
 * The shape returned by GET /api/state and pushed over the WS channel.
 *
 * Everything the UI needs to render — the hub's own state plus a derived
 * view of CC's on-disk state, joined by project path. Secrets (bot tokens,
 * webhook secrets) are stripped before serialization.
 */
export interface UIState {
  config: AppConfig;
  projects: ProjectWithAgentSessions[];
  channels: RedactedChannel[];
  triggers: RedactedTrigger[];
  orchestrator: StoreSnapshot['orchestrator'];
}

export interface ProjectAgentSessionSummary {
  provider: AgentProviderId;
  displayName: string;
  sessionCount: number;
  lastActivity?: string;
}

export interface ProjectWithAgentSessions extends Project {
  /** Matched provider session metadata, if one exists for the project's path. */
  agentSessions: ProjectAgentSessionSummary[];
  /** Back-compat for older web bundles during rolling local rebuilds. */
  cc?: CCProjectEntry;
}

export type RedactedChannel = Omit<StoreSnapshot['channels'][number], 'botToken'> & {
  botTokenSet: boolean;
};

export type RedactedTrigger = StoreSnapshot['triggers'][number] extends infer T
  ? T extends { secret: string }
    ? Omit<T, 'secret'> & { secretSet: true }
    : T
  : never;

export async function buildUIState(
  store: Store,
  ccReader: CCConfigReader,
  channelMgr?: ChannelManager,
): Promise<UIState> {
  const snapshot = store.get();
  const ccProjects = await ccReader.listProjects();
  const ccByName = new Map(ccProjects.map((p) => [p.sanitizedName, p]));

  const projects = snapshot.projects.map<ProjectWithAgentSessions>((p) => {
    const encoded = encodeProjectPath(p.path);
    const cc = ccByName.get(encoded);
    const agentSessions: ProjectAgentSessionSummary[] = cc
      ? [
          {
            provider: 'claude',
            displayName: 'Claude Code',
            sessionCount: cc.sessionCount,
            ...(cc.lastActivity ? { lastActivity: cc.lastActivity } : {}),
          },
        ]
      : [];
    return { ...p, agentSessions, ...(cc ? { cc } : {}) };
  });

  // Persisted status fields are dead — overwrite with the runtime status
  // from the ChannelManager so the UI sees what's actually happening.
  const live = channelMgr?.discordStatus();
  const channels = snapshot.channels.map<RedactedChannel>((c) => {
    const { botToken, status: _persistedStatus, lastError: _persistedErr, ...rest } = c;
    if (c.type === 'discord' && live) {
      return {
        ...rest,
        botTokenSet: !!botToken,
        status: live.status,
        ...(live.error ? { lastError: live.error } : {}),
      };
    }
    return { ...rest, botTokenSet: !!botToken };
  });

  const triggers = snapshot.triggers.map<RedactedTrigger>((t) => {
    if (t.type === 'webhook') {
      const { secret, ...rest } = t;
      return { ...rest, secretSet: true } as RedactedTrigger;
    }
    return t as RedactedTrigger;
  });

  return {
    config: snapshot.config,
    projects,
    channels,
    triggers,
    orchestrator: snapshot.orchestrator,
  };
}
