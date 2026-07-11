# Assembly-Line Pipelines

> Feature documentation + build log. Written 2026-07-05 by Claude (Fable 5) after implementing the
> feature; intended for humans and future agents extending it. The binding conventions live in
> `.cursor/rules/*.mdc` — this doc explains this feature's design, the reasoning behind it, and
> exactly where everything lives.
>
> **Revised 2026-07-06** (per Jeff's review): (1) the separate per-project `#line/<id>` scene is
> gone — every project's lane now lives in the single workshop scene, which auto-scales to fit;
> (2) floor-standing paint order is enforced by a shared `depthSort` helper (see the z-order
> section in `.cursor/rules/ui-api-state-contracts.mdc`); (3) lines start **blank** — all six
> stages default to `enabled: false`, machines are installed one at a time via the lane's "+"
> slot, and enqueueing onto a line with zero enabled stages is rejected with HTTP 409
> (`no-enabled-stages`). Sections below have been updated where they state current behavior; the
> build-log narrative still describes the original 2026-07-05 milestone.

## What this is

Every registered project gets an **assembly line**: work requests flow through six fixed stages —

```
intake → spec → code → test → deploy → monitor
```

— each stage executed autonomously by an agent run (Claude Code or Cursor via
`@claude-hub/agent-runner`) and/or shell commands. The goal is fully autonomous development:
a request arrives (UI form, webhook, cron, or Discord), gets planned, implemented, validated,
deployed, and then watched in production; a failed production check automatically files a defect
work item back at the top of the line.

In the isometric workshop UI every project owns a visible **assembly lane** in the one workshop
scene: head machine, belt, the installed stage machines, work items gliding between them,
approval gates as arches over the belt, and a "+" ghost slot for installing the next machine.
Clicking a machine/item/slot docks the matching panel (station config / work item / intake form /
add-machine picker) in the scene's top-left. The floor deepens one lane per project and the whole
scene scales down to keep everything visible at a glance.

### Product decisions (agreed with Jeff before implementation)

| Decision | Choice |
|---|---|
| Stage model | Fixed six stages, no reordering or custom stages; each stage toggleable on/off per project |
| Initial state | **Blank line** (since 2026-07-06): all six stages default `enabled: false`; the user installs machines one at a time via the lane's "+" slot (any remaining stage, picker) |
| Autonomy | Per-stage gate: `auto` or `approval`. Gate defaults: spec/code/test auto, **deploy requires approval**, monitor auto — inherited when a machine is installed |
| Scope | Full engine (real execution of all six stages) + full UI in one milestone |
| Intake | All sources: manual UI form, webhooks, cron (via trigger `mode: 'enqueue'`), Discord/orchestrator (via hub-mcp tool) |

---

## Architecture

### Data model (canonical: `packages/core/src/types.ts`)

- **`PipelineConfig`** — per-project stage configuration, stored under the new `pipelines` store
  key (NOT embedded in `Project`, mirroring how triggers reference projects by `projectId`).
  Each stage is a **`StageConfig`**: `{ enabled, gate, promptTemplate?, provider?, commands?,
  timeoutMs? }`; the monitor stage extends it with `intervalMinutes?` / `maxChecks?`.
  "No stored config" means "defaults" — `effectivePipelineConfig()` merges stored over built-in
  defaults per stage.
- **`WorkItem`** — one request flowing down a line. Key fields:
  - `status`: `queued | running | waiting-approval | monitoring | failed | done | cancelled`
  - `currentStage` + `stages: Record<PipelineStageId, StageResult>` (per-stage status,
    timestamps, truncated output, error, monitor `checksPassed`)
  - `sessions: Partial<Record<AgentProviderId, string>>` — provider session ids resumed across
    stages, **provider-qualified** per the repo rule (a Claude session id is never fed to Cursor)
  - `approvedStages` — which approval gates a human has cleared; persisted so it survives restarts
- Triggers gained `mode?: 'run' | 'enqueue'` — absent means `'run'` (today's one-shot behavior),
  so no data migration was needed for existing triggers.
- `STORE_SCHEMA_VERSION` bumped **2 → 3**. The migration is purely additive: the new
  `pipelines.json` / `workItems.json` files default to `[]`, and v1/v2 config versions are
  coerced forward in `mergeConfigDefaults` (`packages/core/src/store.ts`).

### Storage split: live snapshot vs JSONL history

| What | Where | Why |
|---|---|---|
| Live items only (queued/running/waiting/monitoring/failed) | `~/.claude-hub/workItems.json` | Keeps the WS fat-patch payload small; failed items stay live so `retry` works |
| Full per-stage records (prompts, untruncated outputs) | `~/.claude-hub/history/pipeline/items/<workItemId>.jsonl` | Append-only, cheap writes, same pattern as trigger history |
| Terminal items (done/cancelled) | `~/.claude-hub/history/pipeline/projects/<projectId>.jsonl` | Archive; served via `GET .../work-items?includeDone=true` |
| Machine-run events (status + 1-2 sentence summary, denormalized labels) | `~/.claude-hub/history/pipeline/machine-runs.jsonl` | Single-file tail powers the activity feed with no joins; labels are as-of run time |

Outputs stored on the live `WorkItem` are truncated to 32 KB (`STAGE_OUTPUT_LIMIT` in
`packages/pipeline/src/stages.ts`); the full text is always in the item's JSONL.

### The `@claude-hub/pipeline` package

Deliberately modeled file-for-file on `@claude-hub/triggers` (EventEmitter runner + scheduler +
JSONL history + fake-CLI unit tests) so it reads as native to the codebase:

| File | Responsibility |
|---|---|
| `src/defaults.ts` | `defaultPipelineConfig()` / `effectivePipelineConfig()`, built-in per-stage prompt templates, marker constants |
| `src/stages.ts` | `executeStage()` — renders the prompt, runs the agent (session resume), runs shell commands, checks result markers |
| `src/runner.ts` | `PipelineRunner` — enqueue/approve/retry/cancel/recover, the per-project drain loop, `runMonitorCheck()` |
| `src/monitor.ts` | `MonitorScheduler` — one `setInterval` per monitoring item; pure timing, semantics live in the runner |
| `src/commands.ts` | `runCommands()` — sequential `spawn(cmd, {shell:true, cwd})`, stop at first failure, Windows tree-kill on timeout |
| `src/history.ts` | JSONL append/read for stage records + archives |

Key behaviors and the reasoning behind them:

- **Concurrency: FIFO, one running item per project; projects run in parallel.** The queue is
  just "oldest `queued` item in the store for this project"; a `draining` Set of project ids
  guards against double drain-loops. There is deliberately no in-memory queue structure — the
  store is the queue, which is what makes restart recovery trivial.
- **Held items release their queue slot.** When an item parks at an approval gate (or enters
  monitoring, or fails), `advance()` returns and the drain loop picks the next queued item.
  A gated item never blocks the line.
- **Session continuity is hybrid.** Each work item resumes one provider session across its stages
  (cheap full context) *and* prior stage outputs are injectable into templates
  (`{{stages.spec.output}}`), which covers provider switches mid-line and server restarts.
- **Gates are checked before execution.** `gate === 'approval'` and stage not in
  `approvedStages` → item `waiting-approval`, stage result `waiting-approval`, return.
  `approve()` records the stage in `approvedStages` (persisted) and re-queues.
- **Restart recovery (`recover()`, called from `main.ts` at boot).** Items stuck in `running`
  get their in-flight stage reset to `pending`, an `interrupted` line appended to their JSONL,
  status `queued`, and every project queue is kicked. `waiting-approval`/`queued` need nothing;
  `monitoring` re-arms via the scheduler's reconcile.
- **Cancellation is archive-then-remove.** An in-flight agent run is left to finish; when it
  completes, `updateItem()` finds the item gone from the live store and `advance()` aborts —
  the result is discarded. (v1 tradeoff: we don't kill the provider process.)
- **Test/monitor stages self-report via marker lines.** The agent-run test stage fails if its
  output contains `TEST_RESULT: FAIL` (lenient — a custom template without the convention still
  works). The monitor stage is strict: output must contain `MONITOR_RESULT: PASS`, else the check
  fails — an unattended health check must be unambiguous. Default templates instruct the agent to
  end with these lines.
- **Command-vs-agent rule for test/deploy/monitor**: if a `promptTemplate` is set → agent run
  first, then commands; commands configured with **no** template → commands only (agent step
  skipped); neither configured → agent run with the built-in default template. Both must pass.
- **Monitor completion semantics (v1)**: check every `intervalMinutes` (default 30); after
  `maxChecks` consecutive passes (default 3) the item is `done` and archived. A failed check
  fails the item **and auto-files a defect work item** (`source: 'monitor'`, `sourceRef` = the
  failed item's id) at the top of the line — with a loop guard: monitor-sourced items never file
  further defects.
- **Shell commands do NOT go through agent-runner.** That boundary exists for provider CLIs;
  `commands.ts` is generic `child_process` execution in the project cwd.

### Intake paths (how requests enter a line)

| Source | Path | Notes |
|---|---|---|
| Manual UI | `POST /api/projects/:id/work-items` | The lane's "New work request" form (click the head machine) |
| Cron / webhook | Trigger with `mode: 'enqueue'` | `TriggerRunner` calls an **`enqueueWorkItem` callback** injected in `apps/server/src/main.ts` — a callback, not a package dependency, to avoid a `triggers → pipeline` cycle. The rendered prompt becomes the request; the trigger's history records `enqueued work item <id>` |
| Discord / orchestrator | hub-mcp tool `enqueue_work_request` | Zero orchestrator changes: the orchestrated agent already has hub-mcp tools, and the tool POSTs to the REST API (`source: 'channel'`), preserving "the hub is the single writer". Also added: `list_work_items`, `approve_work_item` |
| Monitor defects | internal `runner.enqueue(source: 'monitor')` | Loop-guarded as above |

### Server surface (`apps/server`)

New routes in `src/routes/pipeline.ts` (thin handlers; logic in the package):

```
GET  /api/projects/:id/pipeline          effective (defaults-merged) config
PUT  /api/projects/:id/pipeline          full-config upsert; validates the six fixed stage keys,
                                         gate enum, commands only on test/deploy/monitor
POST /api/projects/:id/work-items        {request, title?, source? ('manual'|'channel')} → 202;
                                         409 when the line has zero enabled stages
GET  /api/projects/:id/work-items        live items; ?includeDone=true appends archived tail
GET  /api/work-items/:id                 item + its JSONL stage records
POST /api/work-items/:id/approve|retry|cancel   404 unknown / 409 wrong state
                                         (via WorkItemStateError codes)
```

Enqueue onto a blank line is rejected at `PipelineRunner.enqueue()` itself (`WorkItemStateError`
code `no-enabled-stages`), so *every* intake path fails loudly: the REST route maps it to 409,
enqueue-mode triggers record the rejection in their run history, and the hub-mcp tool surfaces
the API error to the channel.

`UIState` (`src/state.ts`) gained top-level `pipelines` (effective config per registered project)
and `workItems` (live items with the `sessions` field stripped — resume bookkeeping the UI never
renders). **No new WS plumbing was needed**: every work-item transition goes through
`Store.update('workItems', …)`, which the existing fat-patch broadcast in `ws.ts` already fans
out to clients.

`main.ts` wiring order matters: build `PipelineRunner` + `MonitorScheduler`, pass the enqueue
bridge into `TriggerRunner`, then `await pipelineRunner.recover()` and `monitorScheduler.start()`
before serving; `monitorScheduler.stop()` joins the shutdown path.

### Frontend (`apps/web`) — one singular workshop scene (revised 2026-07-06)

Layout decision (revised): **one room**. The original milestone shipped a hybrid (compact
machines in the workshop + a separate `#line/<id>` hall per project); Jeff wanted everything at
a glance, so the hall was merged back in. Each project owns a full-width **lane** stacked along
+Y (lane 0 front-most); the floor's depth grows with the project count and the whole
world-anchored scene sits in one `translate(tx ty) scale(s)` wrapper computed by
`sceneTransform()` — exact because `iso()` is linear.

- **`scenes/workshop/layout.ts`** — all world-coordinate math as pure functions/constants
  (`laneY(k)`, `floorDepth(n)`, `slotX(i)`, `gateX(i)`, `itemSlot(item)`, `ghostSlotIndex()`,
  `sceneTransform()`) plus `defaultPipeline()` mirroring the server defaults (all-disabled) and
  `deriveStageActivity()`. Unit-tested in `test/workshop-layout.test.ts`. Stage slots are fixed
  by stage index regardless of what's installed, so an item transiting a skipped stage still has
  a well-defined belt position.
- **Depth sorting** — `depthSort`/`DepthSorted` in `scenes/iso.ts` enforce back-to-front paint
  order (descending `x + y`; world (0,0) paints last). The scene-level `DepthSorted` holds one
  entity per lane plus the orchestrator console; each `ProjectLane` runs its own `DepthSorted`
  with layers belt(0) < gates(1) < volumetric boxes(2). Lanes occupy disjoint y bands, which is
  what makes the two-level sort correct. Convention codified in
  `.cursor/rules/ui-api-state-contracts.mdc`; regression-tested in `test/iso-depth.test.ts`.
- **`scenes/workshop/ProjectLane.tsx`** — head machine (`LaneHeadMachine`: nameplate, trigger
  screen, session badge, remove button; clicking it opens the intake form), `Belt`, installed
  `StageMachine`s only (a not-installed stage renders nothing), `GateArch`es for enabled
  approval stages, `LaneWorkItemBox`es, and the `GhostSlot` ("+", at the first not-installed
  stage's slot) which opens the `AddStagePanel` picker of remaining stages. Installing = flipping
  that stage's `enabled: true` via read-modify-write `PUT` of the full stages record.
- **Glide animation unchanged**: `LaneWorkItemBox` draws the box at world origin and positions it
  with a screen-space `translate(dx, dy)` + `transition: transform 700ms`; the uniform scene
  scale multiplies it exactly. Looping animations stay on an inner `<g>`;
  `prefers-reduced-motion` collapses all of it.
- **Selection** — `Workshop.tsx` owns one discriminated union
  (`stage | item | intake | addStage | null`); panels dock screen-space top-left (outside the
  scale wrapper), one at a time: `StationConfigPanel` (the enabled checkbox is the
  remove-machine path), `WorkItemPanel`, `RequestIntakeForm` (submit disabled with a hint while
  the lane has zero machines), `AddStagePanel`. A WS push deleting the referenced project/item
  just closes the panel (`validateSelection`).
- **Fixtures** — walls/floor take `floorW`/`floorD` props; `TimeCardWall` (`wallY`/`xEnd`) and
  `ChannelsRadio` (`wallX`) anchor to the back walls; one `WorkRequestTunnel` near the back
  corner; per-lane `ExitChute`s ("SHIPPED") in the right wall at each belt; the orchestrator
  console sits in the front apron (y < 2.2). `StageLightsStrip` was removed — the always-visible
  stage machines carry live lamps/screens. The old 9-project cap and `OverflowBadge` are gone;
  at high project counts the scene just scales smaller (accepted tradeoff).
- **Routing** — `'line'` was removed from `SceneId`; stale `#line/<id>` URLs fall back to the
  workshop.
- Empty-body POSTs send `body: '{}'` — the `req()` helper only sets a JSON content-type when a
  body exists, working around Fastify's empty-JSON-body rejection (pre-existing quirk, documented
  in `api.ts`).

---

## How it was built (process log for future agents)

1. **Exploration** — two parallel read-only subagents mapped (a) the web workshop scene
   (iso projection, Workstation hotspots, foreignObject forms, WS fat-patch data flow) and
   (b) the backend (Store conventions, TriggerRunner/CronScheduler as the pattern to clone,
   the agent-runner boundary, all seven `.cursor/rules/*.mdc`). Conclusion: pipelines were
   fully greenfield; the natural seams were "a new core entity + store key, a new runner
   analogous to TriggerRunner, new routes".
2. **Scoping questions** — stage model / autonomy / milestone scope / intake sources were put to
   Jeff explicitly before design (answers in the decisions table above).
3. **Parallel design** — two Plan subagents designed backend and frontend independently against
   the same requirements; discrepancies were reconciled by hand (stage id `spec` not `plan`;
   work items live top-level in `UIState`, not on `Project`; the backend `WorkItem` shape is
   canonical). Final plan: `~/.claude/plans/i-want-to-flesh-swirling-castle.md`.
4. **Implementation order** (each step built + tested before the next):
   core types/paths/store/migration → `packages/pipeline` + unit tests → trigger enqueue mode +
   server routes/state/main wiring + hub-mcp tools → web (types/api/layout → router + scene →
   stations/panels → workshop integration).
5. **Template move**: `render()` moved verbatim from `packages/triggers/src/template.ts` to
   `packages/core/src/template.ts` (core is dependency-free, so pipeline can use it without a
   triggers dependency); the triggers module re-exports it so nothing else changed.
6. **Verification** — `pnpm -r build && pnpm -r typecheck && pnpm -r test` (repo
   definition-of-done; build before typecheck — no TS project references), then a **live e2e
   against a real server with a fake provider CLI** (below).

### Bugs found during the build (and their fixes)

Both were exposed by the pipeline's concurrency and fixed in `packages/core/src/store.ts`:

1. **Same-file temp-name collision.** `writeJsonAtomic` used `<file>.<pid>.tmp`; two concurrent
   `Store.update('workItems', …)` calls (drain loop + defect enqueue) collided on one temp file →
   `EPERM` on Windows rename. Fix: a monotonically increasing sequence number in the temp name.
2. **Concurrent rename-over-destination race.** Even with unique temp names, two renames
   targeting the same destination file concurrently fail on Windows (`EPERM`/`ENOENT`), and the
   error aborted a drain loop mid-item. Fix: a **per-file write queue** (`writeQueues` Map of
   promise chains) serializing writes to the same path. In-memory consistency was never at risk —
   the updater runs synchronously against the latest snapshot — only the file writes raced.
   Writes snapshot-at-write-time, so queued writes coalesce toward the final state.

Also: the UI slot-clamping bug caught by the layout unit test (above), and a flaky test fixed by
using `rm(..., { maxRetries, retryDelay })` because test cleanup raced a background drain's last
write.

### Testing strategy

Per repo convention, no real provider calls in unit tests — the `AgentRunner` is a vitest mock
(same pattern as `packages/triggers/test/runner.test.ts`):

- `packages/pipeline/test/runner.test.ts` — six-stage happy path, gate hold + approve,
  disabled-stage skip, failure + retry, `TEST_RESULT: FAIL` marker, per-project FIFO (hanging
  promise to observe mid-flight state), session-id persistence/resume, `recover()` after a
  simulated crash (spec is *not* re-run; the persisted session is resumed), cancel discarding an
  in-flight result, monitor checks (pass counting → done+archive; fail → defect; missing PASS
  marker = fail; monitor-source loop guard). Async drains are observed with a small `until()`
  polling helper. Defect-filing tests park the filed defect on a never-resolving agent promise
  so background churn can't race assertions.
- `packages/pipeline/test/monitor.test.ts` — `MonitorScheduler` with vitest fake timers and a
  stubbed runner: interval firing, disarm on leave-monitoring, no overlapping checks.
- `packages/pipeline/test/commands.test.ts` — real `node -e` processes: sequencing, stop at
  first failure, stderr capture, timeout kill.
- `packages/core/test/migration.test.ts` — a v2 store (no new files, trigger without `mode`)
  loads cleanly at v3; future versions still refuse to load.
- `packages/triggers/test/runner.test.ts` — enqueue mode files a work item without an agent run;
  bridge rejection records an error run.
- `apps/web/test/workshop-layout.test.ts` (replaced `line-layout.test.ts` in the 2026-07-06
  revision) — slot spacing inside the floor, disjoint lane bands, every item slot on the belt,
  held items park before their gate, monitoring parks by the exit, ghost-slot placement,
  floor-depth growth, scale-to-fit bounds, defaults mirror the server (all disabled).
  `apps/web/test/iso-depth.test.ts` — depthSort ordering, layer/z tiebreaks, lane regression case.

### End-to-end harness (reusable recipe)

To verify the real server without touching the developer's actual `~/.claude-hub` or spawning
real agent runs:

1. **Isolate the hub home** by launching the server with `USERPROFILE` pointed at a scratch dir
   (Node's `os.homedir()` honors it on Windows), and a scratch `httpPort` (7899) in a
   pre-written `config.json` (`schemaVersion: 3`). Write that JSON **without a BOM** —
   PowerShell 5.1's `Out-File -Encoding utf8` adds one and Node's `JSON.parse` rejects it; use
   `[IO.File]::WriteAllText(..., UTF8Encoding($false))`.
2. **Fake the provider** with `providers.claude.cliPath = 'node "<scratch>/fake-claude.mjs"'` —
   a script that mimics the `claude -p --output-format json` result envelope: echoes back the
   `--session-id`/`--resume` value (matching real CC behavior) and always prints
   `MONITOR_RESULT: PASS`. cc-runner's `useShell` path handles the space in the command.
3. **Drive the API**: add project → `GET` pipeline (verify defaults) → `PUT` config (test/deploy
   commands, `intervalMinutes: 1`, `maxChecks: 1`) → `POST` work item → observe it park
   `waiting-approval` at deploy with spec/code/test `success` and intake `skipped` → approve →
   observe `monitoring` → ~60 s later the item leaves the live snapshot and appears `done` in
   `?includeDone=true`. Also verified: an enqueue-mode cron trigger fired via
   `POST /api/triggers/:id/run` files a `source: 'cron'` work item (trigger history transcript:
   `enqueued work item <id>`), and cancel archives as `cancelled`.

The fake CLI script used is preserved in this session's scratchpad; it's ~20 lines and trivial to
recreate from the description above.

### Known limitations / v1 tradeoffs

- Cancelling a running item does not kill the in-flight provider process; its result is discarded.
- Monitor scheduling is in-process — if the hub isn't running, checks don't fire (same caveat as
  cron triggers).
- Trigger `mode` is settable at creation only (no `PATCH /api/triggers/:id` yet).
- Lanes render up to whatever fits; there's no per-item overflow handling for very busy lines
  (items stack at shared slots).
- There's no lower bound on the scene scale: many projects (≈10+) render legibly small. If that
  becomes real usage, revisit with label-size compensation, a min scale + pan, or row wrapping.
- The visual composition was verified by typecheck + layout unit tests + serving the built
  bundle; eyeball the workshop in a browser (`pnpm dev`) after visual changes.

### Extension points

- **New stage behavior**: add config fields to `StageConfig` in core, honor them in
  `packages/pipeline/src/stages.ts`, validate in `apps/server/src/routes/pipeline.ts`'s
  `parsePipelineBody`, surface in `StationConfigPanel.tsx`. The six stage *ids* are fixed by
  design — resist adding custom stages without revisiting the UI layout math.
- **New intake source**: extend `WorkItemSource` in core (and the web mirror), call
  `pipelineRunner.enqueue()` — from server code directly, or via the REST route if the caller is
  outside the process (keep the hub the single writer).
- **Richer monitor checks**: `MonitorScheduler` is pure timing; all semantics are in
  `PipelineRunner.runMonitorCheck` — that's the one place to change pass/fail/defect behavior.
- **Notifications** (e.g. Discord ping on `waiting-approval`): subscribe to `PipelineRunner`'s
  `itemChanged` event in `main.ts`, mirroring how trigger events piggy-back today.
