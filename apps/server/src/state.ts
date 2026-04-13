import { CCConfigReader, type CCProjectEntry } from '@claude-hub/cc-config-reader';
import { encodeProjectPath } from '@claude-hub/cc-config-reader';
import type { Project, Store, StoreSnapshot } from '@claude-hub/core';

/**
 * The shape returned by GET /api/state and pushed over the WS channel.
 *
 * Everything the UI needs to render — the hub's own state plus a derived
 * view of CC's on-disk state, joined by project path. Secrets (bot tokens,
 * webhook secrets) are stripped before serialization.
 */
export interface UIState {
  projects: ProjectWithCC[];
  channels: RedactedChannel[];
  triggers: RedactedTrigger[];
  orchestrator: StoreSnapshot['orchestrator'];
}

export interface ProjectWithCC extends Project {
  /** Matched CC project dir, if one exists for the project's path. */
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

export async function buildUIState(store: Store, ccReader: CCConfigReader): Promise<UIState> {
  const snapshot = store.get();
  const ccProjects = await ccReader.listProjects();
  const ccByName = new Map(ccProjects.map((p) => [p.sanitizedName, p]));

  const projects = snapshot.projects.map<ProjectWithCC>((p) => {
    const encoded = encodeProjectPath(p.path);
    const cc = ccByName.get(encoded);
    return cc ? { ...p, cc } : p;
  });

  const channels = snapshot.channels.map<RedactedChannel>((c) => {
    const { botToken, ...rest } = c;
    return { ...rest, botTokenSet: !!botToken };
  });

  const triggers = snapshot.triggers.map<RedactedTrigger>((t) => {
    if (t.type === 'webhook') {
      const { secret, ...rest } = t;
      return { ...rest, secretSet: true } as RedactedTrigger;
    }
    return t as RedactedTrigger;
  });

  return { projects, channels, triggers, orchestrator: snapshot.orchestrator };
}
