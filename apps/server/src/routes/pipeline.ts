import {
  MACHINE_KEY_PATTERN,
  type PipelineConfig,
  type PipelineMachine,
  type Store,
} from '@claude-hub/core';
import {
  WorkItemStateError,
  effectivePipelineConfig,
  listMachineTemplates,
  readArchivedWorkItems,
  readWorkItemStageRuns,
  type PipelineRunner,
} from '@claude-hub/pipeline';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { ensureVaultKeys } from '../vault.js';
import { parseMachineBehavior } from './machineTemplates.js';

interface CreateWorkItemBody {
  request: string;
  title?: string;
  /** Restricted to UI/MCP-originated sources; trigger/monitor items are filed internally. */
  source?: 'manual' | 'channel';
}

interface PutPipelineBody {
  machines: unknown[];
}

export async function registerPipelineRoutes(
  app: FastifyInstance,
  store: Store,
  runner: PipelineRunner,
): Promise<void> {
  // -- pipeline config -------------------------------------------------------

  app.get<{ Params: { id: string } }>('/api/projects/:id/pipeline', async (req, reply) => {
    if (!store.projects().some((p) => p.id === req.params.id)) {
      return reply.code(404).send({ error: 'project not found' });
    }
    return effectivePipelineConfig(store, req.params.id);
  });

  app.put<{ Params: { id: string }; Body: PutPipelineBody }>(
    '/api/projects/:id/pipeline',
    async (req, reply) => {
      const projectId = req.params.id;
      if (!store.projects().some((p) => p.id === projectId)) {
        return reply.code(404).send({ error: 'project not found' });
      }
      const parsed = parsePipelineBody(req.body, projectId, store);
      if (typeof parsed === 'string') {
        return reply.code(400).send({ error: parsed });
      }
      await store.update('pipelines', (current) => [
        ...current.filter((p) => p.projectId !== projectId),
        parsed,
      ]);
      await ensureVaultKeys(
        store,
        parsed.machines.flatMap((m) => m.requiredEnv ?? []),
      );
      // Un-strand items parked at machines this edit removed.
      await runner.reconcileLineEdit(projectId);
      return parsed;
    },
  );

  // -- work items ------------------------------------------------------------

  app.post<{ Params: { id: string }; Body: CreateWorkItemBody }>(
    '/api/projects/:id/work-items',
    async (req, reply) => {
      const projectId = req.params.id;
      if (!store.projects().some((p) => p.id === projectId)) {
        return reply.code(404).send({ error: 'project not found' });
      }
      const { request, title, source } = req.body ?? ({} as CreateWorkItemBody);
      if (!request || typeof request !== 'string' || !request.trim()) {
        return reply.code(400).send({ error: 'request is required' });
      }
      if (source !== undefined && source !== 'manual' && source !== 'channel') {
        return reply.code(400).send({ error: `invalid source: ${String(source)}` });
      }
      return handleTransition(reply, async () => {
        const item = await runner.enqueue({
          projectId,
          request: request.trim(),
          ...(title !== undefined ? { title } : {}),
          source: source ?? 'manual',
        });
        return reply.code(202).send(item);
      });
    },
  );

  app.get<{ Params: { id: string }; Querystring: { includeDone?: string } }>(
    '/api/projects/:id/work-items',
    async (req, reply) => {
      const projectId = req.params.id;
      if (!store.projects().some((p) => p.id === projectId)) {
        return reply.code(404).send({ error: 'project not found' });
      }
      const live = store.workItems().filter((it) => it.projectId === projectId);
      if (req.query.includeDone !== 'true') return live;
      const archived = await readArchivedWorkItems(store.paths, projectId, 50);
      return [...live, ...archived];
    },
  );

  app.get<{ Params: { id: string } }>('/api/work-items/:id', async (req, reply) => {
    const item = store.workItems().find((it) => it.id === req.params.id);
    if (!item) return reply.code(404).send({ error: 'not found' });
    const stageRuns = await readWorkItemStageRuns(store.paths, item.id);
    return { item, stageRuns };
  });

  app.post<{ Params: { id: string } }>('/api/work-items/:id/approve', async (req, reply) => {
    return handleTransition(reply, () => runner.approve(req.params.id));
  });

  app.post<{ Params: { id: string } }>('/api/work-items/:id/retry', async (req, reply) => {
    return handleTransition(reply, () => runner.retry(req.params.id));
  });

  app.post<{ Params: { id: string } }>('/api/work-items/:id/cancel', async (req, reply) => {
    return handleTransition(reply, () => runner.cancel(req.params.id));
  });
}

async function handleTransition(
  reply: FastifyReply,
  action: () => Promise<unknown>,
): Promise<unknown> {
  try {
    return await action();
  } catch (err) {
    if (err instanceof WorkItemStateError) {
      return reply
        .code(err.code === 'not-found' ? 404 : 409)
        .send({ error: err.message });
    }
    throw err;
  }
}

/**
 * Validates a PUT body into a PipelineConfig: an ordered machines array
 * (may be empty — a blank line). Returns an error string on bad input.
 * The UI does read-modify-write of the whole array, so the stored config
 * is always complete.
 */
function parsePipelineBody(
  body: PutPipelineBody,
  projectId: string,
  store: Store,
): PipelineConfig | string {
  const rawMachines = body?.machines;
  if (!Array.isArray(rawMachines)) return 'machines array is required';

  const templateIds = new Set(listMachineTemplates(store).map((t) => t.id));
  const seenKeys = new Set<string>();
  const machines: PipelineMachine[] = [];

  for (const raw of rawMachines) {
    if (!raw || typeof raw !== 'object') return 'each machine must be an object';
    const m = raw as Record<string, unknown>;

    if (typeof m.key !== 'string' || !MACHINE_KEY_PATTERN.test(m.key)) {
      return 'machine key must be a lowercase slug (letters, digits, hyphens; max 64 chars)';
    }
    const label = `machine "${m.key}"`;
    if (seenKeys.has(m.key)) return `${label}: duplicate key — keys must be unique on the line`;
    seenKeys.add(m.key);
    if (typeof m.name !== 'string' || !m.name.trim()) {
      return `${label}: name is required`;
    }
    if (m.gate !== 'auto' && m.gate !== 'approval') {
      return `${label}: gate must be "auto" or "approval"`;
    }
    if (m.templateId !== undefined) {
      if (typeof m.templateId !== 'string') return `${label}: templateId must be a string`;
      // Unknown template ids are a clear 400 rather than a silent drop at
      // save time; run-time prompt resolution still tolerates dangling ids.
      if (!templateIds.has(m.templateId)) {
        return `${label}: unknown templateId "${m.templateId}"`;
      }
    }
    const behavior = parseMachineBehavior(m, store, label);
    if (typeof behavior === 'string') return behavior;

    machines.push({
      key: m.key,
      name: m.name.trim(),
      gate: m.gate,
      ...(m.templateId !== undefined ? { templateId: m.templateId } : {}),
      ...behavior,
    });
  }

  return {
    projectId,
    machines,
    updatedAt: new Date().toISOString(),
  };
}
