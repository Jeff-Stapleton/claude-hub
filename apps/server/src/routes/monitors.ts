import type {
  MonitorCheckStatus,
  ProjectMonitor,
  ProjectMonitorCheck,
  Store,
} from '@claude-hub/core';
import type { ProjectMonitorScheduler } from '@claude-hub/pipeline';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

interface PutMonitorBody {
  enabled?: unknown;
  fileDefectOnFailure?: unknown;
  checks?: unknown;
}

const CHECK_TYPES = new Set(['http', 'command', 'agent']);
const PROVIDERS = new Set(['claude', 'cursor']);

/**
 * Project-level continuous monitoring config (the factory light over the
 * SHIPPED door). Config and latest status live on one monitors entry per
 * project; the scheduler reconciles timers off the store change event, so
 * a PUT here is all it takes to (re)arm checks.
 */
export async function registerMonitorRoutes(
  app: FastifyInstance,
  store: Store,
  scheduler: ProjectMonitorScheduler,
): Promise<void> {
  app.get<{ Params: { id: string } }>('/api/projects/:id/monitor', async (req, reply) => {
    if (!store.projects().some((p) => p.id === req.params.id)) {
      return reply.code(404).send({ error: 'project not found' });
    }
    return (
      store.monitors().find((m) => m.projectId === req.params.id) ??
      defaultMonitor(req.params.id)
    );
  });

  app.put<{ Params: { id: string }; Body: PutMonitorBody }>(
    '/api/projects/:id/monitor',
    async (req, reply) => {
      const projectId = req.params.id;
      if (!store.projects().some((p) => p.id === projectId)) {
        return reply.code(404).send({ error: 'project not found' });
      }
      const parsed = parseMonitorBody(req.body);
      if (typeof parsed === 'string') {
        return reply.code(400).send({ error: parsed });
      }

      let saved: ProjectMonitor | undefined;
      await store.update('monitors', (current) => {
        const existing = current.find((m) => m.projectId === projectId);
        const now = new Date().toISOString();
        // Status is server-owned: preserve it from the current snapshot
        // (never the client payload), pruning entries for removed checks so
        // aggregate health never counts ghosts.
        const keptIds = new Set(parsed.checks.map((c) => c.id));
        const statusChecks: Record<string, MonitorCheckStatus> = {};
        for (const [id, status] of Object.entries(existing?.status.checks ?? {})) {
          if (keptIds.has(id)) statusChecks[id] = status;
        }
        saved = {
          projectId,
          enabled: parsed.enabled,
          checks: parsed.checks,
          fileDefectOnFailure: parsed.fileDefectOnFailure,
          status: {
            checks: statusChecks,
            outageOpen: existing?.status.outageOpen ?? false,
          },
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        return [...current.filter((m) => m.projectId !== projectId), saved];
      });
      return saved;
    },
  );

  app.post<{ Params: { id: string } }>('/api/projects/:id/monitor/run', async (req, reply) => {
    const projectId = req.params.id;
    if (!store.projects().some((p) => p.id === projectId)) {
      return reply.code(404).send({ error: 'project not found' });
    }
    const monitor = store.monitors().find((m) => m.projectId === projectId);
    if (!monitor?.enabled || monitor.checks.length === 0) {
      return reply
        .code(409)
        .send({ error: 'monitor is disabled or has no checks configured' });
    }
    void scheduler.runNow(projectId);
    return reply.code(202).send({ ok: true });
  });
}

function defaultMonitor(projectId: string): ProjectMonitor {
  const epoch = new Date(0).toISOString();
  return {
    projectId,
    enabled: false,
    checks: [],
    fileDefectOnFailure: true,
    status: { checks: {}, outageOpen: false },
    createdAt: epoch,
    updatedAt: epoch,
  };
}

interface ParsedMonitorBody {
  enabled: boolean;
  fileDefectOnFailure: boolean;
  checks: ProjectMonitorCheck[];
}

/** Validates a PUT body. Returns an error string on bad input. */
function parseMonitorBody(body: PutMonitorBody): ParsedMonitorBody | string {
  if (typeof body?.enabled !== 'boolean') return 'enabled must be a boolean';
  if (typeof body.fileDefectOnFailure !== 'boolean') {
    return 'fileDefectOnFailure must be a boolean';
  }
  if (!Array.isArray(body.checks)) return 'checks array is required';

  const seenIds = new Set<string>();
  const checks: ProjectMonitorCheck[] = [];
  for (const raw of body.checks) {
    if (!raw || typeof raw !== 'object') return 'each check must be an object';
    const c = raw as Record<string, unknown>;

    if (typeof c.name !== 'string' || !c.name.trim()) return 'check name is required';
    const label = `check "${c.name.trim()}"`;
    if (typeof c.type !== 'string' || !CHECK_TYPES.has(c.type)) {
      return `${label}: type must be "http", "command", or "agent"`;
    }
    // New checks arrive without an id; the server assigns one so status
    // stays keyed to a stable identity across config edits.
    if (c.id !== undefined && typeof c.id !== 'string') return `${label}: id must be a string`;
    const id = typeof c.id === 'string' && c.id ? c.id : randomUUID();
    if (seenIds.has(id)) return `${label}: duplicate check id`;
    seenIds.add(id);

    if (typeof c.intervalMinutes !== 'number' || !Number.isFinite(c.intervalMinutes) || c.intervalMinutes < 1) {
      return `${label}: intervalMinutes must be a number >= 1`;
    }
    if (c.timeoutMs !== undefined && (typeof c.timeoutMs !== 'number' || c.timeoutMs <= 0)) {
      return `${label}: timeoutMs must be a positive number`;
    }

    const base = {
      id,
      name: c.name.trim(),
      intervalMinutes: c.intervalMinutes,
      ...(c.timeoutMs !== undefined ? { timeoutMs: c.timeoutMs as number } : {}),
    };

    if (c.type === 'http') {
      if (typeof c.url !== 'string' || !c.url.trim()) return `${label}: url is required`;
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(c.url.trim());
      } catch {
        return `${label}: url is not a valid URL`;
      }
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return `${label}: url must be http(s)`;
      }
      if (
        c.expectedStatus !== undefined &&
        (typeof c.expectedStatus !== 'number' ||
          !Number.isInteger(c.expectedStatus) ||
          c.expectedStatus < 100 ||
          c.expectedStatus > 599)
      ) {
        return `${label}: expectedStatus must be an integer between 100 and 599`;
      }
      checks.push({
        ...base,
        type: 'http',
        url: c.url.trim(),
        ...(c.expectedStatus !== undefined ? { expectedStatus: c.expectedStatus as number } : {}),
      });
    } else if (c.type === 'command') {
      if (typeof c.command !== 'string' || !c.command.trim()) {
        return `${label}: command is required`;
      }
      checks.push({ ...base, type: 'command', command: c.command.trim() });
    } else {
      if (typeof c.prompt !== 'string' || !c.prompt.trim()) {
        return `${label}: prompt is required`;
      }
      if (c.provider !== undefined && (typeof c.provider !== 'string' || !PROVIDERS.has(c.provider))) {
        return `${label}: provider must be "claude" or "cursor"`;
      }
      checks.push({
        ...base,
        type: 'agent',
        prompt: c.prompt.trim(),
        ...(c.provider !== undefined ? { provider: c.provider as 'claude' | 'cursor' } : {}),
      });
    }
  }

  return {
    enabled: body.enabled,
    fileDefectOnFailure: body.fileDefectOnFailure,
    checks,
  };
}
