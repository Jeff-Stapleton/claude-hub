import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { HubPaths, Store, type ToolboxMcpServer, type ToolboxSkill } from '@claude-hub/core';
import { CCConfigReader } from '@claude-hub/cc-config-reader';
import type { PipelineRunner } from '@claude-hub/pipeline';
import { registerPipelineRoutes } from '../src/routes/pipeline.js';
import { registerToolboxRoutes } from '../src/routes/toolbox.js';
import { buildUIState } from '../src/state.js';
import {
  seedBundledMcpServers,
  seedBundledSkills,
  type BundledMcpServerDef,
} from '../src/toolboxSeed.js';

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

  it('DELETE scrubs the tool id from machine and template assignments', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/toolbox/skills',
      payload: SKILL_PAYLOAD,
    });
    const { id } = JSON.parse(create.body);
    await store.update('pipelines', [
      {
        projectId: 'p1',
        machines: [
          { key: 'spec', name: 'Spec', gate: 'auto' as const, skills: [id, 'other-id'] },
          { key: 'code', name: 'Code', gate: 'auto' as const, skills: [id] },
        ],
        updatedAt: new Date().toISOString(),
      },
    ]);
    await store.update('machineTemplates', [
      {
        id: 't1',
        slug: 'scanner',
        name: 'Scanner',
        description: 'x',
        source: 'custom' as const,
        defaultGate: 'auto' as const,
        promptTemplate: 'scan',
        skills: [id],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const res = await app.inject({ method: 'DELETE', url: `/api/toolbox/skills/${id}` });
    expect(res.statusCode).toBe(200);
    const machines = store.pipelines()[0]!.machines;
    expect(machines[0]!.skills).toEqual(['other-id']);
    expect(machines[1]!.skills).toBeUndefined();
    expect(store.machineTemplates()[0]!.skills).toBeUndefined();
  });

  it('DELETE scrubs the tool id from project-level assignments too', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/toolbox/skills',
      payload: SKILL_PAYLOAD,
    });
    const { id } = JSON.parse(create.body);
    await store.update('projects', [
      {
        id: 'p1',
        path: '/tmp/proj',
        name: 'proj',
        vision: '',
        repos: [],
        skills: [id, 'other-id'],
        mcpServers: ['srv-1'],
        addedAt: new Date().toISOString(),
      },
      {
        id: 'p2',
        path: '/tmp/proj2',
        name: 'proj2',
        vision: '',
        repos: [],
        skills: [id],
        addedAt: new Date().toISOString(),
      },
    ]);

    const res = await app.inject({ method: 'DELETE', url: `/api/toolbox/skills/${id}` });
    expect(res.statusCode).toBe(200);
    const [p1, p2] = store.projects();
    expect(p1!.skills).toEqual(['other-id']);
    expect(p1!.mcpServers).toEqual(['srv-1']);
    // A now-empty list is dropped entirely, matching the stage scrub.
    expect(p2!.skills).toBeUndefined();
  });
});

describe('pipeline PUT with tool assignments', () => {
  let app: FastifyInstance;
  let store: Store;
  let root: string;

  const baseMachines = (): Record<string, unknown>[] => [
    { key: 'intake', name: 'Intake', gate: 'auto' },
    { key: 'spec', name: 'Spec', gate: 'auto' },
    { key: 'code', name: 'Code', gate: 'auto' },
  ];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'toolbox-pipeline-'));
    store = new Store(new HubPaths(root));
    await store.load();
    await store.update('projects', [
      { id: 'p1', path: '/tmp/proj', addedAt: new Date().toISOString() },
    ]);
    app = Fastify();
    const runnerStub = { reconcileLineEdit: async () => undefined } as unknown as PipelineRunner;
    await registerPipelineRoutes(app, store, runnerStub);
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

    const machines = baseMachines();
    machines[1]!.skills = [skillId];
    machines[2]!.skills = [];
    const res = await app.inject({
      method: 'PUT',
      url: '/api/projects/p1/pipeline',
      payload: { machines },
    });
    expect(res.statusCode).toBe(200);
    const saved = store.pipelines()[0]!.machines;
    expect(saved[1]!.skills).toEqual([skillId]);
    expect(saved[2]!.skills).toBeUndefined();
  });

  it('rejects unknown tool ids with a 400', async () => {
    const machines = baseMachines();
    machines[1]!.mcpServers = ['no-such-id'];
    const res = await app.inject({
      method: 'PUT',
      url: '/api/projects/p1/pipeline',
      payload: { machines },
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

describe('seedBundledMcpServers', () => {
  let root: string;
  let store: Store;

  function gitlabDef(overrides: Partial<BundledMcpServerDef> = {}): BundledMcpServerDef {
    return {
      slug: 'gitlab',
      version: 1,
      description: 'GitLab workflow tools',
      tags: ['git', 'gitlab'],
      requiredEnv: ['GITLAB_TOKEN'],
      transport: { type: 'stdio', command: 'node', args: ['/repo/packages/gitlab-mcp/dist/server.js'] },
      ...overrides,
    };
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mcp-seed-'));
    store = new Store(new HubPaths(root));
    await store.load();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('seeds a bundled server with a stable id and declares its vault keys unset', async () => {
    await seedBundledMcpServers(store, [gitlabDef()]);

    const servers = store.toolbox().mcpServers;
    expect(servers).toHaveLength(1);
    const server = servers[0]!;
    expect(server.id).toBe('bundled-gitlab');
    expect(server.name).toBe('gitlab');
    expect(server.source).toBe('bundled');
    expect(server.bundledVersion).toBe(1);
    expect(server.requiredEnv).toEqual(['GITLAB_TOKEN']);
    expect(server.transport).toEqual(gitlabDef().transport);

    const entry = store.vault().find((v) => v.key === 'GITLAB_TOKEN');
    expect(entry).toBeDefined();
    expect(entry!.value).toBeNull();
  });

  it('is idempotent and reseeds on a version bump preserving createdAt', async () => {
    await seedBundledMcpServers(store, [gitlabDef()]);
    const first = store.toolbox().mcpServers[0]!;

    await seedBundledMcpServers(store, [gitlabDef()]);
    expect(store.toolbox().mcpServers[0]).toEqual(first);

    await seedBundledMcpServers(store, [gitlabDef({ version: 2, description: 'Updated' })]);
    const reseeded = store.toolbox().mcpServers[0]!;
    expect(reseeded.bundledVersion).toBe(2);
    expect(reseeded.description).toBe('Updated');
    expect(reseeded.createdAt).toBe(first.createdAt);
  });

  it('rewrites the entry when the stored transport path drifts', async () => {
    await seedBundledMcpServers(store, [gitlabDef()]);
    const moved = gitlabDef({
      transport: { type: 'stdio', command: 'node', args: ['/new-home/packages/gitlab-mcp/dist/server.js'] },
    });
    await seedBundledMcpServers(store, [moved]);
    const server = store.toolbox().mcpServers[0]!;
    expect(server.transport).toEqual(moved.transport);
    expect(server.bundledVersion).toBe(1);
  });

  it('never clobbers a user server that owns the bundled name', async () => {
    const userServer: ToolboxMcpServer = {
      id: 'u1',
      name: 'gitlab',
      transport: { type: 'stdio', command: 'my-gitlab' },
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await store.update('toolbox', (t) => ({ ...t, mcpServers: [userServer] }));
    await seedBundledMcpServers(store, [gitlabDef()]);

    expect(store.toolbox().mcpServers).toHaveLength(1);
    expect(store.toolbox().mcpServers[0]).toEqual(userServer);
  });

  it('the shipped defs seed cleanly', async () => {
    await seedBundledMcpServers(store); // default bundled defs
    const servers = store.toolbox().mcpServers;
    expect(servers.length).toBeGreaterThanOrEqual(1);
    const gitlab = servers.find((s) => s.name === 'gitlab');
    expect(gitlab).toBeDefined();
    expect(gitlab!.id).toBe('bundled-gitlab');
    expect(gitlab!.source).toBe('bundled');
    expect(gitlab!.requiredEnv).toEqual(['GITLAB_TOKEN']);
    expect(gitlab!.transport.type).toBe('stdio');
  });
});

describe('bundled MCP server route guards', () => {
  let app: FastifyInstance;
  let store: Store;
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mcp-guard-'));
    store = new Store(new HubPaths(root));
    await store.load();
    await seedBundledMcpServers(store, [
      {
        slug: 'gitlab',
        version: 1,
        description: 'GitLab workflow tools',
        tags: ['git'],
        requiredEnv: ['GITLAB_TOKEN'],
        transport: { type: 'stdio', command: 'node', args: ['/repo/server.js'] },
      },
    ]);
    app = Fastify();
    await registerToolboxRoutes(app, store);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  it('rejects PUT and DELETE on a bundled server', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/toolbox/mcp-servers/bundled-gitlab',
      payload: { name: 'gitlab', transport: { type: 'stdio', command: 'evil' } },
    });
    expect(put.statusCode).toBe(400);
    expect(JSON.parse(put.body).error).toContain('read-only');

    const del = await app.inject({
      method: 'DELETE',
      url: '/api/toolbox/mcp-servers/bundled-gitlab',
    });
    expect(del.statusCode).toBe(400);
    expect(store.toolbox().mcpServers).toHaveLength(1);
  });

  it('still allows creating and mutating user servers alongside the bundled one', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/toolbox/mcp-servers',
      payload: STDIO_SERVER_PAYLOAD,
    });
    expect(created.statusCode).toBe(200);
    const id = JSON.parse(created.body).id;

    const del = await app.inject({ method: 'DELETE', url: `/api/toolbox/mcp-servers/${id}` });
    expect(del.statusCode).toBe(200);
    expect(store.toolbox().mcpServers).toHaveLength(1);
  });

  it('duplicating the bundled name still hits the uniqueness check', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/toolbox/mcp-servers',
      payload: { name: 'gitlab', transport: { type: 'stdio', command: 'x' } },
    });
    expect(res.statusCode).toBe(400);
  });
});
