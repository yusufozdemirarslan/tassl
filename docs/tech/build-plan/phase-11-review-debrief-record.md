# Phase 11 — Faculty Replay, Debrief, Record, Exports, Notifications

**Purpose / Read this when:** runs are scored (Phase 10) and the two seats must see the same evidence: the faculty replay with confirm and override, void and re-offer, neutralization with recompute and re-export, manual banding for held runs, the Run Debrief in both draft and confirmed forms, the Judgment Record, course exports with versions, the notifications UI, the illustrative queue and trajectory, the mapping change with recompute, and the Impeccable onboarding and copy passes. Walkthrough steps 1 and 11 to 17 become live, and the full walkthrough E2E runs on both variants.

**Requirements covered:** FR-002, FR-003, FR-005, FR-008, FR-140, FR-150 to FR-156, FR-170 to FR-172, FR-180 to FR-186, FR-204, FR-206, FR-232, FR-250 to FR-254, FR-055 (flagging), UI-009 (panels), UI-011, UI-027, UI-028, UI-029, UI-033, UI-034, UI-035, UI-030 (mapping apply), DATA-043 to DATA-046, DATA-054, DATA-055, SYS-010, SYS-011 (audit rows); decisions D-035, D-087, D-092, D-095, D-096, D-104, D-120.

## Goal

The definition of done is reachable: both seats complete the walkthrough on both variants through the interface, with the E2E suite covering every step.

## Prerequisites

- Phase 10 exit criteria pass.
- Read `10-backend-spec-modules.md` §12–15, `07-api-spec.md` §8, `09-frontend-spec-screens.md` §UI-028, UI-029, UI-033 to UI-035.

## Steps

### Step 11.1 — Review service: replay, band decisions, confirm, neutralize, void and re-offer, manual banding, flagging
**Goal:** Every function in `10-backend-spec-modules.md` §12 with router and actions; confirmation writes the first course export.
**Covers:** FR-002, FR-003, FR-005, FR-008, FR-026, FR-055, FR-140, FR-180 to FR-184, FR-204, FR-232, DATA-044, DATA-046, D-087, D-092, D-120
**Prerequisites:** Phase 10 complete
**Files to create / modify:**
- `src/server/modules/review/{schema,service,repository,router,actions,index,errors}.ts` — create or complete
- `src/server/modules/runs/service.ts` — modify; `voidRun` and `reofferRun` with the `void_reason` enum and event `note`
- `src/server/modules/records/service.ts` — modify; `writeCourseExport` called on confirmation and every correction; `getRecord`, `exportRecord`, `sample`
- `src/app/api/v1/review/**` routes, `src/app/api/v1/runs/[runId]/exports/route.ts`, `.../exports/[version]/route.ts`, `src/app/api/v1/assignments/[assignmentId]/exports/route.ts`, `src/app/api/v1/runs/[runId]/record/route.ts` — create
**Commands (in order, from repo root):** none.
**Implementation notes:** `decideBand` transitions to `confirmed` when all seven have decisions, computes `points_confirmed`, writes export v1 (reason `initial`), notifies the student (`bands_confirmed`); re-decisions on confirmed runs write a new export (reason `override`); `neutralizeClaim` calls `scoring.recomputeAfterNeutralization`, sets `review_requested_at` on the package version, writes an export (reason `neutralization`) when the run was confirmed; `voidRun` from any state, re-offer per `10-backend-spec-modules.md` §6; TA cannot change an instructor-decided band; first replay open records `flags.replay_first_opened_at` (D-120); audit rows for every action.
**Secrets (if any):** none.
**Tests to write:**
- `tests/integration/review/decisions.test.ts` — confirm, override with note, unassessed; transition after the seventh decision; points from confirmed bands; export v1 written; re-decision writes v2; TA lock.
- `tests/integration/review/neutralize.test.ts` — neutralization recompute never lowers; export version increments with reason; package version flagged for review; credit-challenge path marks `inconsistency_credited`.
- `tests/integration/review/void.test.ts` — void from `working` and from `recorded`; re-offer creates the linked run on the other variant; no points in any export for the voided run.
- `tests/integration/review/held.test.ts` — manual banding on a held run transitions to `confirmed`.
- `tests/integration/api/review.test.ts` — endpoints and matrix rows (student 403 on the replay).
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test:integration -- tests/integration/review tests/integration/api/review.test.ts tests/integration/auth/matrix.test.ts && pnpm openapi:generate && pnpm openapi:check
```
**Commit:** `feat(review): replay bundle, band decisions, neutralization, void and re-offer, exports`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 11.2 — Debrief service and mapping change with recompute
**Goal:** `getDebrief`, `answerDebrief`, the Recorded transition, and `changeMapping` with the `recompute_exports` job.
**Covers:** FR-150 to FR-155, FR-206, DATA-043, DATA-055, D-091, D-095
**Prerequisites:** Step 11.1 complete
**Files to create / modify:**
- `src/server/modules/debrief/{schema,service,repository,router,actions,index,errors}.ts` — create; section assembly in the fixed order, done-well selection, forbidden-word-free templates in `src/lib/i18n/en-US.ts`
- `src/server/modules/courses/service.ts` — modify; `previewMappingChange`, `changeMapping`, `recomputeExports` (job handler registered in `src/server/jobs/handlers/recompute-exports.ts`)
- `src/app/api/v1/runs/[runId]/debrief/route.ts`, `.../debrief/answers/route.ts`, `src/app/api/v1/courses/[courseId]/mapping/preview/route.ts`, `.../mapping/route.ts` — create
**Commands (in order, from repo root):** none.
**Implementation notes:** `debrief_opened { version }` written once per version; `answerDebrief` transitions `confirmed → recorded`; sections a run cannot support carry `available: false` with a reason; mapping change requires `confirm: true`, writes `course_mapping_changes`, and re-exports every confirmed run with reason `mapping_change`.
**Secrets (if any):** none.
**Tests to write:**
- `tests/unit/debrief/assembly.test.ts` — section order; done-well selection rules; forbidden words absent from every template (scans `en-US.ts` keys under `debrief.`).
- `tests/integration/debrief/flow.test.ts` — draft debrief with draft points; after confirmation the same route shows confirmed bands and the note; answering transitions to `recorded` and writes `debrief_answer`; reviewer view has no answer form.
- `tests/integration/courses/mapping.test.ts` — preview lists affected runs with both values; apply without confirm refused; apply recomputes and re-exports.
- `tests/integration/api/debrief.test.ts` — endpoints and matrix rows.
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test -- tests/unit/debrief && pnpm test:integration -- tests/integration/debrief tests/integration/courses/mapping.test.ts tests/integration/api/debrief.test.ts && pnpm openapi:generate && pnpm openapi:check
```
**Commit:** `feat(debrief): debrief assembly and recorded transition; mapping change recompute`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 11.3 — Faculty replay screen
**Goal:** UI-033 through the Impeccable loop, including the test control and manual banding.
**Covers:** UI-033, FR-180 to FR-185, FR-118, FR-008
**Prerequisites:** Step 11.2 complete
**Files to create / modify:**
- `src/app/(app)/review/runs/[runId]/page.tsx` — create
- `src/components/features/review/{replay-trace,band-decision-control,evidence-drawer,package-view,confirmation-record,void-dialog,neutralize-dialog,test-controls,exports-list,manual-bands-form}.tsx` — create
- `src/components/features/packages/claim-object-view.tsx` — modify; both variants side by side with the current one highlighted
**Commands (in order, from repo root):** Impeccable loop for `/review/runs/[runId]`; then `/impeccable clarify /review/runs/[runId]`.
**Implementation notes:** Tabs per `09-frontend-spec-screens.md` §UI-033; the points arithmetic sentence renders from the mapping and bands; uncalibrated labels; the void dialog uses the reason enum with a note field; the test control explains its purpose.
**Secrets (if any):** none.
**Tests to write:**
- `tests/unit/components/review/band-decision-control.test.tsx` — draft pre-selected, not submitted; override requires a band; note optional.
- `tests/e2e/walkthrough/01-package.spec.ts` — faculty seat opens the package view from the replay: id, version, and the confirmation record are visible.
- `tests/e2e/walkthrough/12-faculty-replay.spec.ts` — trace in order with the clock column; four graphs; defense transcript; confirm one band, override one with a note, confirm the remaining five; the run leaves `scored` only after the seventh; the mapping arithmetic and points are shown; a claim object view shows evidence status, source passage, failure family, verification result, and confirmation (FR-253).
- `tests/e2e/walkthrough/15-neutralize-void.spec.ts` — neutralize the planted claim on the confirmed, recorded, exported run: recompute shown, band never lower, export v2 exists; void the short auto-lock run with re-offer: no partial result, a new run offered.
- `tests/e2e/a11y/instructor.spec.ts` — modify; replay route in scored and confirmed states.
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test -- tests/unit/components/review && pnpm test:e2e -- tests/e2e/walkthrough/01-package.spec.ts tests/e2e/walkthrough/12-faculty-replay.spec.ts tests/e2e/walkthrough/15-neutralize-void.spec.ts tests/e2e/a11y/instructor.spec.ts
```
**Commit:** `feat(review): faculty replay screen with decisions, neutralization, void, test controls`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 11.4 — Debrief, record, run status, exports, notifications, queue screens
**Goal:** UI-028, UI-029, UI-027 (all states), UI-035, UI-011, UI-034, the home panels, and the mapping apply on UI-030 through the Impeccable loop.
**Covers:** UI-009, UI-011, UI-027, UI-028, UI-029, UI-030, UI-034, UI-035, FR-150 to FR-156, FR-170 to FR-172, FR-186, FR-204, FR-206, FR-254, SYS-010, D-035, D-096
**Prerequisites:** Step 11.3 complete
**Files to create / modify:**
- `src/app/(app)/runs/[runId]/debrief/page.tsx`, `src/app/(app)/records/[runId]/page.tsx`, `src/app/(app)/assignments/[assignmentId]/exports/page.tsx`, `src/app/(app)/notifications/page.tsx`, `src/app/(app)/review/page.tsx` — create
- `src/components/features/debrief/*` (`09-frontend-spec.md` §3), `src/components/features/review/review-queue.tsx`, `src/components/graphs/trajectory-sample.tsx`, `src/server/modules/records/sample/{four-run-trajectory,review-queue}.json` — create
- `src/components/features/courses/mapping-editor.tsx` — modify; preview table and apply with the confirmation checkbox
- `src/app/(app)/home/page.tsx` — modify; review, packages, and courses panels with real data
- `src/components/layout/notifications-bell.tsx` — modify; live unread count
**Commands (in order, from repo root):** Impeccable loop for each route; then `/impeccable onboard` (home, runs list, packages list) and `/impeccable clarify` for `/runs/[runId]/work`, `/runs/[runId]/debrief`, `/packages/[packageId]/versions/[versionId]/confirm`.
**Implementation notes:** Debrief sections in the fixed order with `GraphFrame`s; the "Illustrative sample data" label on the trajectory and queue panels (component refuses to render without it); the record export button downloads the record form; the exports table carries the gradebook sentence.
**Secrets (if any):** none.
**Tests to write:**
- `tests/unit/components/debrief/debrief-sections.test.tsx` — order; unavailable sections named; done-well present.
- `tests/unit/components/layout/illustrative-sample.test.tsx` — modify; trajectory and queue render only inside the labeled wrapper.
- `tests/e2e/walkthrough/11-scoring-debrief.spec.ts` — modify; part 2: draft debrief within 10 minutes with every band marked draft and provisional points labeled draft.
- `tests/e2e/walkthrough/13-debrief-confirmed.spec.ts` — confirmed bands replace drafts in place with the note; sections in run order including the missed defect with document and action, at least one thing done well, the confidence line, the Turn beside the frame, the clock, the counterfactual; answer the two questions → `recorded`.
- `tests/e2e/walkthrough/14-export-record.spec.ts` — modify; part 2: exports page lists v1; the record screen shows the four graphs, confirmed bands with the note, mode and variant, and its export omits weight, mapping, and points.
- `tests/e2e/instructor/mapping.spec.ts` — preview and apply a mapping change; export v2 with reason `mapping_change`.
- `tests/e2e/a11y/{student-run,instructor,shell}.spec.ts` — modify; new routes.
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test -- tests/unit/components && pnpm test:e2e -- tests/e2e/walkthrough/11-scoring-debrief.spec.ts tests/e2e/walkthrough/13-debrief-confirmed.spec.ts tests/e2e/walkthrough/14-export-record.spec.ts tests/e2e/instructor/mapping.spec.ts tests/e2e/a11y
```
**Commit:** `feat(runs): debrief, record, exports, notifications, queue screens`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 11.5 — Full walkthrough E2E on both variants, standing rules, keyboard-only run
**Goal:** Steps 16 and 17 and the complete suite of PRD §12 pass on chromium, firefox, and webkit locally.
**Covers:** FR-250 to FR-254, FR-210, FR-212, FR-004 (unassessed recompute), NFR-010
**Prerequisites:** Step 11.4 complete
**Files to create / modify:**
- `tests/e2e/walkthrough/16-sound-variant.spec.ts` — create; seats swapped (student2 and instructor): steps 2–14 on the sound assignment; the student accepts without checking the sound claim whose warranted stance is Accept; the debrief scores it as warranted (Accept against Accept)
- `tests/e2e/walkthrough/17-standing-rules-a11y.spec.ts` — create; set one dimension to unassessed from the override control and see points recomputed as the mean over the remaining assessed dimensions; every run screen keyboard-only; screen-reader structure checks (landmarks, headings); each graph opens to its data table and description
- `tests/e2e/a11y/keyboard-only-run.spec.ts` — create; the pointer-throwing run from `16-performance-a11y-budgets.md` §8
- `tests/e2e/flows.json`, `tests/e2e/coverage.test.ts`, `tests/e2e/a11y/screens.json`, `tests/e2e/a11y/coverage.test.ts` — create; `14-testing-strategy.md` §3
**Commands (in order, from repo root):**
```bash
pnpm test:e2e
```
**Implementation notes:** The defective session asserts FR-252 (Accept against warranted Verify on the stale figure; confidence rise at lock with no verification action on the timeline; the provenance answer from memory in the transcript). The suite runs in CI on chromium and locally on all three projects.
**Secrets (if any):** none.
**Tests to write:** the files above.
**Verify (all must pass):**
```bash
pnpm test:e2e && pnpm test:e2e --project=firefox -- tests/e2e/walkthrough && pnpm test:e2e --project=webkit -- tests/e2e/walkthrough
```
**Commit:** `test(e2e): full walkthrough on both variants, standing rules, keyboard-only run`
**Rollback:** `git checkout -- tests`

## Phase exit criteria

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm test:e2e && pnpm evals && pnpm build && pnpm openapi:check && npx impeccable@3.6.1 detect --json . > impeccable-report.json && node scripts/impeccable-gate.mjs impeccable-report.json .impeccable/config.json && pnpm exec tsx scripts/bundle-budget.ts
```

Requirement IDs now fully implemented: FR-002, FR-003, FR-005, FR-008, FR-055, FR-140, FR-150 to FR-156, FR-170 to FR-172, FR-180 to FR-186, FR-204, FR-206, FR-210, FR-212, FR-231, FR-232, FR-250 to FR-254, UI-009, UI-011, UI-027, UI-028, UI-029, UI-030, UI-033, UI-034, UI-035, DATA-043 to DATA-046, DATA-054, DATA-055, SYS-010, SYS-011 (rows; screens in Phase 13).
