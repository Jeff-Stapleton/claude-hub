import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { HubPaths, Store } from '@claude-hub/core';
import { CCConfigReader, CCWatcher } from '@claude-hub/cc-config-reader';
import { ChannelManager } from '@claude-hub/channels';
import { registerWs } from '../src/ws.js';
import type { UIState } from '../src/state.js';

interface StateFrame {
  type: 'state';
  payload: UIState;
}

/** Open a WS, collect frames until `predicate` returns true, then close. */
async function collectFrames(
  url: string,
  predicate: (frames: StateFrame[]) => boolean,
  timeoutMs = 2000,
): Promise<StateFrame[]> {
  const frames: StateFrame[] = [];
  const ws = new WebSocket(url);
  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`timed out waiting for frames; got ${frames.length}`));
    }, timeoutMs);
    ws.addEventListener('message', (evt) => {
      frames.push(JSON.parse(String((evt as MessageEvent).data)));
      if (predicate(frames)) {
        clearTimeout(timer);
        ws.close();
        resolve();
      }
    });
    ws.addEventListener('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
  await done;
  return frames;
}

describe('WS state broadcast', () => {
  let app: FastifyInstance;
  let store: Store;
  let ccReader: CCConfigReader;
  let ccWatcher: CCWatcher;
  let channelMgr: ChannelManager;
  let url: string;
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ws-test-'));
    store = new Store(new HubPaths(root));
    await store.load();
    // Point cc-config-reader at an empty temp dir so listProjects() returns
    // [] without touching the real ~/.claude/.
    ccReader = new CCConfigReader(join(root, 'fake-claude'));
    ccWatcher = new CCWatcher(ccReader); // not started — used only as an EventEmitter
    channelMgr = new ChannelManager(store); // not started — discordStatus() returns 'disconnected'

    app = Fastify();
    await registerWs(app, store, ccReader, ccWatcher, channelMgr);
    const listenUrl = await app.listen({ host: '127.0.0.1', port: 0 });
    url = `${listenUrl.replace(/^http/, 'ws')}/ws`;
  });

  afterEach(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  it('sends an initial {type:"state"} frame on connect with a UIState payload', async () => {
    const frames = await collectFrames(url, (f) => f.length >= 1);
    expect(frames[0]?.type).toBe('state');
    expect(frames[0]?.payload).toMatchObject({
      projects: expect.any(Array),
      channels: expect.any(Array),
      triggers: expect.any(Array),
      orchestrator: expect.any(Object),
    });
  });

  it('broadcasts a new frame on store.change (e.g. trigger added)', async () => {
    const framesPromise = collectFrames(url, (f) => f.length >= 2);
    // Wait a beat to make sure the WS is connected and the initial frame
    // landed before we mutate the store.
    await new Promise((r) => setTimeout(r, 50));
    await store.update('triggers', () => [
      {
        id: 't1',
        type: 'cron',
        name: 'broadcast-test',
        projectId: 'proj-1',
        prompt: 'hi',
        cronExpr: '0 0 1 1 *',
      },
    ]);
    const frames = await framesPromise;
    expect(frames).toHaveLength(2);
    expect(frames[1]?.payload.triggers).toHaveLength(1);
    expect(frames[1]?.payload.triggers[0]?.name).toBe('broadcast-test');
  });

  it('redacts secrets in broadcast frames (botToken → botTokenSet, secret → secretSet)', async () => {
    await store.update('channels', () => [
      { id: 'discord', type: 'discord', botToken: 'super-secret', allowedUserIds: ['u1'] },
    ]);
    await store.update('triggers', () => [
      {
        id: 'wh-1',
        type: 'webhook',
        name: 'wh',
        projectId: 'proj-1',
        promptTemplate: 'x',
        secret: 'a'.repeat(64),
      },
    ]);

    const frames = await collectFrames(url, (f) => f.length >= 1);
    const payload = frames[0]!.payload;
    const ch = payload.channels[0]!;
    const wh = payload.triggers[0]!;

    // Channel: botToken stripped, botTokenSet present
    expect((ch as { botToken?: unknown }).botToken).toBeUndefined();
    expect((ch as { botTokenSet: boolean }).botTokenSet).toBe(true);

    // Webhook trigger: secret stripped, secretSet:true present
    expect((wh as { secret?: unknown }).secret).toBeUndefined();
    expect((wh as { secretSet?: true }).secretSet).toBe(true);
  });

  it('rebroadcasts on cc-watcher change events', async () => {
    const framesPromise = collectFrames(url, (f) => f.length >= 2);
    await new Promise((r) => setTimeout(r, 50));
    ccWatcher.emit('change', { kind: 'projects' });
    const frames = await framesPromise;
    expect(frames).toHaveLength(2);
    expect(frames[1]?.type).toBe('state');
  });
});
