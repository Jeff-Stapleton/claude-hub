import type { DiscordChannelConfig, Store } from '@claude-hub/core';
import type { FastifyInstance } from 'fastify';

interface DiscordSettingsBody {
  /** Empty string / missing clears the token and disables the adapter. */
  botToken?: string;
  allowedUserIds?: string[];
}

/**
 * The Channels tab in the UI posts here to update the single Discord
 * channel config. It's the one place the plaintext bot token is accepted;
 * every subsequent read of the state redacts it to `botTokenSet: boolean`.
 */
export async function registerChannelRoutes(app: FastifyInstance, store: Store): Promise<void> {
  app.put<{ Body: DiscordSettingsBody }>('/api/channels/discord', async (req, reply) => {
    const { botToken, allowedUserIds } = req.body ?? ({} as DiscordSettingsBody);

    if (allowedUserIds !== undefined && !Array.isArray(allowedUserIds)) {
      return reply.code(400).send({ error: 'allowedUserIds must be an array of strings' });
    }

    await store.update('channels', (current) => {
      const others = current.filter((c) => c.type !== 'discord');
      const existing = current.find(
        (c): c is DiscordChannelConfig => c.type === 'discord',
      );

      // Empty / absent token disables Discord: remove the entry entirely.
      if (botToken !== undefined && botToken.trim() === '') {
        return others;
      }

      const next: DiscordChannelConfig = {
        id: 'discord',
        type: 'discord',
        botToken: botToken ?? existing?.botToken ?? '',
        allowedUserIds: allowedUserIds ?? existing?.allowedUserIds ?? [],
      };
      return [...others, next];
    });

    return { ok: true };
  });
}
