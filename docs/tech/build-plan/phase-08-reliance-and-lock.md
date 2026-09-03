# Phase 8 — Reliance, Interrogation, Escalation, and Decision Lock

**Purpose / Read this when:** the assistant surfaces claims (Phase 7) and the student must take stances, run interrogation actions, escalate, write the brief, be refused at the lock gate when a relied-on claim is unstanced, lock irreversibly, add an addendum, have the clock auto-lock at expiry, and exercise the Paused state through the forced-failure test control. Walkthrough steps 6, 7, and 8 become live.

**Requirements covered:** FR-070 to FR-075, FR-080 to FR-087 (except scoring parts), FR-090 to FR-093, FR-100 to FR-109 (except scoring), FR-001, FR-118, UI-023 (stances, actions, brief editor), UI-024, DATA-034 to DATA-037, DATA-040, NFR-004; decisions D-042, D-044, D-076, D-089, D-109, D-116.

## Goal

The working period is complete: five stances, Source Trace and the authored Replication and Decomposition Checks, escalation with the two-per-run limit and the general reply, the brief with named numeric fields, the lock gate naming the first unstanced relied-on claim, the irreversible lock, the addendum, auto-lock at expiry, pause and resume with clock credit, and the faculty-seat forced failure.

## Prerequisites

- Phase 7 exit criteria pass.
- Read `10-backend-spec-modules.md` §6 and §8, `10-backend-spec.md` §8 and §10, `09-frontend-spec-screens.md` §UI-023 and §UI-024.

## Steps

### Step 8.1 — Reliance service: stances, actions, escalations, relied-on detection, lock-gate query
**Goal:** Every function in `10-backend-spec-modules.md` §8 with router and actions.
**Covers:** FR-070 to FR-075, FR-080, FR-081, FR-085, FR-090 to FR-093, DATA-034 to DATA-036, D-076, D-089, D-116
**Prerequisites:** Phase 7 complete
**Files to create / modify:**
- `src/server/modules/reliance/{schema,service,repository,router,actions,index,errors}.ts` — complete; `setStance`, `runAction`, `escalate`, `markReliedOnFromNamedFields`, `findUnstancedReliedOn`, student `ClaimView` including `remainingEscalations`
- `src/app/api/v1/runs/[runId]/claims/[claimId]/stance/route.ts`, `.../actions/route.ts`, `.../escalation/route.ts` — create
**Commands (in order, from repo root):** none.
**Implementation notes:** Costs charged at start (`chargeCost`), results returned verbatim from `verification_paths`; `CLOCK_EXPIRED` when remaining ≤ 0 at start; both stances kept; escalation limit and general reply per FR-090 to FR-092; the student escalation response omits `response_id` and `counts_against_limit` (D-116); `stance = escalate` without an escalation call is allowed (the stance is a record; the reply requires `escalate`).
**Secrets (if any):** none.
**Tests to write:**
- `tests/unit/reliance/relied-on.test.ts` — named-field tolerance (D-076), unit normalization, ordering of unstanced claims.
- `tests/integration/reliance/stances.test.ts` — set, change (previous kept, `action_ids`), refuse unsurfaced claim, refuse when locked or paused.
- `tests/integration/reliance/actions.test.ts` — Source Trace on every sourced claim (cost 60,000, authored result), Replication and Decomposition only where authored (`ACTION_NOT_AVAILABLE` otherwise), cost charged before result, expiry refusal, action started before expiry completes.
- `tests/integration/reliance/escalations.test.ts` — authored reply counts, general reply does not count, third counted escalation refused, statement validation, student response shape.
- `tests/integration/api/reliance.test.ts` — endpoints and matrix rows.
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test -- tests/unit/reliance && pnpm test:integration -- tests/integration/reliance tests/integration/api/reliance.test.ts tests/integration/auth/matrix.test.ts && pnpm openapi:generate && pnpm openapi:check
```
**Commit:** `feat(reliance): stances, interrogation actions, escalations, relied-on detection`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 8.2 — Brief draft, lock gate, Decision Lock, addendum, auto-lock, pause and resume, test control
**Goal:** The remaining `runs` functions for the working period.
**Covers:** FR-001, FR-084, FR-100 to FR-108, FR-118, DATA-037, DATA-040, NFR-004, D-042, D-044, D-109
**Prerequisites:** Step 8.1 complete
**Files to create / modify:**
- `src/server/modules/runs/service.ts` — modify; `saveBriefDraft`, `briefSignal`, `lockDecision`, `addAddendum`, `forceAssistantFailure`, `materializeTimers` extended with clock-expiry auto-lock (D-044)
- `src/app/api/v1/runs/[runId]/brief/route.ts`, `.../brief/signals/route.ts`, `.../lock/route.ts`, `.../addendum/route.ts`, `src/app/api/v1/review/runs/[runId]/test-controls/force-assistant-failure/route.ts` — create (the `review` module gets `router.ts` with this single route now; the rest arrives in Phase 11)
- `src/app/api/v1/test/runs/[runId]/advance-clock/route.ts` — modify; also shifts `turn_due_at` and `turn_window_ends_at` (D-109)
**Commands (in order, from repo root):** none.
**Implementation notes:** `lockDecision` order: validate → `markReliedOnFromNamedFields` → `findUnstancedReliedOn` → refuse with `lock_refused` event and `LOCK_REFUSED_UNSTANCED_CLAIM { claimId, claimText }` or lock (`decision_locked` payload per `10-backend-spec-modules.md` §10, `speed_outlier`, `turn_due_at = now + turn_delay_seconds`). Auto-lock at expiry records empty fields as empty and relied-on unstanced claims as unstanced with `occurred_at` = the expiry instant. `addAddendum` once, ≤ 50 words, any state after lock and before `recorded`. `forceAssistantFailure` requires `flags.testControls` and the section instructor; audit `test_control.force_failure`. Locked artifacts are immutable (no update path; grants).
**Secrets (if any):** none.
**Tests to write:**
- `tests/unit/runs/lock-gate.test.ts` — ordering, empty brief allowed at auto-lock only.
- `tests/integration/runs/lock.test.ts` — refusal names the first unstanced relied-on claim (log mark, named field, both); successful lock freezes (brief update refused by trigger), transition, `turn_due_at`; speed outlier under 240 s; addendum once; auto-lock via `advance-clock` records empty fields and unstanced claims; `RUN_PAUSED` refusal while paused.
- `tests/integration/runs/pause.test.ts` — forced failure arms the flag (instructor only, flag on), the next delegation pauses the run, resume credits the cost for a failed action path (0 for delegation), `resume` event payload; `TEST_CONTROLS_DISABLED` when the flag is off.
- `tests/integration/api/runs-lock.test.ts` — endpoints and matrix rows (student cannot arm the test control).
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test -- tests/unit/runs && pnpm test:integration -- tests/integration/runs tests/integration/api/runs-lock.test.ts tests/integration/auth/matrix.test.ts && pnpm openapi:generate && pnpm openapi:check
```
**Commit:** `feat(runs): brief, lock gate, decision lock, addendum, auto-lock, pause and test control`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 8.3 — Screens: stance controls, action results, escalation dialog, brief editor, lock dialogs, addendum, locked page
**Goal:** UI-023 complete and UI-024 through the Impeccable loop.
**Covers:** UI-023, UI-024, FR-073, FR-084, FR-100, FR-103, FR-107, FR-118 (control UI arrives with the replay in Phase 11; until then the test control is exercised through the API)
**Prerequisites:** Step 8.2 complete
**Files to create / modify:**
- `src/components/features/run/{stance-control,action-result-sheet,escalation-dialog,brief-editor,lock-dialog,addendum-dialog}.tsx` — create; `claim-card.tsx` — modify (live stance control, actions menu, escalate, escalation reply)
- `src/app/(app)/runs/[runId]/locked/page.tsx` — create; locked brief, frozen frame, Turn countdown placeholder (Turn arrives in Phase 9), addendum
- `src/app/(app)/runs/[runId]/work/page.tsx` — modify; brief editor column with autosave and lock button
**Commands (in order, from repo root):** Impeccable loop for `/runs/[runId]/work` (full working state) and `/runs/[runId]/locked`.
**Implementation notes:** Stance control is a five-option radio group with icons and labels; the actions menu lists only `availableActions`; costs shown ("1 min", "3 min", "4 min", "5 min"); the lock dialog names the unstanced claim with "Go to claim"; brief editor word counts and numeric fields with unit labels; addendum dialog disabled after use; clock under 5:00 amber border, under 1:00 red with the live region.
**Secrets (if any):** none.
**Tests to write:**
- `tests/unit/components/run/stance-control.test.tsx` — keyboard selection; previous stance shown after change.
- `tests/unit/components/run/brief-editor.test.tsx` — limits; numeric fields reject letters.
- `tests/e2e/walkthrough/06-working-period.spec.ts` — modify; append step 6: Source Trace on a different claim returns document, passage, date, author and charges 1 minute; change a stance after the action (both kept in the trace); Challenge one low-stakes claim and Reject another; escalate once with a one-sentence statement and see the authored reply after a 5-minute charge.
- `tests/e2e/walkthrough/07-forced-failure.spec.ts` — instructor arms the control via the API fixture, student delegates, paused overlay appears, resume restores the clock and shows the credit note.
- `tests/e2e/walkthrough/08-lock.spec.ts` — lock refused with the claim named; set the stance; lock with named numbers; post-lock edit impossible; addendum offered and saved; the two-minute auto-lock run (assignment "Auto-lock test run"): lock a frame, leave the brief unfiled, `advanceClock`, observe `/locked` with empty fields recorded (assert through the trace).
- `tests/e2e/a11y/student-run.spec.ts` — modify; full workspace and locked page.
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test -- tests/unit/components/run && pnpm test:e2e -- tests/e2e/walkthrough/06-working-period.spec.ts tests/e2e/walkthrough/07-forced-failure.spec.ts tests/e2e/walkthrough/08-lock.spec.ts tests/e2e/a11y/student-run.spec.ts
```
**Commit:** `feat(runs): stances, actions, escalation, brief editor, lock, addendum screens`
**Rollback:** `git checkout -- . && git clean -fd`

## Phase exit criteria

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm test:e2e && pnpm build && pnpm openapi:check && npx impeccable@3.6.1 detect --json . > impeccable-report.json && node scripts/impeccable-gate.mjs impeccable-report.json .impeccable/config.json
```

Requirement IDs now fully implemented: FR-001, FR-070, FR-071, FR-072, FR-073, FR-074, FR-080, FR-081, FR-084, FR-085, FR-090, FR-091, FR-092, FR-093, FR-100 to FR-108, FR-118, UI-023, UI-024, DATA-034 to DATA-037, DATA-040, NFR-004. Partially: FR-075, FR-086, FR-087, FR-109 (scoring in Phase 10), FR-082 and FR-083 (matrix and line in Phase 10).
