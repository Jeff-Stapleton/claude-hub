import type { AgentRunner } from '@claude-hub/agent-runner';
import {
  TOOLBOX_NAME_PATTERN,
  type AgentProviderId,
  type Project,
  type ProjectRepo,
  type Store,
} from '@claude-hub/core';
import { randomUUID } from 'node:crypto';
import { mkdir, symlink } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { GitJobRunner } from '../git/jobs.js';

export type RepoInput =
  | { mode: 'local'; path: string }
  | { mode: 'clone'; url: string; name?: string; credentialId?: string }
  | { mode: 'create'; name: string; credentialId: string; private?: boolean };

interface CreateProjectBody {
  name?: string;
  vision?: string;
  repos?: RepoInput[];
  context?: string;
  skills?: string[];
  mcpServers?: string[];
  rootPath?: string;
  /** Legacy body shape ({path, alias}) used by the orchestrator's hub-MCP add_project tool. */
  path?: string;
  alias?: string;
}

interface UpdateProjectBody {
  name?: string;
  vision?: string;
  context?: string;
  skills?: string[];
  mcpServers?: string[];
}

interface SpawnBody {
  prompt: string;
  sessionId?: string;
  provider?: AgentProviderId;
}

/** Dir-safe slug for project roots and repo directory names. */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'project'
  );
}

/** Repo directory name from a clone URL: last path segment minus .git. */
function repoNameFromUrl(url: string): string {
  const tail = url.replace(/\/+$/, '').split('/').pop() ?? '';
  return slugify(tail.replace(/\.git$/, ''));
}

export async function registerProjectRoutes(
  app: FastifyInstance,
  store: Store,
  runner: AgentRunner,
  gitJobs: GitJobRunner,
): Promise<void> {
  app.post<{ Body: CreateProjectBody }>('/api/projects', async (req, reply) => {
    const body = req.body ?? {};

    // Back-compat: the hub-MCP add_project tool registers a bare working
    // directory. Map it to the v5 shape the same way the store migration does.
    if (typeof body.path === 'string' && body.path && body.repos === undefined) {
      const existing = store.projects().find((p) => p.path === body.path);
      if (existing) return existing;
      const now = new Date().toISOString();
      const project: Project = {
        id: randomUUID(),
        path: body.path,
        name: body.alias ?? basename(body.path),
        vision: '',
        repos: [
          {
            id: randomUUID(),
            name: basename(body.path),
            path: body.path,
            origin: 'local',
            status: 'ready',
            addedAt: now,
          },
        ],
        addedAt: now,
      };
      await store.update('projects', (current) => [...current, project]);
      return project;
    }

    const parsed = parseProjectBody(body, store);
    if (typeof parsed === 'string') return reply.code(400).send({ error: parsed });

    const rootPath =
      parsed.rootPath ?? join(store.config().projectsRoot, slugify(parsed.name));
    if (store.projects().some((p) => p.path === rootPath)) {
      return reply.code(400).send({ error: `a project already uses root ${rootPath}` });
    }

    try {
      await mkdir(rootPath, { recursive: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: `could not create project root: ${msg}` });
    }

    const now = new Date().toISOString();
    const repos = parsed.repos.map((input) => buildRepo(input, rootPath, now));
    await linkLocalRepos(repos, rootPath);

    const project: Project = {
      id: randomUUID(),
      path: rootPath,
      name: parsed.name,
      vision: parsed.vision,
      repos,
      ...(parsed.context !== undefined ? { context: parsed.context } : {}),
      ...(parsed.skills.length > 0 ? { skills: parsed.skills } : {}),
      ...(parsed.mcpServers.length > 0 ? { mcpServers: parsed.mcpServers } : {}),
      addedAt: now,
    };
    await store.update('projects', (current) => [...current, project]);

    for (const repo of repos) {
      if (repo.status === 'pending') gitJobs.provision(project.id, repo.id);
    }
    return project;
  });

  app.put<{ Params: { id: string }; Body: UpdateProjectBody }>(
    '/api/projects/:id',
    async (req, reply) => {
      const project = store.projects().find((p) => p.id === req.params.id);
      if (!project) return reply.code(404).send({ error: 'not found' });
      const body = req.body ?? {};

      if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) {
        return reply.code(400).send({ error: 'name must be a non-empty string' });
      }
      if (body.vision !== undefined && typeof body.vision !== 'string') {
        return reply.code(400).send({ error: 'vision must be a string' });
      }
      if (body.context !== undefined && typeof body.context !== 'string') {
        return reply.code(400).send({ error: 'context must be a string' });
      }
      const skillsError = validateProjectToolIds(
        body.skills,
        new Set(store.toolbox().skills.map((s) => s.id)),
        'skills',
      );
      if (skillsError) return reply.code(400).send({ error: skillsError });
      const serversError = validateProjectToolIds(
        body.mcpServers,
        new Set(store.toolbox().mcpServers.map((m) => m.id)),
        'mcpServers',
      );
      if (serversError) return reply.code(400).send({ error: serversError });

      const updated = await store.update('projects', (current) =>
        current.map((p) => {
          if (p.id !== req.params.id) return p;
          const next: Project = { ...p };
          if (body.name !== undefined) next.name = body.name.trim();
          if (body.vision !== undefined) next.vision = body.vision;
          if (body.context !== undefined) {
            if (body.context.trim() === '') delete next.context;
            else next.context = body.context;
          }
          if (body.skills !== undefined) {
            if (body.skills.length === 0) delete next.skills;
            else next.skills = body.skills;
          }
          if (body.mcpServers !== undefined) {
            if (body.mcpServers.length === 0) delete next.mcpServers;
            else next.mcpServers = body.mcpServers;
          }
          return next;
        }),
      );
      return updated.find((p) => p.id === req.params.id);
    },
  );

  // -- repos -----------------------------------------------------------------

  app.post<{ Params: { id: string }; Body: RepoInput }>(
    '/api/projects/:id/repos',
    async (req, reply) => {
      const project = store.projects().find((p) => p.id === req.params.id);
      if (!project) return reply.code(404).send({ error: 'not found' });
      const parsed = parseRepoInput(req.body);
      if (typeof parsed === 'string') return reply.code(400).send({ error: parsed });

      const repo = buildRepo(parsed, project.path, new Date().toISOString());
      if (project.repos.some((r) => r.name === repo.name)) {
        return reply.code(400).send({ error: `a repo named "${repo.name}" already exists` });
      }
      await linkLocalRepos([repo], project.path);
      await store.update('projects', (current) =>
        current.map((p) => (p.id === project.id ? { ...p, repos: [...p.repos, repo] } : p)),
      );
      if (repo.status === 'pending') gitJobs.provision(project.id, repo.id);
      return repo;
    },
  );

  app.post<{ Params: { id: string; repoId: string } }>(
    '/api/projects/:id/repos/:repoId/retry',
    async (req, reply) => {
      const project = store.projects().find((p) => p.id === req.params.id);
      const repo = project?.repos.find((r) => r.id === req.params.repoId);
      if (!project || !repo) return reply.code(404).send({ error: 'not found' });
      if (repo.status !== 'failed') {
        return reply.code(409).send({ error: 'only failed repos can be retried' });
      }
      gitJobs.provision(project.id, repo.id);
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string; repoId: string } }>(
    '/api/projects/:id/repos/:repoId',
    async (req, reply) => {
      const project = store.projects().find((p) => p.id === req.params.id);
      const repo = project?.repos.find((r) => r.id === req.params.repoId);
      if (!project || !repo) return reply.code(404).send({ error: 'not found' });
      if (project.repos.length === 1) {
        return reply.code(400).send({ error: 'a project must keep at least one repo' });
      }
      // Removes the record only — working trees on disk are never deleted.
      await store.update('projects', (current) =>
        current.map((p) =>
          p.id === project.id
            ? { ...p, repos: p.repos.filter((r) => r.id !== repo.id) }
            : p,
        ),
      );
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const { id } = req.params;
    const before = store.projects().length;
    await store.update('projects', (current) => current.filter((p) => p.id !== id));
    if (store.projects().length === before) {
      return reply.code(404).send({ error: 'not found' });
    }
    return { ok: true };
  });

  /**
   * Synchronous one-shot spawn of the configured agent in a project's dir. Intended
   * for the orchestrator's hub-MCP tool, which needs the transcript inline
   * rather than fire-and-forget. Timeout is enforced by agent-runner.
   */
  app.post<{ Params: { id: string }; Body: SpawnBody }>(
    '/api/projects/:id/spawn',
    async (req, reply) => {
      const { id } = req.params;
      const project = store.projects().find((p) => p.id === id);
      if (!project) return reply.code(404).send({ error: 'project not found' });

      const { prompt, sessionId, provider } = req.body ?? ({} as SpawnBody);
      if (!prompt || typeof prompt !== 'string') {
        return reply.code(400).send({ error: 'prompt is required' });
      }

      const result = await runner.runProjectSession({
        ...(provider ? { provider } : {}),
        cwd: project.path,
        prompt,
        ...(sessionId ? { sessionId } : {}),
      });
      if (!result.ok) {
        return reply.code(500).send({ error: result.error, stderr: result.stderr });
      }
      return {
        sessionId: result.sessionId,
        text: result.text,
        durationMs: result.durationMs,
        ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}),
      };
    },
  );
}

// ---------------------------------------------------------------------------
// Validation + construction
// ---------------------------------------------------------------------------

interface ParsedProjectBody {
  name: string;
  vision: string;
  repos: RepoInput[];
  context?: string;
  skills: string[];
  mcpServers: string[];
  rootPath?: string;
}

/** Validates a create body. Returns an error string on bad input. */
function parseProjectBody(body: CreateProjectBody, store: Store): ParsedProjectBody | string {
  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    return 'name is required';
  }
  if (!body.vision || typeof body.vision !== 'string' || !body.vision.trim()) {
    return 'vision is required';
  }
  if (!Array.isArray(body.repos) || body.repos.length === 0) {
    return 'at least one repo is required';
  }
  const repos: RepoInput[] = [];
  for (const raw of body.repos) {
    const parsed = parseRepoInput(raw);
    if (typeof parsed === 'string') return parsed;
    repos.push(parsed);
  }
  if (body.context !== undefined && typeof body.context !== 'string') {
    return 'context must be a string';
  }
  if (body.rootPath !== undefined) {
    if (typeof body.rootPath !== 'string' || !isAbsolute(body.rootPath)) {
      return 'rootPath must be an absolute path';
    }
  }
  const skillsError = validateProjectToolIds(
    body.skills,
    new Set(store.toolbox().skills.map((s) => s.id)),
    'skills',
  );
  if (skillsError) return skillsError;
  const serversError = validateProjectToolIds(
    body.mcpServers,
    new Set(store.toolbox().mcpServers.map((m) => m.id)),
    'mcpServers',
  );
  if (serversError) return serversError;

  return {
    name: body.name.trim(),
    vision: body.vision.trim(),
    repos,
    ...(body.context !== undefined && body.context.trim() !== ''
      ? { context: body.context }
      : {}),
    skills: body.skills ?? [],
    mcpServers: body.mcpServers ?? [],
    ...(body.rootPath !== undefined ? { rootPath: body.rootPath } : {}),
  };
}

function parseRepoInput(raw: unknown): RepoInput | string {
  if (!raw || typeof raw !== 'object') return 'repo entry must be an object';
  const r = raw as Record<string, unknown>;
  if (r.mode === 'local') {
    if (typeof r.path !== 'string' || !isAbsolute(r.path)) {
      return 'local repo: path must be an absolute path';
    }
    return { mode: 'local', path: r.path };
  }
  if (r.mode === 'clone') {
    if (typeof r.url !== 'string' || !r.url.trim()) return 'clone repo: url is required';
    if (r.name !== undefined && !isValidRepoName(r.name)) {
      return 'clone repo: name must be a lowercase slug';
    }
    if (r.credentialId !== undefined && typeof r.credentialId !== 'string') {
      return 'clone repo: credentialId must be a string';
    }
    return {
      mode: 'clone',
      url: r.url.trim(),
      ...(r.name !== undefined ? { name: r.name as string } : {}),
      ...(r.credentialId !== undefined ? { credentialId: r.credentialId as string } : {}),
    };
  }
  if (r.mode === 'create') {
    if (!isValidRepoName(r.name)) return 'create repo: name must be a lowercase slug';
    if (typeof r.credentialId !== 'string' || !r.credentialId) {
      return 'create repo: credentialId is required';
    }
    if (r.private !== undefined && typeof r.private !== 'boolean') {
      return 'create repo: private must be a boolean';
    }
    return {
      mode: 'create',
      name: r.name as string,
      credentialId: r.credentialId,
      ...(r.private !== undefined ? { private: r.private as boolean } : {}),
    };
  }
  return 'repo mode must be "local", "clone", or "create"';
}

function isValidRepoName(name: unknown): name is string {
  return typeof name === 'string' && TOOLBOX_NAME_PATTERN.test(name);
}

/** Unknown tool ids are a clear 400 rather than a silent drop at save time. */
function validateProjectToolIds(
  ids: unknown,
  known: Set<string>,
  field: 'skills' | 'mcpServers',
): string | undefined {
  if (ids === undefined) return undefined;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
    return `${field} must be an array of strings`;
  }
  const unknown = (ids as string[]).find((id) => !known.has(id));
  if (unknown) return `${field}: unknown tool id "${unknown}"`;
  return undefined;
}

function buildRepo(input: RepoInput, rootPath: string, now: string): ProjectRepo {
  const id = randomUUID();
  if (input.mode === 'local') {
    return {
      id,
      name: basename(input.path),
      path: input.path,
      origin: 'local',
      status: 'ready',
      addedAt: now,
    };
  }
  if (input.mode === 'clone') {
    const name = input.name ?? repoNameFromUrl(input.url);
    return {
      id,
      name,
      path: join(rootPath, name),
      origin: 'clone',
      remoteUrl: input.url,
      ...(input.credentialId !== undefined ? { credentialId: input.credentialId } : {}),
      status: 'pending',
      addedAt: now,
    };
  }
  return {
    id,
    name: input.name,
    path: join(rootPath, input.name),
    origin: 'create',
    credentialId: input.credentialId,
    status: 'pending',
    addedAt: now,
  };
}

/**
 * Best-effort symlinks for repos living outside the project root so agents
 * running at the root still see them. Failure (e.g. exists, permissions) is
 * non-fatal — the repo's recorded absolute path is what matters.
 */
async function linkLocalRepos(repos: ProjectRepo[], rootPath: string): Promise<void> {
  for (const repo of repos) {
    if (repo.origin !== 'local') continue;
    if (repo.path === rootPath || repo.path.startsWith(rootPath + '/')) continue;
    try {
      await symlink(repo.path, join(rootPath, repo.name), 'dir');
    } catch {
      // Non-fatal by design.
    }
  }
}
