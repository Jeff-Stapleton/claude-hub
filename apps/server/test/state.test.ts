import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HubPaths, Store, type WebhookTrigger } from '@claude-hub/core';
import { CCConfigReader } from '@claude-hub/cc-config-reader';
import { buildUIState } from '../src/state.js';

describe('buildUIState', () => {
  let root: string;
  let store: Store;
  let ccReader: CCConfigReader;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'state-test-'));
    store = new Store(new HubPaths(root));
    await store.load();
    // Point CC reader at an empty temp dir so it doesn't read real ~/.claude.
    ccReader = new CCConfigReader(join(root, 'fake-claude'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('redacts Discord bot token to botTokenSet: boolean', async () => {
    await store.update('channels', [
      {
        id: 'discord',
        type: 'discord' as const,
        botToken: 'SUPER_SECRET_TOKEN_12345',
        allowedUserIds: ['111'],
      },
    ]);

    const state = await buildUIState(store, ccReader);
    const ch = state.channels[0];
    expect(ch).toBeDefined();
    expect(ch!.botTokenSet).toBe(true);
    // The raw token must NOT appear anywhere in the serialized state.
    const json = JSON.stringify(state);
    expect(json).not.toContain('SUPER_SECRET_TOKEN_12345');
  });

  it('redacts webhook trigger secret to secretSet: true', async () => {
    await store.update('projects', [
      { id: 'p1', path: '/tmp/proj', addedAt: new Date().toISOString() },
    ]);
    const trigger: WebhookTrigger = {
      id: 'w1',
      type: 'webhook',
      name: 'test',
      projectId: 'p1',
      promptTemplate: 'hello {{payload.x}}',
      secret: 'TOP_SECRET_WEBHOOK_KEY_ABCDEF',
    };
    await store.update('triggers', [trigger]);

    const state = await buildUIState(store, ccReader);
    const t = state.triggers[0];
    expect(t).toBeDefined();
    // Check the trigger has secretSet instead of secret.
    const json = JSON.stringify(state);
    expect(json).not.toContain('TOP_SECRET_WEBHOOK_KEY_ABCDEF');
    expect(json).toContain('"secretSet":true');
  });

  it('includes cron triggers without modification', async () => {
    await store.update('projects', [
      { id: 'p1', path: '/tmp/proj', addedAt: new Date().toISOString() },
    ]);
    await store.update('triggers', [
      {
        id: 'c1',
        type: 'cron' as const,
        name: 'daily',
        projectId: 'p1',
        prompt: 'summarize',
        cronExpr: '0 9 * * *',
      },
    ]);

    const state = await buildUIState(store, ccReader);
    expect(state.triggers[0]).toMatchObject({
      id: 'c1',
      type: 'cron',
      name: 'daily',
      prompt: 'summarize',
      cronExpr: '0 9 * * *',
    });
  });

  it('shows botTokenSet: false when no token is configured', async () => {
    await store.update('channels', [
      {
        id: 'discord',
        type: 'discord' as const,
        botToken: '',
        allowedUserIds: [],
      },
    ]);

    const state = await buildUIState(store, ccReader);
    expect(state.channels[0]!.botTokenSet).toBe(false);
  });

  it('returns empty arrays when nothing is configured', async () => {
    const state = await buildUIState(store, ccReader);
    expect(state.projects).toEqual([]);
    expect(state.channels).toEqual([]);
    expect(state.triggers).toEqual([]);
    expect(state.orchestrator.status).toBe('stopped');
  });
});
