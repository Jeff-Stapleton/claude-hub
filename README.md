# claude-hub

A local-first GUI + bridge for [Claude Code](https://docs.claude.com/en/docs/claude-code), inspired by [OpenClaw](https://github.com/openclaw/openclaw) but purpose-built for CC. The brain is always Claude Code itself; `claude-hub` is the surrounding scaffolding.

## Getting Started

### Prerequisites

- **Node.js 22+** (24 recommended). Check with `node --version`.
- **Claude Code CLI** installed and authenticated — `claude --version` should print a version, and you should already be logged in (run `claude` once to confirm). The hub shells out to this binary for every CC run.
- **pnpm 9+** via [corepack](https://nodejs.org/api/corepack.html) (bundled with Node). Run `corepack enable` once; the hub's `packageManager` field pins the exact pnpm version.

### Install, build, run

```bash
git clone <this-repo>
cd claude-hub

corepack pnpm install
corepack pnpm -r build
corepack pnpm --filter @claude-hub/server start
```

Open http://127.0.0.1:7878 in your browser. The hub binds to loopback only — no auth, no login.

### First use — verify the full loop works

1. **Add a project** (Projects tab → Add project). Use the absolute path of a directory you've already used with Claude Code. If CC has seen it before, the row shows its session count and last activity from `~/.claude/projects/`.

2. **Fire a cron trigger on demand.** Triggers tab → Cron → Add:
   - Name: `smoke`
   - Project: pick the one you just added
   - Cron: `0 0 1 1 *` (effectively never; we'll run it manually)
   - Prompt: `reply with exactly the word OK`
   
   Click **Run now**. After a few seconds, the row's status should flip to `success`. Open the Activity tab to see the transcript.

3. **(Optional) Try a webhook.** Triggers → Webhooks → Add. Copy the URL and secret from the one-time banner, then:

   ```bash
   curl -X POST http://127.0.0.1:7878/triggers/webhooks/<id> \
     -H "X-Hub-Secret: <secret>" \
     -H "Content-Type: application/json" \
     -d '{"message":"hello from curl"}'
   ```

   Returns `202` immediately; the CC run appears in Activity within seconds.

4. **(Optional) Enable Discord.** See [Configure Discord](#configure-discord-optional) below.

### Troubleshooting

- **`EADDRINUSE :7878` on start** — a previous hub is still running. Kill it:
  ```bash
  powershell.exe -Command "Get-NetTCPConnection -LocalPort 7878 -State Listen -EA SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force }"
  ```
  (On macOS/Linux: `lsof -ti :7878 | xargs kill`.)

- **Typecheck fails with `Cannot find module '@claude-hub/triggers'`** — run `pnpm -r build` first. TypeScript project references aren't set up yet, so the server's typecheck needs built `dist/` folders from its workspace deps.

- **`claude` not found** — install via the [Claude Code installer](https://docs.claude.com/en/docs/claude-code/quickstart) and verify with `claude --version`. The hub doesn't bundle it.

- **Trigger run status stuck on `running`** — CC hit the default 10-minute timeout. Check `~/.claude-hub/history/triggers/<id>.jsonl` for the error tail.

- **Bot token saved but status shows `error`** — check the Channels tab for the error message. Usually missing `MESSAGE CONTENT` intent in the Discord developer portal.

## Concepts

- **Channels** — conversational, bidirectional, *orchestrator-mediated* surfaces. v1 ships Discord DMs. A user DMs the bot; each conversation gets its own persistent CC session id, so follow-ups continue the same context.
- **Triggers** — deterministic, *non-conversational* event handlers that fire a CC run with a pre-defined prompt against a specific project. v1 ships **cron** (time-based) and **webhooks** (HTTP-based). Triggers bypass the orchestrator entirely.
- **Projects** — user-registered working directories. CC sessions and skills are scoped per directory; the hub mirrors that.
- **Orchestrator** — not a long-lived process. For each incoming DM, the hub spawns `claude -p --resume <session-id> --mcp-config <hub-mcp-config>` in a dedicated workdir. The CC session id is persisted per conversation so follow-ups resume.
- **hub-mcp** — an MCP stdio server claude-hub ships for the orchestrator. It exposes hub tools (`list_projects`, `spawn_session`, `create_cron_trigger`, `create_webhook_trigger`, ...) so the DM'd agent can manage the hub by name. Tools delegate to the hub's own HTTP API so mutations go through the same validation + WS-broadcast pipeline as UI edits.

## Architecture

```
   Discord DM  ──► ChannelManager ──►  Orchestrator  ──► claude -p --resume ──► DM reply
                                          │              │
                                          │              │ --mcp-config
                                          ▼              ▼
                                  channelSessions    hub-mcp (stdio)
                                  (session-per-       │
                                   conversation)      │ HTTP
                                                      ▼
                                               Hub API (the single writer)
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

## Stack

Node 22+, TypeScript strict ESM, pnpm workspace.

- **Server:** Fastify 5 + @fastify/websocket + @fastify/static
- **Client:** React 18 + Vite 5 + TanStack Query, served by Fastify in prod
- **Discord:** discord.js v14
- **Claude Code:** the `claude` CLI (via `@claude-hub/cc-runner` — handles JSON envelope parsing, timeouts, tree-kill on Windows)
- **MCP:** `@modelcontextprotocol/sdk` stdio transport
- **Triggers:** node-cron in-process

## Workspace layout

```
packages/
  core/                state store + shared types + ~/.claude-hub/ paths
  cc-runner/           spawns claude -p with JSON envelope parsing
  cc-config-reader/    read-only views of ~/.claude/
  triggers/            cron + webhook runners + safe prompt templater
  channels/            Channel adapter interface + Discord
  orchestrator/        per-DM claude -p --resume + MCP config writer
  hub-mcp/             stdio MCP server the orchestrator uses
apps/
  server/              Fastify + ws + CRUD routes + static bundle
  web/                 Vite React UI (5 tabs)
```

## State on disk

Everything in `~/.claude-hub/` — mirrors how Claude Code itself stores config in `~/.claude/`.

```
~/.claude-hub/
├── config.json          # http port, schema version
├── projects.json
├── channels.json        # plaintext Discord bot token (redacted on /api/state reads)
├── triggers.json        # plaintext webhook secrets (redacted on /api/state reads)
├── orchestrator.json    # status + channelSessions map
├── history/
│   ├── triggers/<id>.jsonl
│   └── channels/<id>.jsonl    # (reserved for a later version)
└── orchestrator/
    └── hub-mcp-config.json    # written on boot; --mcp-config points here
```

## Develop

For hot-reload UI development, run the server and Vite in separate terminals:

```bash
# terminal 1 — hub API + WS
corepack pnpm --filter @claude-hub/server dev

# terminal 2 — Vite on :5173, proxies /api and /ws to the hub
corepack pnpm --filter @claude-hub/web dev
```

Run tests across the workspace:

```bash
corepack pnpm -r test           # unit tests
corepack pnpm -r typecheck      # after pnpm -r build
```

Agent-specific guidance (load-bearing design decisions, gotchas, style) is in [`CLAUDE.md`](./CLAUDE.md).

## Configure Discord (optional)

1. Create a Discord bot at https://discord.com/developers/applications.
2. Enable the `MESSAGE CONTENT INTENT` and `DIRECT MESSAGES` under Bot → Privileged Gateway Intents.
3. Invite the bot to a server (any server — DMs don't require guild permissions, but the invite is required for the bot account to exist).
4. In the hub UI, open the Channels tab, paste the bot token, add your Discord user ID to the allowlist, and Save. The bot connects immediately.
5. DM the bot. Each conversation is resumed per follow-up.

## Create a trigger

**Cron** (Triggers tab → Cron → Add): name, project, standard 5-field cron expression, prompt. Fires immediately on schedule; "Run now" fires on demand.

**Webhook** (Triggers tab → Webhooks → Add): name, project, prompt template using `{{payload.field}}` interpolation. On create, a one-time URL + secret banner is displayed — copy both. Fire with:

```bash
curl -X POST http://127.0.0.1:7878/triggers/webhooks/<id> \
  -H "X-Hub-Secret: <secret>" \
  -H "Content-Type: application/json" \
  -d '{"any":"payload"}'
```

Webhooks are fire-and-forget — they always return 202 immediately; the CC run happens asynchronously and lands in the Activity tab.

## Loopback-only

The hub binds to 127.0.0.1. To expose webhooks to the internet, run your own tunnel (ngrok / cloudflared / Tailscale Funnel). Bundling one is out of scope for v1.

## Status

v0.0.0 — end-to-end functional. See the commit history for the step-by-step build.

Known limitations:
- No project references for TypeScript — run `pnpm -r build` before `pnpm -r typecheck` on a fresh checkout.
- Activity tab currently shows trigger runs only; channel-message history is persisted per-conversation but not yet surfaced in the UI.
- Single-user, single-process. Store writes are not safe under concurrent mutators.
