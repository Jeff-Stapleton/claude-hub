import {
  PIPELINE_STAGE_ORDER,
  type MonitorStageConfig,
  type PipelineConfig,
  type PipelineStageId,
  type StageConfig,
  type Store,
} from '@claude-hub/core';
import {
  WorkItemStateError,
  effectivePipelineConfig,
  readArchivedWorkItems,
  readWorkItemStageRuns,
  type PipelineRunner,
} from '@claude-hub/pipeline';
import type { FastifyInstance, FastifyReply } from 'fastify';

/** Stages where shell commands are honored. */
const COMMAND_STAGES: ReadonlySet<PipelineStageId> = new Set(['test', 'deploy', 'monitor']);

interface CreateWorkItemBody {
  request: string;
  title?: string;
  /** Restricted to UI/MCP-originated sources; trigger/monitor items are filed internally. */
  source?: 'manual' | 'channel';
}

interface PutPipelineBody {
  stages: Record<string, unknown>;
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
 * Validates a PUT body into a PipelineConfig. Returns an error string on
 * bad input. Requires all six fixed stages so the stored config is always
 * complete (the UI does read-modify-write of the whole stages record).
 */
function parsePipelineBody(
  body: PutPipelineBody,
  projectId: string,
  store: Store,
): PipelineConfig | string {
  const stages = body?.stages;
  if (!stages || typeof stages !== 'object') return 'stages object is required';

  const knownSkillIds = new Set(store.toolbox().skills.map((s) => s.id));
  const knownServerIds = new Set(store.toolbox().mcpServers.map((m) => m.id));

  const parsedStages: Partial<Record<PipelineStageId, StageConfig | MonitorStageConfig>> = {};
  for (const stageId of PIPELINE_STAGE_ORDER) {
    const raw = (stages as Record<string, unknown>)[stageId];
    if (!raw || typeof raw !== 'object') return `stage "${stageId}" is required`;
    const s = raw as Record<string, unknown>;

    if (typeof s.enabled !== 'boolean') return `stage "${stageId}": enabled must be a boolean`;
    if (s.gate !== 'auto' && s.gate !== 'approval') {
      return `stage "${stageId}": gate must be "auto" or "approval"`;
    }
    if (s.promptTemplate !== undefined && typeof s.promptTemplate !== 'string') {
      return `stage "${stageId}": promptTemplate must be a string`;
    }
    if (s.provider !== undefined && s.provider !== 'claude' && s.provider !== 'cursor') {
      return `stage "${stageId}": provider must be "claude" or "cursor"`;
    }
    if (s.commands !== undefined) {
      if (!COMMAND_STAGES.has(stageId)) {
        return `stage "${stageId}": commands are only supported on test/deploy/monitor`;
      }
      if (!Array.isArray(s.commands) || s.commands.some((c) => typeof c !== 'string')) {
        return `stage "${stageId}": commands must be an array of strings`;
      }
    }
    if (s.timeoutMs !== undefined && (typeof s.timeoutMs !== 'number' || s.timeoutMs <= 0)) {
      return `stage "${stageId}": timeoutMs must be a positive number`;
    }
    // Unknown tool ids are a clear 400 rather than a silent drop at save
    // time; run-time resolution still tolerates dangling ids defensively.
    const skillsError = validateToolIds(s.skills, knownSkillIds, stageId, 'skills');
    if (skillsError) return skillsError;
    const serversError = validateToolIds(s.mcpServers, knownServerIds, stageId, 'mcpServers');
    if (serversError) return serversError;

    const config: StageConfig = {
      enabled: s.enabled,
      gate: s.gate,
      ...(s.promptTemplate !== undefined && s.promptTemplate !== ''
        ? { promptTemplate: s.promptTemplate as string }
        : {}),
      ...(s.provider !== undefined ? { provider: s.provider } : {}),
      ...(s.commands !== undefined
        ? { commands: (s.commands as string[]).map((c) => c.trim()).filter((c) => c.length > 0) }
        : {}),
      ...(s.timeoutMs !== undefined ? { timeoutMs: s.timeoutMs as number } : {}),
      ...(Array.isArray(s.skills) && s.skills.length > 0
        ? { skills: s.skills as string[] }
        : {}),
      ...(Array.isArray(s.mcpServers) && s.mcpServers.length > 0
        ? { mcpServers: s.mcpServers as string[] }
        : {}),
    };

    if (stageId === 'monitor') {
      if (
        s.intervalMinutes !== undefined &&
        (typeof s.intervalMinutes !== 'number' || s.intervalMinutes < 1)
      ) {
        return 'stage "monitor": intervalMinutes must be a number >= 1';
      }
      if (s.maxChecks !== undefined && (typeof s.maxChecks !== 'number' || s.maxChecks < 1)) {
        return 'stage "monitor": maxChecks must be a number >= 1';
      }
      const monitor: MonitorStageConfig = {
        ...config,
        ...(s.intervalMinutes !== undefined ? { intervalMinutes: s.intervalMinutes as number } : {}),
        ...(s.maxChecks !== undefined ? { maxChecks: s.maxChecks as number } : {}),
      };
      parsedStages.monitor = monitor;
    } else {
      parsedStages[stageId] = config;
    }
  }

  return {
    projectId,
    stages: parsedStages as PipelineConfig['stages'],
    updatedAt: new Date().toISOString(),
  };
}

function validateToolIds(
  raw: unknown,
  known: ReadonlySet<string>,
  stageId: PipelineStageId,
  field: 'skills' | 'mcpServers',
): string | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.some((id) => typeof id !== 'string')) {
    return `stage "${stageId}": ${field} must be an array of strings`;
  }
  const unknown = (raw as string[]).find((id) => !known.has(id));
  if (unknown !== undefined) {
    return `stage "${stageId}": unknown ${field} id "${unknown}"`;
  }
  return undefined;
}
