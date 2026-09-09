# PROGRESS-QA — resumable state of the QA run

**Read this first when resuming.** Sections are those of `docs/prompts/02-qa-and-guides.md`.
Branch: `qa/guides-and-full-qa` (from `main` 8ec771b). Local Postgres: `bash scripts/pg-local.sh start`.
Local production build env: `.env.test` (gitignored; recreate from the block in `docs/qa/00-baseline.md` if missing).

## Done
- Step 0 — orientation and baseline (commit c9a387a): `docs/qa/00-baseline.md`, `research-notes.md`, `demo-path.md`, `demo-accounts.md` (gitignored), `PROGRESS-QA.md`, `FIXED-ISSUES.md`. Baseline fully green on 66d87fe.
- Understand pass: 14 read-only reports in the session scratchpad `understand/` (screens, test harness, env, LLM, authz, security, data, CI). Their findings are the C-section worklist below.

## In progress
- Part A — guides: three writers (instructor guide, student guide, runbook + README) running as workflow `wf_b799b824-53b`.
- Prepared for later sections (uncommitted): `scripts/check-guide-coverage.ts` (Part B), `scripts/env-parity.ts` (C1), `playwright.smoke.config.ts` (Part B), `src/app/robots.ts` (C9), `src/app/api/health/route.ts` version fix (C14).

## Open fix in progress
- (none)

## Worklist from the understand pass (each becomes a FIXED-ISSUES row when fixed)
- C1: Node 24 portable at `~/.tassl-tools/node24/node-v24.21.0-win-x64` for builds; add eslint `no-console`; remove unused `next-themes`; cspell; depcheck; clean-clone build; gitleaks full history; client bundle secret grep; env parity (add `DEMO_MODE`, `SENTRY_TRACES_SAMPLE_RATE` to production).
- C2: web-vitals spec skips on firefox/webkit → scope perf specs to chromium in the config; `--repeat-each=3`.
- C3: `tests/integration/api/coverage.test.ts` (documented gate) missing; coverage thresholds not run in CI (`pnpm test:coverage`).
- C4: reviewer endpoints answer 403 (not 404) to a classmate → run-id existence leak; account deletion needs no fresh session; raw Better Auth org endpoints (`update-member-role`, `remove-member`, `leave`) unaudited; `BRIEF_LOCKED` trigger unmapped (500); generate `tests/integration/authz-matrix.test.ts`.
- C5: no student-visible assistant mode notice; mock has no delay/throw injection for the assistant (MSW doubles exist); injection suite missing other-learner-data, base64/unicode, extreme length, cost attack, grader injection; `regeneratePackageVersion` on the `write` bucket.
- C6: seed marks only one assignment walkthrough; `ensurePackage` reuses a draft; drift gate in CI; `demo:reset`; backup branch `pre-demo-backup-YYYYMMDD`.
- C7: 500 envelopes ship `details`; non-JSON 504/413 handling in the client fetch wrapper; no body-size cap on route handlers.
- C8: no load-test tooling (k6 portable → `~/.tassl-tools/k6`); `<Link>` prefetch on per-run list links; export size vs 4.5 MB.
- C9: `/robots.txt` 404 (fixed, uncommitted); per-account sign-in limit; `smoke.sh` checks 4 headers only.
- C11: no dark mode exists (light only; `next-themes` unused); QA viewports 1920×1080@1.25 and 390×844 untested; terminology drift lists in the screen reports; runs table "Continue" for an assigned run; held runs chip; assignment runs table has no replay link and a stale Phase-6 sentence; retry copy says "starts again at step 1"; "elements {keys}" renders UUIDs; sign-out failure silent; rail Admin active state; no Privacy/Terms link inside the shell; notification email names a setting that does not exist.
- C13: Sentry CI token cannot create alert rules (use the Sentry UI via the browser); no uptime monitor by design (nothing may poll `/api/ready`); PostHog last hop unverified.
- C14: `SENTRY_TRACES_SAMPLE_RATE` defaults to 1 in production; `/api/health` version "dev" (fixed, uncommitted).
- C15: build `app_settings` + `ai_mode` switch on `/admin/flags` ("Assistant mode": "Live model" / "Scripted assistant" / "Save assistant mode"); `DEMO_MODE`; `demo:warm`; `demo:reset`; `PRE-DEMO-CHECKLIST.md`.

## Next command
- When the guide workflow finishes: read `docs/guides/*.md`, fix format problems, run `pnpm exec tsx scripts/check-guide-coverage.ts` (expect spec-missing errors only), then Part B.
