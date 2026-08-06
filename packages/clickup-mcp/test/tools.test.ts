import { describe, expect, it } from 'vitest';
import {
  ClickUpClient,
  MISSING_TOKEN_HINT,
  makeScrubber,
  resolveConfig,
  type FetchFn,
} from '../src/clickupClient.js';
import { TASK_TEXT_LIMIT, makeTools, truncateText } from '../src/tools.js';

const TOKEN = 'pk_1234_SECRETSECRETSECRET';

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

function fakeFetch(
  responses: { status?: number; body?: unknown; text?: string }[] = [{}],
): { fetchFn: FetchFn; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const queue = [...responses];
  const fetchFn: FetchFn = async (url, init) => {
    requests.push({
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body as string | undefined,
    });
    const next = queue.length > 1 ? queue.shift()! : queue[0]!;
    const status = next.status ?? 200;
    const text = next.text ?? (next.body === undefined ? '{}' : JSON.stringify(next.body));
    return new Response(text, { status });
  };
  return { fetchFn, requests };
}

function setup(
  overrides: { env?: Record<string, string>; responses?: { status?: number; body?: unknown; text?: string }[] } = {},
) {
  const config = resolveConfig({ CLICKUP_TOKEN: TOKEN, ...overrides.env });
  const { fetchFn, requests } = fakeFetch(overrides.responses);
  const client = new ClickUpClient(config, fetchFn);
  const tools = makeTools({ client, config });
  return { tools, requests };
}

const TASK_FIXTURE = {
  id: '86abc123',
  custom_id: 'ABC-123',
  name: 'Fix the widget',
  description: 'A long description that should not appear in list summaries.',
  status: { status: 'in progress' },
  priority: { priority: 'high' },
  points: 3,
  assignees: [{ username: 'jeff' }],
  tags: [{ name: 'bug' }, { name: 'frontend' }],
  due_date: '1730000000000',
  date_updated: '1729000000000',
  parent: '86parent1',
  list: { id: '901' },
  url: 'https://app.clickup.com/t/86abc123',
};

const TASK_SUMMARY = {
  id: '86abc123',
  customId: 'ABC-123',
  name: 'Fix the widget',
  status: 'in progress',
  priority: 'high',
  points: 3,
  assignees: ['jeff'],
  tags: ['bug', 'frontend'],
  dueDate: '1730000000000',
  dateUpdated: '1729000000000',
  parent: '86parent1',
  listId: '901',
  url: 'https://app.clickup.com/t/86abc123',
};

describe('resolveConfig', () => {
  it('defaults to api.clickup.com and strips trailing slashes', () => {
    expect(resolveConfig({ CLICKUP_TOKEN: TOKEN }).baseUrl).toBe('https://api.clickup.com');
    expect(
      resolveConfig({ CLICKUP_TOKEN: TOKEN, CLICKUP_API_URL: 'https://proxy.example.com/' }).baseUrl,
    ).toBe('https://proxy.example.com');
  });

  it('treats unresolved ${KEY} placeholders as unset', () => {
    const config = resolveConfig({
      CLICKUP_TOKEN: '${CLICKUP_TOKEN}',
      CLICKUP_API_URL: '${CLICKUP_API_URL}',
    });
    expect(config.token).toBeUndefined();
    expect(config.baseUrl).toBe('https://api.clickup.com');
  });
});

describe('auth and errors', () => {
  it('sends the raw token in the Authorization header (no Bearer prefix)', async () => {
    const { tools, requests } = setup({ responses: [{ body: { teams: [] } }] });
    await tools.clickup_get_workspaces.handler();
    expect(requests[0]!.headers['Authorization']).toBe(TOKEN);
    expect(requests[0]!.url).toBe('https://api.clickup.com/api/v2/team');
  });

  it('fails with the vault hint and no request when the token is unset', async () => {
    const { tools, requests } = setup({ env: { CLICKUP_TOKEN: '${CLICKUP_TOKEN}' } });
    await expect(tools.clickup_get_workspaces.handler()).rejects.toThrow(MISSING_TOKEN_HINT);
    expect(requests).toHaveLength(0);
  });

  it('scrubs the token from API error messages', async () => {
    const { tools } = setup({
      responses: [{ status: 401, text: `Oauth token not authorized: ${TOKEN}` }],
    });
    const err = await tools.clickup_get_workspaces.handler().catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('(401)');
    expect((err as Error).message).toContain('***');
    expect((err as Error).message).not.toContain(TOKEN);
  });

  it('makeScrubber replaces every occurrence of the token', () => {
    const scrub = makeScrubber(TOKEN);
    expect(scrub(`a ${TOKEN} b ${TOKEN}`)).toBe('a *** b ***');
    expect(makeScrubber(undefined)('unchanged')).toBe('unchanged');
  });
});

describe('hierarchy tools', () => {
  it('lists workspaces as {id, name}', async () => {
    const { tools } = setup({
      responses: [{ body: { teams: [{ id: '42', name: 'Acme', color: '#fff', members: [{}] }] } }],
    });
    expect(await tools.clickup_get_workspaces.handler()).toEqual([{ id: '42', name: 'Acme' }]);
  });

  it('lists spaces with status names', async () => {
    const { tools, requests } = setup({
      responses: [
        {
          body: {
            spaces: [
              { id: 's1', name: 'Eng', statuses: [{ status: 'to do' }, { status: 'done' }] },
            ],
          },
        },
      ],
    });
    const result = await tools.clickup_get_spaces.handler({ team_id: '42' });
    expect(requests[0]!.url).toBe('https://api.clickup.com/api/v2/team/42/space');
    expect(result).toEqual([{ id: 's1', name: 'Eng', statuses: ['to do', 'done'] }]);
  });

  it('lists folders with their lists', async () => {
    const { tools, requests } = setup({
      responses: [
        { body: { folders: [{ id: 'f1', name: 'Sprints', lists: [{ id: 'l1', name: 'Sprint 1', extra: true }] }] } },
      ],
    });
    const result = await tools.clickup_get_folders.handler({ space_id: 's1' });
    expect(requests[0]!.url).toBe('https://api.clickup.com/api/v2/space/s1/folder');
    expect(result).toEqual([{ id: 'f1', name: 'Sprints', lists: [{ id: 'l1', name: 'Sprint 1' }] }]);
  });

  it('routes clickup_get_lists to the folder or space endpoint', async () => {
    const { tools, requests } = setup({ responses: [{ body: { lists: [{ id: 'l1', name: 'Backlog' }] } }] });
    expect(await tools.clickup_get_lists.handler({ folder_id: 'f1' })).toEqual([
      { id: 'l1', name: 'Backlog' },
    ]);
    await tools.clickup_get_lists.handler({ space_id: 's1' });
    expect(requests[0]!.url).toBe('https://api.clickup.com/api/v2/folder/f1/list');
    expect(requests[1]!.url).toBe('https://api.clickup.com/api/v2/space/s1/list');
  });

  it('rejects clickup_get_lists with neither or both of folder_id/space_id', async () => {
    const { tools, requests } = setup();
    await expect(tools.clickup_get_lists.handler({})).rejects.toThrow(
      'exactly one of folder_id or space_id',
    );
    await expect(tools.clickup_get_lists.handler({ folder_id: 'f1', space_id: 's1' })).rejects.toThrow(
      'exactly one of folder_id or space_id',
    );
    expect(requests).toHaveLength(0);
  });
});

describe('clickup_get_tasks', () => {
  it('builds the full filter query including tags and JSON-encoded custom fields', async () => {
    const { tools, requests } = setup({ responses: [{ body: { tasks: [] } }] });
    await tools.clickup_get_tasks.handler({
      list_id: '901',
      page: 2,
      include_closed: true,
      subtasks: true,
      statuses: ['in progress', 'review'],
      assignees: ['1001'],
      tags: ['bug', 'frontend'],
      custom_fields: [
        { field_id: 'cf-1', operator: '=', value: 'opt-uuid' },
        { field_id: 'cf-2', operator: 'IS NOT NULL' },
      ],
      order_by: 'updated',
      reverse: true,
      due_date_lt: 1730000000000,
      date_updated_gt: 1720000000000,
    });
    const url = new URL(requests[0]!.url);
    expect(url.pathname).toBe('/api/v2/list/901/task');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('include_closed')).toBe('true');
    expect(url.searchParams.get('subtasks')).toBe('true');
    expect(url.searchParams.getAll('statuses[]')).toEqual(['in progress', 'review']);
    expect(url.searchParams.getAll('assignees[]')).toEqual(['1001']);
    expect(url.searchParams.getAll('tags[]')).toEqual(['bug', 'frontend']);
    expect(JSON.parse(url.searchParams.get('custom_fields')!)).toEqual([
      { field_id: 'cf-1', operator: '=', value: 'opt-uuid' },
      { field_id: 'cf-2', operator: 'IS NOT NULL' },
    ]);
    expect(url.searchParams.get('order_by')).toBe('updated');
    expect(url.searchParams.get('reverse')).toBe('true');
    expect(url.searchParams.get('due_date_lt')).toBe('1730000000000');
    expect(url.searchParams.get('date_updated_gt')).toBe('1720000000000');
  });

  it('omits filters that were not provided', async () => {
    const { tools, requests } = setup({ responses: [{ body: { tasks: [] } }] });
    await tools.clickup_get_tasks.handler({ list_id: '901' });
    expect(new URL(requests[0]!.url).search).toBe('');
  });

  it('returns bounded task summaries without descriptions', async () => {
    const { tools } = setup({ responses: [{ body: { tasks: [TASK_FIXTURE] } }] });
    const result = await tools.clickup_get_tasks.handler({ list_id: '901', page: 1 });
    expect(result).toEqual({ page: 1, count: 1, tasks: [TASK_SUMMARY] });
    expect(JSON.stringify(result)).not.toContain('long description');
  });
});

describe('clickup_search_tasks', () => {
  it('searches team-wide with scope filters and subtasks', async () => {
    const { tools, requests } = setup({
      responses: [{ body: { tasks: [TASK_FIXTURE], last_page: false } }],
    });
    const result = await tools.clickup_search_tasks.handler({
      team_id: '42',
      subtasks: true,
      tags: ['bug'],
      space_ids: ['s1'],
      project_ids: ['f1'],
      list_ids: ['l1'],
      custom_fields: [{ field_id: 'cf-1', operator: 'ANY', value: ['opt-a', 'opt-b'] }],
    });
    const url = new URL(requests[0]!.url);
    expect(url.pathname).toBe('/api/v2/team/42/task');
    expect(url.searchParams.get('subtasks')).toBe('true');
    expect(url.searchParams.getAll('tags[]')).toEqual(['bug']);
    expect(url.searchParams.getAll('space_ids[]')).toEqual(['s1']);
    expect(url.searchParams.getAll('project_ids[]')).toEqual(['f1']);
    expect(url.searchParams.getAll('list_ids[]')).toEqual(['l1']);
    expect(JSON.parse(url.searchParams.get('custom_fields')!)).toEqual([
      { field_id: 'cf-1', operator: 'ANY', value: ['opt-a', 'opt-b'] },
    ]);
    expect(result).toEqual({ page: 0, lastPage: false, count: 1, tasks: [TASK_SUMMARY] });
  });
});

describe('clickup_get_task', () => {
  it('always requests subtasks and markdown description', async () => {
    const { tools, requests } = setup({ responses: [{ body: TASK_FIXTURE }] });
    await tools.clickup_get_task.handler({ task_id: '86abc123' });
    const url = new URL(requests[0]!.url);
    expect(url.pathname).toBe('/api/v2/task/86abc123');
    expect(url.searchParams.get('include_subtasks')).toBe('true');
    expect(url.searchParams.get('include_markdown_description')).toBe('true');
    expect(url.searchParams.get('custom_task_ids')).toBeNull();
  });

  it('resolves custom ids when team_id is given', async () => {
    const { tools, requests } = setup({ responses: [{ body: TASK_FIXTURE }] });
    await tools.clickup_get_task.handler({ task_id: 'ABC-123', team_id: '42' });
    const url = new URL(requests[0]!.url);
    expect(url.pathname).toBe('/api/v2/task/ABC-123');
    expect(url.searchParams.get('custom_task_ids')).toBe('true');
    expect(url.searchParams.get('team_id')).toBe('42');
  });

  it('truncates oversized text fields in the full payload', async () => {
    const long = 'x'.repeat(TASK_TEXT_LIMIT + 100);
    const { tools } = setup({
      responses: [{ body: { ...TASK_FIXTURE, markdown_description: long } }],
    });
    const result = (await tools.clickup_get_task.handler({ task_id: '86abc123' })) as Record<
      string,
      unknown
    >;
    expect((result['markdown_description'] as string).length).toBeLessThan(long.length);
    expect(result['markdown_description']).toContain('[… truncated]');
    expect(result['description']).toBe(TASK_FIXTURE.description);
  });

  it('truncateText caps at TASK_TEXT_LIMIT and leaves short text alone', () => {
    expect(truncateText('short')).toBe('short');
    const long = 'y'.repeat(TASK_TEXT_LIMIT + 1);
    expect(truncateText(long)).toBe(`${'y'.repeat(TASK_TEXT_LIMIT)} [… truncated]`);
  });
});

describe('clickup_get_custom_fields', () => {
  it('returns trimmed field definitions with dropdown options', async () => {
    const { tools, requests } = setup({
      responses: [
        {
          body: {
            fields: [
              {
                id: 'cf-1',
                name: 'Team',
                type: 'drop_down',
                required: false,
                type_config: {
                  default: 0,
                  options: [
                    { id: 'opt-a', name: 'Platform', orderindex: 0, color: '#f00' },
                    { id: 'opt-b', label: 'Mobile', orderindex: 1 },
                  ],
                },
              },
              { id: 'cf-2', name: 'Estimate', type: 'number', type_config: {} },
            ],
          },
        },
      ],
    });
    const result = await tools.clickup_get_custom_fields.handler({ list_id: '901' });
    expect(requests[0]!.url).toBe('https://api.clickup.com/api/v2/list/901/field');
    expect(result).toEqual([
      {
        id: 'cf-1',
        name: 'Team',
        type: 'drop_down',
        required: false,
        options: [
          { id: 'opt-a', name: 'Platform', orderindex: 0 },
          { id: 'opt-b', name: 'Mobile', orderindex: 1 },
        ],
      },
      { id: 'cf-2', name: 'Estimate', type: 'number' },
    ]);
  });
});

describe('clickup_create_task', () => {
  it('POSTs only the provided fields and returns a compact result', async () => {
    const { tools, requests } = setup({ responses: [{ body: TASK_FIXTURE }] });
    const result = await tools.clickup_create_task.handler({
      list_id: '901',
      name: 'Fix the widget',
      parent: '86parent1',
      tags: ['bug'],
      custom_fields: [{ id: 'cf-1', value: 'opt-a' }],
    });
    expect(requests[0]!.method).toBe('POST');
    expect(requests[0]!.url).toBe('https://api.clickup.com/api/v2/list/901/task');
    expect(JSON.parse(requests[0]!.body!)).toEqual({
      name: 'Fix the widget',
      parent: '86parent1',
      tags: ['bug'],
      custom_fields: [{ id: 'cf-1', value: 'opt-a' }],
    });
    expect(result).toEqual({
      id: '86abc123',
      customId: 'ABC-123',
      name: 'Fix the widget',
      url: 'https://app.clickup.com/t/86abc123',
    });
  });
});

describe('clickup_update_task', () => {
  it('PUTs core fields, preserving explicit nulls and omitting the rest', async () => {
    const { tools, requests } = setup({ responses: [{ body: TASK_FIXTURE }] });
    const result = await tools.clickup_update_task.handler({
      task_id: '86abc123',
      status: 'done',
      priority: null,
      points: null,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.method).toBe('PUT');
    expect(new URL(requests[0]!.url).pathname).toBe('/api/v2/task/86abc123');
    expect(JSON.parse(requests[0]!.body!)).toEqual({ status: 'done', priority: null, points: null });
    expect(result).toBe('Updated core fields on task 86abc123');
  });

  it('sets custom fields via sequential field POSTs, skipping the PUT when only custom fields are given', async () => {
    const { tools, requests } = setup({ responses: [{ body: {} }] });
    const result = await tools.clickup_update_task.handler({
      task_id: 'ABC-123',
      team_id: '42',
      custom_fields: [
        { id: 'cf-1', value: 'opt-a' },
        { id: 'cf-2', value: [1, 2] },
      ],
    });
    expect(requests).toHaveLength(2);
    for (const [i, fieldId] of ['cf-1', 'cf-2'].entries()) {
      const url = new URL(requests[i]!.url);
      expect(requests[i]!.method).toBe('POST');
      expect(url.pathname).toBe(`/api/v2/task/ABC-123/field/${fieldId}`);
      expect(url.searchParams.get('custom_task_ids')).toBe('true');
      expect(url.searchParams.get('team_id')).toBe('42');
    }
    expect(JSON.parse(requests[0]!.body!)).toEqual({ value: 'opt-a' });
    expect(JSON.parse(requests[1]!.body!)).toEqual({ value: [1, 2] });
    expect(result).toBe('Updated custom fields [cf-1, cf-2] on task ABC-123');
  });

  it('reports partial state when a custom-field update fails midway', async () => {
    const { tools, requests } = setup({
      responses: [{ body: {} }, { body: {} }, { status: 400, text: 'Field value invalid' }],
    });
    const err = await tools.clickup_update_task
      .handler({
        task_id: '86abc123',
        status: 'done',
        custom_fields: [
          { id: 'cf-1', value: 'opt-a' },
          { id: 'cf-2', value: 'bad' },
        ],
      })
      .catch((e: Error) => e);
    expect(requests).toHaveLength(3);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('Updated core fields and custom fields [cf-1]');
    expect((err as Error).message).toContain('setting custom field cf-2 failed');
    expect((err as Error).message).toContain('(400)');
  });
});
