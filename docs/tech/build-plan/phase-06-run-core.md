# Phase 6 — Run Core

**Purpose / Read this when:** packages and assignments exist (Phase 5) and the student's run must begin: lifecycle and state machine, the server clock, the policy display, the Readiness Check, the Scenario Brief and Evidence Room with open tracking, the frame, and the trace that records all of it. Walkthrough steps 2 to 5 become live.

**Requirements covered:** FR-007, FR-010 to FR-018, FR-020 to FR-024, FR-040 to FR-044, FR-117, FR-201, FR-231, FR-233, FR-235, FR-241 (event types so far), UI-020, UI-021, UI-022, UI-023 (framing state and room), UI-027 (base), UI-032 (runs table), DATA-028 to DATA-032, NFR-002 (readiness timer), NFR-003, NFR-005; decisions D-041, D-042, D-082.

## Goal

A student opens an assignment, acknowledges the policy display, takes the Readiness Check, reads the brief and documents with every open recorded, locks a frame, and enters the working period with a running server clock.

## Prerequisites

- Phase 5 exit criteria pass.
- Read `10-backend-spec.md` §8–10, `10-backend-spec-modules.md` §6 and §10, `09-frontend-spec-screens.md` §UI-020 to UI-023.

## Steps

### Step 6.1 — Trace module: append, sequencing, reading
**Goal:** `trace.append` allocates gapless sequences under the run row lock and stores `clock_remaining_ms`; events are readable in order.
**Covers:** FR-007, FR-241, NFR-005, DATA-029
**Prerequisites:** Phase 5 complete
**Files to create / modify:**
- `src/server/modules/trace/{schema,service,repository,router,index,errors}.ts` — create; `append`, `listEvents`, event payload schemas for every type in `10-backend-spec-modules.md` §10 (validated on append), `RunEventType` enum
- `src/app/api/v1/runs/[runId]/trace/route.ts` — create (owner or reviewer)
**Commands (in order, from repo root):** none.
**Implementation notes:** `append(tx, run, type, payload, opts)` requires the run row to be locked in the current transaction (`runs.repository.findRunForUpdate`) and increments `next_event_seq`; payloads are validated against the per-type Zod schema; `occurred_at` defaults to `now()` but timers pass exact instants.
**Secrets (if any):** none.
**Tests to write:**
- `tests/unit/trace/payloads.test.ts` — every event type's schema accepts its documented payload and rejects a missing required field.
- `tests/integration/trace/append.test.ts` — two concurrent appenders (parallel transactions) produce sequences 1..N without gaps or duplicates; `UPDATE run_events` as `tassl_app` fails.
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test -- tests/unit/trace && pnpm test:integration -- tests/integration/trace
```
**Commit:** `feat(trace): append-only event log with gapless sequencing`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 6.2 — Runs module: state machine, clock, limits, start, policy acknowledgement
**Goal:** Runs can be created and moved through `assigned → readiness → framing → working` with every transition traced.
**Covers:** FR-201, FR-231, FR-233, FR-235, DATA-028, NFR-003, D-041, D-042
**Prerequisites:** Step 6.1 complete
**Files to create / modify:**
- `src/server/modules/runs/state-machine.ts` — create; `10-backend-spec.md` §9
- `src/server/modules/runs/clock.ts` — create; `10-backend-spec.md` §10
- `src/server/modules/runs/limits.ts` — create; `ESCALATIONS_PER_RUN 2`, `TURN_WINDOW_MS 720000`, `READINESS_MS 480000`, `ACTION_COSTS`, each annotated `pilotParameter: true`
- `src/server/modules/runs/{schema,service,repository,router,actions,index,errors}.ts` — create; `startRun`, `acknowledgePolicy`, `getRun`, `getRunStatus`, `listMyRuns`, `materializeTimers` (readiness expiry only in this phase; later steps extend it), `RunSummary` view with `ETag`/`X-Run-Version` (D-123)
- `src/app/api/v1/assignments/[assignmentId]/runs/route.ts` (POST start, GET list for reviewers), `src/app/api/v1/runs/[runId]/route.ts` (GET), `.../policy-ack/route.ts`, `src/app/api/v1/me/runs/route.ts` — create or complete
- `src/server/modules/courses/service.ts` — modify; `listAssignmentRuns`
**Commands (in order, from repo root):** none.
**Implementation notes:** `startRun` copies `working_clock_seconds` (assignment override or package) and `turn_delay_seconds` (package), sets `is_walkthrough`, `attempt_no`; `acknowledgePolicy` writes `policy_displayed` and starts the readiness timer; `getRun` calls `materializeTimers` first and sets the ETag headers; illegal transitions raise `ILLEGAL_TRANSITION`.
**Secrets (if any):** none.
**Tests to write:**
- `tests/unit/runs/state-machine.test.ts` — every listed transition allowed; every unlisted pair refused; void from every non-voided state.
- `tests/unit/runs/clock.test.ts` — remaining with pauses, credits, and charges; never negative in `chargeCost` assertions.
- `tests/integration/runs/start.test.ts` — start (student in section), refuse second active run, refuse non-member; policy ack transitions and writes `policy_displayed` with the course values; `GET /runs/{id}` returns 304 with `If-None-Match`.
- `tests/integration/api/runs.test.ts` — the endpoints of this step; matrix rows.
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test -- tests/unit/runs && pnpm test:integration -- tests/integration/runs tests/integration/api/runs.test.ts tests/integration/auth/matrix.test.ts && pnpm openapi:generate && pnpm openapi:check
```
**Commit:** `feat(runs): state machine, clock, run start and policy acknowledgement`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 6.3 — Readiness Check service
**Goal:** Items are served without keys, answers recorded, results computed as a concept map, expiry auto-submits, skip after failure.
**Covers:** FR-010 to FR-018, DATA-030, NFR-002 (readiness timer)
**Prerequisites:** Step 6.2 complete
**Files to create / modify:**
- `src/server/modules/runs/readiness.ts` — create; `getReadiness`, `answerReadinessItem`, `submitReadiness`, `skipReadiness`, concept-map computation (`held` if all items on the concept correct, `not_held` if any wrong, `unknown` if any unanswered)
- `src/server/modules/runs/service.ts` — modify; `materializeTimers` handles readiness expiry (auto-submit with unanswered as unknown)
- `src/app/api/v1/runs/[runId]/readiness/route.ts`, `.../readiness/answers/[itemId]/route.ts`, `.../readiness/submit/route.ts`, `.../readiness/skip/route.ts` — create
**Commands (in order, from repo root):** none.
**Implementation notes:** Correctness is computed server-side and never returned to the student; `readiness_item` events carry `correct` (null when unanswered); `readiness_skipped` only after a failed submit (`flags.readiness_submit_failed`) or expiry; the result never blocks (FR-013); Standard Mode always.
**Secrets (if any):** none.
**Tests to write:**
- `tests/unit/runs/readiness-map.test.ts` — concept statuses for held, not held, unknown, mixed.
- `tests/integration/runs/readiness.test.ts` — answer, submit, 16 events, concept map in the result row; expiry via `advance-clock` test route (added in this step under `APP_ENV=test`, D-109) auto-submits; skip refused before a failure, allowed after.
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test -- tests/unit/runs && pnpm test:integration -- tests/integration/runs/readiness.test.ts
```
**Commit:** `feat(runs): readiness check with concept map and expiry`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 6.4 — Evidence Room opens and the frame
**Goal:** Documents open and close with trace events and skim marking; the frame validates, locks irreversibly, and starts the working clock.
**Covers:** FR-020 to FR-024, FR-031, FR-040 to FR-044, FR-117, DATA-031, DATA-032, D-082
**Prerequisites:** Step 6.3 complete
**Files to create / modify:**
- `src/server/modules/runs/service.ts` — modify; `getRunWorkspace` (student view for `framing` and `working`), `openDocument`, `closeDocument`, `lockFrame`
- `src/server/modules/scenarios/service.ts` — modify; `getStudentScenario`
- `src/app/api/v1/runs/[runId]/workspace/route.ts`, `.../documents/[documentId]/open/route.ts`, `.../document-opens/[openId]/close/route.ts`, `.../frame/route.ts` — create
**Commands (in order, from repo root):** none.
**Implementation notes:** Open is allowed in `framing`, `working`, `turn_open` (window handling completes in Phase 9); `before_first_delegation` = `first_delegation_at` is null; `close` caps duration at the clock remaining at open; skim per D-082; a still-open document is closed by lock with the capped duration. `lockFrame` validates with `LockFrameSchema`, inserts `run_frames`, writes `frame_locked`, sets `confidence_at_frame`, transitions to `working`, and sets `working_started_at`.
**Secrets (if any):** none.
**Tests to write:**
- `tests/unit/runs/skim.test.ts` — thresholds by word count.
- `tests/integration/runs/documents.test.ts` — open and close events with flags; open refused before readiness closes; body returned; document-sourced claims surfaced (a stub `reliance.surfaceDocumentClaims` is not allowed: implement the real function in `reliance/service.ts` now with `surfaceClaims` and `listRunClaims` read-only parts; stances arrive in Phase 8).
- `tests/integration/runs/frame.test.ts` — validation errors name the field; lock transitions; second lock refused; frame row immutable as `tassl_app`.
- `tests/integration/security/student-view-invariants.test.ts` — modify; the workspace projection carries no forbidden keys.
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test -- tests/unit/runs && pnpm test:integration -- tests/integration/runs tests/integration/security
```
**Commit:** `feat(runs): evidence room open tracking and irreversible frame lock`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 6.5 — Student screens: runs list, policy display, readiness, run frame and clock, workspace (framing state)
**Goal:** UI-020, UI-021, UI-022, the `RunFrame` layout with the clock, and UI-023 in its `framing` state (brief, Evidence Room, frame form) through the Impeccable loop.
**Covers:** UI-020, UI-021, UI-022, UI-023 (framing), UI-027 (base), FR-201, FR-012, FR-023
**Prerequisites:** Step 6.4 complete
**Files to create / modify:**
- `src/app/(app)/runs/page.tsx`, `src/app/(app)/runs/[runId]/layout.tsx` (RunFrame), `src/app/(app)/runs/[runId]/page.tsx` (status), `.../start/page.tsx`, `.../readiness/page.tsx`, `.../readiness/result/page.tsx`, `.../work/page.tsx` — create
- `src/components/features/run/{run-frame,clock,policy-display,readiness-timer,readiness-item,concept-map,brief-panel,evidence-room,document-reader,frame-form,frame-panel,run-status}.tsx` — create
- `src/lib/hooks/{use-run-poll,use-clock}.ts` — create; poll every 5 s with `If-None-Match`; countdown from server timestamps
- `src/app/(app)/assignments/[assignmentId]/page.tsx` — modify; runs table (`AssignmentRunsTable`)
- `src/app/(app)/home/page.tsx` — modify; "Your runs" panel with next actions
**Commands (in order, from repo root):** Impeccable loop for `/runs`, `/runs/[runId]/start`, `/runs/[runId]/readiness`, `/runs/[runId]/readiness/result`, `/runs/[runId]/work` (framing state).
**Implementation notes:** The workspace's assistant and brief editor panels render disabled with the "unlocks after the frame" sentence (their live versions arrive in Phases 7 and 8). `DocumentReader` sends open on mount and close on unmount, `visibilitychange` hidden, and `beforeunload`. The frame form has live word counts using `countWords`.
**Secrets (if any):** none.
**Tests to write:**
- `tests/unit/components/run/frame-form.test.tsx` — word-limit errors; confidence slider and number stay in sync.
- `tests/unit/components/run/clock.test.tsx` — renders mm:ss from a deadline; live-region text at thresholds.
- `tests/e2e/walkthrough/02-05-start-to-frame.spec.ts` — steps 2–5: policy display values match the course, readiness with 16 items and a concept-map result with no score, brief and 9 documents, opens recorded (assert through `GET /runs/{id}/trace`), incomplete frame refused, lock is permanent (edit controls gone), assistant panel unlocked state visible.
- `tests/e2e/a11y/student-run.spec.ts` — axe on the five routes.
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test -- tests/unit/components/run && pnpm test:e2e -- tests/e2e/walkthrough/02-05-start-to-frame.spec.ts tests/e2e/a11y/student-run.spec.ts
```
**Commit:** `feat(runs): run list, policy display, readiness, and framing screens`
**Rollback:** `git checkout -- . && git clean -fd`

## Phase exit criteria

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm test:e2e && pnpm build && pnpm openapi:check && npx impeccable@3.6.1 detect --json . > impeccable-report.json && node scripts/impeccable-gate.mjs impeccable-report.json .impeccable/config.json
```

Requirement IDs now fully implemented: FR-010 to FR-018, FR-020, FR-022, FR-023, FR-024, FR-040 to FR-044, FR-117, FR-201, FR-233, FR-235, UI-020, UI-021, UI-022, UI-032, DATA-028 to DATA-032, NFR-003, NFR-005. Partially: FR-007 and FR-241 (event types grow), FR-021 (validation done in Phase 5; room rendering here), FR-231 (later transitions), UI-023 (working state in Phases 7–8), UI-027 (states grow).
