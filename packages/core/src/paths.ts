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

  file(
    name: 'config' | 'projects' | 'channels' | 'triggers' | 'orchestrator' | 'pipelines' | 'workItems',
  ): string {
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

  workItemHistoryDir(): string {
    return join(this.historyDir(), 'pipeline', 'items');
  }

  pipelineArchiveDir(): string {
    return join(this.historyDir(), 'pipeline', 'projects');
  }

  /** Per-stage run records (prompts, full outputs) for one work item. */
  workItemHistoryFile(workItemId: string): string {
    return join(this.workItemHistoryDir(), `${workItemId}.jsonl`);
  }

  /** Terminal (done/cancelled) work items archived per project. */
  pipelineArchiveFile(projectId: string): string {
    return join(this.pipelineArchiveDir(), `${projectId}.jsonl`);
  }

  orchestratorWorkdir(): string {
    return join(this.root, 'orchestrator');
  }
}
