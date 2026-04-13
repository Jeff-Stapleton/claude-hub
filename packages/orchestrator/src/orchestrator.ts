import { spawnProjectSession } from '@claude-hub/cc-runner';
import type { IncomingChannelMessage, Store } from '@claude-hub/core';

/**
 * Turns an incoming channel message into a Claude Code run.
 *
 * v1 strategy (approach B per the plan): one `claude -p --resume` per
 * message, keyed on a per-conversation session id stored in
 * orchestrator.channelSessions. Simpler than a long-lived claude process,
 * and we get tree-kill / timeout / JSON envelope parsing from cc-runner
 * for free.
 *
 * Concurrency: per-conversation serialization. If two DMs arrive from the
 * same user in quick succession, we queue them so they both land in the
 * same session in order rather than racing on the session file.
 */
export class Orchestrator {
  private queues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly store: Store,
    private readonly opts: {
      /** Working dir for orchestrator CC runs — its own area under ~/.claude-hub/. */
      workdir: string;
      /** Path to the hub-mcp config, to be passed via --mcp-config. */
      mcpConfigPath: string;
      /** Per-message hard timeout. Default 5 minutes. */
      timeoutMs?: number;
    },
  ) {}

  /** Key shape — kept together so storage and lookup can't drift. */
  private keyFor(msg: IncomingChannelMessage): string {
    return `${msg.channelId}:${msg.conversationId}`;
  }

  async handle(msg: IncomingChannelMessage): Promise<
    | { ok: true; text: string }
    | { ok: false; error: string }
  > {
    const key = this.keyFor(msg);

    // Chain onto any in-flight run for this conversation so messages stay
    // in order and don't race on the CC session file.
    const prior = this.queues.get(key) ?? Promise.resolve();
    const work = prior
      .catch(() => undefined) // prior failure shouldn't block the next message
      .then(() => this.doHandle(msg));
    this.queues.set(
      key,
      work.finally(() => {
        // Clear the slot only if it still points at our promise; a newer
        // message may have already chained onto it.
        if (this.queues.get(key) === work) this.queues.delete(key);
      }),
    );
    return work;
  }

  private async doHandle(msg: IncomingChannelMessage): Promise<
    | { ok: true; text: string }
    | { ok: false; error: string }
  > {
    const key = this.keyFor(msg);
    const state = this.store.orchestrator();
    const existing = state.channelSessions[key];

    const result = await spawnProjectSession({
      cwd: this.opts.workdir,
      prompt: msg.text,
      ...(existing ? { sessionId: existing } : {}),
      extraArgs: ['--mcp-config', this.opts.mcpConfigPath],
      ...(this.opts.timeoutMs ? { timeoutMs: this.opts.timeoutMs } : {}),
    });

    if (!result.ok) {
      await this.setStatus('error', result.error);
      return { ok: false, error: result.error };
    }

    // Persist the resulting session id so follow-up DMs continue this session.
    await this.store.update('orchestrator', (current) => ({
      ...current,
      status: 'running' as const,
      startedAt: current.startedAt ?? new Date().toISOString(),
      channelSessions: { ...current.channelSessions, [key]: result.sessionId },
    }));

    return { ok: true, text: result.text };
  }

  private async setStatus(
    status: 'error' | 'running' | 'stopped',
    lastError?: string,
  ): Promise<void> {
    await this.store.update('orchestrator', (current) => ({
      ...current,
      status,
      ...(lastError ? { lastError } : {}),
    }));
  }
}
