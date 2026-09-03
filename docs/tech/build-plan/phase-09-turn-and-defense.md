# Phase 9 — The Turn and the Defense

**Purpose / Read this when:** Decision Lock works (Phase 8) and the run must continue: the Turn fires 60 to 120 seconds after lock with exact timestamps, the window reopens the assistant and room for 12 minutes, the student holds, revises, or reverses, and the typed defense selects six to nine questions from the run record with one authored follow-up each. Walkthrough steps 9 and 10 become live.

**Requirements covered:** FR-110 to FR-115, FR-120 to FR-126, FR-231 (turn and defense transitions), UI-025, UI-026, UI-027 (pending scoring state), DATA-038, DATA-039, NFR-002; decisions D-043, D-045, D-077, D-080, D-090, D-106.

## Goal

A locked run receives its Turn on time, the student responds inside the window (or an implicit hold is recorded), the defense opens with the right questions and follow-ups, and completion enqueues scoring.

## Prerequisites

- Phase 8 exit criteria pass.
- Read `10-backend-spec-modules.md` §6 (Turn functions) and §9, `10-backend-spec.md` §8, `09-frontend-spec-screens.md` §UI-025 and §UI-026.

## Steps

### Step 9.1 — Turn delivery, window, response, implicit hold
**Goal:** `materializeTimers` delivers the Turn and closes the window; `getTurn` and `respondToTurn` exist; window claims surface and are relied on by rule.
**Covers:** FR-110 to FR-115, DATA-038, NFR-002, D-043, D-077
**Prerequisites:** Phase 8 complete
**Files to create / modify:**
- `src/server/modules/runs/service.ts` — modify; `materializeTimers` cases 3 and 4 (`10-backend-spec.md` §8), `getTurn`, `respondToTurn`; `openDocument`, `delegate`, `setStance`, `runAction`, `escalate` accept `turn_open` with `in_turn_window: true` and no working-clock charge (window remaining recorded)
- `src/server/modules/runs/turn.ts` — create; delivery (writes `turn_delivered` at `occurred_at = turn_due_at`, surfaces `window_claim_ids` via `reliance.surfaceClaims(..., 'turn')`), implicit hold at window end
- `src/app/api/v1/runs/[runId]/turn/route.ts`, `.../turn/response/route.ts` — create
**Commands (in order, from repo root):** none.
**Implementation notes:** Window start = delivery read time, never earlier than `turn_due_at`, so an offline student gets the full 12 minutes (FR-115); `respondToTurn` refuses while any window claim is unstanced (`TURN_CLAIMS_UNSTANCED`); after the response (or implicit hold) the run transitions `turn_open → turn_locked → defense_pending` in one transaction; `confidence_after_turn` set (null on implicit hold).
**Secrets (if any):** none.
**Tests to write:**
- `tests/unit/runs/timers.test.ts` — delivery instant equals `decision_locked_at + delay`; window end computation for on-time and late reads; implicit hold at window end with exact `occurred_at`.
- `tests/integration/runs/turn.test.ts` — before `turn_due_at` the run stays `decision_locked`; after (via `advance-clock`) the read materializes delivery, window claims surfaced with `relied_on_via = ['turn_window']`; response validation (150 words, confidence); refusal with unstanced window claims; implicit hold when the window expires; documents and actions in the window record `in_turn_window` and no clock charge.
- `tests/integration/api/turn.test.ts` — endpoints and matrix rows.
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test -- tests/unit/runs && pnpm test:integration -- tests/integration/runs/turn.test.ts tests/integration/api/turn.test.ts && pnpm openapi:generate && pnpm openapi:check
```
**Commit:** `feat(runs): turn delivery, window, response, implicit hold`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 9.2 — Defense service: selection, follow-ups, answers, completion
**Goal:** Every function in `10-backend-spec-modules.md` §9.
**Covers:** FR-025, FR-120 to FR-126, DATA-039, D-080, D-090, D-106
**Prerequisites:** Step 9.1 complete
**Files to create / modify:**
- `src/server/modules/defense/{schema,service,repository,router,actions,index,errors}.ts` — create
- `src/server/modules/defense/selection.ts` — create; the pure selection algorithm (candidates, take 9, fill to 6 with defaults, render templates)
- `src/server/modules/defense/follow-up.ts` — create; deterministic trigger (D-031) and the verbatim-brief rule (D-090)
- `src/app/api/v1/runs/[runId]/defense/route.ts`, `.../defense/questions/[runQuestionId]/answer/route.ts`, `.../defense/complete/route.ts` — create
**Commands (in order, from repo root):** none.
**Implementation notes:** `openDefense` selects once (idempotent on reopen); `completeDefense` sets `nothing_answered` when every answer is empty or under three words, transitions to `defense_complete`, and enqueues `score_run` (handler arrives in Phase 10; the queue exists and the drain skips queues without handlers with a `warn` log).
**Secrets (if any):** none.
**Tests to write:**
- `tests/unit/defense/selection.test.ts` — each condition individually (provenance for a relied-on claim without a trace; figure provenance for an unmatched named value; verification after a stance change; assumption departed and the `reverse` rule; confidence strictly greater; frame-vs-response only for non-implicit responses; counterfactual when the field was entered); ordering; cap at 9; fill to 6; template rendering with all placeholders.
- `tests/unit/defense/follow-up.test.ts` — digits, document-title tokens, reason markers, verbatim-brief substring.
- `tests/integration/defense/flow.test.ts` — open selects 6–9 questions and writes `defense_question` events; answer writes `defense_answer` and inserts a follow-up when triggered; reopen resumes at the first unanswered; complete with unanswered refused; complete transitions and enqueues (`pgboss.job` row exists with `singletonKey score_run:<runId>`).
- `tests/integration/api/defense.test.ts` — endpoints and matrix rows.
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test -- tests/unit/defense && pnpm test:integration -- tests/integration/defense tests/integration/api/defense.test.ts && pnpm openapi:generate && pnpm openapi:check
```
**Commit:** `feat(defense): question selection, follow-ups, answers, completion`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 9.3 — Screens: Turn window, defense, run status (pending scoring)
**Goal:** UI-025 and UI-026 through the Impeccable loop; UI-027 shows "being scored" after completion.
**Covers:** UI-025, UI-026, UI-027, FR-112, FR-120
**Prerequisites:** Step 9.2 complete
**Files to create / modify:**
- `src/app/(app)/runs/[runId]/turn/page.tsx`, `src/app/(app)/runs/[runId]/defense/page.tsx` — create
- `src/components/features/run/{turn-panel,defense-question,defense-artifacts}.tsx` — create; `run-status.tsx` — modify (pending scoring state); `locked` page — modify (redirects to `/turn` on delivery; live region announces the Turn)
- `src/components/graphs/frame-beside-decision.tsx` — create the layout component now (used by the Turn panel for the frozen record; the graph payload version is completed in Phase 10)
**Commands (in order, from repo root):** Impeccable loop for `/runs/[runId]/turn`, `/runs/[runId]/defense`, `/runs/[runId]`.
**Implementation notes:** Window countdown with the 1:00 live region; response radio with plain descriptions; the frozen frame and locked brief beside the form; defense with no assistant or room, artifacts panel, follow-up rendered beneath its question, "Finish the defense" with the unanswered-count confirm dialog; duration captured from focus to submit.
**Secrets (if any):** none.
**Tests to write:**
- `tests/unit/components/run/turn-panel.test.tsx` — response options; refusal message names the claim.
- `tests/unit/components/run/defense-question.test.tsx` — follow-up appears; duration reported.
- `tests/e2e/walkthrough/09-turn.spec.ts` — after lock, `advanceClock` past the delay, the Turn arrives with the stakeholder message; a window claim needs a stance; file `revise` with justification and updated confidence; the frozen record is visible beside.
- `tests/e2e/walkthrough/10-defense.spec.ts` — 6–9 typed questions including the provenance question for the stale figure; answer from memory without a source and see the follow-up; artifacts visible; no assistant or room; finish → status page shows scoring pending.
- `tests/e2e/a11y/student-run.spec.ts` — modify; Turn and defense routes.
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test -- tests/unit/components/run && pnpm test:e2e -- tests/e2e/walkthrough/09-turn.spec.ts tests/e2e/walkthrough/10-defense.spec.ts tests/e2e/a11y/student-run.spec.ts
```
**Commit:** `feat(runs): turn window and defense screens`
**Rollback:** `git checkout -- . && git clean -fd`

## Phase exit criteria

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm test:e2e && pnpm build && pnpm openapi:check && npx impeccable@3.6.1 detect --json . > impeccable-report.json && node scripts/impeccable-gate.mjs impeccable-report.json .impeccable/config.json
```

Requirement IDs now fully implemented: FR-110 to FR-115, FR-120 to FR-124, FR-126, UI-025, UI-026, DATA-038, DATA-039, NFR-002. Partially: FR-125 (Ownership read in Phase 10), FR-231 (scoring and confirmation transitions in Phases 10–11), UI-027 (held and scored states in Phases 10–11).
