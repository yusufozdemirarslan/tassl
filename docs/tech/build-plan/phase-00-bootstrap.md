# Phase 0 — Bootstrap

**Purpose / Read this when:** starting the build from an empty folder. At the end of this phase the repository, toolchain, local database, configuration loading, health endpoints, test tooling, CI, GitHub, Vercel, and Neon exist, and a "hello" build is live in production.

**Requirements covered:** SYS-009, SYS-013, SYS-014 (logging part), SYS-016 (project prerequisites), SYS-017, SYS-021, SYS-022, SYS-023, INT-001, INT-002, INT-009, NFR-016 (request ids), NFR-017.

## Goal

Prove the whole pipeline on day one: code → lint/typecheck/tests → build → production deploy → smoke test, with local Postgres and fail-fast configuration in place.

## Prerequisites

- macOS or Linux shell at the repository root (the folder containing `Tassl PRD.md` and `docs/`).
- Installed: `git`, `docker` with Compose v2, `gh` (GitHub CLI, signed in: `gh auth status` or run `gh auth login`), `nvm`, `curl`, `openssl`.
- Accounts: GitHub, Vercel (https://vercel.com/signup), Neon (https://console.neon.tech/signup). No secrets are needed until Step 0.10.
- Read `docs/tech/00-README.md`, `04-repo-structure.md`, `05-environment-config.md`, `15-cicd-deployment.md` §11.

Branching rule for this phase: Steps 0.1–0.8 commit directly on `main` (no remote yet). From Step 0.9 on, `main` is protected, so every later commit in every phase lands through a pull request: `git switch -c <branch>`, commit, `git push -u origin <branch>`, `gh pr create --fill`, `gh pr merge --squash --auto --delete-branch` (D-134; `00-README.md` §Builder rules).

## Steps

### Step 0.1 — Install the toolchain and initialize the repository
**Goal:** Node 24 LTS, pnpm 11.25.0, and a git repository on `main`.
**Covers:** SYS-017
**Prerequisites:** none
**Files to create / modify:**
- `.nvmrc` — create; content `24`
- `.gitignore` — create; the block in `04-repo-structure.md` §9 plus `impeccable-report.json` (the Impeccable block is added in Phase 1)
- `.editorconfig` — create; `root = true`, `[*] indent_style = space`, `indent_size = 2`, `end_of_line = lf`, `charset = utf-8`, `trim_trailing_whitespace = true`, `insert_final_newline = true`
**Commands (in order, from repo root):**
```bash
nvm install --lts && nvm use --lts
node -v
corepack enable && corepack prepare pnpm@11.25.0 --activate
pnpm -v
git init -b main
git add 'Tassl PRD.md' docs CLAUDE.md && git commit -m "chore(repo): add PRD and technical documentation"
git add .nvmrc .gitignore .editorconfig && git commit -m "chore(repo): pin node 24 and pnpm 11.25.0"
```
**Implementation notes:** D-002 pins Node 24 (`.nvmrc` = `24`); if `node -v` prints a version that does not start with `v24`, run `nvm install 24 && nvm use 24 && nvm alias default 24`. pnpm is managed by corepack (D-004).
**Secrets (if any):** none.
**Tests to write:** none (tooling).
**Verify (all must pass):**
```bash
node -v | grep -E '^v24\.' && pnpm -v | grep -E '^11\.25\.0$' && git rev-parse --abbrev-ref HEAD | grep -qx main && test "$(git rev-list --count HEAD)" -eq 2
```
**Commit:** made inside the command block (two commits).
**Rollback:** `rm -rf .git .nvmrc .gitignore .editorconfig`

### Step 0.2 — Scaffold the Next.js application with pinned dependencies
**Goal:** A minimal Next.js 16 App Router app with TypeScript strict, Tailwind 4, and the `package.json` scripts block, built by hand (no `create-next-app`, which refuses non-empty folders).
**Covers:** SYS-017, SYS-021, NFR-017
**Prerequisites:** Step 0.1 complete
**Files to create / modify:**
- `package.json` — create; name `tassl`, `private: true`, `packageManager: "pnpm@11.25.0"`, `engines.node ">=24.0.0 <25"`, scripts exactly as `04-repo-structure.md` §7 except `db:migrate` is `drizzle-kit migrate` (the pg-boss step is appended in Step 2.7)
- `tsconfig.json` — create; `04-repo-structure.md` §9
- `next.config.ts` — create; `import type { NextConfig } from 'next'; const config: NextConfig = { reactStrictMode: true, poweredByHeader: false, typedRoutes: true }; export default config` (grows in Phases 13 and 14; the final listing is `12-security.md` §4.3)
- `postcss.config.mjs` — create; `export default { plugins: { '@tailwindcss/postcss': {} } }`
- `src/app/globals.css` — create; `@import "tailwindcss"; @import "tw-animate-css";` and the `:root` token block from `09-frontend-spec.md` §2.2 plus the `@theme inline` mapping; declare `--font-plex-sans`, `--font-plex-mono`, `--font-plex-serif` as custom properties that Phase 1 fills, and set `font-family: var(--font-plex-sans, "IBM Plex Sans", sans-serif)` on `body`
- `src/app/layout.tsx` — create; root layout with `<html lang="en-US">`, metadata title "Tassl", `globals.css`
- `src/app/page.tsx` — create; a server component rendering the heading `t('landing.title')` and the sentence `t('landing.tagline')` ("Make the call.")
- `src/lib/i18n/en-US.ts` — create; `export const enUS = { 'landing.tagline': 'Make the call.', 'landing.title': 'Tassl' } as const`
- `src/lib/i18n/t.ts` — create; `t(key, params?)` with `{param}` interpolation, typed by `keyof typeof enUS`
- `src/lib/cn.ts` — create; `clsx` + `tailwind-merge` helper
**Commands (in order, from repo root):**
```bash
pnpm init
pnpm add next@16.3.4 react@19.2.8 react-dom@19.2.8 zod@4.5.4 server-only@0.0.1 clsx@2.1.1 tailwind-merge@3.6.0 dotenv@17.4.2
pnpm add -D typescript@6.0.3 @types/node@26.4.1 @types/react@19.2.18 @types/react-dom@19.2.5 tailwindcss@4.3.3 @tailwindcss/postcss@4.3.3 postcss@8.5.26 tw-animate-css@1.4.0 tsx@4.23.13
```
Then edit `package.json` to the scripts block and fields above (`pnpm init` writes a default file; replace it).
**Implementation notes:** `strict: true` and the extra strictness flags from `04-repo-structure.md` §9. `typedRoutes: true` makes `<Link href>` typed. No Edge runtime anywhere. `t()` is the only way UI strings are rendered (NFR-017). Do not add Tailwind config files; Tailwind 4 is CSS-first. `dotenv` is a runtime dependency because `src/server/config.ts` imports it (D-131).
**Secrets (if any):** none.
**Tests to write:** none yet (test tooling arrives in Step 0.7).
**Verify (all must pass):**
```bash
pnpm typecheck && pnpm build && (pnpm start & sleep 6; curl -fsS http://localhost:3000 | grep -q 'Make the call.'; s=$?; kill %1; exit $s)
```
**Commit:** `feat(app): scaffold next 16 app with pinned dependencies`
**Rollback:** `git checkout -- . && git clean -fd && rm -rf node_modules .next`

### Step 0.3 — Lint, format, layering rule, and commit hooks
**Goal:** `pnpm lint` and `pnpm typecheck` pass and every commit is checked.
**Covers:** SYS-017
**Prerequisites:** Step 0.2 complete
**Files to create / modify:**
- `eslint.config.mjs` — create; exactly `04-repo-structure.md` §2
- `prettier.config.mjs`, `commitlint.config.mjs`, `.lintstagedrc.json` — create; `04-repo-structure.md` §9
- `.husky/pre-commit` — create; content `pnpm exec lint-staged`
- `.husky/commit-msg` — create; content `pnpm exec commitlint --edit "$1"`
- `.prettierignore` — create; `.next`, `drizzle`, `pnpm-lock.yaml`, `docs/TASSL-TECHNICAL-DOCUMENTATION.md`, `impeccable-report.json` (one per line)
**Commands (in order, from repo root):**
```bash
pnpm add -D eslint@9.39.5 eslint-config-next@16.3.4 typescript-eslint@8.69.0 eslint-plugin-boundaries@7.2.0 eslint-config-prettier@10.1.8 prettier@3.9.6 prettier-plugin-tailwindcss@0.8.1 husky@9.1.7 lint-staged@17.4.1 @commitlint/cli@21.2.2 @commitlint/config-conventional@21.2.2
pnpm exec husky init
printf 'pnpm exec lint-staged\n' > .husky/pre-commit
printf 'pnpm exec commitlint --edit "$1"\n' > .husky/commit-msg
pnpm lint:fix
```
**Implementation notes:** The boundaries element list references folders that do not exist yet; ESLint tolerates that. `react/jsx-no-literals` is on from the first commit so strings go through `t()`.
**Secrets (if any):** none.
**Tests to write:** none.
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && git add -A && git commit -m "test: hook check" --dry-run
! (echo "bad message" | pnpm exec commitlint) && echo "commitlint rejects bad messages"
```
**Commit:** `chore(tooling): eslint, prettier, boundaries, husky, commitlint`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 0.4 — Local Postgres, environment file, and fail-fast configuration
**Goal:** Docker Compose Postgres 17 runs; `.env.example` has working defaults; the server refuses to start on invalid configuration.
**Covers:** SYS-013, SYS-023, INT-001
**Prerequisites:** Step 0.3 complete; Docker running (or the portable Postgres of D-139 on a machine without Docker)
**Files to create / modify:**
- `compose.yaml`, `scripts/init-test-db.sql` — create; `04-repo-structure.md` §9
- `scripts/pg-local.sh` — create; D-139 wrapper (`start|stop|restart|status`) for the portable PostgreSQL 17 install used where Docker is unavailable; same role, password, port, and databases as `compose.yaml`
- `.env.example` — create; verbatim from `05-environment-config.md` §2
- `src/server/config.ts` — create; `05-environment-config.md` §3 (starts with `import 'dotenv/config'`, D-131)
- `src/lib/env.public.ts` — create; `05-environment-config.md` §3
- `src/lib/flags.ts` — create; `Flags` type and `flagsFromEnv(env)` (server) plus `FlagsProvider`/`useFlags` (client context) in `src/lib/flags-context.tsx`
**Commands (in order, from repo root):**
```bash
cp .env.example .env
docker compose up -d --wait
# Without Docker (D-139): bash scripts/pg-local.sh start
```
**Implementation notes:** `superRefine` rules for deployed environments per `05-environment-config.md` §3. `effectiveLlmProvider()` returns `mock` when `FEATURE_AI` is false (D-029).
**Secrets (if any):** none (all defaults are non-secret).
**Tests to write:** deferred to Step 0.7 (`tests/unit/lib/config.test.ts` asserts the deployed-environment refinements).
**Verify (all must pass):**
```bash
docker compose exec -T postgres pg_isready -U tassl -d tassl && docker compose exec -T postgres psql -U tassl -d tassl_test -c 'select 1' -tA | grep -qx 1
# Without Docker (D-139): bash scripts/pg-local.sh status && PGPASSWORD=tassl psql -h localhost -U tassl -d tassl_test -c 'select 1' -tA | grep -qx 1
pnpm exec tsx -e "import('./src/server/config').then(m => console.log(m.env.APP_ENV, m.effectiveLlmProvider()))" | grep -q 'local mock'
APP_ENV=production pnpm exec tsx -e "import('./src/server/config').then(() => { console.log('NOT REFUSED'); process.exit(1) }).catch(e => { console.log('refused:', e.message); process.exit(0) })" | grep -q 'refused: INVALID_SERVER_ENV'
```
**Commit:** `feat(config): docker postgres, env example, zod config loading`
**Rollback:** `docker compose down -v && git checkout -- . && git clean -fd`

### Step 0.5 — Logging, request context, error model, route and action wrappers, analytics helper
**Goal:** The cross-cutting server kit from `10-backend-spec.md` §1–3 exists and is unit-tested.
**Covers:** SYS-014, SYS-022, NFR-016
**Prerequisites:** Step 0.4 complete
**Files to create / modify:**
- `src/lib/errors.ts` — create; `AppError`, `ErrorCode` union (global codes now; module codes appended later), `DEFAULT_STATUS`, `DEFAULT_MESSAGES`
- `src/server/logging/logger.ts` — create; pino with the redaction paths from `src/server/logging/redaction.ts`, `pino-pretty` transport only when `APP_ENV=local`
- `src/server/logging/redaction.ts` — create; `REDACT_PATHS` from `13-observability-ops.md` §2
- `src/server/logging/request-id.ts` — create; `getOrCreateRequestId(headers)`
- `src/server/logging/ops-events.ts` — create; `alertOps()` and `countOps()` (log-only until Phase 13 wires Sentry and PostHog)
- `src/server/http/request-context.ts` — create; `AsyncLocalStorage` store, `runWithContext`, `getRequestContext` (undefined outside a request), `requireRequestContext`
- `src/server/http/errors.ts` — create; `toErrorResponse(err, requestId)` producing the envelope and status
- `src/server/http/define-route.ts` — create; `defineRoute` per `10-backend-spec.md` §2 with `auth: 'session' | 'cron' | 'public'` (session support arrives in Phase 3; until then `auth: 'session'` throws `UNAUTHENTICATED`), input validation, output validation in non-production, rate limit hook calling `getRateLimiter()`
- `src/server/http/define-action.ts` — create; `defineAction`
- `src/server/http/openapi-registry.ts` — create; `registerRoute(spec)` collecting operation metadata for `scripts/openapi-generate.ts`
- `src/server/rate-limit/index.ts` — create; `getRateLimiter()` returning the memory limiter (`memory.ts`, two-window sliding algorithm over a `Map`) until Step 2.8 adds the Postgres limiter; `limits.ts` with the buckets from D-026
- `src/lib/analytics/events.ts` — create; `EVENTS` map with Zod property schemas (start with `sign_up_completed`, `sign_in_succeeded`, `error_shown`; extend per phase from `17-analytics-events.md`)
- `src/server/analytics/track.ts` — create; `track(event, props, ctx)` validating against `EVENTS` and writing a `debug` log line; the PostHog transport is added in Phase 13
**Commands (in order, from repo root):**
```bash
pnpm add pino@10.3.1
pnpm add -D pino-pretty@13.1.3
```
**Implementation notes:** Follow `10-backend-spec.md` §1–4 exactly (status mapping, envelope shape, header `x-request-id`, `Cache-Control: no-store`). `defineRoute` returns a Next.js route handler `(req, { params }) => Promise<Response>`.
**Secrets (if any):** none.
**Tests to write:** deferred to Step 0.7: `tests/unit/lib/errors.test.ts` (status mapping), `tests/unit/http/define-route.test.ts` (validation → 400 envelope; unknown error → 500 with request id; `x-request-id` echoed), `tests/unit/rate-limit/memory.test.ts` (window arithmetic).
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck
```
**Commit:** `feat(http): error envelope, request context, logging, route and action wrappers`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 0.6 — Database client, health and readiness endpoints, request proxy
**Goal:** `/api/health` and `/api/ready` respond; every request carries a request id and baseline security headers.
**Covers:** SYS-009, SYS-015 (baseline), NFR-016, INT-001
**Prerequisites:** Step 0.5 complete; Postgres running
**Files to create / modify:**
- `src/server/db/client.ts` — create; `postgres(env.DATABASE_URL, { max: 5, prepare: false })` and `drizzle(client)`; export `db`, `sql`, and `pingDb(timeoutMs)`
- `src/server/http/readiness.ts` — create; `checkReadiness()` (DB ping with a 2 s timeout; the `pgboss` schema check is added in Step 2.7)
- `src/app/api/health/route.ts` — create; `13-observability-ops.md` §4 (version from `process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev'`)
- `src/app/api/ready/route.ts` — create; calls `checkReadiness()` and maps the result to 200 or 503
- `src/proxy.ts` — create; sets `x-request-id` on the request and response, adds `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`; matcher excludes `_next/static`, `_next/image`, `favicon.ico`, `fonts` (the full CSP and HSTS arrive in Phase 13)
**Commands (in order, from repo root):**
```bash
pnpm add postgres@3.4.9 drizzle-orm@0.45.2
```
**Implementation notes:** `prepare: false` is required for Neon's pooled connection string. `ready` returns `503 { status: 'not_ready', checks: { db: 'failed' } }` on failure.
**Secrets (if any):** `DATABASE_URL` — local default `postgres://tassl:tassl@localhost:5432/tassl` (non-secret).
**Tests to write:** deferred to Step 0.7: `tests/integration/system/ready.test.ts`, `tests/e2e/system/health.spec.ts`.
**Verify (all must pass):**
```bash
pnpm build && (pnpm start & sleep 6; curl -fsS localhost:3000/api/health | grep -q '"status":"ok"' && curl -fsS localhost:3000/api/ready | grep -q '"db":"ok"' && curl -sI localhost:3000/ | grep -qi 'x-request-id'; s=$?; kill %1; exit $s)
```
**Commit:** `feat(system): db client, health and ready endpoints, request proxy`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 0.7 — Test tooling, migration journal, OpenAPI generator, docs build, smoke script
**Goal:** Vitest (unit + integration), Playwright + axe, MSW, Lighthouse CI, the OpenAPI generator, `pnpm docs:build`, and `scripts/smoke.sh` all run; the empty Drizzle migration journal exists so `pnpm db:migrate` works before Phase 2.
**Covers:** SYS-017, SYS-019, NFR-006 (tooling), NFR-012 (tooling)
**Prerequisites:** Step 0.6 complete
**Files to create / modify:**
- `vitest.config.ts`, `playwright.config.ts`, `drizzle.config.ts` — create; `04-repo-structure.md` §9
- `lighthouserc.json` — create; `16-performance-a11y-budgets.md` §3.5
- `drizzle/meta/_journal.json` — create; `{ "version": "7", "dialect": "postgresql", "entries": [] }` (`drizzle-kit migrate` refuses to run without a journal; `drizzle-kit generate` appends to it from Step 2.1)
- `tests/setup/unit.ts`, `tests/setup/integration.ts`, `tests/setup/msw/server.ts` — create; `14-testing-strategy.md` §2 (the integration setup runs `drizzle-kit migrate` against `TEST_DATABASE_URL`; with the empty journal it applies nothing)
- `tests/e2e/fixtures.ts` — create; `signInAs` is added in Phase 3; for now export `test` and `expect` from Playwright with an `axe(page)` helper (`tests/e2e/a11y/axe.ts`)
- `tests/unit/lib/errors.test.ts`, `tests/unit/http/define-route.test.ts`, `tests/unit/rate-limit/memory.test.ts`, `tests/unit/lib/config.test.ts`, `tests/unit/lib/i18n.test.ts` (every `t()` key used in `src/**` exists in `en-US.ts`; walk the source with a regex) — create
- `tests/integration/system/ready.test.ts` — create; calls the `GET` handler and expects `db: 'ok'`
- `tests/e2e/system/health.spec.ts` — create; `/` renders "Make the call.", `/api/health` is 200, axe on `/`
- `scripts/openapi-generate.ts` — create; builds the document with `createDocument` from `zod-openapi` using the registry, writes `docs/tech/openapi.yaml`; `--check` exits 1 when the file differs
- `scripts/docs-build.sh` — create; `04-repo-structure.md` §7
- `scripts/smoke.sh` — create; `15-cicd-deployment.md` §9
- `scripts/db-reset.ts` — create; drops and recreates the public schema of `TEST_DATABASE_URL` (or `DATABASE_URL` with `--dev`), runs migrations, runs the seed when `src/server/db/seed.ts` exists
**Commands (in order, from repo root):**
```bash
pnpm add zod-openapi@6.0.2 yaml@2.9.0
pnpm add -D vitest@4.1.11 @vitest/coverage-v8@4.1.11 vite@8.2.2 @vitejs/plugin-react@6.1.1 vite-tsconfig-paths@6.1.1 jsdom@30.0.1 @testing-library/react@16.3.3 @testing-library/dom@10.4.1 @testing-library/jest-dom@7.0.1 @testing-library/user-event@14.6.7 msw@2.15.0 @playwright/test@1.62.1 @axe-core/playwright@4.13.0 @lhci/cli@0.15.1 @faker-js/faker@10.6.0 drizzle-kit@0.31.10
pnpm exec playwright install --with-deps
mkdir -p drizzle/meta && printf '{ "version": "7", "dialect": "postgresql", "entries": [] }\n' > drizzle/meta/_journal.json
chmod +x scripts/docs-build.sh scripts/smoke.sh
```
**Implementation notes:** All three Playwright browsers are installed locally (CI installs chromium only and runs `--project=chromium`, D-126). Register `health` and `ready` in the OpenAPI registry with `servers: [{ url: '/api' }]` so the generated file matches `docs/tech/openapi.yaml` §system; the generator must be deterministic (sorted paths and keys).
**Secrets (if any):** none.
**Tests to write:** the files listed above.
**Verify (all must pass):**
```bash
pnpm db:migrate && pnpm test && pnpm test:integration && pnpm test:e2e -- tests/e2e/system && pnpm openapi:generate && pnpm openapi:check && pnpm docs:build
pnpm build && (pnpm start & sleep 6; bash scripts/smoke.sh http://localhost:3000; s=$?; kill %1; exit $s)
pnpm lhci
# Windows (D-147): bash scripts/lhci-local.sh
```
(`pnpm lhci` starts the server itself per `lighthouserc.json`; it must pass the accessibility and best-practices assertions on `/`.)
**Commit:** `test(tooling): vitest, playwright, axe, msw, lighthouse ci, openapi generator, migration journal`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 0.8 — CI workflows
**Goal:** The reusable gates workflow, the PR and production workflows, the cleanup workflow, the composite setup action, the gate scripts, and the branch-protection input exist; every gate passes on the current code.
**Covers:** SYS-017, INT-009
**Prerequisites:** Step 0.7 complete
**Files to create / modify:**
- `.github/workflows/checks.yml` — create; the reusable gates workflow from `15-cicd-deployment.md` §4 (jobs `lint`, `typecheck`, `unit`, `integration`, `build`, `e2e`, `impeccable`, `lhci`, `openapi-check`, `security`)
- `.github/workflows/pr.yml` — create; `15-cicd-deployment.md` §5 (calls `checks.yml`, then `preview-deploy`, gated by the repository variable `DEPLOY_ENABLED`)
- `.github/workflows/production.yml` — create; `15-cicd-deployment.md` §7 (calls `checks.yml`, then `deploy`, gated by `DEPLOY_ENABLED`)
- `.github/workflows/preview-cleanup.yml` — create; `15-cicd-deployment.md` §6
- `.github/actions/setup/action.yml` — create; the composite setup action from `15-cicd-deployment.md` §4
- `.github/PULL_REQUEST_TEMPLATE.md` — create; checklist from `04-repo-structure.md` §6
- `.github/branch-protection.json` — create; `15-cicd-deployment.md` §10 (ten `checks / <job>` contexts, D-113)
- `scripts/impeccable-gate.mjs` — create; `15-cicd-deployment.md` §4.3
- `scripts/bundle-budget.ts` — create; `16-performance-a11y-budgets.md` §3 (runs in the `build` job)
- `.impeccable/config.json` — create if absent with `{ "detector": { "ignoreRules": [], "ignoreFiles": [], "ignoreValues": [] } }` (Phase 1's installer merges into it)
**Commands (in order, from repo root):**
```bash
mkdir -p .github/workflows .github/actions/setup .impeccable
```
Then write the files exactly as `15-cicd-deployment.md` gives them.
**Implementation notes:** The `security` job runs `pnpm audit --audit-level=high` and gitleaks (it needs `pull-requests: read`). The `impeccable` job runs `npx impeccable@3.6.1 detect --json .` through the gate script (it works before Phase 1 installs the skill). The `lhci` job uses `treosh/lighthouse-ci-action@v12` with the same `lighthouserc.json`. The Sentry release step is guarded by `SENTRY_ENABLED`. Deploy jobs use `vercel@59.11.2` and run only when `vars.DEPLOY_ENABLED == 'true'` (set at the end of Step 0.10, D-134), so the gates can run before any Vercel secret exists.
**Secrets (if any):** none needed for the gates.
**Tests to write:** none (workflows are verified by running).
**Verify (all must pass):**
```bash
pnpm exec tsx -e "import('yaml').then(y => { const fs = require('fs'); for (const f of ['checks','pr','production','preview-cleanup']) { y.parse(fs.readFileSync('.github/workflows/'+f+'.yml','utf8')); console.log(f, 'ok') } y.parse(fs.readFileSync('.github/actions/setup/action.yml','utf8')); console.log('setup ok') })"
pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build && pnpm exec tsx scripts/bundle-budget.ts
```
**Commit:** `ci: reusable gates, pr and production workflows, gate scripts`
**Rollback:** `git checkout -- .github scripts .impeccable`

### Step 0.9 — GitHub repository and branch protection
**Goal:** The code lives in a private GitHub repository with `main` protected by the ten required checks.
**Covers:** INT-009, SYS-017
**Prerequisites:** Step 0.8 complete; `gh auth status` succeeds
**Files to create / modify:** none
**Commands (in order, from repo root):**
```bash
git remote -v | grep -q origin || gh repo create tassl --private --source=. --push
git push -u origin main
OWNER=$(gh repo view --json owner -q .owner.login)
gh api -X PUT "repos/$OWNER/tassl/branches/main/protection" --input .github/branch-protection.json
```
**Implementation notes:** The first push triggers `production.yml`; its `deploy` job is skipped because `DEPLOY_ENABLED` is not set yet (Step 0.10), and the ten gates must pass. From now on `main` accepts changes only through pull requests (see the branching rule at the top of this phase).
**Secrets (if any):** `GITHUB_TOKEN` is provided by Actions automatically.
**Tests to write:** none.
**Verify (all must pass):**
```bash
gh repo view --json isPrivate -q .isPrivate | grep -qx true && gh api "repos/$(gh repo view --json owner -q .owner.login)/tassl/branches/main/protection" -q '.required_status_checks.contexts | length' | grep -qx 10
RUN=$(gh run list --workflow production.yml --limit 1 --json databaseId -q '.[0].databaseId') && gh run watch --exit-status "$RUN"
```
**Commit:** none (no file changes).
**Rollback:** `gh api -X DELETE "repos/$OWNER/tassl/branches/main/protection"` (the repository itself is kept).

### Step 0.10 — Vercel project, Neon project, environment variables, CI secrets
**Goal:** Vercel and Neon projects exist; production and preview environment variables are set; CI has its secrets and the deploy gate is switched on.
**Covers:** INT-001, INT-002, SYS-016 (prerequisites), SYS-023
**Prerequisites:** Step 0.9 complete
**Files to create / modify:**
- `vercel.json` — create; `04-repo-structure.md` §9 (also `15-cicd-deployment.md` §11.7)
**Commands (in order, from repo root):** exactly `15-cicd-deployment.md` §11.1–§11.5, which performs: §11.1 (Vercel login, `vercel link --yes --project tassl`, the three `gh secret set` for `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`); §11.2 (Node 24.x, Standard Protection, the assigned production domain saved to `$S/prod-url.txt`); §11.3 (Neon project `tassl`, Postgres 17, `aws-us-east-1`, pooled and unpooled connection strings into files under `$HOME/.config/tassl/`, 7-day history retention, `NEON_API_KEY`, `NEON_PROJECT_ID`, `PRODUCTION_DATABASE_URL_UNPOOLED`); §11.4 (`BACKUP_ENCRYPTION_KEY`; the Sentry lines are skipped until Phase 13; `DEPLOY_ENABLED=true` last); §11.5 (the `vercel env add` lines: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `BETTER_AUTH_SECRET`, `CRON_SECRET` for production and preview; `NEXT_PUBLIC_APP_URL` and `SEED_PASSWORD` for production; `APP_ENV` for both). No other variable is added in Phase 0; every other value keeps its `src/server/config.ts` default until its phase sets it.
**Implementation notes:** Follow the CLI path (D-071: the Marketplace integration is not used; preview branches are created by the PR workflow). `vercel.json` disables Git auto-deploys so CI is the only deploy path (ADR-002). Secret values are written to `$HOME/.config/tassl/` (mode 700) and piped with `< file` (D-125).
**Secrets (if any):** `VERCEL_TOKEN` — https://vercel.com/account/tokens; `NEON_API_KEY` — https://console.neon.tech/app/settings/api-keys; `BETTER_AUTH_SECRET`, `CRON_SECRET`, `SEED_PASSWORD`, `BACKUP_ENCRYPTION_KEY` — generated locally as §11 shows. Non-secret defaults let local development continue without any of them.
**Tests to write:** none.
**Verify (all must pass):**
```bash
npx vercel@59.11.2 env ls production | grep -cE 'DATABASE_URL|BETTER_AUTH_SECRET|CRON_SECRET|APP_ENV|NEXT_PUBLIC_APP_URL|SEED_PASSWORD' | grep -qE '^([6-9]|[1-9][0-9])$'
npx neon@4.14.0 projects list --output json | grep -q '"name": *"tassl"'
gh secret list | grep -cE 'VERCEL_TOKEN|VERCEL_ORG_ID|VERCEL_PROJECT_ID|NEON_API_KEY|PRODUCTION_DATABASE_URL_UNPOOLED|BACKUP_ENCRYPTION_KEY' | grep -qx 6
gh variable get DEPLOY_ENABLED | grep -qx true
```
**Commit:** `chore(deploy): vercel project configuration` (through a pull request, per the branching rule)
**Rollback:** `gh variable delete DEPLOY_ENABLED`, `npx vercel@59.11.2 project rm tassl --yes`, `npx neon@4.14.0 projects delete <project-id>`, and `gh secret delete <NAME>` for each secret.

### Step 0.11 — First production deploy of the "hello" build
**Goal:** The production workflow deploys the current build to Vercel and the smoke test passes against the live URL.
**Covers:** INT-002, SYS-017, SYS-009
**Prerequisites:** Step 0.10 complete
**Files to create / modify:**
- `README.md` — create; three lines: what Tassl is, `pnpm dev` quick start, link to `docs/tech/00-README.md`
**Commands (in order, from repo root):**
```bash
git switch -c chore/00-first-deploy && git add -A && git commit -m "docs(readme): quick start" && git push -u origin chore/00-first-deploy
gh pr create --fill --base main && gh pr checks --watch --fail-fast && gh pr merge --squash --auto --delete-branch
git switch main && git pull --ff-only
sleep 20; RUN=$(gh run list --workflow production.yml --branch main --limit 1 --json databaseId -q '.[0].databaseId') && gh run watch --exit-status "$RUN"
URL="$(cat "$HOME/.config/tassl/prod-url.txt")"; echo "$URL"
```
**Implementation notes:** The workflow runs `pnpm db:migrate` (the empty journal applies nothing), `vercel build --prod`, `vercel deploy --prebuilt --prod`, then `scripts/smoke.sh` against `NEXT_PUBLIC_APP_URL`. If Vercel assigned a different production domain than the one saved in Step 0.10, update it: `printf 'https://<assigned>' | npx vercel@59.11.2 env add NEXT_PUBLIC_APP_URL production --force` and `gh workflow run production.yml --ref main`.
**Secrets (if any):** none beyond Step 0.10.
**Tests to write:** none (smoke script).
**Verify (all must pass):**
```bash
gh run list --workflow production.yml --branch main --limit 1 --json conclusion -q '.[0].conclusion' | grep -qx success
bash scripts/smoke.sh "$URL"
```
**Commit:** made through the pull request above.
**Rollback:** `PREV=$(npx vercel@59.11.2 ls tassl --prod --token "$VERCEL_TOKEN" | grep -oE 'https://[^ ]+' | sed -n 2p); npx vercel@59.11.2 rollback "$PREV" --token "$VERCEL_TOKEN"` (no previous deployment exists on the very first deploy; a failed first deploy is fixed and re-run).

## Phase exit criteria

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm test:e2e && pnpm build && pnpm openapi:check && pnpm docs:build
gh run list --workflow production.yml --branch main --limit 1 --json conclusion -q '.[0].conclusion' | grep -qx success
```

Requirement IDs now fully implemented: SYS-009, SYS-013, SYS-022, SYS-023, INT-009. Partially (completed in later phases): SYS-014 (Sentry in Phase 13), SYS-015 (CSP in Phase 13), SYS-017 (gates exist; E2E suites grow), SYS-019 (registry grows), SYS-021 (strings grow), INT-001, INT-002, NFR-016, NFR-017.
