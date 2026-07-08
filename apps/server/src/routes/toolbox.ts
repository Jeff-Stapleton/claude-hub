import {
  TOOLBOX_NAME_PATTERN,
  type McpTransport,
  type Store,
  type Toolbox,
  type ToolboxMcpServer,
  type ToolboxSkill,
} from '@claude-hub/core';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { ensureVaultKeys, parseRequiredEnv } from '../vault.js';

interface SkillBody {
  name?: string;
  description?: string;
  body?: string;
  tags?: string[];
  requiredEnv?: string[];
}

interface McpServerBody {
  name?: string;
  description?: string;
  transport?: unknown;
  tags?: string[];
  requiredEnv?: string[];
}

/**
 * Toolbox CRUD: skills + MCP servers that machines can be granted access to.
 * Bundled skills are seeded at boot and immutable here — the UI offers
 * "duplicate to edit" instead. Deleting a tool also scrubs its id from every
 * pipeline stage so assignments never dangle in stored config.
 */
export async function registerToolboxRoutes(app: FastifyInstance, store: Store): Promise<void> {
  // -- skills ----------------------------------------------------------------

  app.post<{ Body: SkillBody }>('/api/toolbox/skills', async (req, reply) => {
    const parsed = parseSkillBody(req.body);
    if (typeof parsed === 'string') return reply.code(400).send({ error: parsed });
    if (store.toolbox().skills.some((s) => s.name === parsed.name)) {
      return reply.code(400).send({ error: `a skill named "${parsed.name}" already exists` });
    }
    const now = new Date().toISOString();
    const skill: ToolboxSkill = {
      id: randomUUID(),
      ...parsed,
      source: 'user',
      createdAt: now,
      updatedAt: now,
    };
    await store.update('toolbox', (current) => ({
      ...current,
      skills: [...current.skills, skill],
    }));
    await ensureVaultKeys(store, skill.requiredEnv ?? []);
    return skill;
  });

  app.put<{ Params: { id: string }; Body: SkillBody }>(
    '/api/toolbox/skills/:id',
    async (req, reply) => {
      const existing = store.toolbox().skills.find((s) => s.id === req.params.id);
      const guarded = guardMutable(reply, existing);
      if (guarded) return guarded;
      const parsed = parseSkillBody(req.body);
      if (typeof parsed === 'string') return reply.code(400).send({ error: parsed });
      if (store.toolbox().skills.some((s) => s.id !== req.params.id && s.name === parsed.name)) {
        return reply.code(400).send({ error: `a skill named "${parsed.name}" already exists` });
      }
      // Rebuild rather than spread over `existing` so a cleared requiredEnv
      // doesn't linger from the stored entry.
      const updated: ToolboxSkill = {
        id: existing!.id,
        ...parsed,
        source: existing!.source,
        ...(existing!.bundledVersion !== undefined
          ? { bundledVersion: existing!.bundledVersion }
          : {}),
        createdAt: existing!.createdAt,
        updatedAt: new Date().toISOString(),
      };
      await store.update('toolbox', (current) => ({
        ...current,
        skills: current.skills.map((s) => (s.id === updated.id ? updated : s)),
      }));
      await ensureVaultKeys(store, updated.requiredEnv ?? []);
      return updated;
    },
  );

  app.delete<{ Params: { id: string } }>('/api/toolbox/skills/:id', async (req, reply) => {
    const existing = store.toolbox().skills.find((s) => s.id === req.params.id);
    const guarded = guardMutable(reply, existing);
    if (guarded) return guarded;
    await store.update('toolbox', (current) => ({
      ...current,
      skills: current.skills.filter((s) => s.id !== req.params.id),
    }));
    await scrubAssignments(store, 'skills', req.params.id);
    return { ok: true };
  });

  // -- MCP servers -----------------------------------------------------------

  app.post<{ Body: McpServerBody }>('/api/toolbox/mcp-servers', async (req, reply) => {
    const parsed = parseMcpServerBody(req.body);
    if (typeof parsed === 'string') return reply.code(400).send({ error: parsed });
    if (store.toolbox().mcpServers.some((m) => m.name === parsed.name)) {
      return reply.code(400).send({ error: `an MCP server named "${parsed.name}" already exists` });
    }
    const now = new Date().toISOString();
    const server: ToolboxMcpServer = {
      id: randomUUID(),
      ...parsed,
      createdAt: now,
      updatedAt: now,
    };
    await store.update('toolbox', (current) => ({
      ...current,
      mcpServers: [...current.mcpServers, server],
    }));
    await ensureVaultKeys(store, server.requiredEnv ?? []);
    return redactServer(server);
  });

  app.put<{ Params: { id: string }; Body: McpServerBody }>(
    '/api/toolbox/mcp-servers/:id',
    async (req, reply) => {
      const existing = store.toolbox().mcpServers.find((m) => m.id === req.params.id);
      if (!existing) return reply.code(404).send({ error: 'not found' });
      const parsed = parseMcpServerBody(req.body, existing.transport);
      if (typeof parsed === 'string') return reply.code(400).send({ error: parsed });
      if (
        store.toolbox().mcpServers.some((m) => m.id !== req.params.id && m.name === parsed.name)
      ) {
        return reply
          .code(400)
          .send({ error: `an MCP server named "${parsed.name}" already exists` });
      }
      // Rebuild rather than spread over `existing` so a cleared description
      // doesn't linger from the stored entry.
      const updated: ToolboxMcpServer = {
        id: existing.id,
        ...parsed,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      };
      await store.update('toolbox', (current) => ({
        ...current,
        mcpServers: current.mcpServers.map((m) => (m.id === updated.id ? updated : m)),
      }));
      await ensureVaultKeys(store, updated.requiredEnv ?? []);
      return redactServer(updated);
    },
  );

  app.delete<{ Params: { id: string } }>('/api/toolbox/mcp-servers/:id', async (req, reply) => {
    if (!store.toolbox().mcpServers.some((m) => m.id === req.params.id)) {
      return reply.code(404).send({ error: 'not found' });
    }
    await store.update('toolbox', (current) => ({
      ...current,
      mcpServers: current.mcpServers.filter((m) => m.id !== req.params.id),
    }));
    await scrubAssignments(store, 'mcpServers', req.params.id);
    return { ok: true };
  });
}

/** 404 for missing skills, 400 for bundled ones; undefined when mutable. */
function guardMutable(reply: FastifyReply, skill: ToolboxSkill | undefined): unknown {
  if (!skill) return reply.code(404).send({ error: 'not found' });
  if (skill.source === 'bundled') {
    return reply.code(400).send({ error: 'bundled skills are read-only; duplicate to edit' });
  }
  return undefined;
}

/**
 * Removes a deleted tool id from every installed machine, every custom
 * machine template, and every project-level assignment.
 */
async function scrubAssignments(
  store: Store,
  field: 'skills' | 'mcpServers',
  toolId: string,
): Promise<void> {
  const projectsAffected = store.projects().some((p) => p[field]?.includes(toolId));
  if (projectsAffected) {
    await store.update('projects', (current) =>
      current.map((project) => {
        const ids = project[field];
        if (!ids?.includes(toolId)) return project;
        const remaining = ids.filter((id) => id !== toolId);
        const next = { ...project };
        if (remaining.length > 0) next[field] = remaining;
        else delete next[field];
        return next;
      }),
    );
  }

  const pipelinesAffected = store
    .pipelines()
    .some((p) => p.machines.some((m) => m[field]?.includes(toolId)));
  if (pipelinesAffected) {
    await store.update('pipelines', (current) =>
      current.map((pipeline) => ({
        ...pipeline,
        machines: pipeline.machines.map((machine) => {
          const ids = machine[field];
          if (!ids?.includes(toolId)) return machine;
          const remaining = ids.filter((id) => id !== toolId);
          const next = { ...machine };
          if (remaining.length > 0) next[field] = remaining;
          else delete next[field];
          return next;
        }),
      })),
    );
  }

  const templatesAffected = store
    .machineTemplates()
    .some((t) => t[field]?.includes(toolId));
  if (templatesAffected) {
    await store.update('machineTemplates', (current) =>
      current.map((template) => {
        const ids = template[field];
        if (!ids?.includes(toolId)) return template;
        const remaining = ids.filter((id) => id !== toolId);
        const next = { ...template };
        if (remaining.length > 0) next[field] = remaining;
        else delete next[field];
        return next;
      }),
    );
  }
}

function parseSkillBody(
  body: SkillBody | undefined,
): Pick<ToolboxSkill, 'name' | 'description' | 'body' | 'tags' | 'requiredEnv'> | string {
  const { name, description, body: skillBody, tags, requiredEnv } = body ?? {};
  const nameError = validateName(name, 'skill');
  if (nameError) return nameError;
  if (!description || typeof description !== 'string' || !description.trim()) {
    return 'description is required';
  }
  if (typeof skillBody !== 'string' || !skillBody.trim()) return 'body is required';
  const parsedTags = parseTags(tags);
  if (typeof parsedTags === 'string') return parsedTags;
  const parsedRequiredEnv = parseRequiredEnv(requiredEnv);
  if (typeof parsedRequiredEnv === 'string') return parsedRequiredEnv;
  return {
    name: name!,
    description: description.trim(),
    body: skillBody,
    tags: parsedTags,
    ...(parsedRequiredEnv.length > 0 ? { requiredEnv: parsedRequiredEnv } : {}),
  };
}

function parseMcpServerBody(
  body: McpServerBody | undefined,
  existingTransport?: McpTransport,
):
  | (Pick<ToolboxMcpServer, 'name' | 'transport' | 'tags' | 'requiredEnv'> & {
      description?: string;
    })
  | string {
  const { name, description, transport, tags, requiredEnv } = body ?? {};
  const nameError = validateName(name, 'MCP server');
  if (nameError) return nameError;
  if (description !== undefined && typeof description !== 'string') {
    return 'description must be a string';
  }
  const parsedTags = parseTags(tags);
  if (typeof parsedTags === 'string') return parsedTags;
  const parsedRequiredEnv = parseRequiredEnv(requiredEnv);
  if (typeof parsedRequiredEnv === 'string') return parsedRequiredEnv;
  const parsedTransport = parseTransport(transport, existingTransport);
  if (typeof parsedTransport === 'string') return parsedTransport;
  return {
    name: name!,
    transport: parsedTransport,
    tags: parsedTags,
    ...(parsedRequiredEnv.length > 0 ? { requiredEnv: parsedRequiredEnv } : {}),
    ...(description !== undefined && description.trim() !== ''
      ? { description: description.trim() }
      : {}),
  };
}

/**
 * Validates a transport. On update, empty env/header values ("") mean
 * "keep the stored secret" — the UI never sees plaintext values, so it
 * round-trips blanks for untouched entries (the channels botToken pattern).
 */
function parseTransport(
  raw: unknown,
  existing?: McpTransport,
): McpTransport | string {
  if (!raw || typeof raw !== 'object') return 'transport is required';
  const t = raw as Record<string, unknown>;
  if (t.type === 'stdio') {
    if (!t.command || typeof t.command !== 'string' || !(t.command as string).trim()) {
      return 'transport.command is required for stdio servers';
    }
    if (
      t.args !== undefined &&
      (!Array.isArray(t.args) || t.args.some((a) => typeof a !== 'string'))
    ) {
      return 'transport.args must be an array of strings';
    }
    const env = parseSecretRecord(
      t.env,
      'transport.env',
      existing?.type === 'stdio' ? existing.env : undefined,
    );
    if (typeof env === 'string') return env;
    return {
      type: 'stdio',
      command: (t.command as string).trim(),
      ...(t.args !== undefined ? { args: t.args as string[] } : {}),
      ...(env !== undefined ? { env } : {}),
    };
  }
  if (t.type === 'http') {
    if (!t.url || typeof t.url !== 'string' || !(t.url as string).trim()) {
      return 'transport.url is required for http servers';
    }
    const headers = parseSecretRecord(
      t.headers,
      'transport.headers',
      existing?.type === 'http' ? existing.headers : undefined,
    );
    if (typeof headers === 'string') return headers;
    return {
      type: 'http',
      url: (t.url as string).trim(),
      ...(headers !== undefined ? { headers } : {}),
    };
  }
  return 'transport.type must be "stdio" or "http"';
}

function parseSecretRecord(
  raw: unknown,
  label: string,
  existing?: Record<string, string>,
): Record<string, string> | undefined | string {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return `${label} must be a record of string values`;
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'string') return `${label} must be a record of string values`;
    // Blank value = keep the stored secret for that key, if one exists.
    const kept = value === '' ? existing?.[key] : value;
    if (kept !== undefined && kept !== '') out[key] = kept;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function validateName(name: unknown, kind: string): string | undefined {
  if (!name || typeof name !== 'string') return `${kind} name is required`;
  if (!TOOLBOX_NAME_PATTERN.test(name)) {
    return `${kind} name must be a lowercase slug (letters, digits, hyphens; max 64 chars)`;
  }
  return undefined;
}

function parseTags(raw: unknown): string[] | string {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.some((t) => typeof t !== 'string')) {
    return 'tags must be an array of strings';
  }
  const cleaned = raw
    .map((t) => (t as string).trim().toLowerCase())
    .filter((t) => t.length > 0);
  return [...new Set(cleaned)];
}

/** Strips env/header values (potential secrets) down to key names. */
export function redactServer(server: ToolboxMcpServer): Omit<ToolboxMcpServer, 'transport'> & {
  transport: RedactedMcpTransport;
} {
  const { transport, ...rest } = server;
  return { ...rest, transport: redactTransport(transport) };
}

export type RedactedMcpTransport =
  | { type: 'stdio'; command: string; args?: string[]; envKeys: string[] }
  | { type: 'http'; url: string; headerKeys: string[] };

export function redactTransport(transport: McpTransport): RedactedMcpTransport {
  if (transport.type === 'stdio') {
    return {
      type: 'stdio',
      command: transport.command,
      ...(transport.args !== undefined ? { args: transport.args } : {}),
      envKeys: Object.keys(transport.env ?? {}),
    };
  }
  return {
    type: 'http',
    url: transport.url,
    headerKeys: Object.keys(transport.headers ?? {}),
  };
}

export type RedactedToolboxMcpServer = ReturnType<typeof redactServer>;

export interface RedactedToolbox {
  skills: Toolbox['skills'];
  mcpServers: RedactedToolboxMcpServer[];
}

export function redactToolbox(toolbox: Toolbox): RedactedToolbox {
  return {
    skills: toolbox.skills,
    mcpServers: toolbox.mcpServers.map(redactServer),
  };
}
