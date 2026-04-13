# CLAUDE.md

Guidance for AI agents working in this repo. This file is auto-loaded by Claude Code; keep it scannable. For user-facing docs see `README.md`.

## Mental model

`claude-hub` is scaffolding around Claude Code. The **brain is always `claude` itself**; everything in this repo is glue. Two distinct concepts wrap CC — and this split is load-bearing:

- **Channels** — conversational, bidirectional, *orchestrator-mediated*. v1 ships Discord DMs.
- **Triggers** — deterministic, one-way, *NOT* orchestrator-mediated. v1 ships cron + webhooks.

Webhooks fire `claude -p` directly against the project's cwd with a rendered prompt template. **The orchestrator never sees webhook traffic.** This keeps the orchestrator context clean and webhook behavior predictable. Do not "unify" these paths.

## Architecture

```
   Discord DM  ──► ChannelManager ──►  Orchestrator  ──► claude -p --resume ──► DM reply
                                          │              │
                                          │              │ --mcp-config
                                          ▼              ▼
                                  channelSessions    hub-mcp (stdio)
                                  (session-per-       │
                                   conversation)      │ HTTP (single writer)
                                                      ▼
                                               Hub API
                                                      ▲
   Cron tick  ──┐                                     │
                ├─► TriggerRunner ─► claude -p ───────┤
   Webhook POST ┘  (deterministic;                    │
                    no orchestrator)                  │
                                                      │
   React UI  ◄── WS ──────── Hub (Fastify) ───────────┘
                    ▲
                    └─ reads ~/.claude/ (CC config) via cc-config-reader
```

### Package graph

```
core  <── cc-runner        <── triggers    <── server
core  <── cc-config-reader                 <── server
core  <── channels                         <── server
core  <── orchestrator <── cc-runner       <── server
(hub-mcp has no workspace deps — it's a client of server over HTTP)
web   (standalone; proxies /api and /ws to server in dev)
```

Do not introduce cycles. If two packages need a shared type, put it in `packages/core/src/types.ts`.

### Orchestrator is NOT a long-lived CC subprocess

Approach (B): one `claude -p --resume <session-id>` per incoming message. Session id is persisted per conversation in `store.orchestrator.channelSessions` so follow-ups continue the context.

Why: simpler than piping JSON frames into a long-lived claude. We inherit tree-kill, timeouts, and envelope parsing from `cc-runner` for free. Per-conversation serialization queue in `Orchestrator.handle()` prevents races on the CC session file when DMs arrive fast. **Don't change this to a long-lived process without a very good reason.**

### hub-mcp is stdio, not in-process

`packages/hub-mcp` is a separate MCP stdio server spawned by `claude --mcp-config`. It holds no state — every tool delegates to the hub's HTTP API (`CLAUDE_HUB_URL` env var). Consequences worth preserving:

- Hub is the **single writer**. MCP mutations flow through the same validation, persistence, and WS broadcast pipeline as UI mutations.
- Secrets stay in the hub process; never in the MCP subprocess.
- A failing tool doesn't crash the hub.

Don't embed hub-mcp in-process "for simplicity" — it would re-introduce shared-memory concerns and weaken isolation.

## Conventions

### TypeScript

- `strict` + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` in `tsconfig.base.json`.
- Optional fields in object literals: spread-if-defined, not `undefined`:
  ```ts
  const obj = { a, ...(b !== undefined ? { b } : {}) };
  // NOT: const obj = { a, b };
  ```
- ESM everywhere. Relative imports need the `.js` extension (Bundler resolution).
- Cross-cutting types live in `@claude-hub/core`. Feature-local types live next to the feature.

### Store

- Flat JSON under `~/.claude-hub/`. Atomic writes (write-to-`*.tmp` then rename).
- Single-writer contract. Do not mutate `~/.claude-hub/*.json` from multiple processes.
- `Store.update(key, updaterOrValue)` — the updater form receives a `structuredClone` of current state, so mutation is safe.
- Breaking change to any persisted shape: bump `STORE_SCHEMA_VERSION` in `packages/core/src/types.ts`. The store refuses to load mismatched versions.

### Secrets

Plaintext secrets live in `~/.claude-hub/*.json` (bot tokens, webhook secrets). They are **redacted** at the `/api/state` serialization boundary in `apps/server/src/state.ts`:

- `Channel.botToken` → `botTokenSet: boolean`
- `WebhookTrigger.secret` → `secretSet: true`

If you add a new secret field:
1. Redact it in `state.ts` before it ships.
2. If it's user-generated, show plaintext **exactly once** in the create-response. There is intentionally no "reveal" endpoint — users re-create if they lose it.
3. Verify with `timingSafeEqual` (see `packages/triggers/src/webhook.ts`).

### Discord gotchas (these bit us, documented so you don't rediscover)

- **Bot tokens are exclusive.** Discord allows only one active gateway connection per bot token. If two processes (e.g. the hub and OpenClaw, or two hub restarts racing) use the same token, one silently loses its session and stops receiving events, while both may still appear connected. The `Events.Invalidated` listener in `packages/channels/src/discord.ts` catches one direction of this; the other direction is harder to detect. **Use a dedicated bot application per tool.**

- **discord.js v14 silently drops DMs.** In 14.16.3 (verified via live debug session — commit `feb6ded`), the typed `MessageCreate` event never fires for direct messages despite the raw `MESSAGE_CREATE` dispatch arriving. Partials (`Channel`, `Message`, `User`, `GuildMember`) and intents (`DirectMessages` + `MessageContent`) were all set correctly; no `Warn` or `Debug` line was emitted. We work around it by driving DM delivery off the raw gateway event in `DiscordChannelAdapter`. Guild messages still flow through the typed `MessageCreate` handler. If you upgrade `discord.js`, test a live DM end-to-end before removing the raw path — raw works regardless, so the workaround is safe to keep indefinitely.

- **Privileged intents must be enabled in the Developer Portal** per bot application. A fresh bot rejects `MessageContent` with gateway close code 4014 until you toggle it on under Bot → Privileged Gateway Intents.

- **`GuildMessages` intent is required for @mentions in server channels**, separate from `DirectMessages`. We request both so the `raw` log can surface all message activity during debugging even though v1 only responds to DMs.

### cc-runner gotchas (these bit us, documented so you don't rediscover)

- `claude -p` positional prompt: `--mcp-config <configs...>` is variadic and will greedily consume the prompt if you don't emit `--` before it. `cc-runner` already does this — don't strip it.
- `shell: true` on Windows doesn't quote args; prompts with spaces get tokenized and CC sees only the first word. Node 24 resolves `.cmd` shims with `shell: false` via PATHEXT, which is what `cc-runner` uses by default. Test fakes pass `node "<path>"` (with a space), so `cc-runner` auto-enables shell when `claudePath` contains whitespace.
- Always tree-kill on timeout. `child.kill` against a shell-launched `.cmd` only kills cmd.exe — the grandchild `claude.exe` (or node in tests) keeps running. `cc-runner.killTree` uses `taskkill /T /F` on Windows.

### WS "fat patch" model

On any `store.change` or CC config change, the server pushes `{type: "state", payload: UIState}` with the *entire* UIState. The UI drops it into the react-query cache:

```ts
qc.setQueryData(['state'], payload);
```

No per-field diffing. Fine for a local single-user app. Don't add diffing unless payload size becomes a real problem.

### Windows path gotchas

- JSON config files referencing paths: use **forward slashes**. Backslashes need double-escaping in JSON.
- `/tmp/` in bash is mingw's temp; `node.exe` resolves it to `C:\tmp\` which doesn't exist. For files node will read, use `C:\Users\$USER\AppData\Local\Temp\`.
- `~/.claude-hub/` resolves the same from bash and node.

## Running

```bash
pnpm install
pnpm -r build           # builds are ordered by deps
pnpm -r typecheck
pnpm -r test
pnpm --filter @claude-hub/server start     # loopback on :7878
```

**Gotcha — no TS project references yet.** On a fresh checkout, `pnpm -r typecheck` fails because `apps/server/typecheck` runs before `packages/triggers/build` has emitted its `dist/`. Always run `pnpm -r build` first on a new clone or after pulling large changes. Adding project references is a reasonable follow-up.

For hot-reload UI development:
```bash
# terminal 1
pnpm --filter @claude-hub/server dev

# terminal 2
pnpm --filter @claude-hub/web dev
# vite on :5173 proxies /api and /ws to :7878
```

## Smoke tests against real `claude`

Unit tests mock the CLI; E2E confidence comes from shell one-liners that spawn the real `claude` binary. Before running one, kill any stale listener on 7878 (previous session leftover is common):

```bash
powershell.exe -Command "Get-NetTCPConnection -LocalPort 7878 -State Listen -EA SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force }"
```

The commit messages (`git log`) contain the exact smoke commands used for each feature. Recreate them when debugging CC integration — don't try to reproduce in vitest.

## Common tasks

### Adding a REST endpoint

1. New file under `apps/server/src/routes/`.
2. Register in `apps/server/src/main.ts`.
3. If it mutates store, use `store.update()` on the relevant entity. WS broadcast happens automatically on the `change` event.
4. If it returns secret data, decide now whether it's one-time (mirror the webhook-create pattern) or redacted permanently.

### Adding an MCP tool

1. Append to `makeTools()` in `packages/hub-mcp/src/tools.ts`. Zod input schema + handler that calls `HubClient`.
2. Rebuild hub-mcp (`pnpm --filter @claude-hub/hub-mcp build`).
3. Orchestrator picks it up on the next CC spawn — no hub restart needed.

### Adding a channel type

1. Implement `ChannelAdapter` from `@claude-hub/channels`.
2. Register in `ChannelManager.reconcile()`.
3. Add a new type variant to `Channel` union in `packages/core/src/types.ts` and teach the state redactor (`apps/server/src/state.ts`) how to redact its secrets.
4. Add a subsection to `ChannelsTab.tsx`. Don't prematurely generalize the UI.

### Adding a trigger type

1. New variant in the `Trigger` discriminated union in `core`.
2. Extend `TriggerRunner.run()` if the new type needs different prompt rendering.
3. Add a runner subsystem (like `CronScheduler`) if it needs its own lifecycle.
4. Server route + UI subsection.

## What's intentionally out of scope

Don't add these without asking:

- **Auth on the UI.** Bound to 127.0.0.1 by design. Adding login adds complexity with no threat model for a local tool.
- **Built-in tunneling / remote access.** Users run their own ngrok / cloudflared / Tailscale Funnel. Documented in README.
- **A database.** Flat JSON is deliberate — mirrors how `~/.claude/` stores state. Only switch if trigger-run history volume forces it.
- **Streaming CC output to the UI.** CC runs are fire-and-forget from the UI's perspective; the Activity tab polls every 10s.
- **Long-lived orchestrator CC process.** See above.
- **hub-mcp running in-process.** See above.

## Style

- Concise commit subjects; commit body explains **why**. See `git log` for examples of the house style.
- One feature per commit when practical. Existing history is one commit per plan step.
- Don't add comments that restate the code. Do add comments that explain non-obvious decisions (e.g., "use `--` before prompt because --mcp-config is variadic").
- No emojis in files unless the user explicitly asks.
- Don't add features, refactor, or "polish" beyond what was asked.
- Always pause before destructive actions (force push, reset --hard, deleting `~/.claude-hub/`). The hub's state files are the only place some config lives.
