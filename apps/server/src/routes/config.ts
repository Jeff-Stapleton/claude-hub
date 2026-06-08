import type {
  AgentProviderId,
  AgentProviderConfigs,
  AppConfig,
  Store,
} from '@claude-hub/core';
import type { FastifyInstance } from 'fastify';

type ConfigUpdateBody = Partial<
  Pick<AppConfig, 'defaultProvider'> & {
    providers: Partial<AgentProviderConfigs>;
  }
>;

export async function registerConfigRoutes(app: FastifyInstance, store: Store): Promise<void> {
  app.put<{ Body: ConfigUpdateBody }>('/api/config', async (req, reply) => {
    const body = req.body ?? {};

    if (
      body.defaultProvider !== undefined &&
      body.defaultProvider !== 'claude' &&
      body.defaultProvider !== 'cursor'
    ) {
      return reply.code(400).send({ error: 'defaultProvider must be claude or cursor' });
    }

    const next = await store.update('config', (current) => {
      const providers: AgentProviderConfigs = {
        claude: {
          ...current.providers.claude,
          ...(body.providers?.claude ?? {}),
          type: 'claude',
        },
        cursor: {
          ...current.providers.cursor,
          ...(body.providers?.cursor ?? {}),
          type: 'cursor',
        },
      };
      const defaultProvider = chooseDefaultProvider(
        body.defaultProvider ?? current.defaultProvider,
        providers,
      );
      return {
        ...current,
        defaultProvider,
        providers,
      };
    });

    return next;
  });
}

function chooseDefaultProvider(
  provider: AgentProviderId,
  providers: AgentProviderConfigs,
): AgentProviderId {
  if (providers[provider].enabled) return provider;
  if (providers.claude.enabled) return 'claude';
  return 'cursor';
}
