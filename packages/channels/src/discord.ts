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
      // For DMs, every one of these can be the object that's "partial" at
      // dispatch time. Missing one causes discord.js to silently skip the
      // typed emit when resolution fails — raw MESSAGE_CREATE fires but
      // the MessageCreate event never does. User + GuildMember added
      // defensively; not strictly required but harmless.
      partials: [
        Partials.Channel,
        Partials.Message,
        Partials.User,
        Partials.GuildMember,
        Partials.Reaction,
      ],
    });

    // Surface discord.js's own warnings — they often name the exact
    // partial or cache miss that's blocking event emit.
    client.on(Events.Warn, (info) => console.warn('[discord warn]', info));
    client.on(Events.Debug, (info) => {
      // debug is very chatty; filter to probable failure hints.
      if (
        info.includes('error') ||
        info.includes('failed') ||
        info.includes('unable') ||
        info.includes('dropped') ||
        info.includes('missing')
      ) {
        console.log('[discord debug]', info);
      }
    });

    // Raw gateway driver for DM messages.
    //
    // discord.js v14.16.3 has a bug where the typed MessageCreate event
    // never fires for DMs despite the raw MESSAGE_CREATE dispatch
    // arriving — observed directly (see commit history). The partial
    // hydration step for the DM channel silently drops the emit. Rather
    // than chase discord.js internals, we decode the raw packet
    // ourselves for DMs. Guild messages still flow through the typed
    // MessageCreate handler below (which currently drops them — v1 is
    // DM-only).
    client.on('raw', (packet: { t?: string; d?: unknown }) => {
      if (!packet || !packet.t) return;

      // Filter logging noise — keep only the events useful for
      // diagnosing DM delivery.
      const logged = new Set([
        'READY',
        'RESUMED',
        'GUILD_CREATE',
        'GUILD_DELETE',
        'CHANNEL_CREATE',
        'MESSAGE_CREATE',
        'MESSAGE_UPDATE',
        'MESSAGE_DELETE',
      ]);
      if (logged.has(packet.t)) {
        const d = packet.d as Record<string, unknown> | undefined;
        const summary =
          packet.t === 'MESSAGE_CREATE'
            ? ` author=${(d?.author as { username?: string } | undefined)?.username ?? '?'} guild_id=${d?.guild_id ?? 'DM'} content=${JSON.stringify(String(d?.content ?? '').slice(0, 60))}`
            : packet.t === 'GUILD_CREATE'
              ? ` name=${(d as { name?: string } | undefined)?.name ?? '?'}`
              : '';
        console.log(`[discord] raw: ${packet.t}${summary}`);
      }

      // DM delivery: handle MESSAGE_CREATE with no guild_id directly.
      if (packet.t !== 'MESSAGE_CREATE') return;
      const d = packet.d as
        | {
            author?: { id?: string; username?: string; bot?: boolean };
            content?: string;
            guild_id?: string;
            attachments?: Array<{
              id?: string;
              filename?: string;
              url?: string;
              size?: number;
              content_type?: string;
            }>;
          }
        | undefined;
      if (!d || !d.author || !d.author.id || d.author.bot) return;
      if (d.guild_id) return; // DMs only (guild messages flow through MessageCreate below)

      if (!this.config.allowedUserIds.includes(d.author.id)) {
        console.log(
          `[discord] dropping DM — id=${d.author.id} not in allowlist (${this.config.allowedUserIds.length} entries)`,
        );
        return;
      }
      if (!this.handler) {
        console.log('[discord] no orchestrator handler attached; dropping DM');
        return;
      }

      // Download text-based attachments and inline them into the prompt.
      // Binary files are noted but not fetched.
      const attachments = d.attachments ?? [];
      void (async () => {
        let text = d.content ?? '';
        if (attachments.length > 0) {
          const parts = await Promise.all(attachments.map(fetchAttachment));
          const inlined = parts.filter((p) => p.length > 0).join('\n\n');
          if (inlined.length > 0) {
            text = text.length > 0 ? `${text}\n\n${inlined}` : inlined;
          }
        }

        console.log(
          `[discord] forwarding DM to orchestrator (via raw path)${attachments.length > 0 ? ` with ${attachments.length} attachment(s)` : ''}`,
        );
        this.handler!({
          channelId: this.id,
          conversationId: d.author!.id!,
          user: d.author!.username ?? d.author!.id!,
          text,
          receivedAt: new Date().toISOString(),
        });
      })().catch((err) => {
        console.error('[discord] error processing DM attachments:', err);
      });
    });

    // Typed MessageCreate handler covers guild messages only — DMs go
    // through the raw handler above to work around discord.js v14's
    // silent DM emit failure. If a future discord.js version starts
    // firing MessageCreate for DMs, we defensively drop them here to
    // avoid double-forwarding.
    client.on(Events.MessageCreate, (msg) => {
      if (msg.author.bot) return;
      if (!msg.guild) return; // DMs handled by raw path
      // v1 doesn't respond in guild channels at all.
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

// ---------------------------------------------------------------------------
// Attachment fetching
// ---------------------------------------------------------------------------

/** File extensions we'll download and inline as text. Everything else is noted but skipped. */
const TEXT_EXTENSIONS = new Set([
  '.md', '.txt', '.json', '.jsonl', '.csv', '.tsv', '.xml', '.yaml', '.yml',
  '.toml', '.ini', '.cfg', '.conf', '.env', '.env.example',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.c', '.cpp', '.h', '.hpp',
  '.cs', '.swift', '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd',
  '.sql', '.graphql', '.gql',
  '.html', '.htm', '.css', '.scss', '.less', '.svg',
  '.dockerfile', '.tf', '.hcl',
  '.log', '.diff', '.patch',
]);

/** Max bytes to fetch per attachment. Prevents a multi-GB file from OOMing the hub. */
const MAX_ATTACHMENT_BYTES = 512 * 1024; // 512 KB

function isTextFile(filename: string, contentType?: string): boolean {
  if (contentType?.startsWith('text/')) return true;
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
}

async function fetchAttachment(att: {
  filename?: string;
  url?: string;
  size?: number;
  content_type?: string;
}): Promise<string> {
  const name = att.filename ?? 'unknown';
  if (!att.url) return `[Attachment: ${name} — no URL]`;

  if (!isTextFile(name, att.content_type)) {
    return `[Attachment: ${name} (${att.content_type ?? 'binary'}) — skipped, not a text file]`;
  }

  if (att.size !== undefined && att.size > MAX_ATTACHMENT_BYTES) {
    return `[Attachment: ${name} — skipped, ${(att.size / 1024).toFixed(0)} KB exceeds ${MAX_ATTACHMENT_BYTES / 1024} KB limit]`;
  }

  try {
    const res = await fetch(att.url);
    if (!res.ok) return `[Attachment: ${name} — download failed: HTTP ${res.status}]`;
    const body = await res.text();
    // Double-check actual size after download (Discord CDN doesn't always
    // include Content-Length, and size in the payload can be stale).
    if (body.length > MAX_ATTACHMENT_BYTES) {
      return `[Attachment: ${name} — truncated to ${MAX_ATTACHMENT_BYTES / 1024} KB]\n--- ${name} ---\n${body.slice(0, MAX_ATTACHMENT_BYTES)}\n--- end of ${name} (truncated) ---`;
    }
    return `--- ${name} ---\n${body}\n--- end of ${name} ---`;
  } catch (err) {
    return `[Attachment: ${name} — download error: ${err instanceof Error ? err.message : String(err)}]`;
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
