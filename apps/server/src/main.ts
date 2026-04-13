import { CCConfigReader, CCWatcher } from '@claude-hub/cc-config-reader';
import { Store } from '@claude-hub/core';
import { CronScheduler, TriggerRunner } from '@claude-hub/triggers';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { registerProjectRoutes } from './routes/projects.js';
import { registerStateRoutes } from './routes/state.js';
import { registerTriggerRoutes } from './routes/triggers.js';
import { registerWs } from './ws.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const store = new Store();
  await store.load();

  const ccReader = new CCConfigReader();
  const ccWatcher = new CCWatcher(ccReader);
  ccWatcher.start();

  const triggerRunner = new TriggerRunner(store);
  const cronScheduler = new CronScheduler(store, triggerRunner);
  cronScheduler.start();

  const app = Fastify({ logger: { level: 'info' } });

  // Broadcast WS updates on trigger run lifecycle too, so the UI reflects
  // a trigger firing without waiting for the next store save.
  triggerRunner.on('started', () => ccWatcher.emit('change', { kind: 'projects' }));
  triggerRunner.on('finished', () => ccWatcher.emit('change', { kind: 'projects' }));

  await registerWs(app, store, ccReader, ccWatcher);
  await registerStateRoutes(app, store, ccReader);
  await registerProjectRoutes(app, store);
  await registerTriggerRoutes(app, store, triggerRunner);

  // Serve the built web bundle if present. In dev, the Vite server on :5173
  // proxies /api and /ws here; this static branch only matters for
  // `pnpm build && pnpm --filter @claude-hub/server start`.
  const webDist = resolve(__dirname, '../../web/dist');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/', decorateReply: false });
    app.setNotFoundHandler((req, reply) => {
      // SPA fallback for client-side routing — leave /api and /ws alone.
      if (req.url.startsWith('/api') || req.url.startsWith('/ws')) {
        return reply.code(404).send({ error: 'not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  const port = store.config().httpPort;
  await app.listen({ host: '127.0.0.1', port });
  app.log.info(`claude-hub listening on http://127.0.0.1:${port}`);

  const shutdown = async (): Promise<void> => {
    app.log.info('shutting down');
    cronScheduler.stop();
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
