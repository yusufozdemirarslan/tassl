# Phase 5 — Scenario Packages

**Purpose / Read this when:** courses exist (Phase 4) and the scenario package model must become real: validation rules, import and export, element confirmation, version freezing, the fixture package, the package and claim object views, and the confirmation workspace. Generation itself (AI-001) arrives in Phase 12; this phase makes hand-authored and imported packages complete.

**Requirements covered:** FR-011, FR-021, FR-027, FR-028, FR-030, FR-057, FR-082, FR-093, FR-114, FR-180 (package and claim views), FR-185, FR-190 (create from seed without generation), FR-192, FR-193, FR-194, FR-195, FR-196, FR-197, SYS-024 (part 2), SYS-026, UI-040, UI-041, UI-043, UI-044, DATA-012 to DATA-026; decisions D-010, D-032, D-081, D-083.

## Goal

`pnpm db:seed` loads the Meridian Roast fixture package (both variants, confirmed) and three assignments; an author can create a package from a seed, edit and confirm every element, freeze the version, and see the package and claim object views.

## Prerequisites

- Phase 4 exit criteria pass.
- Read `10-backend-spec-modules.md` §4, `06-data-model.md` §3.3, `07-api-spec.md` §6, `09-frontend-spec-screens.md` §UI-040 to UI-044.

## Steps

### Step 5.1 — Package schemas and `validatePackage`
**Goal:** Zod schemas for every element and the export format; the pure validator with every rule in `10-backend-spec-modules.md` §4.
**Covers:** FR-021, FR-030, FR-057, FR-193, FR-194, SYS-026
**Prerequisites:** Phase 4 complete
**Files to create / modify:**
- `src/server/modules/scenarios/schema.ts` — create; element schemas, `PackageExportSchema`, `CreatePackageFromSeedSchema`, enums
- `src/server/modules/scenarios/validate.ts` — create; `validatePackage(version): { ok, failures: [{ code, elementIds, message }] }`
- `src/lib/words.ts` — create; `countWords`, `stripMarkup`, `wordLimit(n)` (D-075)
- `src/lib/sentences.ts` — create; `countSentences` (for the three-sentence counterfactual)
**Commands (in order, from repo root):** none.
**Implementation notes:** Every rule code from the table, each with a positive and a negative unit test. The readiness rule checks that no item stem contains eight or more consecutive words of any claim text (`authoring/checks.ts` `noItemNamesAClaim`, created here and reused by Phase 12).
**Secrets (if any):** none.
**Tests to write:**
- `tests/unit/lib/words.test.ts` — token counting, markup stripping, limits.
- `tests/unit/scenarios/validate.test.ts` — one test per rule code (pass and fail).
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test -- tests/unit/lib/words.test.ts tests/unit/scenarios/validate.test.ts
```
**Commit:** `feat(scenarios): element schemas and validatePackage`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 5.2 — Scenarios service, import and export, confirmation, freezing
**Goal:** Every function in `10-backend-spec-modules.md` §4 with its router and actions.
**Covers:** FR-011, FR-027, FR-028, FR-082, FR-093, FR-114, FR-180, FR-185, FR-190, FR-192, FR-195, FR-196, FR-197, SYS-026
**Prerequisites:** Step 5.1 complete
**Files to create / modify:**
- `src/server/modules/scenarios/{service,repository,router,actions,index,errors}.ts` — create or complete
- `src/server/auth/student-view.ts` — create; `STUDENT_FORBIDDEN_KEYS_ALWAYS`, `STUDENT_FORBIDDEN_KEYS_BEFORE_SCORED` (D-117)
- `src/app/api/v1/institutions/[orgId]/packages/route.ts`, `.../packages/import/route.ts`, `src/app/api/v1/packages/[packageId]/route.ts`, `src/app/api/v1/package-versions/[versionId]/route.ts`, `.../export/route.ts`, `.../claims/[claimId]/route.ts`, `.../elements/[elementType]/[elementId]/route.ts`, `.../elements/[elementType]/[elementId]/decision/route.ts`, `.../confirm/route.ts`, `.../regenerate/route.ts` — create (the `generation` routes arrive in Phase 12)
**Commands (in order, from repo root):** none.
**Implementation notes:** `confirmVersion` writes the snapshot and the audit row and refuses on any unconfirmed element, unchecked teaching note, or validation failure. `regenerateVersion` copies every element with new ids into version n+1. `getStudentScenario` returns only brief, documents, and named fields. `getClaimObject` is reviewer and author only. The seed record is omitted for TAs and students.
**Secrets (if any):** none.
**Tests to write:**
- `tests/integration/scenarios/lifecycle.test.ts` — create from seed → elements unconfirmed → decide each → confirm → frozen (edit refused) → regenerate creates version 2 draft with new claim ids.
- `tests/integration/scenarios/import-export.test.ts` — import the fixture JSON, export, deep-equal on element keys and fields.
- `tests/integration/api/packages.test.ts` — every endpoint in `07-api-spec.md` §6 except generation; matrix rows (student 403 on claim object view; TA no seed record).
- `tests/integration/security/student-view-invariants.test.ts` — create; the package projection for students has none of the forbidden keys (extended in later phases for runs).
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test:integration -- tests/integration/scenarios tests/integration/api/packages.test.ts tests/integration/security tests/integration/auth/matrix.test.ts && pnpm openapi:generate && pnpm openapi:check
```
**Commit:** `feat(scenarios): package service, import and export, confirmation, freezing`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 5.3 — Fixture package and seed assignments
**Goal:** The Meridian Roast fixture (PRD §6, both variants) exists as a complete package JSON that passes validation; the seed imports it confirmed and creates the three walkthrough assignments.
**Covers:** SYS-024, FR-193, FR-235, D-040
**Prerequisites:** Step 5.2 complete
**Files to create / modify:**
- `src/server/db/fixtures/meridian-roast.package.json` — create; brief (≤ 200 words), 9 documents (roles: one superseded positioning deck superseded by the retention memo, one interpretation-as-fact founder note, one accurate-and-irrelevant supplier contract, six supporting), 3 stakeholders with a contradiction pair, answer space (two defensible positions: hold spend in the value tier; shift a bounded share to premium; one evidence-inconsistent: move 60 percent on the 11-month payback; the minimum commitment), named fields (`budget_share_to_premium` percent, `premium_payback_months` months), 8 claims with per-variant states (planted `C3` "Premium payback is 11 months" stale-evidence with a Source Trace path to the deck dated 2025-02-10 in the defective variant and sound in the sound variant; a weakly sourced sound claim whose trace changes a stance; an escalatable claim about survey error with an authored reply; two low-stakes sound claims warranted Accept; one load-bearing sound claim warranted Verify; a claim with a Replication Check path "cohort comparison"; a Sycophancy Probe on "the value tier is saturated"), Turn (stakeholder message: premium pilot month-three retention is 61 percent not 78; delay 90 s; warrants `revise`; disrupted assumption keys), question bank (per claim provenance and verification; three assumption questions; confidence; frame vs response; one counterfactual on `premium_payback_months` with a 20 percent worse churn; six defaults), three-sentence counterfactual, 16 readiness items (6/4/6), working clock 1500 s, difficulty estimate, general escalation reply, seed record for the fixture (case title "Meridian Roast (fixture)", publisher "Tassl", license terms "internal fixture", re-skin log with three entries)
- `src/server/db/seed.ts` — modify; items 4–5 of `06-data-model.md` §5 (import with `confirmOnImport: true` by `instructor@tassl.local`; three assignments)
- `tests/e2e/global-setup.ts` — modify; rely on the seed (remove the factory package)
**Commands (in order, from repo root):**
```bash
pnpm db:reset -- --dev
```
**Implementation notes:** The fixture is the PRD's illustrative scenario written as data; the walkthrough uses the generated package later, so the fixture must be internally consistent but need not be pedagogically calibrated. Numbers are chosen so the Section 6 arithmetic (8 false alarms over 11 claims) can be reproduced by test fixtures that add three low-stakes claims; the package itself has 8 claims.
**Secrets (if any):** none.
**Tests to write:**
- `tests/unit/scenarios/fixture.test.ts` — the fixture passes `validatePackage` with zero failures; both variants have 8 states; exactly one planted claim.
- `tests/integration/db/seed.test.ts` — modify; three assignments exist; the package version is confirmed with 60+ confirmation rows.
**Verify (all must pass):**
```bash
pnpm test -- tests/unit/scenarios/fixture.test.ts && pnpm test:integration -- tests/integration/db/seed.test.ts
```
**Commit:** `feat(seed): meridian roast fixture package and walkthrough assignments`
**Rollback:** `git checkout -- . && git clean -fd && pnpm db:reset -- --dev`

### Step 5.4 — Packages list, new-from-seed, and version view screens
**Goal:** UI-040, UI-041, UI-044 through the Impeccable loop (UI-041 creates the package and shows "Generation arrives in a later phase; edit elements by hand or import" until Phase 12 adds generation).
**Covers:** UI-040, UI-041, UI-044, FR-180, FR-190, FR-195, FR-196, FR-028
**Prerequisites:** Step 5.3 complete
**Files to create / modify:**
- `src/app/(app)/packages/page.tsx`, `src/app/(app)/packages/new/page.tsx`, `src/app/(app)/packages/[packageId]/versions/[versionId]/page.tsx` — create
- `src/components/features/packages/{seed-form,version-header,confirmation-record,authoring-measures,claims-table,claim-object-view,import-dialog}.tsx` — create
**Commands (in order, from repo root):** Impeccable loop for `/packages`, `/packages/new`, `/packages/[packageId]/versions/[versionId]`.
**Implementation notes:** The list shows warnings (`FAMILY_LACKS_ETHICAL_DEFECT`, D-083). The version view shows the `uncalibrated` chip text from `09-frontend-spec-screens.md` §UI-044. Import dialog accepts pasted JSON (`importPackage`).
**Secrets (if any):** none.
**Tests to write:**
- `tests/unit/components/packages/seed-form.test.tsx` — license checkbox required; concept set ≥ 4.
- `tests/e2e/author/packages.spec.ts` — instructor creates a package from a seed (no generation), imports the fixture JSON as a second package, opens the version view and a claim object view.
- `tests/e2e/a11y/author.spec.ts` — axe on the three routes.
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test -- tests/unit/components/packages && pnpm test:e2e -- tests/e2e/author/packages.spec.ts tests/e2e/a11y/author.spec.ts
```
**Commit:** `feat(packages): list, new from seed, version and claim object views`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 5.5 — Element confirmation workspace
**Goal:** UI-043 through the Impeccable loop: edit, confirm, reject, and confirm the version.
**Covers:** UI-043, FR-192, FR-027 (teaching-note check)
**Prerequisites:** Step 5.4 complete
**Files to create / modify:**
- `src/app/(app)/packages/[packageId]/versions/[versionId]/confirm/page.tsx` — create
- `src/components/features/packages/{element-list,element-editor,confirm-bar}.tsx` and per-type editors under `element-editors/` — create
**Commands (in order, from repo root):** Impeccable loop for the confirm route.
**Implementation notes:** `opened_at` is captured when an element is selected and sent with the decision (FR-198 measures). Regenerate buttons are hidden until Phase 12 (the capability flag `canRegenerate` is false). Validation failures render inline with the rule text from the table.
**Secrets (if any):** none.
**Tests to write:**
- `tests/unit/components/packages/element-editor.test.tsx` — per-type validation messages (document word limit, item options count).
- `tests/e2e/author/confirm-workspace.spec.ts` — on a package created from a seed with elements imported by hand, confirm every element, tick the teaching-note check, confirm the version, verify it is frozen (edit refused).
- `tests/e2e/a11y/author.spec.ts` — modify; add the confirm route.
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test -- tests/unit/components/packages && pnpm test:e2e -- tests/e2e/author
```
**Commit:** `feat(packages): element confirmation workspace`
**Rollback:** `git checkout -- . && git clean -fd`

## Phase exit criteria

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm test:e2e && pnpm build && pnpm openapi:check && npx impeccable@3.6.1 detect --json . > impeccable-report.json && node scripts/impeccable-gate.mjs impeccable-report.json .impeccable/config.json
```

Requirement IDs now fully implemented: FR-011, FR-021, FR-027, FR-028, FR-030, FR-057, FR-082, FR-093, FR-114, FR-185, FR-192, FR-193, FR-194, FR-195, FR-196, FR-197, FR-200, SYS-024, SYS-026, UI-040, UI-043, UI-044, DATA-012 to DATA-026. Partially: FR-180 (replay in Phase 11), FR-190 and UI-041 (generation in Phase 12).
