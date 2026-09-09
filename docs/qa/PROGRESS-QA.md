# PROGRESS-QA — resumable state of the QA run

**Read this first when resuming.** Sections are those of `docs/prompts/02-qa-and-guides.md`.
Branch: `qa/guides-and-full-qa` (from `main` 8ec771b). Local Postgres: `bash scripts/pg-local.sh start`.
Local production build env: `.env.test` (gitignored; recreate from the block in `docs/qa/00-baseline.md` if missing).

## Done
- Step 0 — orientation and baseline (commit c9a387a). Baseline fully green on 66d87fe.
- Understand pass: 14 read-only reports in the session scratchpad `understand/` (screens, test harness, env, LLM, authz, security, data, CI).
- Part A — guides written (commit a3d3335): `docs/guides/{README,instructor-guide,learner-guide,demo-runbook}.md`, `docs/qa/PRE-DEMO-CHECKLIST.md`.
- Product changes (commit c06828f, D-691–D-700): runtime Assistant mode switch (`app_settings`, `/admin/flags`, `PUT /api/v1/admin/settings/ai-mode`, `/api/ready.assistantMode`, workspace chip), `DEMO_MODE`, replay links on the assignment runs table, `robots.txt`, health version from the inlined release, all seeded assignments walkthrough, perf spec scoped to chromium, guide projects chained, guide purge in global setup.
- Scripts and gates: `check-guide-coverage.ts`, `env-parity.ts`, `demo-warm.ts` (passes locally and against production), `demo-reset.ts` (passes locally: one recorded run, one scored run on student2), `db-drift.ts` (17 migrations, no drift), API coverage gate (`tests/integration/api/coverage.test.ts`), smoke specs + `playwright.smoke.config.ts`, k6 `tests/load/core-flow.js`, `tests/security/prompt-injection.spec.ts` (security vitest project), package scripts `test:guides test:demo-path test:smoke test:security test:load env:check demo:warm demo:reset db:drift deps:check spell:check qa:all`, CI `guides` job and post-deploy browser smoke.
- Tooling: portable Node 24 (`~/.tassl-tools/node24`) and k6 (`~/.tassl-tools/k6`); clean-clone build green; cspell clean on the guides; gitleaks clean over 153 commits.

## In progress
- Part B — three spec writers (workflow `wf_4fadf660-a97`): `tests/e2e/guides/{instructor-guide,learner-guide,demo-path}.spec.ts`, each on its own database (tassl_test_a/b/c) and port (3001/3002/3003). Main server on :3000 serves tassl_test from the rebuilt bundle.
- Pending after the writers: rebuild if they changed src/, run `pnpm test:guides` on the main database, review screenshots, commit Part B, then C1–C17.

## C-section status (🟢 = finished, ◐ = partly done, ○ = not started)
- C1 ◐ typecheck/lint/build green; audit --prod no high/critical; depcheck config + unused deps to remove (next-themes, shadcn, @faker-js/faker, typescript-eslint — pending `pnpm remove` once no agent runs); no console.log (eslint rule); cspell clean; clean-clone build green (Node 24); gitleaks clean; bundle secret grep clean; env parity green (DEMO_MODE and SENTRY_TRACES_SAMPLE_RATE added to Vercel production).
- C2 ○ `--repeat-each=3` E2E run pending (after the spec writers).
- C3 ◐ API coverage gate written and green (two untested endpoints got tests); COVERAGE.md walk pending.
- C4 ◐ classmate → 404 on reviewer endpoints (D-703); per-account lockout (D-704); authz-matrix generation pending.
- C5 🟢 prompt-injection battery (17 tests, security project); assistant mode chip; provider-down = pause path covered by existing tests.
- C6 ◐ drift gate green; demo:reset green; seed all-walkthrough; Neon backup branch `pre-demo-backup-20260909` created (3 branches); cold start measured 2.2 s; nothing polls /api/ready (D-698).
- C7 ◐ envelope fuzz + 1 MiB body cap (D-702); offline/long-input UI checks pending.
- C8 ○ k6 portable ready; load run against a preview pending.
- C9 ◐ headers verified on production; robots.txt; lockout; body cap; raw SQL parameterised (report); open-redirect check pending.
- C10 ○ axe suite exists (34 screens); keyboard-only spec exists; rerun pending.
- C11 ◐ impeccable detect 0 findings; viewport/copy fixes pending.
- C12 ○ guide tests on three engines pending.
- C13 ○ Sentry alert rule via browser pending; PostHog verification pending.
- C14 ◐ env set; rollback target recorded in the runbook; branch protection needs the `checks / guides` context added.
- C15 ◐ kill switch built; demo:warm and demo:reset built and passing; PRE-DEMO-CHECKLIST written.
- C16 ○ pending Part B.
- C17 ○ pending.

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
