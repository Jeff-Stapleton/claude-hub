import type { GitCredential, Store } from '@claude-hub/core';
import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { checkRemote, inspectLocalPath } from '../git/ops.js';

interface InspectPathBody {
  path?: string;
}

interface CheckRemoteBody {
  url?: string;
  credentialId?: string;
}

interface CreateCredentialBody {
  name?: string;
  token?: string;
}

/** What the UI sees of a credential: everything but the token. */
export interface RedactedGitCredential {
  id: string;
  name: string;
  provider: GitCredential['provider'];
  tokenSet: true;
  createdAt: string;
}

export function redactCredential(cred: GitCredential): RedactedGitCredential {
  return {
    id: cred.id,
    name: cred.name,
    provider: cred.provider,
    tokenSet: true,
    createdAt: cred.createdAt,
  };
}

/**
 * Wizard-side git validation plus hub-level credential CRUD. Tokens are
 * write-only: stored in gitCredentials.json, referenced by id, never
 * returned by any endpoint (the channels botToken pattern).
 */
export async function registerGitRoutes(app: FastifyInstance, store: Store): Promise<void> {
  app.post<{ Body: InspectPathBody }>('/api/git/inspect-path', async (req, reply) => {
    const { path } = req.body ?? {};
    if (!path || typeof path !== 'string' || !isAbsolute(path)) {
      return reply.code(400).send({ error: 'path must be an absolute path' });
    }
    return inspectLocalPath(path);
  });

  app.post<{ Body: CheckRemoteBody }>('/api/git/check-remote', async (req, reply) => {
    const { url, credentialId } = req.body ?? {};
    if (!url || typeof url !== 'string' || !url.trim()) {
      return reply.code(400).send({ error: 'url is required' });
    }
    let token: string | undefined;
    if (credentialId !== undefined) {
      const cred = store.gitCredentials().find((c) => c.id === credentialId);
      if (!cred) return reply.code(400).send({ error: 'unknown credentialId' });
      token = cred.token;
    }
    try {
      await checkRemote(url.trim(), token);
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });

  app.get('/api/git/credentials', async () =>
    store.gitCredentials().map(redactCredential),
  );

  app.post<{ Body: CreateCredentialBody }>('/api/git/credentials', async (req, reply) => {
    const { name, token } = req.body ?? {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return reply.code(400).send({ error: 'name is required' });
    }
    if (!token || typeof token !== 'string' || !token.trim()) {
      return reply.code(400).send({ error: 'token is required' });
    }
    if (store.gitCredentials().some((c) => c.name === name.trim())) {
      return reply.code(400).send({ error: `a credential named "${name.trim()}" already exists` });
    }
    const cred: GitCredential = {
      id: randomUUID(),
      name: name.trim(),
      provider: 'github',
      token: token.trim(),
      createdAt: new Date().toISOString(),
    };
    await store.update('gitCredentials', (current) => [...current, cred]);
    return redactCredential(cred);
  });

  app.delete<{ Params: { id: string } }>('/api/git/credentials/:id', async (req, reply) => {
    const { id } = req.params;
    if (!store.gitCredentials().some((c) => c.id === id)) {
      return reply.code(404).send({ error: 'not found' });
    }
    await store.update('gitCredentials', (current) => current.filter((c) => c.id !== id));
    // Scrub dangling references so repos never point at a deleted credential.
    const affected = store
      .projects()
      .some((p) => p.repos.some((r) => r.credentialId === id));
    if (affected) {
      await store.update('projects', (current) =>
        current.map((p) => ({
          ...p,
          repos: p.repos.map((r) => {
            if (r.credentialId !== id) return r;
            const { credentialId: _dropped, ...rest } = r;
            return rest;
          }),
        })),
      );
    }
    return { ok: true };
  });
}
