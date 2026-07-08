import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { HubPaths, Store } from '@claude-hub/core';
import { CCConfigReader } from '@claude-hub/cc-config-reader';
import { registerToolboxRoutes } from '../src/routes/toolbox.js';
import { registerVaultRoutes } from '../src/routes/vault.js';
import { buildUIState } from '../src/state.js';
import { seedBundledSkills } from '../src/toolboxSeed.js';

const SECRET = 'PLAINTEXT_VAULT_SECRET_VALUE';

const SKILL_PAYLOAD = {
  name: 'github-helper',
  description: 'Works with GitHub',
  body: '# GitHub helper',
  tags: ['git'],
  requiredEnv: ['GITHUB_TOKEN', 'GITHUB_TOKEN', 'GITHUB_ORG'],
};

describe('vault routes', () => {
  let app: FastifyInstance;
  let store: Store;
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'vault-routes-'));
    store = new Store(new HubPaths(root));
    await store.load();
    app = Fastify();
    await registerVaultRoutes(app, store);
    await registerToolboxRoutes(app, store);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  it('POST /api/vault/keys creates a key and never echoes the value', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/vault/keys',
      payload: { key: 'GITHUB_TOKEN', value: SECRET },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(SECRET);
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({ key: 'GITHUB_TOKEN', valueSet: true });
    // The plaintext IS stored for run-time injection.
    expect(store.vault()[0]!.value).toBe(SECRET);
  });

  it('POST /api/vault/keys without a value creates an unset key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/vault/keys',
      payload: { key: 'AWS_REGION' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).valueSet).toBe(false);
    expect(store.vault()[0]!.value).toBeNull();
  });

  it('POST /api/vault/keys rejects bad key names and duplicates', async () => {
    for (const key of ['lowercase', '1STARTS_WITH_DIGIT', 'HAS-DASH', 'HAS SPACE', '']) {
      const res = await app.inject({ method: 'POST', url: '/api/vault/keys', payload: { key } });
      expect(res.statusCode, `key "${key}"`).toBe(400);
    }
    await app.inject({ method: 'POST', url: '/api/vault/keys', payload: { key: 'DUP_KEY' } });
    const dup = await app.inject({
      method: 'POST',
      url: '/api/vault/keys',
      payload: { key: 'DUP_KEY' },
    });
    expect(dup.statusCode).toBe(400);
    expect(JSON.parse(dup.body).error).toMatch(/already exists/);
  });

  it('PUT /api/vault/keys/:key sets and clears values, redacted', async () => {
    await app.inject({ method: 'POST', url: '/api/vault/keys', payload: { key: 'CLICKUP_API_KEY' } });

    const set = await app.inject({
      method: 'PUT',
      url: '/api/vault/keys/CLICKUP_API_KEY',
      payload: { value: SECRET },
    });
    expect(set.statusCode).toBe(200);
    expect(set.body).not.toContain(SECRET);
    expect(JSON.parse(set.body).valueSet).toBe(true);
    expect(store.vault()[0]!.value).toBe(SECRET);

    const clear = await app.inject({
      method: 'PUT',
      url: '/api/vault/keys/CLICKUP_API_KEY',
      payload: { value: null },
    });
    expect(clear.statusCode).toBe(200);
    expect(JSON.parse(clear.body).valueSet).toBe(false);
    expect(store.vault()[0]!.value).toBeNull();
  });

  it('PUT rejects empty-string values and unknown keys', async () => {
    const missing = await app.inject({
      method: 'PUT',
      url: '/api/vault/keys/NOPE',
      payload: { value: 'x' },
    });
    expect(missing.statusCode).toBe(404);

    await app.inject({ method: 'POST', url: '/api/vault/keys', payload: { key: 'SOME_KEY' } });
    const empty = await app.inject({
      method: 'PUT',
      url: '/api/vault/keys/SOME_KEY',
      payload: { value: '' },
    });
    expect(empty.statusCode).toBe(400);
  });

  it('DELETE removes unreferenced keys and 409s on required ones', async () => {
    await app.inject({ method: 'POST', url: '/api/toolbox/skills', payload: SKILL_PAYLOAD });

    const required = await app.inject({ method: 'DELETE', url: '/api/vault/keys/GITHUB_TOKEN' });
    expect(required.statusCode).toBe(409);
    expect(JSON.parse(required.body).error).toContain('github-helper');
    expect(store.vault().some((e) => e.key === 'GITHUB_TOKEN')).toBe(true);

    await app.inject({ method: 'POST', url: '/api/vault/keys', payload: { key: 'UNUSED_KEY' } });
    const free = await app.inject({ method: 'DELETE', url: '/api/vault/keys/UNUSED_KEY' });
    expect(free.statusCode).toBe(200);
    expect(store.vault().some((e) => e.key === 'UNUSED_KEY')).toBe(false);
  });

  it('GET /api/vault reports requiredBy tool names without values', async () => {
    await app.inject({ method: 'POST', url: '/api/toolbox/skills', payload: SKILL_PAYLOAD });
    await app.inject({
      method: 'PUT',
      url: '/api/vault/keys/GITHUB_TOKEN',
      payload: { value: SECRET },
    });

    const res = await app.inject({ method: 'GET', url: '/api/vault' });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(SECRET);
    const entries = JSON.parse(res.body) as Array<{
      key: string;
      valueSet: boolean;
      requiredBy: { skills: string[]; mcpServers: string[] };
    }>;
    const token = entries.find((e) => e.key === 'GITHUB_TOKEN')!;
    expect(token.valueSet).toBe(true);
    expect(token.requiredBy.skills).toEqual(['github-helper']);
    const org = entries.find((e) => e.key === 'GITHUB_ORG')!;
    expect(org.valueSet).toBe(false);
  });
});

describe('toolbox requiredEnv auto-create', () => {
  let app: FastifyInstance;
  let store: Store;
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'vault-autocreate-'));
    store = new Store(new HubPaths(root));
    await store.load();
    app = Fastify();
    await registerToolboxRoutes(app, store);
    await registerVaultRoutes(app, store);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  it('POST skill validates and dedupes requiredEnv and auto-creates unset keys', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/toolbox/skills',
      payload: SKILL_PAYLOAD,
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).requiredEnv).toEqual(['GITHUB_TOKEN', 'GITHUB_ORG']);
    const keys = store.vault().map((e) => e.key);
    expect(keys.sort()).toEqual(['GITHUB_ORG', 'GITHUB_TOKEN']);
    for (const entry of store.vault()) expect(entry.value).toBeNull();
  });

  it('POST skill rejects invalid requiredEnv keys', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/toolbox/skills',
      payload: { ...SKILL_PAYLOAD, requiredEnv: ['not_screaming'] },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/requiredEnv/);
  });

  it('PUT skill auto-creates newly declared keys without touching set values', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/toolbox/skills',
      payload: SKILL_PAYLOAD,
    });
    const { id } = JSON.parse(create.body);
    await app.inject({
      method: 'PUT',
      url: '/api/vault/keys/GITHUB_TOKEN',
      payload: { value: SECRET },
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/api/toolbox/skills/${id}`,
      payload: { ...SKILL_PAYLOAD, requiredEnv: ['GITHUB_TOKEN', 'NEW_KEY'] },
    });
    expect(res.statusCode).toBe(200);
    const vault = store.vault();
    expect(vault.find((e) => e.key === 'GITHUB_TOKEN')!.value).toBe(SECRET);
    expect(vault.find((e) => e.key === 'NEW_KEY')!.value).toBeNull();
  });

  it('PUT skill clears a removed requiredEnv rather than keeping the stored one', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/toolbox/skills',
      payload: SKILL_PAYLOAD,
    });
    const { id } = JSON.parse(create.body);
    const res = await app.inject({
      method: 'PUT',
      url: `/api/toolbox/skills/${id}`,
      payload: { ...SKILL_PAYLOAD, requiredEnv: [] },
    });
    expect(res.statusCode).toBe(200);
    expect(store.toolbox().skills[0]!.requiredEnv).toBeUndefined();
  });

  it('POST MCP server auto-creates its required keys', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/toolbox/mcp-servers',
      payload: {
        name: 'clickup',
        transport: { type: 'http', url: 'https://example.com/mcp' },
        requiredEnv: ['CLICKUP_API_KEY'],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).requiredEnv).toEqual(['CLICKUP_API_KEY']);
    expect(store.vault().map((e) => e.key)).toEqual(['CLICKUP_API_KEY']);
  });
});

describe('UIState vault redaction', () => {
  let root: string;
  let store: Store;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'vault-state-'));
    store = new Store(new HubPaths(root));
    await store.load();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('exposes set/unset and requiredBy but never a value', async () => {
    const now = new Date().toISOString();
    await store.update('vault', [
      { key: 'GITHUB_TOKEN', value: SECRET, createdAt: now, updatedAt: now },
      { key: 'AWS_REGION', value: null, createdAt: now, updatedAt: now },
    ]);
    await store.update('toolbox', (t) => ({
      ...t,
      skills: [
        {
          id: 's1',
          name: 'github-helper',
          description: 'x',
          body: 'y',
          tags: [],
          requiredEnv: ['GITHUB_TOKEN'],
          source: 'user' as const,
          createdAt: now,
          updatedAt: now,
        },
      ],
    }));

    const state = await buildUIState(store, new CCConfigReader(join(root, 'fake-claude')));
    expect(JSON.stringify(state)).not.toContain(SECRET);
    expect(state.vault).toEqual([
      {
        key: 'GITHUB_TOKEN',
        valueSet: true,
        requiredBy: { skills: ['github-helper'], mcpServers: [] },
        createdAt: now,
        updatedAt: now,
      },
      {
        key: 'AWS_REGION',
        valueSet: false,
        requiredBy: { skills: [], mcpServers: [] },
        createdAt: now,
        updatedAt: now,
      },
    ]);
  });
});

describe('bundled skill requiredEnv seeding', () => {
  let root: string;
  let store: Store;
  let assetsDir: string;

  async function writeAsset(slug: string, version: number, requiredEnv: string): Promise<void> {
    await mkdir(join(assetsDir, slug), { recursive: true });
    await writeFile(
      join(assetsDir, slug, 'SKILL.md'),
      `---\nname: ${slug}\ndescription: Bundled skill\ntags: alpha\nrequiredEnv: ${requiredEnv}\nversion: ${version}\n---\n\nBody.\n`,
      'utf8',
    );
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'vault-seed-'));
    store = new Store(new HubPaths(root));
    await store.load();
    assetsDir = join(root, 'assets');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('parses requiredEnv frontmatter, drops invalid keys, and creates vault entries', async () => {
    await writeAsset('gh-skill', 1, 'GITHUB_TOKEN, bad-key, GITHUB_TOKEN');
    await seedBundledSkills(store, assetsDir);

    expect(store.toolbox().skills[0]!.requiredEnv).toEqual(['GITHUB_TOKEN']);
    expect(store.vault().map((e) => e.key)).toEqual(['GITHUB_TOKEN']);
    expect(store.vault()[0]!.value).toBeNull();
  });

  it('a reseed never clobbers a user-set value', async () => {
    await writeAsset('gh-skill', 1, 'GITHUB_TOKEN');
    await seedBundledSkills(store, assetsDir);
    await store.update('vault', (v) =>
      v.map((e) => (e.key === 'GITHUB_TOKEN' ? { ...e, value: SECRET } : e)),
    );

    await writeAsset('gh-skill', 2, 'GITHUB_TOKEN');
    await seedBundledSkills(store, assetsDir);
    expect(store.toolbox().skills[0]!.bundledVersion).toBe(2);
    expect(store.vault().find((e) => e.key === 'GITHUB_TOKEN')!.value).toBe(SECRET);
  });
});
