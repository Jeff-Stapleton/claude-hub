import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { HubPaths, Store, type ToolboxSkill } from '@claude-hub/core';
import { CCConfigReader } from '@claude-hub/cc-config-reader';
import type { PipelineRunner } from '@claude-hub/pipeline';
import { registerPipelineRoutes } from '../src/routes/pipeline.js';
import { registerToolboxRoutes } from '../src/routes/toolbox.js';
import { buildUIState } from '../src/state.js';
import { seedBundledSkills } from '../src/toolboxSeed.js';

const SKILL_PAYLOAD = {
  name: 'my-skill',
  description: 'Does helpful things',
  body: '# My skill\n\nInstructions here.',
  tags: ['git', 'Workflow', 'git'],
};

const STDIO_SERVER_PAYLOAD = {
  name: 'aws-tools',
  description: 'AWS helpers',
  transport: {
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'aws-mcp'],
    env: { AWS_SECRET_ACCESS_KEY: 'SUPER_SECRET_AWS_VALUE' },
  },
  tags: ['aws'],
};

describe('toolbox routes', () => {
  let app: FastifyInstance;
  let store: Store;
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'toolbox-routes-'));
    store = new Store(new HubPaths(root));
    await store.load();
    app = Fastify();
    await registerToolboxRoutes(app, store);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  it('POST /api/toolbox/skills creates a user skill with normalized tags', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/toolbox/skills',
      payload: SKILL_PAYLOAD,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.source).toBe('user');
    expect(body.tags).toEqual(['git', 'workflow']);
    expect(store.toolbox().skills).toHaveLength(1);
  });

  it('POST /api/toolbox/skills rejects a non-slug name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/toolbox/skills',
      payload: { ...SKILL_PAYLOAD, name: '../escape' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/toolbox/skills rejects a duplicate name', async () => {
    await app.inject({ method: 'POST', url: '/api/toolbox/skills', payload: SKILL_PAYLOAD });
    const res = await app.inject({
      method: 'POST',
      url: '/api/toolbox/skills',
      payload: SKILL_PAYLOAD,
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/already exists/);
  });

  it('PUT /api/toolbox/skills/:id updates a user skill', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/toolbox/skills',
      payload: SKILL_PAYLOAD,
    });
    const { id } = JSON.parse(create.body);
    const res = await app.inject({
      method: 'PUT',
      url: `/api/toolbox/skills/${id}`,
      payload: { ...SKILL_PAYLOAD, description: 'Updated', tags: ['new-tag'] },
    });
    expect(res.statusCode).toBe(200);
    const skill = store.toolbox().skills[0]!;
    expect(skill.description).toBe('Updated');
    expect(skill.tags).toEqual(['new-tag']);
  });

  it('PUT/DELETE on bundled skills return 400', async () => {
    const bundled: ToolboxSkill = {
      id: 'bundled-example',
      name: 'example',
      description: 'x',
      body: 'y',
      tags: [],
      source: 'bundled',
      bundledVersion: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await store.update('toolbox', (t) => ({ ...t, skills: [bundled] }));

    const put = await app.inject({
      method: 'PUT',
      url: '/api/toolbox/skills/bundled-example',
      payload: SKILL_PAYLOAD,
    });
    expect(put.statusCode).toBe(400);
    const del = await app.inject({ method: 'DELETE', url: '/api/toolbox/skills/bundled-example' });
    expect(del.statusCode).toBe(400);
    expect(store.toolbox().skills).toHaveLength(1);
  });

  it('POST /api/toolbox/mcp-servers creates a server and redacts env values in the response', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/toolbox/mcp-servers',
      payload: STDIO_SERVER_PAYLOAD,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('SUPER_SECRET_AWS_VALUE');
    const body = JSON.parse(res.body);
    expect(body.transport.envKeys).toEqual(['AWS_SECRET_ACCESS_KEY']);
    // The plaintext value IS stored for run-time injection.
    const stored = store.toolbox().mcpServers[0]!;
    expect(stored.transport.type).toBe('stdio');
    expect((stored.transport as { env?: Record<string, string> }).env).toEqual({
      AWS_SECRET_ACCESS_KEY: 'SUPER_SECRET_AWS_VALUE',
    });
  });

  it('PUT /api/toolbox/mcp-servers/:id keeps stored secrets for blank env values', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/toolbox/mcp-servers',
      payload: STDIO_SERVER_PAYLOAD,
    });
    const { id } = JSON.parse(create.body);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/toolbox/mcp-servers/${id}`,
      payload: {
        ...STDIO_SERVER_PAYLOAD,
        transport: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', 'aws-mcp'],
          // Blank = keep stored; new key gets a real value.
          env: { AWS_SECRET_ACCESS_KEY: '', AWS_REGION: 'us-east-1' },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const stored = store.toolbox().mcpServers[0]!;
    expect((stored.transport as { env?: Record<string, string> }).env).toEqual({
      AWS_SECRET_ACCESS_KEY: 'SUPER_SECRET_AWS_VALUE',
      AWS_REGION: 'us-east-1',
    });
  });

  it('POST /api/toolbox/mcp-servers rejects a bad transport', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/toolbox/mcp-servers',
      payload: { name: 'bad', transport: { type: 'carrier-pigeon' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('DELETE scrubs the tool id from pipeline stage assignments', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/toolbox/skills',
      payload: SKILL_PAYLOAD,
    });
    const { id } = JSON.parse(create.body);
    await store.update('pipelines', [
      {
        projectId: 'p1',
        stages: {
          intake: { enabled: true, gate: 'auto' as const },
          spec: { enabled: true, gate: 'auto' as const, skills: [id, 'other-id'] },
          code: { enabled: true, gate: 'auto' as const, skills: [id] },
          test: { enabled: false, gate: 'auto' as const },
          deploy: { enabled: false, gate: 'auto' as const },
          monitor: { enabled: false, gate: 'auto' as const },
        },
        updatedAt: new Date().toISOString(),
      },
    ]);

    const res = await app.inject({ method: 'DELETE', url: `/api/toolbox/skills/${id}` });
    expect(res.statusCode).toBe(200);
    const stages = store.pipelines()[0]!.stages;
    expect(stages.spec.skills).toEqual(['other-id']);
    expect(stages.code.skills).toBeUndefined();
  });
});

describe('pipeline PUT with tool assignments', () => {
  let app: FastifyInstance;
  let store: Store;
  let root: string;

  const baseStages = () => ({
    intake: { enabled: true, gate: 'auto' },
    spec: { enabled: true, gate: 'auto' },
    code: { enabled: true, gate: 'auto' },
    test: { enabled: false, gate: 'auto' },
    deploy: { enabled: false, gate: 'auto' },
    monitor: { enabled: false, gate: 'auto' },
  });

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'toolbox-pipeline-'));
    store = new Store(new HubPaths(root));
    await store.load();
    await store.update('projects', [
      { id: 'p1', path: '/tmp/proj', addedAt: new Date().toISOString() },
    ]);
    app = Fastify();
    await registerPipelineRoutes(app, store, {} as PipelineRunner);
    await registerToolboxRoutes(app, store);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  it('accepts known tool ids and drops empty arrays', async () => {
    const skillRes = await app.inject({
      method: 'POST',
      url: '/api/toolbox/skills',
      payload: SKILL_PAYLOAD,
    });
    const skillId = JSON.parse(skillRes.body).id;

    const stages = baseStages() as Record<string, Record<string, unknown>>;
    stages.spec!.skills = [skillId];
    stages.code!.skills = [];
    const res = await app.inject({
      method: 'PUT',
      url: '/api/projects/p1/pipeline',
      payload: { stages },
    });
    expect(res.statusCode).toBe(200);
    const saved = store.pipelines()[0]!.stages;
    expect(saved.spec.skills).toEqual([skillId]);
    expect(saved.code.skills).toBeUndefined();
  });

  it('rejects unknown tool ids with a 400', async () => {
    const stages = baseStages() as Record<string, Record<string, unknown>>;
    stages.spec!.mcpServers = ['no-such-id'];
    const res = await app.inject({
      method: 'PUT',
      url: '/api/projects/p1/pipeline',
      payload: { stages },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/unknown mcpServers id/);
  });
});

describe('UIState toolbox redaction', () => {
  let root: string;
  let store: Store;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'toolbox-state-'));
    store = new Store(new HubPaths(root));
    await store.load();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('never includes MCP env or header values', async () => {
    await store.update('toolbox', (t) => ({
      ...t,
      mcpServers: [
        {
          id: 'm1',
          name: 'stdio-server',
          transport: {
            type: 'stdio' as const,
            command: 'npx',
            env: { TOKEN: 'STDIO_SECRET_VALUE' },
          },
          tags: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'm2',
          name: 'http-server',
          transport: {
            type: 'http' as const,
            url: 'https://example.com/mcp',
            headers: { Authorization: 'Bearer HTTP_SECRET_VALUE' },
          },
          tags: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    }));

    const state = await buildUIState(store, new CCConfigReader(join(root, 'fake-claude')));
    const json = JSON.stringify(state);
    expect(json).not.toContain('STDIO_SECRET_VALUE');
    expect(json).not.toContain('HTTP_SECRET_VALUE');
    expect(state.toolbox.mcpServers).toHaveLength(2);
    const [stdio, http] = state.toolbox.mcpServers;
    expect(stdio!.transport).toEqual({ type: 'stdio', command: 'npx', envKeys: ['TOKEN'] });
    expect(http!.transport).toEqual({
      type: 'http',
      url: 'https://example.com/mcp',
      headerKeys: ['Authorization'],
    });
  });
});

describe('seedBundledSkills', () => {
  let root: string;
  let store: Store;
  let assetsDir: string;

  async function writeAsset(slug: string, version: number, description = 'Bundled skill'): Promise<void> {
    await mkdir(join(assetsDir, slug), { recursive: true });
    await writeFile(
      join(assetsDir, slug, 'SKILL.md'),
      `---\nname: ${slug}\ndescription: ${description}\ntags: alpha, beta\nversion: ${version}\n---\n\n# ${slug}\n\nBody text.\n`,
      'utf8',
    );
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'toolbox-seed-'));
    store = new Store(new HubPaths(root));
    await store.load();
    assetsDir = join(root, 'assets');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('seeds bundled skills with stable ids and parsed frontmatter', async () => {
    await writeAsset('example-skill', 1);
    await seedBundledSkills(store, assetsDir);

    const skills = store.toolbox().skills;
    expect(skills).toHaveLength(1);
    const skill = skills[0]!;
    expect(skill.id).toBe('bundled-example-skill');
    expect(skill.source).toBe('bundled');
    expect(skill.tags).toEqual(['alpha', 'beta']);
    expect(skill.bundledVersion).toBe(1);
    expect(skill.body).toContain('Body text.');
  });

  it('is idempotent and only reseeds on a version bump', async () => {
    await writeAsset('example-skill', 1);
    await seedBundledSkills(store, assetsDir);
    const first = store.toolbox().skills[0]!;

    await seedBundledSkills(store, assetsDir);
    expect(store.toolbox().skills[0]).toEqual(first);

    await writeAsset('example-skill', 2, 'Updated description');
    await seedBundledSkills(store, assetsDir);
    const reseeded = store.toolbox().skills[0]!;
    expect(reseeded.bundledVersion).toBe(2);
    expect(reseeded.description).toBe('Updated description');
    expect(reseeded.createdAt).toBe(first.createdAt);
  });

  it('never touches user skills', async () => {
    const userSkill: ToolboxSkill = {
      id: 'u1',
      name: 'mine',
      description: 'user skill',
      body: 'x',
      tags: [],
      source: 'user',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await store.update('toolbox', (t) => ({ ...t, skills: [userSkill] }));
    await writeAsset('example-skill', 1);
    await seedBundledSkills(store, assetsDir);

    expect(store.toolbox().skills).toHaveLength(2);
    expect(store.toolbox().skills.find((s) => s.id === 'u1')).toEqual(userSkill);
  });

  it('tolerates a missing assets directory', async () => {
    await expect(seedBundledSkills(store, join(root, 'nope'))).resolves.toBeUndefined();
    expect(store.toolbox().skills).toHaveLength(0);
  });

  it('the shipped assets seed cleanly', async () => {
    await seedBundledSkills(store); // default assets dir
    const skills = store.toolbox().skills;
    expect(skills.length).toBeGreaterThanOrEqual(3);
    for (const skill of skills) {
      expect(skill.source).toBe('bundled');
      expect(skill.id).toBe(`bundled-${skill.name}`);
      expect(skill.description.length).toBeGreaterThan(0);
      expect(skill.tags.length).toBeGreaterThan(0);
    }
  });
});
