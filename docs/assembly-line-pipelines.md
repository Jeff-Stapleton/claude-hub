# Assembly-Line Pipelines

> Feature documentation + build log. Written 2026-07-05 by Claude (Fable 5) after implementing the
> feature; intended for humans and future agents extending it. The binding conventions live in
> `.cursor/rules/*.mdc` — this doc explains this feature's design, the reasoning behind it, and
> exactly where everything lives.

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

In the isometric workshop UI, clicking a project machine opens its **assembly hall**
(`#line/<projectId>`): six stations along one belt, work items gliding between them, approval
gates as arches over the belt, and docked panels to configure stations / feed the line / approve
held items.

### Product decisions (agreed with Jeff before implementation)

| Decision | Choice |
|---|---|
| Stage model | Fixed six stages, no reordering or custom stages; each stage toggleable on/off per project |
| Autonomy | Per-stage gate: `auto` or `approval`. Defaults: spec/code/test auto, **deploy requires approval**, monitor auto |
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
| Manual UI | `POST /api/projects/:id/work-items` | The hall's "New work request" form |
| Cron / webhook | Trigger with `mode: 'enqueue'` | `TriggerRunner` calls an **`enqueueWorkItem` callback** injected in `apps/server/src/main.ts` — a callback, not a package dependency, to avoid a `triggers → pipeline` cycle. The rendered prompt becomes the request; the trigger's history records `enqueued work item <id>` |
| Discord / orchestrator | hub-mcp tool `enqueue_work_request` | Zero orchestrator changes: the orchestrated agent already has hub-mcp tools, and the tool POSTs to the REST API (`source: 'channel'`), preserving "the hub is the single writer". Also added: `list_work_items`, `approve_work_item` |
| Monitor defects | internal `runner.enqueue(source: 'monitor')` | Loop-guarded as above |

### Server surface (`apps/server`)

New routes in `src/routes/pipeline.ts` (thin handlers; logic in the package):

```
GET  /api/projects/:id/pipeline          effective (defaults-merged) config
PUT  /api/projects/:id/pipeline          full-config upsert; validates the six fixed stage keys,
                                         gate enum, commands only on test/deploy/monitor
POST /api/projects/:id/work-items        {request, title?, source? ('manual'|'channel')} → 202
GET  /api/projects/:id/work-items        live items; ?includeDone=true appends archived tail
GET  /api/work-items/:id                 item + its JSONL stage records
POST /api/work-items/:id/approve|retry|cancel   404 unknown / 409 wrong state
                                         (via WorkItemStateError codes)
```

`UIState` (`src/state.ts`) gained top-level `pipelines` (effective config per registered project)
and `workItems` (live items with the `sessions` field stripped — resume bookkeeping the UI never
renders). **No new WS plumbing was needed**: every work-item transition goes through
`Store.update('workItems', …)`, which the existing fat-patch broadcast in `ws.ts` already fans
out to clients.

`main.ts` wiring order matters: build `PipelineRunner` + `MonitorScheduler`, pass the enqueue
bridge into `TriggerRunner`, then `await pipelineRunner.recover()` and `monitorScheduler.start()`
before serving; `monitorScheduler.stop()` joins the shutdown path.

### Frontend (`apps/web`)

Layout decision: **hybrid**. The main workshop can't legibly fit a six-station line per project
(stations would be <20 px), so each machine stays compact and clicking it opens a dedicated
per-project scene. A 6-LED `StageLightsStrip` on each machine's front face gives at-a-glance
line status from the main room.

- **Routing** (`scenes/useSceneRouter.ts`): `SceneId` gained `'line'`; the hash parses as
  `#line/<encodedProjectId>` and the hook now returns `{ scene, param, navigate(next, param?) }`.
  Still hash-based (no clash with `/api` or `/triggers/webhooks/*`).
- **`scenes/AssemblyLine.tsx`** — scene root. Draws its own 14×5-world-unit hall (adapted
  wall/floor styling from `Workshop.tsx`) inside `<g transform="translate(-40, 30)">` to center
  it in the 1600×900 stage. Owns `selectedStage` / `selectedItemId` state (mutually exclusive)
  and all mutations. Guards against the project being deleted underneath it (a WS push can remove
  it while the scene is open) with a "this machine was dismantled" fallback.
- **`scenes/line/layout.ts`** — all world-coordinate math as pure functions (`stationX(i)`,
  `gateX(i)`, `itemSlot(item)`) plus `defaultPipeline()` mirroring the server defaults so the
  scene renders before state arrives. Unit-tested (`test/line-layout.test.ts`); notably
  `itemSlot` clamps to the belt because the stage-0 gate slot fell off the belt's left edge —
  the test caught it.
- **Geometry/animation approach**: everything reuses `scenes/iso.ts` (`iso()`, `isoBoxPoints()`).
  `WorkItemBox` exploits the fact that `iso()` is **linear**: the box is drawn once at world
  origin and positioned by a screen-space `translate(dx, dy)` with
  `transition: transform 700ms` — when a WS push changes an item's stage/status, React re-renders
  a new translate and the box *glides* along the belt. No rAF anywhere; all looping animations
  are the existing CSS keyframes in `index.html` (plus one new `line-belt-scroll`), and looping
  animations live on an **inner** `<g>` so they never clobber the positioning transform. The
  existing `prefers-reduced-motion` universal override collapses all of it.
- **Panels are in-scene `foreignObject` HTML** (ProjectAddPanel pattern), docked in the empty
  screen-left region, *outside* the scene's translate wrapper: `StationConfigPanel` (per-stage
  form: enabled, gate, provider, prompt template, commands one-per-line for test/deploy/monitor,
  monitor cadence — keyed by stage so drafts reset on station change; saves via read-modify-write
  `PUT` of the full stages record), `WorkItemPanel` (stage timeline dots, latest output/error,
  Approve/Retry/Cancel), `RequestIntakeForm` (always visible), and a `HelpCard` when nothing is
  selected.
- **Workshop integration** (`scenes/workshop/ProjectMachines.tsx`): the machine body became a
  `Workstation` hotspot navigating to `line/<id>` (the nested `RemoveButton` already
  `stopPropagation`s), and gained the `StageLightsStrip`. `types.ts` mirrors the canonical shapes
  with `pipelines?`/`workItems?` **optional** on `UIState` so payloads from a pre-pipeline server
  still render during rolling local rebuilds.
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
- `apps/web/test/line-layout.test.ts` — station spacing inside the hall, every slot on the belt,
  held items park before their gate, monitoring parks by the exit, defaults mirror the server.

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
- The hall renders up to whatever fits; there's no per-item overflow handling for very busy lines
  (items stack at shared slots).
- The visual composition was verified by typecheck + layout unit tests + serving the built
  bundle; eyeball the hall in a browser (`pnpm dev`, click a machine) after visual changes.

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
