# 04 — Repository Structure and Conventions

**Purpose / Read this when:** you create or move a file, add a dependency, write a commit, or need the exact `package.json` scripts. This is the naming, layering, and tooling contract for the whole codebase.

**Requirements covered:** SYS-017, SYS-019, SYS-021, SYS-022, SYS-023, NFR-017; supports every FR through the layering rules.

## 1. Directory tree

```
tassl/
├── .github/
│   ├── actions/setup/action.yml    # composite: pnpm/action-setup@v6, setup-node@v7 (.nvmrc, pnpm cache), pnpm install --frozen-lockfile
│   ├── branch-protection.json      # input for gh api PUT branches/main/protection (ten `checks / <job>` contexts)
│   ├── dependabot.yml              # weekly npm (grouped) and github-actions updates
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── workflows/
│       ├── checks.yml              # reusable gates: lint → typecheck → unit → integration → build → e2e → impeccable → lhci → openapi-check → security
│       ├── pr.yml                  # calls checks.yml → Neon preview branch → migrate → vercel deploy --prebuilt --env … → alias tassl-pr-<n>
│       ├── production.yml          # calls checks.yml → migrate production → vercel deploy --prebuilt --prod → smoke → sentry release
│       ├── backup.yml              # nightly pg_dump artifact (30-day retention) with Sentry cron check-ins
│       └── preview-cleanup.yml     # deletes the Neon preview branch and alias when a PR closes
├── .gitleaks.toml                  # gitleaks config; allowlists only the documented non-secret defaults
├── sentry.server.config.ts, sentry.edge.config.ts   # Sentry SDK init files (Phase 13)
├── .husky/
│   ├── pre-commit                  # lint-staged
│   └── commit-msg                  # commitlint
├── .impeccable/                    # Impeccable config, design.json, critique reports (tracked; see .gitignore block)
├── .vercel/                        # vercel link output (gitignored)
├── docs/
│   ├── prd/Tassl-PRD.md            # canonical PRD copy (never edited)
│   ├── prompts/                    # generation prompts
│   ├── tech/                       # this documentation set
│   └── TASSL-TECHNICAL-DOCUMENTATION.md  # generated single-file edition
├── drizzle/                        # SQL migrations (generated, or `drizzle-kit generate --custom` for hand-written ones) + meta/_journal.json (committed empty in Step 0.7)
├── evals/
│   ├── run.ts                      # pnpm evals entry
│   ├── config.ts                   # thresholds (mock 1.0, real 0.9)
│   ├── assistant/                  # AI-002, AI-004 golden cases
│   ├── authoring/                  # AI-001, AI-005 golden cases
│   └── scoring/                    # AI-003 and rubric placement cases
├── public/
│   ├── fonts/                      # IBM Plex Sans/Mono/Serif (self-hosted, woff2)
│   └── favicon.svg
├── scripts/
│   ├── docs-build.sh               # pnpm docs:build
│   ├── openapi-generate.ts         # writes docs/tech/openapi.yaml (--check compares)
│   ├── pgboss-migrate.ts           # creates the pgboss schema and queues
│   ├── jobs-worker.ts              # local long-running worker (boss.work)
│   ├── jobs-retry.ts               # re-enqueue a job, redrive a dead-letter queue, expire stuck jobs
│   ├── db-reset.ts                 # drop + migrate + seed (local/test only)
│   ├── db-app-role.ts              # sets the tassl_app role password from TASSL_APP_DB_PASSWORD
│   ├── revoke-sessions.ts          # incident containment: revoke sessions for one account or all
│   ├── sentry-test.ts              # launch checklist: send a test event and print its id
│   ├── bundle-budget.ts            # per-route gzip JavaScript budget over the Next build manifests
│   ├── impeccable-gate.mjs         # fails CI on any unwaived detector finding
│   ├── smoke.sh                    # post-deploy smoke test (unauthenticated)
│   ├── sentry-checkin.sh           # Sentry cron monitor check-in helper used by backup.yml and the restore drill
│   ├── init-test-db.sql            # creates the tassl_test database for the local Compose Postgres
│   ├── backup.sh                   # pg_dump wrapper used by backup.yml
│   ├── restore-drill.sh            # weekly restore drill
│   ├── load/run-loop.js            # k6 load test
│   └── load/seed-users.ts          # 60 load-test students on a preview branch (refuses production)
├── docs/incidents/TEMPLATE.md      # incident record template (records: docs/incidents/YYYY-MM-DD-<slug>.md)
├── src/
│   ├── app/                        # Next.js App Router (routes only; no business logic)
│   │   ├── (public)/               # sign-in, sign-up, verify-email, forgot/reset password, privacy, terms
│   │   ├── (app)/                  # authenticated shell: layout.tsx with nav, institution switcher
│   │   │   ├── home/
│   │   │   ├── settings/
│   │   │   ├── notifications/
│   │   │   ├── runs/[runId]/{start,readiness,work,locked,turn,defense,debrief}/
│   │   │   ├── records/[runId]/
│   │   │   ├── courses/[courseId]/sections/[sectionId]/roster/
│   │   │   ├── assignments/[assignmentId]/exports/
│   │   │   ├── review/runs/[runId]/
│   │   │   ├── packages/[packageId]/versions/[versionId]/{generation,confirm}/
│   │   │   ├── invitations/[invitationId]/
│   │   │   └── admin/{users,flags,audit}/
│   │   ├── dev/components/         # dev-only gallery (404 in production)
│   │   ├── api/
│   │   │   ├── auth/[...all]/route.ts       # Better Auth handler
│   │   │   ├── health/route.ts
│   │   │   ├── ready/route.ts
│   │   │   ├── internal/jobs/drain/route.ts # cron + after() drain (CRON_SECRET)
│   │   │   └── v1/                          # REST route handlers; one folder per resource
│   │   ├── layout.tsx, globals.css, not-found.tsx, error.tsx, global-error.tsx
│   ├── components/
│   │   ├── ui/                     # shadcn primitives (generated, then themed)
│   │   ├── features/<feature>/     # feature components (run workspace, claims panel, graphs, replay, …)
│   │   ├── graphs/                 # ConfidenceLine, ClockTimeline, StanceMatrix, FrameBesideDecision (+ DataTable, Description)
│   │   └── layout/                 # AppShell, Nav, InstitutionSwitcher, NotificationsBell
│   ├── lib/                        # isomorphic helpers (no DB, no secrets)
│   │   ├── i18n/en-US.ts, i18n/t.ts
│   │   ├── flags.ts                # typed flags from env
│   │   ├── env.public.ts           # NEXT_PUBLIC_* schema
│   │   ├── words.ts                # word counting (D-075)
│   │   ├── clock.ts                # countdown helpers (client)
│   │   ├── errors.ts               # error codes + AppError class
│   │   ├── ids.ts, dates.ts, cn.ts
│   │   └── analytics/events.ts     # typed event names + props (client + server)
│   ├── server/
│   │   ├── config.ts               # Zod-validated server env (fail fast)
│   │   ├── auth/                   # auth.ts (Better Auth), permissions.ts, access-control-shared.ts, session.ts, student-view.ts (forbidden key sets)
│   │   ├── db/                     # client.ts, schema/*.ts, seed.ts, fixtures/, pagination.ts, tx.ts
│   │   ├── http/                   # define-route.ts, define-action.ts, errors.ts, request-context.ts, readiness.ts, openapi-registry.ts
│   │   ├── logging/                # logger.ts, redaction.ts, request-id.ts, ops-events.ts (alertOps, countOps)
│   │   ├── rate-limit/             # sliding window + limits
│   │   ├── jobs/                   # boss.ts, queues.ts, handlers/*.ts, drain.ts
│   │   ├── email/                  # transport.ts, templates/*.tsx, send.ts
│   │   ├── analytics/              # posthog.ts (server), track.ts, distinct-id.ts (hashUserId)
│   │   ├── llm/
│   │   │   ├── provider.ts         # LlmProvider interface and request/result types
│   │   │   ├── registry.ts         # getProvider() + the wrapper chain (logging ← budgets ← breaker ← retries ← timeout)
│   │   │   ├── structured.ts       # structuredViaPrompt (JSON prompt + Zod + one repair retry)
│   │   │   ├── providers/{openai-compatible,anthropic,mock}/
│   │   │   ├── prompts/<name>.ts   # versioned prompts
│   │   │   ├── guardrails/         # redact, budgets, circuit breaker, numeric guard
│   │   │   └── calls.ts            # llm_calls logging
│   │   └── modules/
│   │       ├── identity/
│   │       ├── tenancy/
│   │       ├── courses/
│   │       ├── scenarios/
│   │       ├── authoring/
│   │       ├── runs/
│   │       ├── assistant/
│   │       ├── reliance/
│   │       ├── defense/
│   │       ├── trace/
│   │       ├── scoring/            # + rubric/v1.ts, graphs/*.ts
│   │       ├── review/
│   │       ├── debrief/
│   │       ├── records/            # + sample/*.json
│   │       ├── notifications/
│   │       └── admin/
│   ├── proxy.ts                    # Next 16 request proxy: optimistic auth redirect, request id, security headers
│   ├── instrumentation.ts          # Sentry server/edge registration, onRequestError
│   └── instrumentation-client.ts   # Sentry client + PostHog init
├── tests/
│   ├── setup/                      # vitest setup files, db helpers, msw server
│   ├── factories/                  # test data factories (deterministic ids, frozen time)
│   ├── unit/<module>/              # pure logic and components
│   ├── integration/<module>/       # services + repositories against Postgres; every endpoint
│   └── e2e/                        # Playwright: auth, walkthrough/*, a11y/*
├── compose.yaml                    # local Postgres 17
├── drizzle.config.ts
├── eslint.config.mjs
├── lighthouserc.json
├── next.config.ts
├── playwright.config.ts
├── postcss.config.mjs
├── prettier.config.mjs
├── commitlint.config.mjs
├── components.json                 # shadcn
├── PRODUCT.md, DESIGN.md           # Impeccable
├── tsconfig.json
├── vercel.json
├── vitest.config.ts
├── .env.example
├── .nvmrc                          # 24
├── .gitignore
├── CLAUDE.md
├── package.json
└── pnpm-lock.yaml
```

Every module folder `src/server/modules/<name>/` contains at least these files (pure helpers such as `clock.ts`, `state-machine.ts`, `triggers.ts`, `selection.ts`, `facts.ts`, `reads.ts`, `graphs/`, `rubric/`, and `sample/` may be added):

| File | Content |
|---|---|
| `schema.ts` | Zod schemas for inputs and outputs; `.meta()` for OpenAPI; exported types |
| `service.ts` | Business rules; the only place that composes repositories, other services, jobs, LLM, email |
| `repository.ts` | Drizzle queries; every tenant-scoped function takes `tenantId` first; no business logic |
| `router.ts` | Route handlers under `/api/v1`, registered with `defineRoute()` from `src/server/http` |
| `actions.ts` | Server Actions (`'use server'`) that validate with the same schemas and call the service |
| `index.ts` | Public interface: the service functions and types other modules may import |
| `errors.ts` | Module error codes (added to `src/lib/errors.ts` registry) |

## 2. Layering and import rules

`route handler / server action / server component → service → repository → db`.

- No business logic in handlers, actions, or components.
- Server Components read through services directly (`import { listRuns } from '@/server/modules/runs'`), never through `fetch` to our own API.
- UI mutations call Server Actions; programmatic access uses `/api/v1`; both call the same service function.
- A module imports another module only through its `index.ts`.
- Only `repository.ts` files import `@/server/db/client`.
- `src/lib` never imports from `src/server`.
- `src/components` may import from `src/lib`, other components, and module `schema.ts` types and `actions.ts`; never from `service.ts` or `repository.ts`.
- `src/server/llm` is imported only by `assistant`, `scoring`, and `authoring` services and by `evals/`.

Enforced by `eslint-plugin-boundaries@7.2.0` in `eslint.config.mjs`. Elements are folders (`src/app`, `src/components`, `src/lib`, one element per `src/server/modules/<name>`, `src/server/db`, `src/server/llm`, and the rest of `src/server` as `server-lib`); the role of each file inside a module (`index.ts` = public, `schema.ts`, `actions.ts`, `router.ts`, `service.ts`, `repository.ts`, anything else = internal) is a file category. `checkInternals: true` makes the rule apply inside a module too, so `repository.ts` importing `service.ts` is an error. The config is verified against fixture files that must produce exactly the expected violations (repository → service, service → db, actions → repository, index → repository, app → service, app → db, server-lib → module) and no others:

```js
// eslint.config.mjs (complete)
import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
import prettier from 'eslint-config-prettier/flat'
import boundaries from 'eslint-plugin-boundaries'

// Layering rules: docs/tech/04-repo-structure.md §2.
// Elements are folders; the per-file roles inside a module (schema/actions/router/service/
// repository/index) are file categories. Anything not explicitly allowed is an error.
const moduleFile = (categories) => ({ element: { type: 'module' }, file: { categories } })

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        { type: 'app', pattern: 'src/app', partialMatch: false },
        { type: 'components', pattern: 'src/components', partialMatch: false },
        { type: 'lib', pattern: 'src/lib', partialMatch: false },
        { type: 'module', pattern: 'src/server/modules/*', capture: ['name'], partialMatch: false },
        { type: 'db', pattern: 'src/server/db', partialMatch: false },
        { type: 'llm', pattern: 'src/server/llm', partialMatch: false },
        { type: 'server-lib', pattern: 'src/server', partialMatch: false },
      ],
      // Each module file gets exactly one category (stopMatching); everything else is internal.
      'boundaries/files': [
        { pattern: 'src/server/modules/*/index.ts', category: 'public', stopMatching: true },
        { pattern: 'src/server/modules/*/schema.ts', category: 'schema', stopMatching: true },
        { pattern: 'src/server/modules/*/actions.ts', category: 'actions', stopMatching: true },
        { pattern: 'src/server/modules/*/router.ts', category: 'router', stopMatching: true },
        { pattern: 'src/server/modules/*/service.ts', category: 'service', stopMatching: true },
        {
          pattern: 'src/server/modules/*/repository.ts',
          category: 'repository',
          stopMatching: true,
        },
        { pattern: 'src/server/modules/*/**', category: 'internal' },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          // Files inside one module are the same element; still check them (service → repository …).
          checkInternals: true,
          policies: [
            {
              from: { element: { type: 'app' } },
              allow: [
                { to: { element: { type: ['app', 'components', 'lib', 'server-lib'] } } },
                { to: moduleFile(['public', 'schema', 'actions', 'router']) },
              ],
            },
            {
              from: { element: { type: 'components' } },
              allow: [
                { to: { element: { type: ['components', 'lib'] } } },
                { to: moduleFile(['schema', 'actions']) },
              ],
            },
            { from: { element: { type: 'lib' } }, allow: [{ to: { element: { type: 'lib' } } }] },
            {
              from: { element: { type: 'module' }, file: { categories: ['actions', 'router'] } },
              allow: [
                { to: { element: { type: ['server-lib', 'lib'] } } },
                { to: moduleFile(['service', 'schema']) },
              ],
            },
            {
              from: { element: { type: 'module' }, file: { categories: ['service'] } },
              allow: [
                { to: { element: { type: ['server-lib', 'lib', 'llm'] } } },
                { to: moduleFile(['repository', 'schema', 'internal', 'public']) },
              ],
            },
            {
              from: { element: { type: 'module' }, file: { categories: ['repository'] } },
              allow: [{ to: { element: { type: ['db', 'lib'] } } }, { to: moduleFile(['schema']) }],
            },
            {
              from: { element: { type: 'module' }, file: { categories: ['public'] } },
              allow: [{ to: moduleFile(['service', 'schema']) }],
            },
            {
              from: { element: { type: 'module' }, file: { categories: ['internal'] } },
              allow: [
                { to: { element: { type: ['lib', 'server-lib', 'llm'] } } },
                { to: moduleFile(['internal', 'schema']) },
              ],
            },
            {
              from: { element: { type: 'server-lib' } },
              allow: [{ to: { element: { type: ['server-lib', 'lib', 'db'] } } }],
            },
            {
              from: { element: { type: 'llm' } },
              allow: [{ to: { element: { type: ['llm', 'lib', 'server-lib', 'db'] } } }],
            },
            {
              from: { element: { type: 'db' } },
              allow: [{ to: { element: { type: ['db', 'lib'] } } }],
            },
          ],
        },
      ],
      'react/jsx-no-literals': [
        'error',
        { noStrings: true, ignoreProps: true, allowedStrings: ['·', '—', '(', ')', ':', '/'] },
      ],
    },
  },
  {
    files: ['src/lib/i18n/**', 'src/app/dev/**', 'tests/**', 'evals/**'],
    rules: { 'react/jsx-no-literals': 'off' },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'drizzle/**',
    'coverage/**',
    'playwright-report/**',
    'test-results/**',
  ]),
])
```

The `llm` element may import `db` only for `llm_calls` logging.

## 3. Naming

| Thing | Convention | Example |
|---|---|---|
| Database tables and columns | `snake_case`, plural tables | `run_events.clock_remaining_ms` |
| TypeScript identifiers | `camelCase`; types and components `PascalCase` | `computePoints`, `StanceMatrix` |
| Files and folders | `kebab-case`; React components `kebab-case.tsx` exporting a `PascalCase` component | `stance-matrix.tsx` |
| Routes | `kebab-case`; dynamic segments `[camelCaseId]` | `/runs/[runId]/work` |
| Env vars | `SCREAMING_SNAKE_CASE`; browser-visible prefixed `NEXT_PUBLIC_` | `LLM_PROVIDER` |
| Error codes | `SCREAMING_SNAKE_CASE`, registered in `src/lib/errors.ts` | `LOCK_REFUSED_UNSTANCED_CLAIM` |
| Event types (trace) | `snake_case` per PRD §12 | `stance_set` |
| Analytics events | `snake_case` object_verb | `run_started` |
| Zod schemas | `PascalCase` + `Schema`; inferred types without suffix | `CreateCourseSchema`, `CreateCourse` |
| Test files | `<subject>.test.ts` (unit/integration), `<flow>.spec.ts` (e2e) | `lock-gate.test.ts` |
| Jobs | `snake_case` queue names | `score_run` |
| Prompts | `kebab-case` file, `name@vN` id | `band-read-framing.ts` → `band-read-framing@1` |

## 4. Error-handling conventions

- Services throw `AppError(code, message, { status, details })` from `src/lib/errors.ts`. Codes are listed per module in `10-backend-spec-modules.md` and globally in `src/lib/errors.ts`.
- Route handlers are wrapped by `defineRoute({ auth, input, output, rateLimit }, handler)` in `src/server/http/define-route.ts`, which validates input, enforces auth and rate limits, catches `AppError` and Zod errors, and returns the envelope `{ error: { code, message, details?, requestId } }` with the mapped status. Unknown errors become `INTERNAL_ERROR` (500) and are reported to Sentry with the request id.
- Server Actions return `ActionResult<T> = { ok: true, data: T } | { ok: false, error: { code, message, details?, requestId } }`; they never throw to the client.
- HTTP status mapping: validation `400 VALIDATION_ERROR`; unauthenticated `401 UNAUTHENTICATED`; forbidden `403 FORBIDDEN`; not found `404 NOT_FOUND`; state conflicts `409 <specific code>`; rate limit `429 RATE_LIMITED` with `Retry-After`; provider failures `502 LLM_PROVIDER_ERROR`; budget `402 LLM_BUDGET_EXCEEDED`.
- Never expose stack traces or SQL. Every error response carries `requestId`.

## 5. Validation conventions

- One Zod schema per input, defined in the module's `schema.ts`, used by the form (`react-hook-form` + `@hookform/resolvers/zod`), the Server Action, and the route handler.
- Word limits use `wordLimit(n)` from `src/lib/words.ts` (D-075). Text fields are trimmed; HTML is stripped (`stripMarkup`) before validation on brief and frame fields (FR-103).
- Numbers from named fields are parsed with `z.coerce.number().finite()`.

## 6. Commit messages, branches, PRs

- Conventional commits: `type(scope): message` where type ∈ `feat, fix, chore, docs, test, refactor, perf, ci, build`; scope = module or area (`runs`, `scoring`, `ci`, `docs`). Enforced by commitlint (`@commitlint/config-conventional`).
- Branch strategy: `main` is protected; work happens on `feat/<phase>-<slug>` branches; one PR per phase (or per step group when a phase is large); squash merge with the PR title as the commit message.
- Required status checks on `main` (ten, named `checks / <job>` because the gates run in the reusable workflow `checks.yml`, D-113): `checks / lint`, `checks / typecheck`, `checks / unit`, `checks / integration`, `checks / build`, `checks / e2e`, `checks / impeccable`, `checks / lhci`, `checks / openapi-check`, `checks / security`. Linear history required. No force pushes. Administrators included.
- PR checklist (in `.github/PULL_REQUEST_TEMPLATE.md`):
  - [ ] Steps referenced by `Step N.M` in the description; `PROGRESS.md` ticked
  - [ ] Every new endpoint has an integration test and appears in `openapi.yaml` (`pnpm openapi:check` passes)
  - [ ] Every new screen passed `/impeccable critique`, `audit`, `harden`, `polish` and has an axe E2E
  - [ ] New env vars added to `.env.example` and `05-environment-config.md`
  - [ ] New decisions appended to `DECISIONS.md`
  - [ ] Migrations are expand-only for this release

## 7. `package.json`

```json
{
  "name": "tassl",
  "version": "0.1.0",
  "private": true,
  "packageManager": "pnpm@11.25.0",
  "engines": { "node": ">=24.0.0 <25" },
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint . && prettier --check .",
    "lint:fix": "eslint . --fix && prettier --write .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --project unit",
    "test:watch": "vitest --project unit",
    "test:coverage": "vitest run --project unit --project integration --coverage",
    "test:integration": "vitest run --project integration",
    "test:e2e": "playwright test",
    "evals": "tsx evals/run.ts",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate && tsx scripts/pgboss-migrate.ts",
    "db:seed": "tsx src/server/db/seed.ts",
    "db:reset": "tsx scripts/db-reset.ts",
    "db:studio": "drizzle-kit studio",
    "jobs:worker": "tsx scripts/jobs-worker.ts",
    "jobs:retry": "tsx scripts/jobs-retry.ts",
    "openapi:generate": "tsx scripts/openapi-generate.ts",
    "openapi:check": "tsx scripts/openapi-generate.ts --check",
    "docs:build": "bash scripts/docs-build.sh",
    "email:dev": "email dev --dir src/server/email/templates --port 3001",
    "lhci": "lhci autorun",
    "smoke": "bash scripts/smoke.sh",
    "prepare": "husky"
  }
}
```

`scripts/docs-build.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
{ for f in docs/tech/00-README.md docs/tech/0[1-9]-*.md docs/tech/1[0-7]-*.md docs/tech/build-plan/phase-*.md docs/tech/DECISIONS.md docs/tech/COVERAGE.md; do cat "$f"; printf '\n\n---\n\n'; done; } > docs/TASSL-TECHNICAL-DOCUMENTATION.md
# The placeholder pattern is assembled from fragments so this script never contains the tokens it hunts for.
PATTERN="$(printf '%s|%s|%s|%s' 'TB''D' 'TO''DO' 'EDIT'' ME' '<you''r-')"
grep -nE "$PATTERN" docs/TASSL-TECHNICAL-DOCUMENTATION.md && { echo "FIX THESE"; exit 1; } || echo "clean"
```

## 8. Pinned versions (verified with `npm view <pkg> version` on 2026-09-02)

Runtime: Node `24` (`.nvmrc`), pnpm `11.25.0`, Postgres `17`.

**dependencies**

| Package | Version |
|---|---|
| next | 16.3.4 |
| react | 19.2.8 |
| react-dom | 19.2.8 |
| zod | 4.5.4 |
| react-hook-form | 7.87.0 |
| @hookform/resolvers | 5.9.1 |
| drizzle-orm | 0.45.2 |
| postgres | 3.4.9 |
| better-auth | 1.7.2 |
| @better-auth/drizzle-adapter | 1.7.2 |
| resend | 6.25.0 |
| @react-email/components | 1.0.12 |
| @react-email/render | 2.1.0 |
| posthog-js | 1.425.1 |
| posthog-node | 5.51.6 |
| ai | 7.0.91 |
| @ai-sdk/openai-compatible | 3.0.43 |
| @ai-sdk/anthropic | 4.0.49 |
| @ai-sdk/react | 4.0.94 |
| @sentry/nextjs | 10.73.0 |
| pino | 10.3.1 |
| pg-boss | 12.29.0 |
| zod-openapi | 6.0.2 |
| yaml | 2.9.0 |
| class-variance-authority | 0.7.1 |
| clsx | 2.1.1 |
| tailwind-merge | 3.6.0 |
| lucide-react | 1.39.0 |
| next-themes | 0.4.6 |
| sonner | 2.0.8 |
| recharts | 3.10.1 |
| date-fns | 4.4.0 |
| server-only | 0.0.1 |
| dotenv | 17.4.2 |

**devDependencies**

| Package | Version |
|---|---|
| typescript | 6.0.3 |
| @types/node | 26.4.1 |
| @types/react | 19.2.18 |
| @types/react-dom | 19.2.5 |
| tailwindcss | 4.3.3 |
| @tailwindcss/postcss | 4.3.3 |
| postcss | 8.5.26 |
| tw-animate-css | 1.4.0 |
| drizzle-kit | 0.31.10 |
| tsx | 4.23.13 |
| react-email | 6.9.3 |
| vitest | 4.1.11 |
| @vitest/coverage-v8 | 4.1.11 |
| vite | 8.2.2 |
| @vitejs/plugin-react | 6.1.1 |
| vite-tsconfig-paths | 6.1.1 |
| jsdom | 30.0.1 |
| @testing-library/react | 16.3.3 |
| @testing-library/dom | 10.4.1 |
| @testing-library/jest-dom | 7.0.1 |
| @testing-library/user-event | 14.6.7 |
| @playwright/test | 1.62.1 |
| @axe-core/playwright | 4.13.0 |
| msw | 2.15.0 |
| @lhci/cli | 0.15.1 |
| @faker-js/faker | 10.6.0 |
| eslint | 9.39.5 (latest 9.x; 10.x crashes with `eslint-config-next@16.3.4`, D-142) |
| eslint-config-next | 16.3.4 |
| typescript-eslint | 8.69.0 |
| eslint-plugin-boundaries | 7.2.0 |
| eslint-config-prettier | 10.1.8 |
| prettier | 3.9.6 |
| prettier-plugin-tailwindcss | 0.8.1 |
| husky | 9.1.7 |
| lint-staged | 17.4.1 |
| @commitlint/cli | 21.2.2 |
| @commitlint/config-conventional | 21.2.2 |
| pino-pretty | 13.1.3 |

**CLIs used via `npx`/`pnpm dlx` (never installed as dependencies)**: `vercel@59.11.2`, `neon@4.14.0`, `shadcn@4.20.1`, `impeccable@3.6.1`, `auth@1.7.2` (Better Auth CLI), `@sentry/wizard@7.0.3` (not used; manual setup in Phase 13).

GitHub Actions: `actions/checkout@v7`, `actions/setup-node@v7`, `pnpm/action-setup@v6`, `actions/upload-artifact@v7`, `actions/download-artifact@v8`, `actions/cache@v6`, `neondatabase/create-branch-action@v6`, `neondatabase/delete-branch-action@v3`, `treosh/lighthouse-ci-action@v12`.

## 9. Tooling configuration files

`tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"], "@tests/*": ["./tests/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", "drizzle"]
}
```

`prettier.config.mjs`

```js
export default {
  semi: false,
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 100,
  plugins: ['prettier-plugin-tailwindcss'],
}
```

`commitlint.config.mjs`

```js
export default { extends: ['@commitlint/config-conventional'] }
```

`.lintstagedrc.json`

```json
{ "*.{ts,tsx,mjs}": ["eslint --fix", "prettier --write"], "*.{md,json,yaml,yml,css}": ["prettier --write"] }
```

`vitest.config.ts`

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/server/**', 'src/components/**', 'src/lib/**'],
      thresholds: { 'src/server/**': { lines: 80 }, 'src/components/**': { lines: 70 } },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['tests/setup/unit.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['tests/setup/integration.ts'],
          fileParallelism: false,
          testTimeout: 30000,
        },
      },
    ],
  },
})
```

`playwright.config.ts`

```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'pnpm db:reset && pnpm build && pnpm start',
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 240000,
    env: { LLM_PROVIDER: 'mock', FEATURE_AI: 'false', EMAIL_TRANSPORT: 'console', APP_ENV: 'test' },
  },
})
```

`drizzle.config.ts`

```ts
import { defineConfig } from 'drizzle-kit'
import 'dotenv/config'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL! },
  strict: true,
  verbose: true,
})
```

`compose.yaml`

```yaml
services:
  postgres:
    image: postgres:17-alpine
    ports: ['5432:5432']
    environment:
      POSTGRES_USER: tassl
      POSTGRES_PASSWORD: tassl
      POSTGRES_DB: tassl
    volumes:
      - tassl-pg:/var/lib/postgresql/data
      - ./scripts/init-test-db.sql:/docker-entrypoint-initdb.d/init-test-db.sql:ro
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U tassl -d tassl']
      interval: 5s
      timeout: 3s
      retries: 20
volumes:
  tassl-pg: {}
```

`scripts/init-test-db.sql`

```sql
CREATE DATABASE tassl_test OWNER tassl;
```

`vercel.json`

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "git": { "deploymentEnabled": false },
  "crons": [{ "path": "/api/internal/jobs/drain", "schedule": "0 4 * * *" }]
}
```

`.gitignore` (in addition to the Next.js defaults and the Impeccable ignore block from `09-frontend-spec.md` §Impeccable workflow):

```
node_modules/
.next/
out/
coverage/
playwright-report/
test-results/
.vercel/
.env
.env.*
!.env.example
.data/
*.tsbuildinfo
```
