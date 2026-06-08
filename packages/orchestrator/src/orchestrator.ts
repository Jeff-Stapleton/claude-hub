import type { AgentRunner } from '@claude-hub/agent-runner';
import type { AgentProviderId, IncomingChannelMessage, Store } from '@claude-hub/core';

/**
 * Turns an incoming channel message into an agent provider run.
 *
 * v1 strategy (approach B per the plan): one CLI print run per
 * message, keyed on a per-conversation session id stored in
 * orchestrator.channelSessions. Simpler than a long-lived process, and we
 * get tree-kill / timeout / JSON envelope parsing from agent-runner.
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
      /** Working dir for orchestrator agent runs — its own area under ~/.claude-hub/. */
      workdir: string;
      /** Path to the Claude hub-mcp config, to be passed via --mcp-config. */
      claudeMcpConfigPath: string;
      /** Per-message hard timeout. Default 5 minutes. */
      timeoutMs?: number;
    },
    private readonly runner: AgentRunner,
  ) {}

  /** Key shape — kept together so storage and lookup can't drift. */
  private keyFor(provider: AgentProviderId, msg: IncomingChannelMessage): string {
    return `${provider}:${msg.channelId}:${msg.conversationId}`;
  }

  async handle(msg: IncomingChannelMessage): Promise<
    | { ok: true; text: string }
    | { ok: false; error: string }
  > {
    const provider = this.store.config().defaultProvider;
    const key = this.keyFor(provider, msg);

    // Chain onto any in-flight run for this conversation so messages stay
    // in order and don't race on the provider session file.
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
    const state = this.store.orchestrator();
    const provider = this.store.config().defaultProvider;
    const key = this.keyFor(provider, msg);
    const existing = state.channelSessions[key];

    const result = await this.runner.runProjectSession({
      provider,
      cwd: this.opts.workdir,
      prompt: msg.text,
      ...(existing ? { sessionId: existing } : {}),
      ...(provider === 'claude'
        ? { extraArgs: ['--mcp-config', this.opts.claudeMcpConfigPath] }
        : {}),
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
