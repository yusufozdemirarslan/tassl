# Phase 4 — Courses and Assignments

**Purpose / Read this when:** auth and tenancy work (Phase 3) and instructors need courses, sections, rosters, assignments, and the policy display configuration the run start screen shows.

**Requirements covered:** FR-200, FR-201 (service side), FR-205, UI-030, UI-031, UI-032 (configuration part; the runs table fills in Phase 6), SYS-005 (roster), DATA-008 to DATA-011; decisions D-061, D-062, D-104.

## Goal

An instructor can create a course with policy, mapping, and weights, add sections and members, and configure an assignment on a confirmed package version (the fixture package arrives in Phase 5; until then assignment creation is exercised by integration tests with a factory package).

## Prerequisites

- Phase 3 exit criteria pass.
- Read `10-backend-spec-modules.md` §3, `07-api-spec.md` §5, `09-frontend-spec-screens.md` §UI-030 to UI-032.

## Steps

### Step 4.1 — Courses module: schemas, service, repository, router, actions
**Goal:** Every function in `10-backend-spec-modules.md` §3 except `changeMapping`, `previewMappingChange`, `recomputeExports`, and `listAssignmentRuns` (Phase 11 and Phase 6).
**Covers:** FR-200, FR-205, SYS-005, DATA-008 to DATA-011
**Prerequisites:** Phase 3 complete
**Files to create / modify:**
- `src/server/modules/courses/{schema,service,repository,router,actions,index,errors}.ts` — create or complete
- `src/app/api/v1/institutions/[orgId]/courses/route.ts`, `src/app/api/v1/courses/[courseId]/route.ts`, `.../courses/[courseId]/sections/route.ts`, `src/app/api/v1/sections/[sectionId]/members/route.ts`, `.../members/[userId]/route.ts`, `src/app/api/v1/sections/[sectionId]/assignments/route.ts`, `src/app/api/v1/assignments/[assignmentId]/route.ts`, `.../policy-display/route.ts` — create
- `src/lib/errors.ts` — modify; add the module codes
- `tests/factories/package.ts` — create; `minimal()` builds the smallest package version that passes `validatePackage` (the validator itself is Phase 5; the factory writes a confirmed version directly through repositories so assignments can reference it now)
**Commands (in order, from repo root):** none.
**Implementation notes:** `createAssignment` requires a confirmed version (`PACKAGE_NOT_CONFIRMED`) and a matching variant (`VARIANT_MISMATCH`); `updateAssignment` refuses structural changes once a non-voided run exists (`ASSIGNMENT_IN_USE`); `getPolicyDisplay` composes course and assignment values with `uncalibrated: true` and the counts statement key; `addSectionMember` requires an existing organization member; `removeSectionMember` refuses when runs exist. Every list endpoint paginates.
**Secrets (if any):** none.
**Tests to write:**
- `tests/unit/courses/mapping.test.ts` — `MappingSchema` accepts four positives, rejects zero and negatives.
- `tests/integration/courses/service.test.ts` — create course (instructor), refuse (student); sections; add and remove members; assignment creation on a confirmed version, refused on a draft; `ASSIGNMENT_IN_USE` after a run exists (factory run); policy display values.
- `tests/integration/api/courses.test.ts` — every endpoint in `07-api-spec.md` §5 except runs and exports; matrix rows appended to `tests/integration/auth/matrix.json`.
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test -- tests/unit/courses && pnpm test:integration -- tests/integration/courses tests/integration/api/courses.test.ts tests/integration/auth/matrix.test.ts && pnpm openapi:generate && pnpm openapi:check
```
**Commit:** `feat(courses): courses, sections, roster, assignments, policy display`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 4.2 — Courses screens (list, detail, policy, mapping editor without apply)
**Goal:** UI-030 built through the Impeccable loop; the mapping editor previews nothing yet and only saves the mapping on courses with no confirmed runs (apply-with-recompute arrives in Phase 11).
**Covers:** UI-030, FR-200, FR-205
**Prerequisites:** Step 4.1 complete
**Files to create / modify:**
- `src/app/(app)/courses/page.tsx`, `src/app/(app)/courses/[courseId]/page.tsx` — create
- `src/components/features/courses/{course-form,policy-form,mapping-editor,sections-list,assignments-list}.tsx` — create
- `src/lib/i18n/en-US.ts` — modify; course strings including the plain-language policy descriptions (Open, Declared, In-Environment Only) from PRD §7.19
**Commands (in order, from repo root):** Impeccable loop for `/courses` and `/courses/[courseId]` (`shape`, build, `critique`, `audit`, `harden`, `polish`).
**Implementation notes:** The mapping editor's "Apply" is disabled with the sentence "Recomputation of confirmed runs arrives with review" until Phase 11 replaces it; saving the mapping is allowed only when the course has no confirmed runs (`updateCoursePolicy` accepts `mapping` under that condition, refusing with `MAPPING_CHANGE_UNCONFIRMED` otherwise).
**Secrets (if any):** none.
**Tests to write:**
- `tests/unit/components/courses/mapping-editor.test.tsx` — four inputs; invalid values show inline errors.
- `tests/e2e/instructor/courses.spec.ts` — instructor creates a course, adds a section, sets policy; student cannot open `/courses/[id]` of a course they are not in (404 page).
- `tests/e2e/a11y/instructor.spec.ts` — axe on `/courses` and `/courses/[courseId]` (extended in later steps).
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test -- tests/unit/components/courses && pnpm test:e2e -- tests/e2e/instructor/courses.spec.ts tests/e2e/a11y/instructor.spec.ts
```
**Commit:** `feat(courses): course list and detail screens`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 4.3 — Section roster screen
**Goal:** UI-031 built through the Impeccable loop.
**Covers:** UI-031, SYS-005
**Prerequisites:** Step 4.2 complete
**Files to create / modify:**
- `src/app/(app)/courses/[courseId]/sections/[sectionId]/roster/page.tsx` — create
- `src/components/features/courses/section-roster.tsx` — create
**Commands (in order, from repo root):** Impeccable loop for the roster route.
**Implementation notes:** Adding an email that is not an institution member shows the inline "Invite to institution" action that opens the invitation form (`inviteMemberAction`); pending invitations are listed with expiry.
**Secrets (if any):** none.
**Tests to write:**
- `tests/e2e/instructor/roster.spec.ts` — add `student2@tassl.local` to section A, remove, re-add; invite an unknown email and see it pending.
- `tests/e2e/a11y/instructor.spec.ts` — modify; add the roster route.
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test:e2e -- tests/e2e/instructor/roster.spec.ts tests/e2e/a11y/instructor.spec.ts
```
**Commit:** `feat(courses): section roster screen`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 4.4 — Assignment configuration screen
**Goal:** UI-032's configuration form (the runs table is added in Phase 6).
**Covers:** UI-032, FR-200
**Prerequisites:** Step 4.3 complete
**Files to create / modify:**
- `src/app/(app)/assignments/[assignmentId]/page.tsx` — create
- `src/components/features/courses/assignment-form.tsx` — create
- `src/app/(app)/courses/[courseId]/page.tsx` — modify; "New assignment" opens the form (package version select lists confirmed versions in the institution; until Phase 5 the list may be empty and the empty state says "Confirm a scenario package first")
**Commands (in order, from repo root):** Impeccable loop for `/assignments/[assignmentId]`.
**Implementation notes:** Fields per `09-frontend-spec-screens.md` §UI-032; locked fields with the `ASSIGNMENT_IN_USE` explanation; walkthrough toggle.
**Secrets (if any):** none.
**Tests to write:**
- `tests/unit/components/courses/assignment-form.test.tsx` — defaults shown from package and course; clock minimum 60.
- `tests/e2e/instructor/assignment.spec.ts` — create an assignment on the factory-confirmed version (seeded for E2E via `tests/e2e/global-setup.ts` until Phase 5 replaces it with the fixture package), edit the clock, toggle walkthrough.
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test -- tests/unit/components/courses && pnpm test:e2e -- tests/e2e/instructor
```
**Commit:** `feat(courses): assignment configuration screen`
**Rollback:** `git checkout -- . && git clean -fd`

## Phase exit criteria

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm test:e2e && pnpm build && pnpm openapi:check && npx impeccable@3.6.1 detect --json . > impeccable-report.json && node scripts/impeccable-gate.mjs impeccable-report.json .impeccable/config.json
```

Requirement IDs now fully implemented: FR-205, UI-030 (except mapping apply), UI-031, DATA-008 to DATA-011. Partially: FR-200 (assignment on the fixture package in Phase 5), FR-201 (display screen in Phase 6), UI-032 (runs table in Phase 6), FR-206 (Phase 11).
