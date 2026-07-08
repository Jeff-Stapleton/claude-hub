import {
  MACHINE_KEY_PATTERN,
  type MachineBehavior,
  type MachineTemplate,
  type StageGate,
  type Store,
} from '@claude-hub/core';
import { listMachineTemplates } from '@claude-hub/pipeline';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { ensureVaultKeys, parseRequiredEnv } from '../vault.js';

interface MachineTemplateBody {
  slug?: string;
  name?: string;
  description?: string;
  defaultGate?: string;
  [key: string]: unknown;
}

/**
 * CRUD for custom machine templates (reusable machine definitions). Built-in
 * templates are code constants served read-only from the same list — the
 * toolbox bundled-skill pattern.
 */
export async function registerMachineTemplateRoutes(
  app: FastifyInstance,
  store: Store,
): Promise<void> {
  app.get('/api/machine-templates', async () => listMachineTemplates(store));

  app.post<{ Body: MachineTemplateBody }>('/api/machine-templates', async (req, reply) => {
    const parsed = parseTemplateBody(req.body, store);
    if (typeof parsed === 'string') return reply.code(400).send({ error: parsed });
    if (listMachineTemplates(store).some((t) => t.slug === parsed.slug)) {
      return reply.code(400).send({ error: `a template with slug "${parsed.slug}" already exists` });
    }
    const now = new Date().toISOString();
    const template: MachineTemplate = {
      id: randomUUID(),
      ...parsed,
      source: 'custom',
      createdAt: now,
      updatedAt: now,
    };
    await store.update('machineTemplates', (current) => [...current, template]);
    await ensureVaultKeys(store, template.requiredEnv ?? []);
    return template;
  });

  app.put<{ Params: { id: string }; Body: MachineTemplateBody }>(
    '/api/machine-templates/:id',
    async (req, reply) => {
      const existing = store.machineTemplates().find((t) => t.id === req.params.id);
      if (!existing) {
        if (listMachineTemplates(store).some((t) => t.id === req.params.id)) {
          return reply
            .code(400)
            .send({ error: 'built-in templates are read-only; create a custom template instead' });
        }
        return reply.code(404).send({ error: 'not found' });
      }
      const parsed = parseTemplateBody(req.body, store);
      if (typeof parsed === 'string') return reply.code(400).send({ error: parsed });
      if (
        listMachineTemplates(store).some((t) => t.id !== req.params.id && t.slug === parsed.slug)
      ) {
        return reply
          .code(400)
          .send({ error: `a template with slug "${parsed.slug}" already exists` });
      }
      // Rebuild rather than spread over `existing` so cleared optional
      // fields don't linger from the stored entry.
      const updated: MachineTemplate = {
        id: existing.id,
        ...parsed,
        source: 'custom',
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      };
      await store.update('machineTemplates', (current) =>
        current.map((t) => (t.id === updated.id ? updated : t)),
      );
      await ensureVaultKeys(store, updated.requiredEnv ?? []);
      return updated;
    },
  );

  app.delete<{ Params: { id: string } }>('/api/machine-templates/:id', async (req, reply) => {
    const existing = store.machineTemplates().find((t) => t.id === req.params.id);
    if (!existing) {
      if (listMachineTemplates(store).some((t) => t.id === req.params.id)) {
        return reply.code(400).send({ error: 'built-in templates cannot be deleted' });
      }
      return reply.code(404).send({ error: 'not found' });
    }
    // Snapshot-on-delete: installed machines that lean on this template for
    // their prompt get it materialized, then drop the dangling reference.
    const affected = store
      .pipelines()
      .some((p) => p.machines.some((m) => m.templateId === existing.id));
    if (affected) {
      await store.update('pipelines', (current) =>
        current.map((pipeline) => ({
          ...pipeline,
          machines: pipeline.machines.map((machine) => {
            if (machine.templateId !== existing.id) return machine;
            const { templateId: _dropped, ...rest } = machine;
            return {
              ...rest,
              ...(machine.promptTemplate === undefined && existing.promptTemplate !== undefined
                ? { promptTemplate: existing.promptTemplate }
                : {}),
            };
          }),
        })),
      );
    }
    await store.update('machineTemplates', (current) =>
      current.filter((t) => t.id !== req.params.id),
    );
    return { ok: true };
  });
}

/**
 * Validates the shared machine behavior fields (used by both templates and
 * installed machine instances). Error-string style like the other parsers.
 */
export function parseMachineBehavior(
  raw: Record<string, unknown>,
  store: Store,
  label: string,
): MachineBehavior | string {
  if (raw.promptTemplate !== undefined && typeof raw.promptTemplate !== 'string') {
    return `${label}: promptTemplate must be a string`;
  }
  if (raw.provider !== undefined && raw.provider !== 'claude' && raw.provider !== 'cursor') {
    return `${label}: provider must be "claude" or "cursor"`;
  }
  if (
    raw.commands !== undefined &&
    (!Array.isArray(raw.commands) || raw.commands.some((c) => typeof c !== 'string'))
  ) {
    return `${label}: commands must be an array of strings`;
  }
  if (raw.timeoutMs !== undefined && (typeof raw.timeoutMs !== 'number' || raw.timeoutMs <= 0)) {
    return `${label}: timeoutMs must be a positive number`;
  }
  const knownSkillIds = new Set(store.toolbox().skills.map((s) => s.id));
  const knownServerIds = new Set(store.toolbox().mcpServers.map((m) => m.id));
  const skillsError = validateToolIds(raw.skills, knownSkillIds, label, 'skills');
  if (skillsError) return skillsError;
  const serversError = validateToolIds(raw.mcpServers, knownServerIds, label, 'mcpServers');
  if (serversError) return serversError;
  const requiredEnv = parseRequiredEnv(raw.requiredEnv);
  if (typeof requiredEnv === 'string') return `${label}: ${requiredEnv}`;
  if (
    raw.resultCheck !== undefined &&
    raw.resultCheck !== 'strict' &&
    raw.resultCheck !== 'lenient'
  ) {
    return `${label}: resultCheck must be "strict" or "lenient"`;
  }
  let monitor: MachineBehavior['monitor'];
  if (raw.monitor !== undefined) {
    if (!raw.monitor || typeof raw.monitor !== 'object') {
      return `${label}: monitor must be an object`;
    }
    const m = raw.monitor as Record<string, unknown>;
    if (
      m.intervalMinutes !== undefined &&
      (typeof m.intervalMinutes !== 'number' || m.intervalMinutes < 1)
    ) {
      return `${label}: monitor.intervalMinutes must be a number >= 1`;
    }
    if (m.maxChecks !== undefined && (typeof m.maxChecks !== 'number' || m.maxChecks < 1)) {
      return `${label}: monitor.maxChecks must be a number >= 1`;
    }
    monitor = {
      ...(m.intervalMinutes !== undefined ? { intervalMinutes: m.intervalMinutes as number } : {}),
      ...(m.maxChecks !== undefined ? { maxChecks: m.maxChecks as number } : {}),
    };
  }

  const trimmedCommands =
    raw.commands !== undefined
      ? (raw.commands as string[]).map((c) => c.trim()).filter((c) => c.length > 0)
      : undefined;

  return {
    ...(raw.promptTemplate !== undefined && raw.promptTemplate !== ''
      ? { promptTemplate: raw.promptTemplate as string }
      : {}),
    ...(raw.provider !== undefined ? { provider: raw.provider } : {}),
    ...(trimmedCommands !== undefined && trimmedCommands.length > 0
      ? { commands: trimmedCommands }
      : {}),
    ...(raw.timeoutMs !== undefined ? { timeoutMs: raw.timeoutMs as number } : {}),
    ...(Array.isArray(raw.skills) && raw.skills.length > 0
      ? { skills: raw.skills as string[] }
      : {}),
    ...(Array.isArray(raw.mcpServers) && raw.mcpServers.length > 0
      ? { mcpServers: raw.mcpServers as string[] }
      : {}),
    ...(requiredEnv.length > 0 ? { requiredEnv } : {}),
    ...(raw.resultCheck !== undefined ? { resultCheck: raw.resultCheck } : {}),
    ...(monitor !== undefined ? { monitor } : {}),
  };
}

export function validateToolIds(
  raw: unknown,
  known: ReadonlySet<string>,
  label: string,
  field: 'skills' | 'mcpServers',
): string | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.some((id) => typeof id !== 'string')) {
    return `${label}: ${field} must be an array of strings`;
  }
  const unknown = (raw as string[]).find((id) => !known.has(id));
  if (unknown !== undefined) {
    return `${label}: unknown ${field} id "${unknown}"`;
  }
  return undefined;
}

function parseTemplateBody(
  body: MachineTemplateBody | undefined,
  store: Store,
): (MachineBehavior & Pick<MachineTemplate, 'slug' | 'name' | 'description' | 'defaultGate'>) | string {
  const raw = body ?? {};
  if (!raw.name || typeof raw.name !== 'string' || !raw.name.trim()) {
    return 'name is required';
  }
  if (!raw.slug || typeof raw.slug !== 'string' || !MACHINE_KEY_PATTERN.test(raw.slug)) {
    return 'slug must be a lowercase slug (letters, digits, hyphens; max 64 chars)';
  }
  if (!raw.description || typeof raw.description !== 'string' || !raw.description.trim()) {
    return 'description is required';
  }
  if (raw.defaultGate !== undefined && raw.defaultGate !== 'auto' && raw.defaultGate !== 'approval') {
    return 'defaultGate must be "auto" or "approval"';
  }
  const behavior = parseMachineBehavior(raw, store, 'template');
  if (typeof behavior === 'string') return behavior;
  if (behavior.promptTemplate === undefined && behavior.commands === undefined) {
    return 'a template needs a promptTemplate or commands — machines stamped from it would have nothing to run';
  }
  return {
    slug: raw.slug,
    name: raw.name.trim(),
    description: raw.description.trim(),
    defaultGate: (raw.defaultGate as StageGate | undefined) ?? 'auto',
    ...behavior,
  };
}
