# Phase 12 — AI-Assisted Authoring Pipeline

**Purpose / Read this when:** the run loop is complete (Phase 11) and the scenario must be producible from a seed case: the seven generation steps as jobs on the mock provider, per-step validation and retry with the failed rule restated, element regeneration, the warranted-stance table, the authoring record and operating measures, the generation progress screen, and the authoring evals. The real provider arrives in Phase 14; this phase makes the pipeline complete and testable without a key.

**Requirements covered:** FR-190, FR-191, FR-194, FR-198, FR-199 (import path already), AI-001, AI-005 (mock path), UI-041 (generation start), UI-042, UI-043 (regenerate), DATA-027, AN-001; decisions D-032, D-063, D-083.

## Goal

"Create and generate" on a seed produces a complete draft package that passes `validatePackage` on the mock provider, every element can be regenerated or edited, confirmation freezes the version, and the measures are recorded.

## Prerequisites

- Phase 11 exit criteria pass.
- Read `10-backend-spec-modules.md` §5, `11-llm-integration.md` §2.1 (generation prompts), §5 (authoring evals).

## Steps

### Step 12.1 — Generation prompts, warranted-stance table, mock generation
**Goal:** The seven `gen-*` prompts with input and output schemas, `proposeWarrantedStance`, and the mock generation that passes validation.
**Covers:** AI-001, AI-005, FR-191, D-032, D-063
**Prerequisites:** Phase 11 complete
**Files to create / modify:**
- `src/server/llm/prompts/gen-{reskin-brief-stakeholders,documents,answer-space-fields,claims-states,turn-probe,question-bank-and-counterfactual,readiness-items}.ts` — create
- `src/server/modules/authoring/warranted-stance.ts` — create; the D-032 table
- `src/server/llm/providers/mock/generation.ts` — complete; deterministic package from `hash(seedText)` (Halden Roastworks) that passes every rule
- `src/server/modules/authoring/checks.ts` — complete; `noItemNamesAClaim`
**Commands (in order, from repo root):** none.
**Implementation notes:** Output schemas enforce counts and enums (6–12 documents, 6/4/6 items, ≥ 6 claims, 60–120 s delay, three-sentence counterfactual). Every untrusted field (seed text, documents) is wrapped with `untrusted()`.
**Secrets (if any):** none.
**Tests to write:**
- `tests/unit/authoring/warranted-stance.test.ts` — every row of the table.
- `tests/unit/llm/mock-generation.test.ts` — the mock output for two seeds passes `validatePackage`; titles differ; numbers derive from the seed hash.
- `tests/unit/authoring/prompts.test.ts` — each prompt's example input renders with delimiters and its example output validates.
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test -- tests/unit/authoring tests/unit/llm/mock-generation.test.ts
```
**Commit:** `feat(authoring): generation prompts, warranted-stance table, mock generation`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 12.2 — Authoring service and generation jobs
**Goal:** `startGeneration`, `runGenerationStep`, `getGenerationStatus`, `regenerateElement`, `computeAuthoringMeasures` with routes and actions.
**Covers:** FR-190, FR-191, FR-194, FR-198, AI-001, DATA-027, AN-001
**Prerequisites:** Step 12.1 complete
**Files to create / modify:**
- `src/server/modules/authoring/{schema,service,repository,router,actions,index,errors}.ts` — create or complete
- `src/server/jobs/handlers/generate-package-step.ts` — create; registered
- `src/app/api/v1/package-versions/[versionId]/generation/route.ts` (POST start with `export const maxDuration = 300`, GET status), `.../elements/[elementType]/[elementId]/regenerate/route.ts` — create
- `src/server/modules/scenarios/service.ts` — modify; `getPackageVersion` includes `measures` and `authoringRecord`
- `src/lib/analytics/events.ts` — modify; `package_created_from_seed`, `generation_step_completed`, `element_decided`, `package_confirmed` with the AN-001 properties from `17-analytics-events.md`
**Commands (in order, from repo root):** none.
**Implementation notes:** Each step is one job with singleton key `generate:<versionId>:<step>`; a step replaces unconfirmed elements of its type, runs its validation subset, re-enqueues itself once with the failed rules restated on failure, marks `failed` on the second failure and notifies `generation_failed`; success enqueues the next step; step 7 success runs `validatePackage` and notifies `generation_complete` with the report. Generation never runs against a confirmed version. Measures per `10-backend-spec-modules.md` §5.
**Secrets (if any):** none.
**Tests to write:**
- `tests/integration/authoring/pipeline.test.ts` — start → seven steps succeed on mock → validation ok → `generation_complete` notification; `generation_runs` rows with tokens and pass numbers; a step forced to fail validation once (test env `MOCK_GEN_FAIL_ONCE=documents`) re-runs with `pass_number 2` and the failed rule in the prompt input; twice → `failed` and `generation_failed`.
- `tests/integration/authoring/regenerate.test.ts` — regenerating documents replaces the set and resets their confirmations; confirmed elements are untouched.
- `tests/integration/authoring/measures.test.ts` — edit rate, rejected share, passes, review time, seed-to-confirmed.
- `tests/integration/api/authoring.test.ts` — endpoints and matrix rows (editor may start generation only with an author membership).
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test:integration -- tests/integration/authoring tests/integration/api/authoring.test.ts tests/integration/auth/matrix.test.ts && pnpm openapi:generate && pnpm openapi:check
```
**Commit:** `feat(authoring): generation pipeline jobs, retries, regeneration, measures`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 12.3 — Generation progress screen and confirmation workspace regeneration
**Goal:** UI-042 through the Impeccable loop; UI-041's "Create and generate"; UI-043's regenerate controls enabled.
**Covers:** UI-041, UI-042, UI-043, FR-191, FR-192, FR-198
**Prerequisites:** Step 12.2 complete
**Files to create / modify:**
- `src/app/(app)/packages/[packageId]/versions/[versionId]/generation/page.tsx` — create
- `src/components/features/packages/generation-progress.tsx` — create; `seed-form.tsx` — modify ("Create and generate"); `confirm-bar.tsx` — modify (regenerate enabled with the restated-rule field); `authoring-measures.tsx` — modify (live values)
**Commands (in order, from repo root):** Impeccable loop for the generation route; `/impeccable critique` and `polish` again on the confirm route.
**Implementation notes:** Poll status every 5 s while running; failed steps show the PRD rule text and a retry button; validation failures link to the element in the confirmation workspace.
**Secrets (if any):** none.
**Tests to write:**
- `tests/unit/components/packages/generation-progress.test.tsx` — step rows and retry visibility.
- `tests/e2e/author/generate-and-confirm.spec.ts` — create a package from a seed with "Create and generate"; watch the seven steps succeed; open the confirmation workspace; reject one document and regenerate it; confirm every element; tick the teaching-note check; confirm the version; open the version view and see measures and the authoring record.
- `evals/authoring/cases/*.json`, `evals/authoring/check.ts` — the three seed cases from `11-llm-integration.md` §5.
- `tests/e2e/a11y/author.spec.ts` — modify; generation route.
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test -- tests/unit/components/packages && pnpm test:e2e -- tests/e2e/author tests/e2e/a11y/author.spec.ts && pnpm evals
```
**Commit:** `feat(packages): generation progress screen and regeneration controls`
**Rollback:** `git checkout -- . && git clean -fd`

## Phase exit criteria

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm test:e2e && pnpm evals && pnpm build && pnpm openapi:check && npx impeccable@3.6.1 detect --json . > impeccable-report.json && node scripts/impeccable-gate.mjs impeccable-report.json .impeccable/config.json
```

Requirement IDs now fully implemented: FR-190, FR-191, FR-194, FR-198, FR-199, UI-041, UI-042, DATA-027, AN-001 (events). Partially: AI-001 and AI-005 (real provider in Phase 14).
