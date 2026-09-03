# Phase 13 — Cross-Cutting Hardening

**Purpose / Read this when:** the product loop and authoring work on the mock provider (Phases 0–12) and the deployment must become production-grade: Sentry and PostHog wired, security headers and CSP, rate-limit coverage, error pages, the admin area, legal pages, backups and the restore drill, incident tooling, Impeccable's app-wide passes, the accessibility sweep, and the performance budgets enforced in CI.

**Requirements covered:** SYS-006, SYS-007, SYS-011 (screens), SYS-012 (coverage), SYS-014, SYS-015, SYS-016, SYS-025, SYS-027, UI-050, INT-005, INT-006, AN-002 to AN-005, NFR-006, NFR-007, NFR-008 (measurement), NFR-009, NFR-011, NFR-013, NFR-015, NFR-016, FR-006 (copy review), FR-131 (field-name test already), FR-211, FR-213, FR-214, DATA-047, DATA-048; decisions D-017, D-018, D-027, D-069, D-098, D-115, D-119, D-121, D-122, D-126, D-129.

## Goal

Every control in `12-security.md` §3, every signal in `13-observability-ops.md`, every budget in `16-performance-a11y-budgets.md`, and every event in `17-analytics-events.md` exists and is tested; the admin and legal pages exist; the restore drill has run once.

## Prerequisites

- Phase 12 exit criteria pass.
- Read `12-security.md`, `13-observability-ops.md`, `16-performance-a11y-budgets.md`, `17-analytics-events.md`.

## Steps

### Step 13.1 — Sentry: manual setup, release tagging, ops events, alerts
**Goal:** Errors and traces reach Sentry with release tags; `alertOps` raises Sentry messages; alert rules and dashboards exist.
**Covers:** SYS-014, INT-006, NFR-007, NFR-016, D-027, D-121
**Prerequisites:** Phase 12 complete
**Files to create / modify:**
- `sentry.server.config.ts`, `sentry.edge.config.ts`, `src/instrumentation.ts`, `src/instrumentation-client.ts`, `src/app/global-error.tsx`, `next.config.ts` (`withSentryConfig`, `env` inlining of `APP_ENV` and `SENTRY_TRACES_SAMPLE_RATE`) — create or modify exactly per `13-observability-ops.md` §3
- `src/server/logging/ops-events.ts` — modify; `alertOps` captures a Sentry message tagged `ops:<name>` with the fingerprint; `countOps` emits the `ops_*` PostHog event (transport in Step 13.2)
- `src/server/http/define-route.ts`, `define-action.ts` — modify; Sentry tag `route_group`; spans for services and DB queries per `13-observability-ops.md` §5
- `src/server/jobs/drain.ts` — modify; `Sentry.withMonitor('jobs-drain-daily', …)` and the `scoring_overdue` check
- `scripts/sentry-test.ts` — create
- `.github/workflows/production.yml` — modify; `SENTRY_RELEASE=${{ github.sha }}` on the build step; the release step per `15-cicd-deployment.md` §7
**Commands (in order, from repo root):**
```bash
pnpm add @sentry/nextjs@10.73.0
```
Then create the Sentry project (https://sentry.io → Create Project → Next.js, name `tassl`), copy the DSN, and set `NEXT_PUBLIC_SENTRY_DSN` in Vercel production and preview (`printf '%s' '<dsn>' | npx vercel@59.11.2 env add NEXT_PUBLIC_SENTRY_DSN production`; repeat for `preview`), `gh secret set SENTRY_AUTH_TOKEN`, `gh variable set SENTRY_ORG --body '<org-slug>'`, `gh variable set NEXT_PUBLIC_SENTRY_DSN --body '<dsn>'`. Create the alert rules and dashboards of `13-observability-ops.md` §6–7 in the Sentry UI (each rule's condition, window, and threshold are listed there).
**Implementation notes:** Everything is a no-op when the DSN is empty (D-098); tunnel route `/sentry-tunnel`; release = git SHA; environment = `APP_ENV`; no session replay.
**Secrets (if any):** `NEXT_PUBLIC_SENTRY_DSN` (public), `SENTRY_AUTH_TOKEN` — https://sentry.io/settings/account/api/auth-tokens/; non-secret default: empty (Sentry disabled).
**Tests to write:**
- `tests/unit/logging/ops-events.test.ts` — `alertOps` calls `captureMessage` with the tag and fingerprint when the DSN is set and does nothing when empty.
- `tests/integration/system/sentry-noop.test.ts` — with an empty DSN, a thrown `INTERNAL_ERROR` still returns the envelope and logs at `error`.
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test -- tests/unit/logging && pnpm test:integration -- tests/integration/system && pnpm build && NEXT_PUBLIC_SENTRY_DSN="$(npx vercel@59.11.2 env pull --environment=preview --yes .env.preview.tmp >/dev/null 2>&1; grep NEXT_PUBLIC_SENTRY_DSN .env.preview.tmp | cut -d= -f2-; rm -f .env.preview.tmp)" pnpm exec tsx scripts/sentry-test.ts
```
(The last command prints an event id; open it in Sentry to confirm receipt. Without a DSN it prints `NEXT_PUBLIC_SENTRY_DSN is empty; nothing sent` and exits 1, so the Verify line fails until the preview DSN is set in this step.)
**Commit:** `feat(observability): sentry setup, release tagging, ops events, monitors`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 13.2 — PostHog: client and server transports, reverse proxy, event catalogue, identity
**Goal:** Every event in `17-analytics-events.md` fires with typed properties; the client and server no-op without a key.
**Covers:** INT-005, AN-002 to AN-005, SYS-025 (allowlist), D-119
**Prerequisites:** Step 13.1 complete
**Files to create / modify:**
- `src/lib/analytics/events.ts` — complete; the full catalogue with Zod property schemas
- `src/lib/analytics/client.ts`, `src/server/analytics/posthog.ts`, `src/server/analytics/track.ts`, `src/server/analytics/distinct-id.ts`, `src/components/layout/analytics-identity.tsx`, `src/components/layout/analytics-environment.tsx` — create or modify exactly per `17-analytics-events.md` §5
- `src/instrumentation-client.ts` — modify; PostHog init per §5 (`api_host: '/ingest'`, `capture_pageview: 'history_change'`, `capture_pageleave`, `autocapture: false`, `ip: false`, `sanitize_properties`, `person_profiles: 'identified_only'`)
- `next.config.ts` — modify; `/ingest` rewrites and `skipTrailingSlashRedirect: true`
- `eslint.config.mjs` — modify; `no-restricted-imports` for `posthog-js` and `posthog-node`; `no-restricted-syntax` for person properties
- Every service named in the catalogue's "trigger" column — modify; call `track()` with the documented properties (this is the pass that wires the remaining events; earlier phases already emit the run events named in their steps)
**Commands (in order, from repo root):**
```bash
pnpm add posthog-js@1.425.1 posthog-node@5.51.6
```
Then create the PostHog project (https://us.posthog.com → New project `tassl`), copy the project API key, set `NEXT_PUBLIC_POSTHOG_KEY` in Vercel production and preview, and apply the project settings in `17-analytics-events.md` §7 (discard client IP data on; autocapture off).
**Implementation notes:** Distinct id = `hashUserId` (server only); groups `organization`; the request-scoped server client is shut down with `after()`; walkthrough runs carry `is_walkthrough: true`.
**Secrets (if any):** `NEXT_PUBLIC_POSTHOG_KEY` — PostHog → Project settings → Project API key (public by design); non-secret default: empty (no-op).
**Tests to write:**
- `tests/unit/analytics/events.test.ts` — every event's example payload validates; the allowlist forbids strings longer than 200 chars and any key named `email`, `name`, `text`.
- `tests/integration/analytics/track.test.ts` — no-op without a key; with a key the fake client receives the event with the hashed distinct id and the organization group.
- `tests/integration/analytics/coverage.test.ts` — every event in the catalogue has at least one `track('<event>'` call site in `src/server/**` or `src/components/**` (grep).
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test -- tests/unit/analytics && pnpm test:integration -- tests/integration/analytics && pnpm build
```
**Commit:** `feat(analytics): posthog client and server, event catalogue, identity`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 13.3 — Security headers, CSP, cookies, secret scanning, dependency updates
**Goal:** The exact header values of `12-security.md` §4 on every response; gitleaks and Dependabot configured.
**Covers:** SYS-015, NFR-011, D-115
**Prerequisites:** Step 13.2 complete
**Files to create / modify:**
- `src/proxy.ts` — modify; per-request nonce, `buildCsp(nonce)` exported from `src/proxy.ts` exactly per `12-security.md` §4.2, the full CSP and `x-request-id`; the nonce reaches the root layout through the `x-nonce` request header and is applied to `<Script>` tags
- `next.config.ts` — modify; static `headers()` (HSTS, nosniff, referrer, permissions, frame, COOP) and the `/fonts` and `/api` cache rules from `16-performance-a11y-budgets.md` §7
- `.gitleaks.toml`, `.github/dependabot.yml` — create per `12-security.md` §5
- `.github/workflows/checks.yml` — verify the `security` job matches `15-cicd-deployment.md` §4 (it was created in Phase 0; update if the spec changed)
**Commands (in order, from repo root):** none.
**Implementation notes:** `style-src 'self' 'unsafe-inline'` (recharts and sonner); `connect-src 'self'`; `img-src 'self' data:`; `'unsafe-eval'` and `ws://localhost:*` only when `APP_ENV=local`; account menu renders initials only.
**Secrets (if any):** none.
**Tests to write:**
- `tests/unit/security/csp.test.ts` — exact CSP strings for `test` and `production`.
- `tests/e2e/security/headers.spec.ts` — every header byte for byte on a page and an API route; `x-powered-by` absent; `x-request-id` honored.
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test -- tests/unit/security && pnpm test:e2e -- tests/e2e/security && gh workflow view checks.yml >/dev/null
```
**Commit:** `feat(security): csp and security headers, gitleaks, dependabot`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 13.4 — Rate-limit coverage, student-view invariants, PII redaction audit
**Goal:** Every route declares its bucket; the invariants test covers every student projection; logs never carry PII.
**Covers:** SYS-012, SYS-025, NFR-011, D-117
**Prerequisites:** Step 13.3 complete
**Files to create / modify:**
- `tests/integration/rate-limit/coverage.test.ts` — create; every registered route has a `rateLimit.bucket` except `health`, `ready`, `openapi`, and `drain`
- `tests/integration/security/student-view-invariants.test.ts` — complete; run summary, workspace, claims, delegations, defense, debrief (before and after scoring), record export, package projection; 403 for another student, 404 cross-tenant
- `tests/integration/logging/redaction.test.ts` — create; a request with an email in the body logs `[Redacted]` for every redaction path
- `src/server/modules/**/router.ts` — modify where a bucket is missing
**Commands (in order, from repo root):** none.
**Implementation notes:** The redaction test drives a real route through `defineRoute` with a captured pino destination.
**Secrets (if any):** none.
**Tests to write:** the three files above.
**Verify (all must pass):**
```bash
pnpm test:integration -- tests/integration/rate-limit tests/integration/security tests/integration/logging
```
**Commit:** `test(security): rate-limit coverage, student-view invariants, redaction`
**Rollback:** `git checkout -- tests src`

### Step 13.5 — Admin area, legal pages, error-page polish, copy review
**Goal:** UI-050 and UI-006 exist; error pages pass the Impeccable loop; every student-facing string passes the never-accuses review.
**Covers:** SYS-006, SYS-007, SYS-011, UI-050, UI-006, UI-007, FR-006, D-016, D-017
**Prerequisites:** Step 13.4 complete
**Files to create / modify:**
- `src/server/modules/admin/{schema,service,router,actions}.ts` — complete; `listUsers`, `setPlatformRole`, `listAuditLog`, `getFlags`; `src/app/api/v1/admin/**` — create
- `src/app/(app)/admin/layout.tsx` (platform admin guard), `src/app/(app)/admin/{users,flags,audit}/page.tsx`, `src/components/features/admin/*` — create
- `src/lib/legal/{privacy,terms}.ts`, `src/app/(public)/privacy/page.tsx`, `src/app/(public)/terms/page.tsx` — create; content generated from `06-data-model.md` (data collected: name, email, session IP and user agent, run content), purposes, retention (D-018), processors (Neon, Vercel, Resend, PostHog, Sentry, the LLM provider when enabled), the student rights (export, deletion), the no-misconduct statement (FR-006), and a `LAST_REVIEWED` constant
- `tests/unit/copy/never-accuses.test.ts` — create; scans `en-US.ts` for `cheat`, `misconduct`, `dishonest`, `plagiar` and fails on any match outside the legal pages' explicit "Tassl makes no misconduct findings" sentence
**Commands (in order, from repo root):** Impeccable loop for `/admin/users`, `/admin/flags`, `/admin/audit`, `/privacy`, `/terms`, and `critique` + `polish` on the not-found and error pages.
**Implementation notes:** Role changes revoke the user's sessions and audit `role.set`; the audit table filters by organization; flags page shows `effectiveLlmProvider()`.
**Secrets (if any):** none.
**Tests to write:**
- `tests/integration/admin/service.test.ts` — list, role set (sessions revoked, audit row), audit list; non-admin 403.
- `tests/e2e/admin/admin.spec.ts` — admin sets a role; audit row visible; student gets the not-found page on `/admin/users`.
- `tests/e2e/a11y/{admin,public}.spec.ts` — modify; admin and legal routes.
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test -- tests/unit/copy && pnpm test:integration -- tests/integration/admin && pnpm test:e2e -- tests/e2e/admin tests/e2e/a11y/admin.spec.ts tests/e2e/a11y/public.spec.ts
```
**Commit:** `feat(admin): admin area, legal pages, copy review`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 13.6 — Backups, restore drill, incident tooling, retention
**Goal:** The nightly backup workflow runs, a restore drill completes, incident tooling exists, and retention behavior is verified.
**Covers:** SYS-016, SYS-027, NFR-009, NFR-015, D-018, D-069
**Prerequisites:** Step 13.5 complete
**Files to create / modify:**
- `.github/workflows/backup.yml`, `scripts/backup.sh`, `scripts/sentry-checkin.sh`, `scripts/restore-drill.sh` — create per `15-cicd-deployment.md` §8 and `13-observability-ops.md` §8.4
- `gh variable set NEXT_PUBLIC_SENTRY_DSN --body "<dsn>"` — run once so the backup and drill check-ins reach Sentry (skipped silently while unset)
- `scripts/revoke-sessions.ts`, `docs/incidents/TEMPLATE.md`, `src/server/email/templates/incident-notice.tsx` — create per `12-security.md` §9
- `src/server/jobs/drain.ts` — verify `scheduleDailyMaintenance` enqueues `purge_deleted_accounts` once per day (singleton key)
**Commands (in order, from repo root):**
```bash
gh workflow run backup.yml && sleep 60 && gh run list --workflow backup.yml --limit 1
bash scripts/restore-drill.sh
```
**Implementation notes:** The drill restores the latest artifact into a Neon branch `restore-drill-<date>`, migrates, smoke-tests against a local server pointed at the branch, records the duration in the step summary, deletes the branch, and sends the Sentry cron check-in.
**Secrets (if any):** `BACKUP_ENCRYPTION_KEY`, `PRODUCTION_DATABASE_URL_UNPOOLED`, `NEON_API_KEY` (set in Phase 0).
**Tests to write:**
- `tests/integration/identity/retention.test.ts` — the daily maintenance enqueues the purge job once per day; purge behavior per Phase 3 test extended with audit and llm rows nulled (D-112).
**Verify (all must pass):**
```bash
gh run list --workflow backup.yml --limit 1 --json conclusion -q '.[0].conclusion' | grep -qx success && pnpm test:integration -- tests/integration/identity/retention.test.ts
```
**Commit:** `feat(ops): nightly backup workflow, restore drill, incident tooling`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 13.7 — Impeccable app-wide passes: adapt, optimize, extract
**Goal:** Every screen adapts from 360 px to 1440 px, performance findings are fixed, and repeated patterns live in the design system.
**Covers:** NFR-006, NFR-013, INT-011
**Prerequisites:** Step 13.6 complete
**Files to create / modify:** components and `DESIGN.md` as the commands direct; `.impeccable/critique/*.md`
**Commands (in order, from repo root):** in the session: `/impeccable adapt`, `/impeccable optimize`, `/impeccable extract`; then `/impeccable document` to reconcile `DESIGN.md`.
**Implementation notes:** Keep the §2 tokens of `09-frontend-spec.md`; fix every high and medium finding; waive lows with reasons (D-130).
**Secrets (if any):** none.
**Tests to write:**
- `tests/e2e/responsive/viewports.spec.ts` — the workspace, debrief, replay, and confirmation workspace at 360, 768, 1024, and 1440 px have no horizontal page scroll and every primary action is visible.
**Verify (all must pass):**
```bash
pnpm test:e2e -- tests/e2e/responsive && npx impeccable@3.6.1 detect --json . > impeccable-report.json && node scripts/impeccable-gate.mjs impeccable-report.json .impeccable/config.json
```
**Commit:** `chore(design): impeccable adapt, optimize, extract across the app`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 13.8 — Accessibility sweep and performance budgets in CI
**Goal:** Every UI-### has an axe test; the keyboard-only run, contrast test, reduced-motion behavior, bundle budget, Lighthouse assertions, query-plan gate, and web-vitals recording all run in CI.
**Covers:** NFR-006, NFR-008, NFR-013, FR-211, FR-213, FR-214, D-122, D-126
**Prerequisites:** Step 13.7 complete
**Files to create / modify:**
- `tests/e2e/a11y/screens.json` — complete; every UI id from `01-prd-analysis.md` §5.27 with its states
- `tests/unit/design/contrast.test.ts` — create; the pairing table from `16-performance-a11y-budgets.md` §8
- `tests/integration/perf/query-plans.test.ts`, `tests/e2e/perf/web-vitals.spec.ts` — create per `16-performance-a11y-budgets.md` §5 and §2
- `scripts/bundle-budget.ts` — verify it runs in the `build` job (`checks.yml`)
- `lighthouserc.json` — tighten to the final assertions of `16-performance-a11y-budgets.md` §10
**Commands (in order, from repo root):** none.
**Implementation notes:** `prefers-reduced-motion` disables transitions (a test toggles the media feature and asserts computed `transition-duration: 0s`); every `GraphFrame` passes the table and description checks.
**Secrets (if any):** none.
**Tests to write:** the files above plus `tests/e2e/a11y/reduced-motion.spec.ts`.
**Verify (all must pass):**
```bash
pnpm test -- tests/unit/design && pnpm test:integration -- tests/integration/perf && pnpm test:e2e -- tests/e2e/a11y tests/e2e/perf && pnpm build && pnpm exec tsx scripts/bundle-budget.ts && pnpm lhci
```
**Commit:** `test(a11y,perf): full axe coverage, contrast, budgets in ci`
**Rollback:** `git checkout -- tests lighthouserc.json`

## Phase exit criteria

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm test:e2e && pnpm evals && pnpm build && pnpm openapi:check && pnpm exec tsx scripts/bundle-budget.ts && pnpm lhci && npx impeccable@3.6.1 detect --json . > impeccable-report.json && node scripts/impeccable-gate.mjs impeccable-report.json .impeccable/config.json
gh run list --workflow backup.yml --limit 1 --json conclusion -q '.[0].conclusion' | grep -qx success
```

Requirement IDs now fully implemented: SYS-006, SYS-007, SYS-011, SYS-012, SYS-014, SYS-015, SYS-016, SYS-025, SYS-027, UI-006, UI-050, INT-005, INT-006, AN-002 to AN-005, NFR-006, NFR-007, NFR-009, NFR-011, NFR-013, NFR-015, NFR-016, FR-006, FR-211, FR-213, FR-214, DATA-047, DATA-048. Partially: NFR-008 (load test in Phase 15).
