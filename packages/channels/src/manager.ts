import type { DiscordChannelConfig, Store } from '@claude-hub/core';
import { DiscordChannelAdapter } from './discord.js';
import type { ChannelAdapter, ChannelMessageHandler } from './types.js';

/**
 * Owns the lifecycle of the active Discord adapter. Reconnects when the
 * store's Discord config changes (token or allowlist edit via the UI).
 */
export class ChannelManager {
  private discord: DiscordChannelAdapter | null = null;
  private handler: ChannelMessageHandler | null = null;
  /** Hash of the config we last connected with, for change detection. */
  private lastConfigKey: string | null = null;

  constructor(private readonly store: Store) {}

  start(handler: ChannelMessageHandler): void {
    this.handler = handler;
    void this.reconcile();
    this.store.on('change', (key) => {
      if (key === 'channels') void this.reconcile();
    });
  }

  async stop(): Promise<void> {
    await this.discord?.disconnect();
    this.discord = null;
  }

  /** Report status for the UI `/api/state` payload. */
  discordStatus(): { status: 'connected' | 'disconnected' | 'error'; error?: string } {
    const a = this.discord;
    if (!a) return { status: 'disconnected' };
    const err = a.lastError();
    return { status: a.status(), ...(err ? { error: err } : {}) };
  }

  private async reconcile(): Promise<void> {
    const cfg = this.store.channels().find(
      (c): c is DiscordChannelConfig => c.type === 'discord',
    );
    const key = cfg ? `${cfg.botToken}|${cfg.allowedUserIds.join(',')}` : '';

    if (key === this.lastConfigKey) return; // nothing material changed
    this.lastConfigKey = key;

    // Teardown existing connection before applying new config.
    await this.discord?.disconnect();
    this.discord = null;

    if (!cfg || !cfg.botToken) return;

    const adapter = new DiscordChannelAdapter(cfg);
    if (this.handler) adapter.onMessage(this.handler);
    this.discord = adapter;
    try {
      await adapter.connect();
    } catch (err) {
      // Adapter already set its own internal error state; we just log here
      // so the failure reaches the server logs.
      console.error('[channels] discord connect failed:', err);
    }
  }

  /** Send a reply through the adapter that produced the source message. */
  async send(channelId: string, conversationId: string, text: string): Promise<void> {
    if (channelId === 'discord' && this.discord) {
      await this.discord.send(conversationId, text);
      return;
    }
    throw new Error(`no active adapter for channelId=${channelId}`);
  }
}
