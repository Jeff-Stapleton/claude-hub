import { CCConfigReader, CCWatcher } from '@claude-hub/cc-config-reader';
import { Store } from '@claude-hub/core';
import Fastify from 'fastify';
import { registerProjectRoutes } from './routes/projects.js';
import { registerStateRoutes } from './routes/state.js';
import { registerWs } from './ws.js';

async function main(): Promise<void> {
  const store = new Store();
  await store.load();

  const ccReader = new CCConfigReader();
  const ccWatcher = new CCWatcher(ccReader);
  ccWatcher.start();

  const app = Fastify({ logger: { level: 'info' } });

  await registerWs(app, store, ccReader, ccWatcher);
  await registerStateRoutes(app, store, ccReader);
  await registerProjectRoutes(app, store);

  const port = store.config().httpPort;
  await app.listen({ host: '127.0.0.1', port });
  app.log.info(`claude-hub listening on http://127.0.0.1:${port}`);

  const shutdown = async (): Promise<void> => {
    app.log.info('shutting down');
    await ccWatcher.stop();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
