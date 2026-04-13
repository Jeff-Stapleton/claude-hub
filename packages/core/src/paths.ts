import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Resolves filesystem paths under `~/.claude-hub/`.
 *
 * The directory layout deliberately mirrors how Claude Code stores its own
 * config under `~/.claude/` — flat files at the top level, history bucketed
 * into per-entity subdirectories.
 */
export class HubPaths {
  readonly root: string;

  constructor(root?: string) {
    this.root = root ?? join(homedir(), '.claude-hub');
  }

  file(name: 'config' | 'projects' | 'channels' | 'triggers' | 'orchestrator'): string {
    return join(this.root, `${name}.json`);
  }

  historyDir(): string {
    return join(this.root, 'history');
  }

  channelHistoryDir(): string {
    return join(this.historyDir(), 'channels');
  }

  triggerHistoryDir(): string {
    return join(this.historyDir(), 'triggers');
  }

  channelHistoryFile(channelId: string): string {
    return join(this.channelHistoryDir(), `${channelId}.jsonl`);
  }

  triggerHistoryFile(triggerId: string): string {
    return join(this.triggerHistoryDir(), `${triggerId}.jsonl`);
  }

  orchestratorWorkdir(): string {
    return join(this.root, 'orchestrator');
  }
}
