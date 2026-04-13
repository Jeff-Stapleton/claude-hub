import type { DiscordChannelConfig } from '@claude-hub/core';
import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import type { ChannelAdapter, ChannelMessageHandler } from './types.js';

/**
 * Discord DM adapter.
 *
 * v1 scope: DMs only. A DM from an allowlisted user is forwarded to the
 * orchestrator; the orchestrator's response comes back as a DM reply. We
 * never respond in guild channels — if the bot gets added to a guild, it
 * still only responds to direct messages.
 *
 * Discord.js requires the `MessageContent` intent for bots to see message
 * text, and the `DirectMessages` intent + DM partials to see DMs at all.
 * Both must be enabled on the bot in the Discord Developer Portal.
 */
export class DiscordChannelAdapter implements ChannelAdapter {
  readonly id = 'discord';
  readonly type = 'discord';

  private client: Client | null = null;
  private handler: ChannelMessageHandler | null = null;
  private state: 'connected' | 'disconnected' | 'error' = 'disconnected';
  private errorMsg: string | undefined = undefined;

  constructor(private readonly config: DiscordChannelConfig) {}

  async connect(): Promise<void> {
    if (!this.config.botToken) {
      this.state = 'disconnected';
      this.errorMsg = 'no bot token configured';
      return;
    }

    const client = new Client({
      intents: [
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.Guilds,
      ],
      // Required for the bot to receive DMs it wasn't already a party to
      // when the gateway session started.
      partials: [Partials.Channel, Partials.Message],
    });

    client.on(Events.MessageCreate, (msg) => {
      if (msg.author.bot) return;
      if (msg.guild) return; // DMs only
      if (!this.config.allowedUserIds.includes(msg.author.id)) return;
      if (!this.handler) return;
      this.handler({
        channelId: this.id,
        conversationId: msg.author.id,
        user: msg.author.username,
        text: msg.content,
        receivedAt: new Date().toISOString(),
      });
    });

    client.on(Events.Error, (err) => {
      this.state = 'error';
      this.errorMsg = err.message;
    });

    try {
      await client.login(this.config.botToken);
      this.state = 'connected';
      this.errorMsg = undefined;
      this.client = client;
    } catch (err) {
      this.state = 'error';
      this.errorMsg = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    await this.client?.destroy();
    this.client = null;
    this.state = 'disconnected';
  }

  async send(conversationId: string, text: string): Promise<void> {
    if (!this.client) throw new Error('discord not connected');
    const user = await this.client.users.fetch(conversationId);
    // Discord caps single messages at 2000 chars. Chunk naively at 1900 so
    // there's headroom for any attributed prefix we might add later.
    const chunks = chunkText(text, 1900);
    for (const c of chunks) {
      await user.send(c);
    }
  }

  onMessage(handler: ChannelMessageHandler): void {
    this.handler = handler;
  }

  status(): 'connected' | 'disconnected' | 'error' {
    return this.state;
  }

  lastError(): string | undefined {
    return this.errorMsg;
  }
}

function chunkText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let remaining = text;
  while (remaining.length > max) {
    // Prefer a boundary at a newline to avoid mid-sentence splits.
    let cut = remaining.lastIndexOf('\n', max);
    if (cut <= 0) cut = max;
    out.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining.length > 0) out.push(remaining);
  return out;
}
