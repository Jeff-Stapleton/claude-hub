import { CCConfigReader } from '@claude-hub/cc-config-reader';
import type { Store } from '@claude-hub/core';
import type { FastifyInstance } from 'fastify';
import { buildUIState } from '../state.js';

export async function registerStateRoutes(
  app: FastifyInstance,
  store: Store,
  ccReader: CCConfigReader,
): Promise<void> {
  app.get('/api/state', async () => buildUIState(store, ccReader));
}
