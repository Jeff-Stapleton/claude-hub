import { VAULT_KEY_PATTERN, type Store, type VaultEntry } from '@claude-hub/core';
import type { FastifyInstance } from 'fastify';
import { redactVault, type RedactedVaultEntry } from '../vault.js';

interface CreateKeyBody {
  key?: string;
  value?: string;
}

interface SetValueBody {
  value?: string | null;
}

/**
 * Vault CRUD: the global key-value config store tools draw from at run time.
 * Values are write-only — every response is redacted to set/unset, and there
 * is deliberately no endpoint that returns a stored value.
 */
export async function registerVaultRoutes(app: FastifyInstance, store: Store): Promise<void> {
  app.get('/api/vault', async () => redactVault(store.vault(), store.toolbox()));

  app.post<{ Body: CreateKeyBody }>('/api/vault/keys', async (req, reply) => {
    const { key, value } = req.body ?? {};
    if (!key || typeof key !== 'string' || !VAULT_KEY_PATTERN.test(key)) {
      return reply.code(400).send({
        error:
          'key must be SCREAMING_SNAKE_CASE (letters, digits, underscores; starts with a letter)',
      });
    }
    if (value !== undefined && typeof value !== 'string') {
      return reply.code(400).send({ error: 'value must be a string' });
    }
    if (store.vault().some((e) => e.key === key)) {
      return reply.code(400).send({ error: `a vault key named "${key}" already exists` });
    }
    const now = new Date().toISOString();
    const entry: VaultEntry = {
      key,
      value: value !== undefined && value !== '' ? value : null,
      createdAt: now,
      updatedAt: now,
    };
    await store.update('vault', (current) => [...current, entry]);
    return redactEntry(store, entry);
  });

  app.put<{ Params: { key: string }; Body: SetValueBody }>(
    '/api/vault/keys/:key',
    async (req, reply) => {
      const existing = store.vault().find((e) => e.key === req.params.key);
      if (!existing) return reply.code(404).send({ error: 'not found' });
      const { value } = req.body ?? {};
      if (value !== null && (typeof value !== 'string' || value === '')) {
        return reply
          .code(400)
          .send({ error: 'value must be a non-empty string to set, or null to clear' });
      }
      const updated: VaultEntry = {
        ...existing,
        value,
        updatedAt: new Date().toISOString(),
      };
      await store.update('vault', (current) =>
        current.map((e) => (e.key === updated.key ? updated : e)),
      );
      return redactEntry(store, updated);
    },
  );

  app.delete<{ Params: { key: string } }>('/api/vault/keys/:key', async (req, reply) => {
    if (!store.vault().some((e) => e.key === req.params.key)) {
      return reply.code(404).send({ error: 'not found' });
    }
    const toolbox = store.toolbox();
    const requiredBy = [
      ...toolbox.skills.filter((s) => s.requiredEnv?.includes(req.params.key)).map((s) => s.name),
      ...toolbox.mcpServers
        .filter((m) => m.requiredEnv?.includes(req.params.key))
        .map((m) => m.name),
    ];
    if (requiredBy.length > 0) {
      return reply
        .code(409)
        .send({ error: `key is required by: ${requiredBy.join(', ')}` });
    }
    await store.update('vault', (current) => current.filter((e) => e.key !== req.params.key));
    return { ok: true };
  });
}

function redactEntry(store: Store, entry: VaultEntry): RedactedVaultEntry {
  const redacted = redactVault([entry], store.toolbox());
  return redacted[0]!;
}
