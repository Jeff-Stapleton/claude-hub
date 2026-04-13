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

  constructor(
    private readonly config: DiscordChannelConfig,
    /** Called whenever the adapter's status or error changes. */
    private readonly onStatusChange: () => void = () => {},
  ) {}

  async connect(): Promise<void> {
    if (!this.config.botToken) {
      this.state = 'disconnected';
      this.errorMsg = 'no bot token configured';
      return;
    }

    const client = new Client({
      intents: [
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.Guilds,
      ],
      // Required for the bot to receive DMs it wasn't already a party to
      // when the gateway session started.
      partials: [Partials.Channel, Partials.Message],
    });

    // Raw gateway logging — fires for every dispatch event Discord sends,
    // before discord.js's higher-level handlers. Lets us distinguish
    // "gateway isn't delivering anything" from "discord.js isn't routing
    // to MessageCreate".
    client.on('raw', (packet: { t?: string; d?: unknown }) => {
      if (!packet || !packet.t) return;
      // Filter to events relevant to DM / message debugging so we don't
      // spam PRESENCE_UPDATE / TYPING_START etc.
      const interesting = new Set([
        'READY',
        'RESUMED',
        'GUILD_CREATE',
        'GUILD_DELETE',
        'CHANNEL_CREATE',
        'MESSAGE_CREATE',
        'MESSAGE_UPDATE',
        'MESSAGE_DELETE',
      ]);
      if (!interesting.has(packet.t)) return;
      const d = packet.d as Record<string, unknown> | undefined;
      const summary =
        packet.t === 'MESSAGE_CREATE'
          ? ` author=${(d?.author as { username?: string } | undefined)?.username ?? '?'} guild_id=${d?.guild_id ?? 'DM'} content=${JSON.stringify(String(d?.content ?? '').slice(0, 60))}`
          : packet.t === 'GUILD_CREATE'
            ? ` name=${(d as { name?: string } | undefined)?.name ?? '?'}`
            : '';
      console.log(`[discord] raw: ${packet.t}${summary}`);
    });

    client.on(Events.MessageCreate, (msg) => {
      // Top-level log fires for EVERY message the gateway delivers, before
      // any filtering. If you DM the bot and don't see a line starting
      // with "[discord] msg:" here, the gateway never delivered the
      // message — it's a Discord-side issue (privacy settings, another
      // process holding the bot's gateway session, etc.), not a hub bug.
      console.log(
        `[discord] msg: from=${msg.author.username} (id=${msg.author.id}) bot=${msg.author.bot} guild=${msg.guild?.name ?? 'DM'} content=${JSON.stringify(msg.content.slice(0, 80))}`,
      );

      if (msg.author.bot) {
        return;
      }
      if (msg.guild) {
        return;
      }
      if (!this.config.allowedUserIds.includes(msg.author.id)) {
        console.log(
          `[discord] dropping DM — id=${msg.author.id} not in allowlist (${this.config.allowedUserIds.length} entries)`,
        );
        return;
      }
      if (!this.handler) {
        console.log('[discord] no orchestrator handler attached; dropping DM');
        return;
      }
      console.log(`[discord] forwarding DM to orchestrator`);
      this.handler({
        channelId: this.id,
        conversationId: msg.author.id,
        user: msg.author.username,
        text: msg.content,
        receivedAt: new Date().toISOString(),
      });
    });

    client.on(Events.Error, (err) => {
      console.error('[discord] client error:', err.message);
      this.state = 'error';
      this.errorMsg = err.message;
      this.onStatusChange();
    });

    // Surface gateway lifecycle so we can diagnose "ready but not
    // receiving" scenarios — most often caused by another process
    // (e.g. OpenClaw) holding the same bot token's gateway session and
    // forcing us into a resume loop or session replacement.
    client.on(Events.ShardDisconnect, (event, shardId) => {
      console.warn(
        `[discord] shard ${shardId} disconnected (code=${event.code} reason=${event.reason || 'n/a'})`,
      );
      this.state = 'disconnected';
      this.errorMsg = `gateway disconnected (code=${event.code})`;
      this.onStatusChange();
    });
    client.on(Events.ShardReconnecting, (shardId) => {
      console.warn(`[discord] shard ${shardId} reconnecting...`);
    });
    client.on(Events.ShardResume, (shardId, replayed) => {
      console.log(`[discord] shard ${shardId} resumed (replayed ${replayed} events)`);
    });
    client.on(Events.Invalidated, () => {
      console.error(
        '[discord] session invalidated — another process may have claimed this bot token',
      );
      this.state = 'error';
      this.errorMsg = 'session invalidated (another process claimed this token?)';
      this.onStatusChange();
    });

    // login() resolves on auth, but the bot isn't ready to receive DMs
    // until the gateway READY event. Promote 'connected' status only then.
    client.once(Events.ClientReady, (c) => {
      const guilds = c.guilds.cache.map((g) => g.name).join(', ') || '(none)';
      console.log(
        `[discord] ready — logged in as ${c.user.tag} (id=${c.user.id}) guilds=[${guilds}]`,
      );
      this.state = 'connected';
      this.errorMsg = undefined;
      this.onStatusChange();
    });

    try {
      console.log('[discord] login...');
      await client.login(this.config.botToken);
      // Provisionally mark connected; ClientReady will reaffirm.
      this.state = 'connected';
      this.errorMsg = undefined;
      this.client = client;
    } catch (err) {
      console.error('[discord] login failed:', err);
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
