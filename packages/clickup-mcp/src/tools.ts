import { z } from 'zod';
import {
  ClickUpClient,
  appendArrayParam,
  appendCustomTaskIdQuery,
  type ClickUpConfig,
} from './clickupClient.js';

/**
 * MCP tool handlers for ClickUp task workflows: browse the workspace
 * hierarchy, list/search tasks (including subtasks) with tag and
 * custom-field filters, read task details, discover custom fields, and
 * create/update tasks. All ids (team, space, folder, list, task, field)
 * are tool arguments — nothing is workspace-specific.
 */

export interface ToolContext {
  client: ClickUpClient;
  config: ClickUpConfig;
}

const CUSTOM_FIELD_OPERATORS = [
  '=',
  '<',
  '>',
  '<=',
  '>=',
  '!=',
  'IS NULL',
  'IS NOT NULL',
  'RANGE',
  'ANY',
  'ALL',
  'NOT ANY',
  'NOT ALL',
] as const;

const customFieldFilterSchema = z
  .object({
    field_id: z.string().describe('Custom field id (discover via clickup_get_custom_fields).'),
    operator: z.enum(CUSTOM_FIELD_OPERATORS),
    value: z
      .union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))])
      .optional()
      .describe(
        'Omit for IS NULL / IS NOT NULL; use an array for RANGE/ANY/ALL/NOT ANY/NOT ALL. Dropdown fields match on option id.',
      ),
  })
  .strict();

const customFieldValueSchema = z
  .object({
    id: z.string().describe('Custom field id (discover via clickup_get_custom_fields).'),
    value: z
      .union([
        z.string(),
        z.number(),
        z.boolean(),
        z.null(),
        z.array(z.union([z.string(), z.number()])),
      ])
      .describe(
        'Value in the shape the field type expects — e.g. a dropdown option id, an array of label ids, a unix ms timestamp for dates. Check the field type via clickup_get_custom_fields.',
      ),
  })
  .strict();

const prioritySchema = z.number().int().min(1).max(4).describe('1=urgent, 2=high, 3=normal, 4=low.');

/** Filter arguments shared by clickup_get_tasks and clickup_search_tasks. */
const taskFilterShape = {
  page: z.number().int().min(0).optional().describe('0-indexed page; ClickUp returns 100 tasks per page.'),
  include_closed: z.boolean().optional().describe('Include closed tasks (default false).'),
  subtasks: z.boolean().optional().describe('Include subtasks (default false). Subtasks appear as flat entries with a `parent` id.'),
  statuses: z.array(z.string()).optional().describe('Filter by status names.'),
  assignees: z.array(z.string()).optional().describe('Filter by assignee user ids.'),
  tags: z.array(z.string()).optional().describe('Filter by tag names (matches tasks having any of the tags).'),
  custom_fields: z
    .array(customFieldFilterSchema)
    .optional()
    .describe('Filter by custom field values (all conditions must match).'),
  order_by: z.enum(['id', 'created', 'updated', 'due_date']).optional(),
  reverse: z.boolean().optional().describe('Reverse the sort order.'),
  due_date_gt: z.number().int().optional().describe('Due after this unix ms timestamp.'),
  due_date_lt: z.number().int().optional().describe('Due before this unix ms timestamp.'),
  date_updated_gt: z.number().int().optional().describe('Updated after this unix ms timestamp.'),
  date_updated_lt: z.number().int().optional().describe('Updated before this unix ms timestamp.'),
};

type TaskFilterArgs = {
  page?: number;
  include_closed?: boolean;
  subtasks?: boolean;
  statuses?: string[];
  assignees?: string[];
  tags?: string[];
  custom_fields?: z.infer<typeof customFieldFilterSchema>[];
  order_by?: 'id' | 'created' | 'updated' | 'due_date';
  reverse?: boolean;
  due_date_gt?: number;
  due_date_lt?: number;
  date_updated_gt?: number;
  date_updated_lt?: number;
};

function buildTaskFilterParams(args: TaskFilterArgs): URLSearchParams {
  const params = new URLSearchParams();
  if (args.page !== undefined) params.set('page', String(args.page));
  if (args.include_closed) params.set('include_closed', 'true');
  if (args.subtasks) params.set('subtasks', 'true');
  appendArrayParam(params, 'statuses', args.statuses);
  appendArrayParam(params, 'assignees', args.assignees);
  appendArrayParam(params, 'tags', args.tags);
  if (args.custom_fields && args.custom_fields.length > 0) {
    // ClickUp expects the custom_fields filter as a JSON-encoded array of
    // {field_id, operator, value} in the query string.
    params.set('custom_fields', JSON.stringify(args.custom_fields));
  }
  if (args.order_by) params.set('order_by', args.order_by);
  if (args.reverse) params.set('reverse', 'true');
  if (args.due_date_gt !== undefined) params.set('due_date_gt', String(args.due_date_gt));
  if (args.due_date_lt !== undefined) params.set('due_date_lt', String(args.due_date_lt));
  if (args.date_updated_gt !== undefined) params.set('date_updated_gt', String(args.date_updated_gt));
  if (args.date_updated_lt !== undefined) params.set('date_updated_lt', String(args.date_updated_lt));
  return params;
}

interface ClickUpTask {
  id: string;
  custom_id?: string | null;
  name: string;
  status?: { status?: string } | null;
  priority?: { priority?: string } | null;
  points?: number | null;
  assignees?: { username?: string }[];
  tags?: { name?: string }[];
  due_date?: string | null;
  date_updated?: string | null;
  parent?: string | null;
  list?: { id?: string } | null;
  url?: string;
}

/** Raw tasks carry watchers, checklists, and full custom-field definitions;
 * keep list output bounded and point at clickup_get_task for full detail. */
function summarizeTask(task: ClickUpTask) {
  return {
    id: task.id,
    ...(task.custom_id ? { customId: task.custom_id } : {}),
    name: task.name,
    status: task.status?.status,
    ...(task.priority?.priority ? { priority: task.priority.priority } : {}),
    ...(task.points != null ? { points: task.points } : {}),
    assignees: (task.assignees ?? []).map((a) => a.username),
    tags: (task.tags ?? []).map((t) => t.name),
    ...(task.due_date ? { dueDate: task.due_date } : {}),
    ...(task.date_updated ? { dateUpdated: task.date_updated } : {}),
    ...(task.parent ? { parent: task.parent } : {}),
    listId: task.list?.id,
    url: task.url,
  };
}

function summarizeTaskPage(
  page: number | undefined,
  response: { tasks?: ClickUpTask[]; last_page?: boolean },
) {
  const tasks = response.tasks ?? [];
  return {
    page: page ?? 0,
    ...(response.last_page !== undefined ? { lastPage: response.last_page } : {}),
    count: tasks.length,
    tasks: tasks.map(summarizeTask),
  };
}

/** Task descriptions can be arbitrarily long; keep tool output bounded. */
export const TASK_TEXT_LIMIT = 20_000;

export function truncateText(text: string): string {
  return text.length > TASK_TEXT_LIMIT ? `${text.slice(0, TASK_TEXT_LIMIT)} [… truncated]` : text;
}

const TASK_TEXT_FIELDS = ['description', 'markdown_description', 'text_content'] as const;

function truncateTaskText(task: Record<string, unknown>): Record<string, unknown> {
  const out = { ...task };
  for (const field of TASK_TEXT_FIELDS) {
    const value = out[field];
    if (typeof value === 'string') out[field] = truncateText(value);
  }
  return out;
}

interface ClickUpField {
  id: string;
  name: string;
  type: string;
  required?: boolean;
  type_config?: {
    options?: { id?: string; name?: string; label?: string; orderindex?: number }[];
  } | null;
}

export function makeTools(ctx: ToolContext) {
  return {
    clickup_get_workspaces: {
      description:
        'List the ClickUp workspaces (teams) the token can access. The workspace id is the team_id used by other tools.',
      input: z.object({}).strict(),
      handler: async () => {
        const res = await ctx.client.request<{ teams?: { id: string; name: string }[] }>(
          'GET',
          '/team',
        );
        return (res.teams ?? []).map((t) => ({ id: t.id, name: t.name }));
      },
    },

    clickup_get_spaces: {
      description: 'List the spaces in a ClickUp workspace, with their status names.',
      input: z
        .object({
          team_id: z.string().describe('Workspace (team) id from clickup_get_workspaces.'),
        })
        .strict(),
      handler: async (args: { team_id: string }) => {
        const res = await ctx.client.request<{
          spaces?: { id: string; name: string; statuses?: { status?: string }[] }[];
        }>('GET', `/team/${encodeURIComponent(args.team_id)}/space`);
        return (res.spaces ?? []).map((s) => ({
          id: s.id,
          name: s.name,
          statuses: (s.statuses ?? []).map((st) => st.status),
        }));
      },
    },

    clickup_get_folders: {
      description: 'List the folders in a ClickUp space, each with its lists.',
      input: z
        .object({
          space_id: z.string().describe('Space id from clickup_get_spaces.'),
        })
        .strict(),
      handler: async (args: { space_id: string }) => {
        const res = await ctx.client.request<{
          folders?: { id: string; name: string; lists?: { id: string; name: string }[] }[];
        }>('GET', `/space/${encodeURIComponent(args.space_id)}/folder`);
        return (res.folders ?? []).map((f) => ({
          id: f.id,
          name: f.name,
          lists: (f.lists ?? []).map((l) => ({ id: l.id, name: l.name })),
        }));
      },
    },

    clickup_get_lists: {
      description:
        'List the lists in a folder (folder_id) or the folderless lists in a space (space_id). Provide exactly one of the two.',
      input: z
        .object({
          folder_id: z.string().optional().describe('Folder id from clickup_get_folders.'),
          space_id: z.string().optional().describe('Space id, for folderless lists.'),
        })
        .strict(),
      handler: async (args: { folder_id?: string; space_id?: string }) => {
        if ((args.folder_id === undefined) === (args.space_id === undefined)) {
          throw new Error('Provide exactly one of folder_id or space_id.');
        }
        const path = args.folder_id
          ? `/folder/${encodeURIComponent(args.folder_id)}/list`
          : `/space/${encodeURIComponent(args.space_id!)}/list`;
        const res = await ctx.client.request<{ lists?: { id: string; name: string }[] }>(
          'GET',
          path,
        );
        return (res.lists ?? []).map((l) => ({ id: l.id, name: l.name }));
      },
    },

    clickup_get_tasks: {
      description:
        'List the tasks in a ClickUp list, filtered by status, assignee, tag, and/or custom field values. Set subtasks=true to include subtasks. Returns summaries — use clickup_get_task for full detail including descriptions.',
      input: z
        .object({
          list_id: z.string().describe('List id from clickup_get_lists or clickup_get_folders.'),
          ...taskFilterShape,
        })
        .strict(),
      handler: async (args: { list_id: string } & TaskFilterArgs) => {
        const res = await ctx.client.request<{ tasks?: ClickUpTask[]; last_page?: boolean }>(
          'GET',
          `/list/${encodeURIComponent(args.list_id)}/task`,
          { query: buildTaskFilterParams(args) },
        );
        return summarizeTaskPage(args.page, res);
      },
    },

    clickup_search_tasks: {
      description:
        'Search tasks across a whole ClickUp workspace, filtered by space/folder/list, status, assignee, tag, and/or custom field values. Set subtasks=true to include subtasks. Returns summaries — use clickup_get_task for full detail.',
      input: z
        .object({
          team_id: z.string().describe('Workspace (team) id from clickup_get_workspaces.'),
          space_ids: z.array(z.string()).optional().describe('Restrict to these spaces.'),
          project_ids: z
            .array(z.string())
            .optional()
            .describe("Restrict to these folders (ClickUp's legacy name for folder ids)."),
          list_ids: z.array(z.string()).optional().describe('Restrict to these lists.'),
          ...taskFilterShape,
        })
        .strict(),
      handler: async (
        args: {
          team_id: string;
          space_ids?: string[];
          project_ids?: string[];
          list_ids?: string[];
        } & TaskFilterArgs,
      ) => {
        const params = buildTaskFilterParams(args);
        appendArrayParam(params, 'space_ids', args.space_ids);
        appendArrayParam(params, 'project_ids', args.project_ids);
        appendArrayParam(params, 'list_ids', args.list_ids);
        const res = await ctx.client.request<{ tasks?: ClickUpTask[]; last_page?: boolean }>(
          'GET',
          `/team/${encodeURIComponent(args.team_id)}/task`,
          { query: params },
        );
        return summarizeTaskPage(args.page, res);
      },
    },

    clickup_get_task: {
      description:
        'Fetch a single ClickUp task with full details, including its subtasks, markdown description, and custom field values. Accepts the internal id or a custom id like "ABC-123" (pass team_id for custom ids).',
      input: z
        .object({
          task_id: z.string().describe('Internal task id or custom id (e.g. "ABC-123").'),
          team_id: z
            .string()
            .optional()
            .describe('Workspace (team) id — required when task_id is a custom id.'),
        })
        .strict(),
      handler: async (args: { task_id: string; team_id?: string }) => {
        const params = new URLSearchParams({
          include_subtasks: 'true',
          include_markdown_description: 'true',
        });
        appendCustomTaskIdQuery(params, args.team_id);
        const task = await ctx.client.request<Record<string, unknown>>(
          'GET',
          `/task/${encodeURIComponent(args.task_id)}`,
          { query: params },
        );
        return truncateTaskText(task);
      },
    },

    clickup_get_custom_fields: {
      description:
        'List the custom fields available on a ClickUp list — field ids, types, and dropdown/label options. Use this to find the field_id and option ids for custom-field filters and for setting values on create/update.',
      input: z
        .object({
          list_id: z.string().describe('List id from clickup_get_lists or clickup_get_folders.'),
        })
        .strict(),
      handler: async (args: { list_id: string }) => {
        const res = await ctx.client.request<{ fields?: ClickUpField[] }>(
          'GET',
          `/list/${encodeURIComponent(args.list_id)}/field`,
        );
        return (res.fields ?? []).map((f) => ({
          id: f.id,
          name: f.name,
          type: f.type,
          ...(f.required !== undefined ? { required: f.required } : {}),
          ...(f.type_config?.options
            ? {
                options: f.type_config.options.map((o) => ({
                  id: o.id,
                  name: o.name ?? o.label,
                  ...(o.orderindex !== undefined ? { orderindex: o.orderindex } : {}),
                })),
              }
            : {}),
        }));
      },
    },

    clickup_create_task: {
      description:
        'Create a task in a ClickUp list. Pass parent to create it as a subtask of another task. Custom field values can be set directly via custom_fields.',
      input: z
        .object({
          list_id: z.string().describe('List id to create the task in.'),
          name: z.string().describe('Task name.'),
          markdown_description: z.string().optional().describe('Task description (markdown).'),
          parent: z
            .string()
            .optional()
            .describe('Parent task id — creates this task as a subtask.'),
          status: z.string().optional().describe('Status name (must exist on the list).'),
          priority: prioritySchema.optional(),
          points: z.number().optional().describe('Sprint points.'),
          tags: z.array(z.string()).optional().describe('Tag names to apply.'),
          assignees: z.array(z.number().int()).optional().describe('Assignee user ids.'),
          custom_fields: z.array(customFieldValueSchema).optional(),
        })
        .strict(),
      handler: async (args: {
        list_id: string;
        name: string;
        markdown_description?: string;
        parent?: string;
        status?: string;
        priority?: number;
        points?: number;
        tags?: string[];
        assignees?: number[];
        custom_fields?: z.infer<typeof customFieldValueSchema>[];
      }) => {
        const task = await ctx.client.request<ClickUpTask>(
          'POST',
          `/list/${encodeURIComponent(args.list_id)}/task`,
          {
            body: {
              name: args.name,
              ...(args.markdown_description !== undefined
                ? { markdown_description: args.markdown_description }
                : {}),
              ...(args.parent !== undefined ? { parent: args.parent } : {}),
              ...(args.status !== undefined ? { status: args.status } : {}),
              ...(args.priority !== undefined ? { priority: args.priority } : {}),
              ...(args.points !== undefined ? { points: args.points } : {}),
              ...(args.tags !== undefined ? { tags: args.tags } : {}),
              ...(args.assignees !== undefined ? { assignees: args.assignees } : {}),
              ...(args.custom_fields !== undefined ? { custom_fields: args.custom_fields } : {}),
            },
          },
        );
        return {
          id: task.id,
          ...(task.custom_id ? { customId: task.custom_id } : {}),
          name: task.name,
          url: task.url,
        };
      },
    },

    clickup_update_task: {
      description:
        'Update a ClickUp task. Core fields go through one update; each custom field value is set with a separate ClickUp call, so on failure the error states which fields were already applied. Pass null for priority/points to clear them. Accepts custom ids like "ABC-123" when team_id is given.',
      input: z
        .object({
          task_id: z.string().describe('Internal task id or custom id (e.g. "ABC-123").'),
          team_id: z
            .string()
            .optional()
            .describe('Workspace (team) id — required when task_id is a custom id.'),
          name: z.string().optional(),
          markdown_description: z.string().optional(),
          status: z.string().optional().describe('Status name (must exist on the list).'),
          priority: prioritySchema.nullable().optional().describe('null clears the priority.'),
          points: z.number().nullable().optional().describe('null clears the points.'),
          parent: z.string().optional().describe('Re-parent under this task id.'),
          custom_fields: z.array(customFieldValueSchema).optional(),
        })
        .strict(),
      handler: async (args: {
        task_id: string;
        team_id?: string;
        name?: string;
        markdown_description?: string;
        status?: string;
        priority?: number | null;
        points?: number | null;
        parent?: string;
        custom_fields?: z.infer<typeof customFieldValueSchema>[];
      }) => {
        const query = new URLSearchParams();
        appendCustomTaskIdQuery(query, args.team_id);

        // Explicit !== undefined checks: null is a meaningful value here
        // (clears priority/points), so truthiness won't do.
        const body: Record<string, unknown> = {};
        if (args.name !== undefined) body['name'] = args.name;
        if (args.markdown_description !== undefined)
          body['markdown_description'] = args.markdown_description;
        if (args.status !== undefined) body['status'] = args.status;
        if (args.priority !== undefined) body['priority'] = args.priority;
        if (args.points !== undefined) body['points'] = args.points;
        if (args.parent !== undefined) body['parent'] = args.parent;

        const hasCore = Object.keys(body).length > 0;
        if (hasCore) {
          await ctx.client.request('PUT', `/task/${encodeURIComponent(args.task_id)}`, {
            query,
            body,
          });
        }

        // ClickUp cannot set custom fields via the task update endpoint;
        // each one is its own call. Report partial state on failure.
        const setFields: string[] = [];
        for (const field of args.custom_fields ?? []) {
          try {
            await ctx.client.request(
              'POST',
              `/task/${encodeURIComponent(args.task_id)}/field/${encodeURIComponent(field.id)}`,
              { query, body: { value: field.value } },
            );
            setFields.push(field.id);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const applied = [
              ...(hasCore ? ['core fields'] : []),
              ...(setFields.length > 0 ? [`custom fields [${setFields.join(', ')}]`] : []),
            ];
            throw new Error(
              `${applied.length > 0 ? `Updated ${applied.join(' and ')} on task ${args.task_id}, but` : `Task ${args.task_id}:`} setting custom field ${field.id} failed: ${message}`,
            );
          }
        }

        const parts = [
          ...(hasCore ? ['core fields'] : []),
          ...(setFields.length > 0 ? [`custom fields [${setFields.join(', ')}]`] : []),
        ];
        return `Updated ${parts.length > 0 ? parts.join(' and ') : 'nothing (no fields provided)'} on task ${args.task_id}`;
      },
    },
  };
}
