# 14 — Testing Strategy

**Purpose / Read this when:** you write any test, set up test tooling, or need the coverage gates a phase must meet. Every step's "Tests to write" and "Verify" blocks follow this file.

**Requirements covered:** NFR-004, NFR-005, NFR-006, NFR-010, NFR-012, FR-250 to FR-254; enforces every FR through the coverage rules below. Decisions D-064, D-072, D-073, D-085.

## 1. Pyramid

| Level | Tool | What belongs here | Runs where |
|---|---|---|---|
| Unit | Vitest 4.1.11 (`--project unit`, jsdom) + Testing Library | Pure functions: word counting, clock arithmetic, state machine, trigger matching, numeric guard, defense selection, graph builders, facts, band rules, points, validators, view mappers, i18n; React components in isolation (claim card, graph frame, forms with react-hook-form) | `pnpm test`; PR job `unit` |
| Integration | Vitest (`--project integration`, node) against real Postgres | Services + repositories end to end in a transaction per test; every `/api/v1` endpoint through `defineRoute` with a fake session; jobs handlers; auth matrix; immutability grants; export schema; student-view invariants; query plans | `pnpm test:integration`; PR job `integration` (service container) |
| E2E | Playwright 1.62.1 + `@axe-core/playwright` 4.13.0 | Every PRD user flow through the browser against `next start` with the seeded test DB and the mock provider: the walkthrough steps 1–17 on both variants, auth flows, authoring flow, admin; one axe test per screen; keyboard-only run | `pnpm test:e2e`; PR job `e2e` (chromium in CI; all three browsers nightly by `workflow_dispatch`) |
| HTTP mocking | MSW 2.15.0 | Unit tests of the openai-compatible and anthropic adapters (request shape, headers, streaming, repair retry) and of PostHog/Resend clients; never in integration tests of services (they use the mock provider) | unit |
| Evals | `pnpm evals` | Golden datasets for AI-001 to AI-005 and rubric placements (`11-llm-integration.md` §5) | PR job `unit` runs `pnpm evals` on mock |
| Performance | Lighthouse CI 0.15.1 | Web-vitals and bundle budgets (`16-performance-a11y-budgets.md`) | PR job `lhci` |
| Load | k6 | Phase 15 only (`scripts/load/run-loop.js`) | manual |

## 2. Tooling and configuration

- `vitest.config.ts` and `playwright.config.ts`: `04-repo-structure.md` §9.
- `tests/setup/unit.ts`: `@testing-library/jest-dom/vitest`, MSW server `beforeAll/afterEach/afterAll`, `vi.useFakeTimers({ now: FROZEN_TIME })` opt-in helper `withFrozenTime()`, i18n loaded.
- `tests/setup/integration.ts`: connects to `TEST_DATABASE_URL`, runs `drizzle-kit migrate` once per worker (`fileParallelism: false`), creates the `tassl_app` role if missing, and wraps every test in a transaction that is rolled back (`beginTest()/rollbackTest()`); tests that need commit semantics (jobs, immutability grants) use `truncateAll()` in `afterEach` instead and are tagged `// @db:truncate`.
- Fake session: `asUser(factory.user({ role }))` returns headers with a real Better Auth session created through `auth.api.signInEmail` against the test DB (no cookie forging).
- MSW handlers in `tests/setup/msw/`: `mimo.ts` (chat completions with streaming and a JSON-mode path), `anthropic.ts`, `resend.ts`, `posthog.ts`.
- Playwright: `tests/e2e/fixtures.ts` provides `signInAs('student1' | 'student2' | 'instructor' | 'editor' | 'admin')` using the seed accounts and `SEED_PASSWORD`; `runToState(runId, state)` drives a run quickly through the API for tests that start mid-flow; `advanceClock(runId, ms)` calls the test-only endpoint `POST /api/v1/test/runs/{id}/advance-clock` which exists only when `APP_ENV=test` (it shifts `working_started_at` back by `ms` so timers materialize without waiting; it is not a product feature and is excluded from the OpenAPI document).

## 3. Coverage gates

| Gate | Threshold | Enforced by |
|---|---|---|
| Lines on `src/server/**` | ≥ 80 % | `vitest --coverage` thresholds in the `unit` job (unit + integration combined via `pnpm test:coverage`) |
| Lines on `src/components/**` | ≥ 70 % | same |
| API endpoints with an integration test | 100 % | `tests/integration/api/coverage.test.ts` reads the OpenAPI registry and asserts every `operationId` appears in `tests/integration/**` (grep on `op('<operationId>')` helper) |
| PRD user flows with an E2E test | 100 % | `tests/e2e/coverage.test.ts` asserts every flow id in `tests/e2e/flows.json` (the flows of `01-prd-analysis.md` §6 plus auth, authoring, admin) has a spec file |
| Screens with an axe test | 100 % of UI-### | `tests/e2e/a11y/coverage.test.ts` checks `tests/e2e/a11y/screens.json` lists every UI id from `COVERAGE.md` and each has a spec |
| Evals on mock | 100 % | `pnpm evals` exit code |
| Student-view invariants | zero forbidden keys | `tests/integration/security/student-view-invariants.test.ts` |

## 4. Conventions

- Files: `tests/unit/<module>/<subject>.test.ts(x)`, `tests/integration/<module>/<subject>.test.ts`, `tests/e2e/<area>/<flow>.spec.ts`. One subject per file.
- Arrange-act-assert with blank lines between the three parts; one behavior per `it`; names read as sentences: `it('refuses the lock and names the first unstanced relied-on claim')`.
- No network in unit tests (MSW `onUnhandledRequest: 'error'`).
- Integration tests use the real Postgres, the mock provider, the console email transport, and no PostHog/Sentry keys.
- Determinism: ids from `uuidFrom(label)` (UUID v5 of the label in the Tassl namespace); time frozen at `2026-09-01T09:00:00Z` with `vi.setSystemTime`; the mock provider is deterministic; `Math.random` is never used in product code paths that tests observe (use `hash()`-seeded PRNG).
- Every E2E spec ends with an axe scan of the last screen it reached, in addition to the per-screen a11y suite.
- Tests assert on error codes, not messages.
- A test that needs a fixture package uses `factory.package.meridianRoast()` (the seed package) or `factory.package.minimal(overrides)` (the smallest package that passes `validatePackage`).

## 5. Test data

Factories (`tests/factories/`): `user`, `institution`, `course`, `section`, `assignment`, `package` (with `withVariants`, `withPlanted(family)`, `withProbe`), `run` (with `atState(state)` which replays the exact event sequence a real run would write, so every read model and trace stays consistent), `events` (builders for each event type). Factories write through repositories, never raw SQL, except `truncateAll`.

Seed (`pnpm db:seed`) provides the walkthrough institution, course, section, seat accounts, and the fixture package with three assignments (`06-data-model.md` §5); E2E relies on it.

Scoring fixtures (`tests/fixtures/scoring/*.json`): complete event lists for the PRD placements (`accept-everything-defective`, `accept-everything-sound`, `both-defects-escalated`, `outside-answer-space`, `marco-8-of-11`, `nadia-run-one`, `implicit-hold-no-change`, `implicit-hold-change-warranted`, `full-reversal-marginal`, `hold-with-reason`, `nothing-answered`, `stance-records-lost-third`, `stance-records-lost-half`), reused by unit tests and evals.

## 6. What each level must cover (by module)

| Module | Unit | Integration | E2E |
|---|---|---|---|
| lib | words, errors, flags, i18n keys exist for every `t()` call (a test walks the source) | — | — |
| identity | view mappers | me, export (rate limit), delete → purge job repoint | settings, export download, delete account |
| tenancy | access-control roles | invitations, `canReadIdentifiedRecords` with and without agreement | invite → accept |
| courses | mapping validation, `previewMappingChange` arithmetic | all endpoints; `ASSIGNMENT_IN_USE`; recompute job | course create, roster, assignment config |
| scenarios | `validatePackage` every rule (positive and negative), snapshot builder, student view | import fixture, confirm version (frozen trigger), regenerate, claim view permissions | package view, claim object view |
| authoring | warranted-stance table, step input builders | pipeline on mock end to end, retry on failed rule, measures | new package from seed → generation → confirm |
| runs | clock, state machine (every transition and every illegal pair), timers materialization (auto-lock, Turn delivery, window expiry, offline delivery), readiness concept map | start, policy, readiness submit/skip/expiry, documents, frame, lock gate, addendum, void/re-offer, forced failure | walkthrough steps 2–5, 7, 8, 15 |
| assistant | trigger matching (phrases, token sets, normalization), numeric guard, marker assembly, defect-word filter | delegate on mock (stream, claims surfaced, event), forced failure → paused → resume credit, used marks, declaration | step 6 |
| reliance | relied-on detection (named fields tolerance), lock-gate ordering | stances (both kept), actions (cost, results, expiry rule), escalations (limit, general reply) | step 6, 8 |
| defense | selection for every condition and the fill rule, follow-up trigger, verbatim-brief rule, template rendering | open, answer, follow-up insertion, complete → job enqueued | step 10 |
| trace | export schema, two forms differ only by the three keys, sequence gaplessness | append under concurrency (two parallel writers), grants (no UPDATE/DELETE), regenerate graphs from export equals stored graphs | step 14 |
| scoring | every graph builder against fixtures (numbers), facts, band rules for every rubric placement (FR-139), points (mean, null, exclusion), neutralization floor | `score_run` job on mock, held path when reads fail, stance-record loss paths | step 11 |
| review | capability rules | decide, confirm-all, TA lock, neutralize → recompute → re-export, manual banding | steps 12, 15, 17 |
| debrief | section order, done-well selection, forbidden words | get (events written once per version), answer → recorded | step 13 |
| records | record form omits points | exports versioned, record export | step 14 |
| notifications, admin | — | notify + email copy job, role set revokes sessions, audit rows | notifications page, admin pages |
| llm | structuredViaPrompt (parse, repair, fail), budgets, circuit breaker, redact, adapters via MSW | `llm_calls` rows written for every call | — |
| jobs | drain ordering, singleton keys | pgboss migrate, queues exist, `/api/internal/jobs/drain` auth | — |
| a11y | graph frame renders table and description | — | axe on every screen; keyboard-only run |

## 7. E2E walkthrough suite

`tests/e2e/walkthrough/` mirrors PRD §12 steps: `01-package.spec.ts`, `02-05-start-to-frame.spec.ts`, `06-working-period.spec.ts`, `07-forced-failure.spec.ts`, `08-lock.spec.ts` (including the two-minute auto-lock run using `advanceClock`), `09-turn.spec.ts`, `10-defense.spec.ts`, `11-scoring-debrief.spec.ts`, `12-faculty-replay.spec.ts`, `13-debrief-confirmed.spec.ts`, `14-export-record.spec.ts`, `15-neutralize-void.spec.ts`, `16-sound-variant.spec.ts` (seats swapped: student2 and instructor), `17-standing-rules-a11y.spec.ts` (unassessed recompute; keyboard-only completion; screen-reader structure checks; graph data tables). Each spec asserts the PRD's observable outcomes (FR-252, FR-253) and runs with `FEATURE_TEST_CONTROLS=true`, `FEATURE_AI=false`.

## 8. Verify blocks

Every phase step's Verify block uses only: `pnpm lint`, `pnpm typecheck`, `pnpm test [-- <path>]`, `pnpm test:integration [-- <path>]`, `pnpm test:e2e [-- <path>]`, `pnpm evals`, `pnpm build`, `pnpm openapi:check`, `curl` against `localhost:3000`, and `docker compose` commands. Phase exit criteria always run the full `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm test:e2e`.
