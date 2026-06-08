import { ProviderAgentRunner } from '@claude-hub/agent-runner';
import { CCConfigReader, CCWatcher } from '@claude-hub/cc-config-reader';
import { ChannelManager } from '@claude-hub/channels';
import { Store } from '@claude-hub/core';
import {
  Orchestrator,
  writeCursorOrchestratorMcpConfig,
  writeOrchestratorMcpConfig,
} from '@claude-hub/orchestrator';
import { CronScheduler, TriggerRunner } from '@claude-hub/triggers';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { registerActivityRoutes } from './routes/activity.js';
import { registerChannelRoutes } from './routes/channels.js';
import { registerConfigRoutes } from './routes/config.js';
import { registerOrchestratorRoutes } from './routes/orchestrator.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerStateRoutes } from './routes/state.js';
import { registerTriggerRoutes } from './routes/triggers.js';
import { registerWs } from './ws.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ACK_MESSAGES = [
  'Got it — working on this now.',
  'On it. I\'ll get back to you when I have something.',
  'Message received. Spinning up now.',
  'Roger that. Give me a bit to work through this.',
  'Acknowledged — diving in.',
  'Copy. Working on it.',
  'Got your message. Kicking this off now.',
  'Understood. I\'ll ping you when it\'s done.',
  'On the case. Sit tight.',
  'Received. Starting work on this now.',
  'Message noted — processing.',
  'Got it. Let me take a look.',
  'Working on this. I\'ll follow up shortly.',
  'Heard you. Firing up the agent now.',
  'Acknowledged. Running this through now.',
  'Received loud and clear. Working on it.',
  'On it. I\'ll report back with results.',
  'Understood — picking this up now.',
  'Got it. Hang tight while I work through this.',
  'Message received. I\'ll reply once I have an answer.',
];

function randomAck(): string {
  return ACK_MESSAGES[Math.floor(Math.random() * ACK_MESSAGES.length)]!;
}

async function main(): Promise<void> {
  const store = new Store();
  await store.load();

  const ccReader = new CCConfigReader();
  const ccWatcher = new CCWatcher(ccReader);
  ccWatcher.start();

  const agentRunner = new ProviderAgentRunner(() => ({
    defaultProvider: store.config().defaultProvider,
    providers: store.config().providers,
  }));

  const triggerRunner = new TriggerRunner(store, agentRunner, {
    timeoutMs: store.config().triggerTimeoutMs,
  });
  const cronScheduler = new CronScheduler(store, triggerRunner);
  cronScheduler.start();

  // Orchestrator: write MCP configs once, set up the workdir, wire a
  // per-DM handler. Uses approach (B) — per-message CLI print runs — so
  // nothing here needs a long-lived agent subprocess.
  const orchestratorWorkdir = store.paths.orchestratorWorkdir();
  await mkdir(orchestratorWorkdir, { recursive: true });
  const hubMcpServerPath = resolve(
    __dirname,
    '../../../packages/hub-mcp/dist/server.js',
  );
  const port = store.config().httpPort;
  const claudeMcpConfigPath = await writeOrchestratorMcpConfig({
    dir: orchestratorWorkdir,
    hubMcpServerPath,
    hubUrl: `http://127.0.0.1:${port}`,
  });
  await writeCursorOrchestratorMcpConfig({
    workdir: orchestratorWorkdir,
    hubMcpServerPath,
    hubUrl: `http://127.0.0.1:${port}`,
  });
  const orchestrator = new Orchestrator(
    store,
    {
      workdir: orchestratorWorkdir,
      claudeMcpConfigPath,
      timeoutMs: store.config().orchestratorTimeoutMs,
    },
    agentRunner,
  );

  const channels = new ChannelManager(store);

  const app = Fastify({ logger: { level: 'info' } });

  // Broadcast WS updates on trigger + channel + orchestrator activity so
  // the UI reflects live state without polling. We piggy-back on
  // ccWatcher's 'change' event because it's already wired to the
  // broadcast in registerWs.
  triggerRunner.on('started', () => ccWatcher.emit('change', { kind: 'projects' }));
  triggerRunner.on('finished', () => ccWatcher.emit('change', { kind: 'projects' }));
  channels.on('statusChanged', () => ccWatcher.emit('change', { kind: 'projects' }));

  // Wire incoming channel messages through the orchestrator and reply
  // back on the originating channel. A quick ack goes out immediately so
  // the user knows the hub received the message — agent runs can legitimately
  // take minutes-to-hours. Ack failures are logged but don't block the
  // orchestrator run; the real reply still lands when CC finishes.
  channels.start(async (msg) => {
    app.log.info({ user: msg.user, channel: msg.channelId }, 'incoming DM');

    try {
      await channels.send(msg.channelId, msg.conversationId, randomAck());
    } catch (err) {
      app.log.warn({ err }, 'failed to send ack');
    }

    const result = await orchestrator.handle(msg);
    const reply = result.ok
      ? result.text.trim() || 'Done — no output returned.'
      : `Error: ${result.error}`;
    try {
      await channels.send(msg.channelId, msg.conversationId, reply);
    } catch (err) {
      app.log.error({ err }, 'failed to send orchestrator reply');
    }
  });

  await registerWs(app, store, ccReader, ccWatcher, channels);
  await registerStateRoutes(app, store, ccReader, channels);
  await registerConfigRoutes(app, store);
  await registerProjectRoutes(app, store, agentRunner);
  await registerTriggerRoutes(app, store, triggerRunner);
  await registerChannelRoutes(app, store);
  await registerActivityRoutes(app, store);
  await registerOrchestratorRoutes(app, store);

  // Serve the built web bundle if present. In dev, the Vite server on :5173
  // proxies /api and /ws here; this static branch only matters for
  // `pnpm build && pnpm --filter @claude-hub/server start`.
  const webDist = resolve(__dirname, '../../web/dist');
  if (existsSync(webDist)) {
    // decorateReply MUST be true for the SPA-fallback handler below to call
    // reply.sendFile(). Browsers probe odd paths (/favicon.ico,
    // /.well-known/appspecific/com.chrome.devtools.json) which fall through
    // to setNotFoundHandler — without decoration we threw 500s on each.
    await app.register(fastifyStatic, { root: webDist, prefix: '/' });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api') || req.url.startsWith('/ws')) {
        return reply.code(404).send({ error: 'not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  await app.listen({ host: '127.0.0.1', port });
  app.log.info(`claude-hub listening on http://127.0.0.1:${port}`);

  const shutdown = async (): Promise<void> => {
    app.log.info('shutting down');
    cronScheduler.stop();
    await channels.stop();
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
