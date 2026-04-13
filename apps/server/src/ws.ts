import { CCConfigReader, CCWatcher } from '@claude-hub/cc-config-reader';
import type { Store } from '@claude-hub/core';
import websocket from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';
import { buildUIState } from './state.js';

/**
 * Wire up a WS endpoint at /ws that pushes UI state patches whenever either
 * the hub store changes or CC's on-disk config changes.
 *
 * v1 uses a "fat patch" model: on any change, re-send the whole UI state.
 * Message shape: {type: "state", payload: UIState}. Simpler than per-field
 * diffing and fine for a single-user local app.
 */
export async function registerWs(
  app: FastifyInstance,
  store: Store,
  ccReader: CCConfigReader,
  ccWatcher: CCWatcher,
): Promise<void> {
  await app.register(websocket);

  const clients = new Set<import('ws').WebSocket>();

  app.get('/ws', { websocket: true }, (socket) => {
    clients.add(socket);
    void (async () => {
      const state = await buildUIState(store, ccReader);
      safeSend(socket, { type: 'state', payload: state });
    })();
    socket.on('close', () => clients.delete(socket));
  });

  const broadcast = async (): Promise<void> => {
    if (clients.size === 0) return;
    const state = await buildUIState(store, ccReader);
    const frame = JSON.stringify({ type: 'state', payload: state });
    for (const c of clients) {
      if (c.readyState === c.OPEN) c.send(frame);
    }
  };

  store.on('change', () => {
    void broadcast();
  });
  ccWatcher.on('change', () => {
    void broadcast();
  });
}

function safeSend(socket: import('ws').WebSocket, value: unknown): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(value));
}
