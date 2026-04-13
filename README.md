# claude-hub

A local-first GUI + bridge for [Claude Code](https://docs.claude.com/en/docs/claude-code), inspired by [OpenClaw](https://github.com/openclaw/openclaw) but purpose-built for CC. The brain is always Claude Code itself; `claude-hub` is the surrounding scaffolding.

## Concepts

- **Channels** — conversational, bidirectional, *orchestrator-mediated* surfaces. v1: Discord DMs. A single long-lived orchestrator CC session interprets inbound messages and decides what to do.
- **Triggers** — deterministic, *non-conversational* event handlers that fire a Claude Code run with a pre-defined prompt against a specific project. v1: cron + inbound webhooks. Triggers bypass the orchestrator entirely.
- **Projects** — user-registered working directories. CC sessions and skills are scoped per directory; the hub mirrors that.
- **GUI** — a dumb React view of state. Edits limited to registering projects/channels/triggers.

## Status

v0.0.0 — workspace skeleton only. See [`../../.claude/plans/breezy-crafting-shore.md`](./docs/) for the full v1 plan.

## Stack

Node 22+, TypeScript (strict, ESM), pnpm workspace. Server: Fastify + ws. Client: React + Vite + TanStack Query. Discord: discord.js v14. Claude Code: `@anthropic-ai/claude-agent-sdk` (or `claude -p` CLI fallback). MCP: `@modelcontextprotocol/sdk` stdio.

## Layout

```
packages/
  core/                state store + types
  cc-runner/           spawns project-scoped CC sessions
  cc-config-reader/    read-only views of ~/.claude/
  hub-mcp/             MCP server consumed by the orchestrator
  orchestrator/        long-lived CC session manager
  triggers/            cron + webhook trigger runners
  channels/            Discord channel adapter
apps/
  server/              Fastify + ws; wires everything together
  web/                 Vite React UI
```

## Persistence

Flat JSON under `~/.claude-hub/` (mirrors how Claude Code stores its own config in `~/.claude/`).

## Develop

```bash
pnpm install
pnpm dev
```

Server binds to `127.0.0.1:7878`. UI at `http://127.0.0.1:7878` once built; Vite dev server otherwise.
