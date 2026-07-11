import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { HubPaths, Store } from '@claude-hub/core';
import { BUILTIN_MACHINE_TEMPLATES } from '@claude-hub/pipeline';
import { registerMachineTemplateRoutes } from '../src/routes/machineTemplates.js';

const TEMPLATE_PAYLOAD = {
  slug: 'security-scan',
  name: 'Security scan',
  description: 'Scans the change for vulnerabilities',
  defaultGate: 'auto',
  promptTemplate: 'Scan {{request}} for vulnerabilities.',
  requiredEnv: ['SNYK_TOKEN'],
};

describe('machine template routes', () => {
  let app: FastifyInstance;
  let store: Store;
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'machine-templates-'));
    store = new Store(new HubPaths(root));
    await store.load();
    app = Fastify();
    await registerMachineTemplateRoutes(app, store);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  it('GET lists installable built-ins plus stored customs (monitor builtin retired)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/machine-templates' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { id: string; source: string }[];
    // The monitor builtin is hidden from the gallery — project-level
    // monitors (the SHIPPED-door factory light) replaced it.
    expect(body).toHaveLength(BUILTIN_MACHINE_TEMPLATES.length - 1);
    expect(body.some((t) => t.id === 'builtin-monitor')).toBe(false);
    expect(body.every((t) => t.source === 'builtin')).toBe(true);
  });

  it('POST creates a custom template and declares its vault keys', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/machine-templates',
      payload: TEMPLATE_PAYLOAD,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.source).toBe('custom');
    expect(store.machineTemplates()).toHaveLength(1);
    // requiredEnv keys are auto-declared (unset) in the vault.
    expect(store.vault().find((e) => e.key === 'SNYK_TOKEN')?.value).toBeNull();
  });

  it('POST rejects a slug colliding with a built-in', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/machine-templates',
      payload: { ...TEMPLATE_PAYLOAD, slug: 'code' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/already exists/);
  });

  it('POST rejects a template with neither prompt nor commands', async () => {
    const { promptTemplate: _p, ...rest } = TEMPLATE_PAYLOAD;
    const res = await app.inject({
      method: 'POST',
      url: '/api/machine-templates',
      payload: rest,
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/promptTemplate or commands/);
  });

  it('PUT updates a custom template; built-ins are read-only', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/machine-templates',
      payload: TEMPLATE_PAYLOAD,
    });
    const { id } = JSON.parse(create.body);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/machine-templates/${id}`,
      payload: { ...TEMPLATE_PAYLOAD, name: 'Deep security scan' },
    });
    expect(res.statusCode).toBe(200);
    expect(store.machineTemplates()[0]!.name).toBe('Deep security scan');

    const builtin = await app.inject({
      method: 'PUT',
      url: '/api/machine-templates/builtin-code',
      payload: TEMPLATE_PAYLOAD,
    });
    expect(builtin.statusCode).toBe(400);
    const del = await app.inject({ method: 'DELETE', url: '/api/machine-templates/builtin-code' });
    expect(del.statusCode).toBe(400);
  });

  it('DELETE snapshots the prompt into dependent machines and drops the reference', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/machine-templates',
      payload: TEMPLATE_PAYLOAD,
    });
    const { id } = JSON.parse(create.body);
    await store.update('pipelines', [
      {
        projectId: 'p1',
        machines: [
          // Leans on the template for its prompt -> gets it materialized.
          { key: 'scan', name: 'Scan', templateId: id, gate: 'auto' as const },
          // Has its own prompt -> only loses the dangling reference.
          {
            key: 'scan-2',
            name: 'Scan 2',
            templateId: id,
            gate: 'auto' as const,
            promptTemplate: 'my own prompt',
          },
        ],
        updatedAt: new Date().toISOString(),
      },
    ]);

    const res = await app.inject({ method: 'DELETE', url: `/api/machine-templates/${id}` });
    expect(res.statusCode).toBe(200);
    expect(store.machineTemplates()).toHaveLength(0);
    const [scan, scan2] = store.pipelines()[0]!.machines;
    expect(scan!.templateId).toBeUndefined();
    expect(scan!.promptTemplate).toBe(TEMPLATE_PAYLOAD.promptTemplate);
    expect(scan2!.templateId).toBeUndefined();
    expect(scan2!.promptTemplate).toBe('my own prompt');
  });

  it('DELETE of an unknown id is a 404', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/machine-templates/nope' });
    expect(res.statusCode).toBe(404);
  });
});
