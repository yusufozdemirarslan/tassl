# 00 — Orientation and baseline

Run on 2026-09-09 against branch `qa/guides-and-full-qa` at `66d87fe` (= `main` `8ec771b` plus the
docs commit of PR #32, cherry-picked). Nothing was fixed before these numbers were taken.

## Orientation

- Read: `CLAUDE.md`, `docs/tech/00-README.md`, `PROGRESS.md`, `DECISIONS.md` (D-001 … D-689),
  `COVERAGE.md`, `01-prd-analysis.md`, `09-frontend-spec.md`, `07-api-spec.md`,
  `11-llm-integration.md`, `05-environment-config.md`, `15-cicd-deployment.md`; the release
  checklist `docs/release/launch-checklist-2026-09-08.md`; the phase-15 file.
- `git status`: clean apart from the untracked prompt file `docs/prompts/02-qa-and-guides.md`.
  `git log --oneline | head -50` ends at the Phase 15 release work (PR #27 … #32).
- Build state (`PROGRESS.md`): every phase 0–14 step is ticked; Phase 15 steps 15.3–15.6 are open
  (launch checklist rows partial, custom domain a no-op because `APP_DOMAIN` is empty, the
  walkthrough not yet recorded, the post-launch runbook not written). Rule 4 of the prompt applies:
  those steps are executed inside this run (C13–C17 and the runbook).
- Production: https://tassl.vercel.app (Vercel project `tassl`, team `hewotllc-3732`; Neon project
  `red-smoke-66780807`, region `aws-us-east-1`, Postgres 17). Production workflow runs green at
  `8ec771b`. Real provider on (`FEATURE_AI=true`, `LLM_PROVIDER=openai-compatible`).
- This machine: Windows 11, Node v25.0.0 (engines say 24; a portable Node 24 is fetched for the
  builds in C1), pnpm 11.25.0, no Docker, no `psql` on `PATH`. Local Postgres 17 is the portable
  cluster of D-139 (`bash scripts/pg-local.sh start`), databases `tassl` and `tassl_test`, both
  present and accepting connections. Playwright browsers chromium, firefox, webkit installed.
  Chrome extension (Claude in Chrome) connected.

## Local infrastructure (Step 0.3)

`bash scripts/pg-local.sh status` → `localhost:5432 - accepting connections`. `pnpm db:reset`
(migrate + seed) on `tassl_test`: 29 s, `no failed or dead-lettered jobs after the seed`.
Seeded accounts recorded in `docs/qa/demo-accounts.md` (gitignored).

## Baseline suite results (Step 0.4)

Environment: `.env.test` (APP_ENV=test, mock provider, FEATURE_AI=false, console email, local
Postgres `tassl_test`). Production build served by `pnpm start` on :3000 for the E2E run.

| Suite | Command | Result | Duration |
|---|---|---|---|
| Typecheck | `pnpm typecheck` | pass (route types generated, `tsc --noEmit` clean) | 29 s |
| Lint | `pnpm lint` | pass (eslint clean, Prettier: all matched files formatted) | 73 s |
| Unit | `pnpm test` | 131 files, 2529 tests passed | 119 s |
| Integration | `pnpm test:integration` | 90 files, 1753 tests passed | 1265 s |
| Build | `pnpm build` | pass; one warning, and it is pnpm's engine notice (`wanted node >=24 <25, current v25.0.0`), not a Next warning | 86 s |
| E2E, three browsers | `pnpm test:e2e` | 256 passed, 0 failed, 2 skipped (chromium 86, firefox 85, webkit 85) | 952 s |

Failures verbatim: none.

The two skipped E2E tests are one test, `tests/e2e/perf/web-vitals.spec.ts` "core web vitals on
the workspace, the debrief and the faculty replay", which calls `test.skip` on firefox and webkit
because the Largest Contentful Paint and Interaction to Next Paint observers exist only in
Chromium. It is resolved in C2 by scoping the perf specs to the chromium project in
`playwright.config.ts` instead of skipping inside the test (rule 8: no `test.skip`).

Other baseline facts:

- `pnpm audit --prod`: 3 moderate, 0 high, 0 critical. `pnpm audit --audit-level=high` (all
  deps): 2 high, both `extract-zip` advisories already ignored in `pnpm.auditConfig` (dev-only,
  Playwright's transitive dependency).
- Production headers on `/sign-in`: HSTS, CSP with nonce, COOP, CORP, Permissions-Policy,
  Referrer-Policy, X-Content-Type-Options, X-Frame-Options, X-Request-Id all present.
- Production `/api/health` 200, `/api/ready` 200. `/robots.txt` answered with the 404 page
  (fixed in C9). `/` redirects to `/sign-in` (307).
- Neon: 2 branches (`main`, `preview/pr-31`), compute time used 6157 s this month, storage
  36 MB. Cold start on `/api/ready` after more than five idle minutes: 2.23 s; warm: 0.16 s.
- Vercel production variables (16): APP_ENV, BETTER_AUTH_SECRET, CRON_SECRET, DATABASE_URL,
  DATABASE_URL_UNPOOLED, EMAIL_FROM, EMAIL_TRANSPORT, FEATURE_AI, LLM_API_KEY, LLM_BASE_URL,
  LLM_PROVIDER, NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_POSTHOG_KEY, NEXT_PUBLIC_SENTRY_DSN, SEED_PASSWORD,
  TASSL_APP_DB_PASSWORD. Vercel cron: `/api/internal/jobs/drain` at `0 4 * * *`.
- Production workflow (`production.yml`) at `8ec771b`: 41 min end to end (checks 37.5 min, deploy
  3.3 min).

## References (Step 0.5)

`docs/qa/research-notes.md` — 29 items from the Next.js production checklist, the Vercel function
limitations page, and OWASP Top 10 for LLM Applications 2025 that the Section 6 checklist did not
already cover; each is handled in the C-section it belongs to and recorded in `QA-REPORT.md`.

## Demo path (Step 0.6)

`docs/qa/demo-path.md`.

## Tracking (Step 0.7)

`docs/qa/PROGRESS-QA.md` and `docs/qa/FIXED-ISSUES.md` created.
