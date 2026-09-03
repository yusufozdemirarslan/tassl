# Phase 10 — Trace Export and Scoring

**Purpose / Read this when:** a run can complete its defense (Phase 9) and the assessor must do its work: the exportable event trace in both forms, the four graphs plotted from the trace and nothing else, the versioned rubric, the categorical facts, the five model reads on the mock provider, the seven draft bands with evidence, points, the False Challenge Rate, and the held-run path. Walkthrough steps 11 (scoring) and 14 (export) become live on the API; their screens follow in Phase 11.

**Requirements covered:** FR-004, FR-005 (recompute engine), FR-054, FR-064, FR-075, FR-082, FR-083, FR-086, FR-087, FR-109, FR-125 (Ownership read), FR-130 to FR-143, FR-202, FR-203, FR-240 to FR-243, AI-003 (mock path), DATA-041, DATA-042, DATA-053, SYS-010 (notify service), NFR-001, NFR-012; decisions D-033, D-034, D-046, D-047, D-074, D-078, D-079, D-091, D-107, D-108.

## Goal

`score_run` turns a completed run into four graphs, seven evidence-linked draft bands (or unassessed), FCR, and draft points in under five seconds on the mock; the trace exports in both forms; every PRD fixed placement passes as an eval.

## Prerequisites

- Phase 9 exit criteria pass.
- Read `10-backend-spec-modules.md` §10–11, `11-llm-integration.md` §2.1 (band reads) and §5, PRD Appendix A (for the rubric copy).

## Steps

### Step 10.1 — Trace export in two forms
**Goal:** `buildExport(runId, form)` and `TraceExportSchema` match PRD §12 exactly; endpoints serve both forms.
**Covers:** FR-240 to FR-243, FR-170 (export part)
**Prerequisites:** Phase 9 complete
**Files to create / modify:**
- `src/server/modules/trace/export.ts`, `src/server/modules/trace/export-schema.ts` — create; header, events, claim table, computed block; `x_tassl_extensions`
- `src/app/api/v1/runs/[runId]/record/export/route.ts` — create (record form; available from `confirmed`, so this phase tests it through the service)
- `src/server/modules/records/service.ts` — create partial; `writeCourseExport`, `getCourseExport`, `listCourseExports` (used by Phase 11 on confirmation)
**Commands (in order, from repo root):** none.
**Implementation notes:** Claim table rows per `10-backend-spec-modules.md` §10; `points`, `weight`, `mapping` only in the course form; `readiness_context` per row; `false_challenge_rate` from the stance-matrix builder (Step 10.2), so this step wires the field and Step 10.2 fills it.
**Secrets (if any):** none.
**Tests to write:**
- `tests/unit/trace/export-schema.test.ts` — the schema accepts the documented example and rejects a course-form key in the record form.
- `tests/integration/trace/export.test.ts` — a factory run at `defense_complete` exports with the header fields, every event, and a claim table row per consequential claim; the two forms differ only by the three keys.
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test -- tests/unit/trace && pnpm test:integration -- tests/integration/trace
```
**Commit:** `feat(trace): exportable event trace in course and record forms`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 10.2 — Graph builders and graph components
**Goal:** The four pure graph builders and their React components with data tables and descriptions.
**Covers:** FR-063 (graph side), FR-082, FR-083, FR-132 to FR-136, FR-212, D-074, D-078, D-079, D-107
**Prerequisites:** Step 10.1 complete
**Files to create / modify:**
- `src/server/modules/scoring/graphs/{confidence-line,clock-timeline,stance-matrix,frame-beside-decision,index}.ts` — create; pure functions of `(events, packageVersion, variantStates)`
- `src/components/graphs/{graph-frame,confidence-line,clock-timeline,stance-matrix,frame-beside-decision}.tsx` — create or complete; recharts loaded with `next/dynamic`; `GraphFrame` with the data table toggle and hidden description
- `src/app/dev/components/fixtures.ts` — modify; graph fixtures from `tests/fixtures/scoring/marco-8-of-11.json`
- `tests/fixtures/scoring/*.json` — create; the thirteen fixtures listed in `14-testing-strategy.md` §5
**Commands (in order, from repo root):**
```bash
pnpm add recharts@3.10.1
```
**Implementation notes:** Unavailable graphs carry `missing_event_types`; FCR denominator includes unsurfaced claims (D-107); accuracy per D-078; disruption marking per D-079; descriptions built from i18n templates; `isAnimationActive={false}` everywhere.
**Secrets (if any):** none.
**Tests to write:**
- `tests/unit/scoring/graphs/*.test.ts` — each builder against the fixtures: Marco fixture FCR = 0.727 with the 5×5 summary; Nadia fixture confidence 40 → 85 with accuracy at lock below 0.5; timeline segments cover the clock without overlap; frame-beside-decision marks the disrupted assumption; unavailable graph when `frame_locked` is missing.
- `tests/unit/components/graphs/graph-frame.test.tsx` — SVG `role="img"` with `aria-labelledby`; table toggle renders rows; description present.
- `tests/e2e/a11y/dev-components.spec.ts` — modify; graphs in the gallery pass axe.
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test -- tests/unit/scoring tests/unit/components/graphs && pnpm test:e2e -- tests/e2e/a11y/dev-components.spec.ts && pnpm exec tsx scripts/bundle-budget.ts
```
**Commit:** `feat(scoring): four graph builders and accessible graph components`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 10.3 — Rubric v1, categorical facts, band rules, points
**Goal:** Appendix A as code; the computed bands for Verification and Calibration; the categorical placements for the other five; points arithmetic; neutralization recompute.
**Covers:** FR-004, FR-005, FR-075, FR-086, FR-087, FR-109 (categorical), FR-131, FR-137 (categorical), FR-138, FR-139, FR-142, FR-143, FR-202, FR-203, DATA-053, D-033, D-091, D-108
**Prerequisites:** Step 10.2 complete
**Files to create / modify:**
- `src/server/modules/scoring/rubric/v1.ts` — create; the four descriptors, fixed modifiers, and the 21 `[EDIT]` boundary sentences per dimension copied verbatim from `docs/prd/Tassl-PRD.md` Appendix A.1–A.7; `rubric/index.ts` registry `{ v1 }` and `CURRENT_RUBRIC = 'v1'`
- `src/server/modules/scoring/facts.ts`, `src/server/modules/scoring/bands.ts`, `src/server/modules/scoring/points.ts`, `src/server/modules/scoring/recompute.ts` — create; `10-backend-spec-modules.md` §11.2–11.5
- `src/server/modules/scoring/constants.ts` — create; `FCR_PROFESSIONAL = 0.15`, `FCR_FEW = 0.30`, `FCR_NOVICE = 0.5`, `SPEED_OUTLIER_MS = 240000`, each annotated as a hypothesis or an architect constant
**Commands (in order, from repo root):** none.
**Implementation notes:** Every placement in FR-139 is a unit test; `computePoints` returns null when no dimension is assessed; the neutralization floor keeps the higher band and points (FR-005). A field-name test asserts no column, event payload key, or export key is named `score`, `rank`, or `percentile` (FR-131).
**Secrets (if any):** none.
**Tests to write:**
- `tests/unit/scoring/facts.test.ts` — each fact against the fixtures.
- `tests/unit/scoring/bands.test.ts` — every FR-139 placement; unassessed rules (graph unavailable; stance records lost ≤ 1/3 → Verification and Calibration unassessed; > 1/3 → unscoreable).
- `tests/unit/scoring/points.test.ts` — mean over assessed, exclusion of unassessed, null when none, three-decimal rounding, draft versus confirmed.
- `tests/unit/scoring/recompute.test.ts` — neutralizing the planted claim raises Calibration from Developing to Proficient in the fixture and never lowers; points floor.
- `tests/unit/scoring/field-names.test.ts` — FR-131 grep.
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test -- tests/unit/scoring
```
**Commit:** `feat(scoring): rubric v1, categorical facts, band rules, points, recompute`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 10.4 — Band-read prompts, mock readers, scoring job, held path, notifications service
**Goal:** `score_run` runs end to end on the mock provider and notifies; failures hold the run.
**Covers:** FR-054, FR-064, FR-125, FR-130, FR-137, FR-140, FR-141, AI-003, DATA-041, DATA-042, SYS-010, NFR-001, D-046, D-047
**Prerequisites:** Step 10.3 complete
**Files to create / modify:**
- `src/server/llm/prompts/band-read-{framing,delegation,decision-quality,adaptation,ownership}.ts` — create; `11-llm-integration.md` §2.1
- `src/server/modules/scoring/reads.ts` — create; builds inputs (rubric descriptors, free text through `untrusted()`), calls `structured()`, maps outputs; degrades per `11-llm-integration.md` §3
- `src/server/modules/scoring/{schema,service,repository,router,index,errors}.ts` — create; `scoreRun` job handler, `getScore`
- `src/server/jobs/handlers/score-run.ts` — create; registered
- `src/server/modules/notifications/{schema,service,repository,router,actions,index}.ts` — create; `notify`, `listNotifications`, `markRead`, `markAllRead`; `src/app/api/v1/notifications/**` — create
**Commands (in order, from repo root):** none.
**Implementation notes:** Pipeline per `10-backend-spec-modules.md` §11; `draft_band` events written for all seven; `run_scores` with graphs, FCR, matched share, `points_draft`, flags (`all_novice`, `all_professional`, `nothing_answered`); transition to `scored`; notifications `run_scored` (student) and to section instructors; on read failure after retries, `scoring_status = 'held'` and `run_held` notifications; `alertOps('run_held')`; `countOps('ops_scoring_completed')` with latency.
**Secrets (if any):** none.
**Tests to write:**
- `tests/unit/scoring/reads.test.ts` — input builders wrap untrusted text; mapping of read outputs; degradation to `categorical_only` and `read_failed`.
- `tests/integration/scoring/score-run.test.ts` — a fixture run at `defense_complete` becomes `scored` with seven bands (evidence event seqs non-empty, quotes present for read-based bands), `run_scores` populated, notifications created; idempotent on a second run; a forced read failure (mock configured via `MOCK_FAIL_READS=true` test env) holds the run and notifies instructors.
- `tests/integration/notifications/service.test.ts` — list, mark read, email copy enqueued when enabled.
- `evals/scoring/cases/*.json`, `evals/scoring/check.ts` — the FR-139 placements as evals over the full pipeline on mock.
- `tests/integration/api/notifications.test.ts` — endpoints and matrix rows.
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test -- tests/unit/scoring && pnpm test:integration -- tests/integration/scoring tests/integration/notifications tests/integration/api/notifications.test.ts && pnpm evals && pnpm openapi:generate && pnpm openapi:check
```
**Commit:** `feat(scoring): band reads, score_run job, held path, notifications service`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 10.5 — E2E: scoring reachable from the run, export by API
**Goal:** After the defense, the run reaches `scored` within the NFR-001 mock target and the trace export is downloadable through the API.
**Covers:** FR-130, FR-240, NFR-001
**Prerequisites:** Step 10.4 complete
**Files to create / modify:**
- `tests/e2e/walkthrough/11-scoring-debrief.spec.ts` — create (part 1: scoring; the debrief part is added in Phase 11)
- `tests/e2e/walkthrough/14-export-record.spec.ts` — create (part 1: the trace endpoint and export schema; the record screen is added in Phase 11)
**Commands (in order, from repo root):** none.
**Implementation notes:** The E2E server's `after()` drain processes `score_run` immediately; the test polls `GET /runs/{id}` until `scored` with a 20 s timeout and asserts under 5 s elapsed from completion.
**Secrets (if any):** none.
**Tests to write:** the two specs above.
**Verify (all must pass):**
```bash
pnpm test:e2e -- tests/e2e/walkthrough/11-scoring-debrief.spec.ts tests/e2e/walkthrough/14-export-record.spec.ts
```
**Commit:** `test(e2e): scoring and export reachable end to end`
**Rollback:** `git checkout -- tests`

## Phase exit criteria

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm test:e2e && pnpm evals && pnpm build && pnpm openapi:check && pnpm exec tsx scripts/bundle-budget.ts
```

Requirement IDs now fully implemented: FR-004, FR-054, FR-063, FR-064, FR-075, FR-082, FR-083, FR-086, FR-087, FR-109, FR-125, FR-130 to FR-139, FR-141, FR-142, FR-143, FR-202, FR-203, FR-240 to FR-243, DATA-041, DATA-042, DATA-053, NFR-001 (mock), NFR-012. Partially: FR-005 (faculty entry point in Phase 11), FR-140 (manual banding UI in Phase 11), AI-003 (real provider in Phase 14), SYS-010 (UI in Phase 11), FR-212 (graphs shown on screens in Phase 11).
