# Workshop Tool Box

The tool box (the red chest against the workshop's back wall, next to the
orchestrator console) is the catalog of
**skills** and **MCP servers** that machines can be granted access to.
Machines get **no tools by default**: each project's station config picks
exactly which tools that machine may use. This is a security boundary (a spec
agent has no business holding AWS credentials) and a context-efficiency
feature (don't load Python skills into a TypeScript project). Tags on each
tool make the catalog searchable from both the toolbox panel and the station
config's tool picker.

## Data model

- Store entity `toolbox` (`~/.claude-hub/toolbox.json`, schema v4):
  `{ skills: ToolboxSkill[], mcpServers: ToolboxMcpServer[] }` — see
  `packages/core/src/types.ts`.
- Per-machine assignment lives on `StageConfig.skills` / `StageConfig.mcpServers`
  as toolbox ids. Absent or empty = no tools.
- MCP `env` values and HTTP `headers` may carry secrets: they are stored
  plaintext for run-time injection but redacted to key names in `UIState`
  (`RedactedMcpTransport`). Editing a server round-trips blank values to mean
  "keep the stored secret" (the channels bot-token pattern).

## Vault

The vault (the steel safe next to the tool box) is a global key-value store
(`~/.claude-hub/vault.json`, entity `vault`) for the config tools need at run
time — GitHub tokens, ClickUp keys, AWS creds. Skills and MCP servers declare
the keys they need via `requiredEnv` (bundled skills via a `requiredEnv:`
frontmatter line); adding a tool auto-creates missing keys as *unset*
(`value: null`), which lights the amber lamp on the safe until a value is
pasted in.

- Values are write-only: `UIState.vault` carries `{ key, valueSet, requiredBy }`
  only, and there is no reveal endpoint. `requiredBy` is derived from the
  toolbox at read time, never stored.
- At run time `resolveToolAssignments` gathers the union of the **assigned**
  tools' `requiredEnv`, resolves values from the vault, and passes them as
  `tools.env` — injected into the agent child process env (claude and cursor)
  and into MCP transports (stdio env merge; `${KEY}` substitution in stdio env
  and http header values). Unassigned tools' keys never reach a run, keeping
  deny-by-default intact. Literal per-server transport env wins over the vault
  as an override.
- Unset required keys warn and the run continues — the lamp is the pre-run
  signal; a missing token then fails loudly inside the run.
- Deleting a key still listed in some tool's `requiredEnv` is refused (409);
  clear the value or remove it from the tool first.

## Run-time injection

`packages/pipeline/src/stages.ts` resolves assigned ids to full definitions
and passes them as `tools` on `runProjectSession`; the provider adapters in
`packages/agent-runner` translate them (`toolMaterializer.ts`):

- **claude**: assigned skills are materialized into an ephemeral plugin dir
  (`--plugin-dir`), assigned servers into an ephemeral `--mcp-config` file,
  and `--strict-mcp-config` is always passed when `tools` is present. The
  temp dir never touches the project working tree and is removed right after
  the run.
- **cursor**: skills are prepended to the prompt as an "Available skills"
  preamble. MCP assignment is **claude-only for now** — Cursor's only
  discovery path is `<workspace>/.cursor/mcp.json`, and writing into the
  user's repo isn't acceptable; assigned servers are logged and skipped.

Orchestrator and trigger runs don't pass `tools`, so their behavior is
unchanged.

## Bundled skills

Generic starter skills ship as assets in `apps/server/assets/bundled-skills/`
and are seeded into the store at boot (`apps/server/src/toolboxSeed.ts`) with
stable `bundled-<slug>` ids. Bump `version:` in a skill's frontmatter to
reseed it on next boot. Bundled skills are read-only in the UI — "duplicate"
copies one into an editable user skill.

## Notes / caveats

- `--plugin-dir` and `--strict-mcp-config` require a recent Claude Code CLI
  (verified on 2.1.201). Older CLIs fail tool-assigned stage runs with the
  CLI usage text.
- **Behavior change**: pipeline stage runs pass `--strict-mcp-config`, so a
  project's own `.mcp.json` / the user's global MCP config are ignored for
  stage runs. That's the point (deny by default), but it differs from
  pre-toolbox behavior.
- The CLI can't suppress the user's personal `~/.claude/skills` without
  disabling all skills, so toolbox assignment governs hub-managed tools only.
- Skill invocation is model-discretionary: assignment guarantees
  availability, not use. The skill `description` drives triggering — be
  specific.
