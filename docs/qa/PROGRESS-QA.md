# PROGRESS-QA — resumable state of the QA run

**Read this first when resuming.** Sections are those of `docs/prompts/02-qa-and-guides.md`.
Branch: `qa/guides-and-full-qa` (from `main` 8ec771b), pull request #33; preview alias `tassl-pr-33.vercel.app` once the checks pass. Local Postgres: `bash scripts/pg-local.sh start`.
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
Read with the two lists below: what each row rests on is in the evidence section, and what is still
open is named in the row itself.

- C1 🟢 lint, typecheck, build, `audit --prod`, depcheck, `no-console`, cspell, clean-clone build on
  Node 24, gitleaks over the full history, the client-bundle secret grep, env parity, `db:drift`,
  `openapi:check` and the bundle budgets are all green on this branch.
- C2 ◐ the clean `--repeat-each=3` pass over the four projects is running. Two earlier passes each
  found real defects (QA-042…QA-046, QA-055, and the regression QA-043's first attempt introduced),
  which is what the repeats are for; the clean one is the evidence.
- C3 🟢 the API-coverage gate is green, and the requirement register's two joins — every id covered
  exactly once, every test path it names openable — are now a test rather than a habit (QA-048).
- C4 🟢 a classmate meets 404 on every reviewer endpoint (D-703), the per-account lockout exists
  (D-704), and `tests/integration/authz-matrix.test.ts` is 17 cases over role × route, IDOR and
  immutability.
- C5 🟢 seventeen prompt-injection cases in their own vitest project; the assistant-mode chip; the
  provider-down pause path.
- C6 🟢 no migration drift, `demo:reset` green, all three seeded assignments walkthrough, the Neon
  backup branch, a measured 2.2 s cold start, and nothing polling `/api/ready` (D-698).
- C7 🟢 envelope fuzz and the 1 MiB body cap (D-702); the network dropping mid-act is proven on
  every engine (QA-053); pasted markup, zero-width and bidirectional characters were already
  covered, and what happens to an emoji is now stated (QA-054).
- C8 ◐ Lighthouse and every bundle budget green. The k6 run against the PR preview is the open half,
  and it needs the preview deploy, which needs these checks green.
- C9 🟢 headers verified on production, `robots.txt`, the lockout, the body cap, parameterised SQL,
  and the open-redirect check built from a character code so an editor cannot disarm it (QA-033).
- C10 ◐ the axe suite (34 screens) and the keyboard-only run are in the pass above.
- C11 🟢 `impeccable detect` 0 findings, the audit done at 1440×900 and 390×844, the two tables that
  forced a minimum width fixed, and the phone is now a project rather than a reading (QA-047).
- C12 ◐ chromium, firefox, webkit and `mobile-safari` in the pass above; `cross-browser.yml`
  matrixes all three engines it can run (QA-059).
- C13 ◐ `/api/health` and `/api/ready` answer 200 in production; Sentry receives events and the three
  cron monitors exist; PostHog's last hop is verified in the Events view. **Open:** the fifteen
  alert rules of 13 §7 that are not cron monitors need a Sentry token carrying `alerts:write` — the
  one on this machine is `org:ci` and answers 403 to every alert endpoint. That is a secret value,
  which the prompt names as the one human input.
- C14 🟢 eighteen production variables, `env:check` green, the rollback target in the runbook, and
  branch protection carrying all eleven `checks / …` contexts.
- C15 🟢 all four: the runtime assistant-mode switch, `demo:warm`, `demo:reset`, and the checklist.
- C16 ◐ the guide chain is the last stage of the pass above.
- C17 ○ merge, deploy, live smoke, `demo:warm`, `env:check`, and the walkthrough against production.

## Open fix in progress
- (none)

## Session of 2026-09-10 (afternoon): the triage of the first clean ×3 run
The ×3 run of all three engines finished 861 passed / 15 failed (1.2 h) and the CI `guides` job failed
on webkit. Five clusters, each root-caused and adversarially verified, then fixed at the root:

| Cluster | Verdict | Fix |
|---|---|---|
| `meridian-roast` absent from /packages (firefox ×2, webkit ×3, in two specs) and `Decision Run 1 (walkthrough)` absent from /runs (webkit ×3) | test defect — every list is a cursor page, a seeded row is the oldest row there is | `walkPagesTo()` (D-718), QA-046 |
| webkit lands on /debrief instead of /runs/{id} after **Finish it** (1 of 3, two specs) | **product** — the destination was re-derived by a guard that races the scoring job | navigate to the completing call's `links.next` (D-720), QA-043 |
| CI guides: webkit never fires the download for **Export package JSON** | **product** — `content-disposition` alone; WebKit navigates. Safari could not export at all | `download` on the four export anchors (D-719), QA-042 |
| twelve `The destination stream closed early.` in the CI server log | **product (ops)** — a client disconnect reached Sentry untagged, and `NFR-007 error burst` fires on ten untagged events in five minutes | filter at `onRequestError` (D-721), QA-044 |
| (found while verifying the runs-row cluster) /runs printed **Not started** and **Start** over a live run | **product** — two independently paged lists joined; past 100 runs the join went partial and Start then refused with `RUN_ACTIVE_EXISTS` | `listMyRunsForAssignments` (D-722), QA-045 |

Also closed: the guide rewording of the C16 second reading had drifted from thirteen `test.step` titles
(the spec now matches: 28 tasks, 321 steps); D-716 and D-717 rows were missing for work already in the
tree; `/api/health` in production answers `"version":""`, not `"dev"` — the two prose claims that said
otherwise now say what it answers; and C12's fourth project, Mobile Safari, did not exist (D-723,
QA-047 — `mobile-safari` on `devices['iPhone 14']` running the eight smoke specs).

Verification in flight: `db:reset` → `build` → the four projects ×3 → `pnpm test:guides`.

Second round, from that run and from reading the changes:
- QA-050 (D-725) the production walkthrough could not be run: only the browser followed
  `PLAYWRIGHT_BASE_URL`, so the setup and the guide resets cleaned the local test database.
- QA-051, QA-052 the two test fixes of 18f2007 and 8c3cb26 had no rows, and `axe.ts` cited a
  number that now means something else.
- QA-053 (D-726) nothing proved what a student sees when the network drops mid-act.
- QA-054 a two-part emoji is stored as its parts, because the joiner is one of the invisible
  characters `stripMarkup` removes. Deliberate, now stated.
- QA-055 (D-727) `page.goto` can never settle on Firefox with the finished page on screen behind it.

**Watch in the clean re-run** (three webkit-only observations, all while a coverage measurement was
competing for the machine, so none is yet a finding):
1. `author/confirm-workspace.spec.ts:241` — **Confirm and freeze** with the teaching note
   unchecked, and the refusal sentence did not arrive within the default five seconds while the
   dialog's button still read **Confirming…**. The refusal is not cheap by design: `confirmVersion`
   loads the whole version and every confirmation to compute "undecided" before it can honestly
   reach the note check (`service.ts:1909-1927`). If it recurs on a quiet machine, measure that
   action against NFR-008 rather than widening the assertion.
2. `author/packages.spec.ts` ran 66 s against a 60 s budget on webkit — it is three flows in one
   test (a package from a seed, a whole import, a claim read back), and it only now runs to its
   full length, because before QA-046 it stopped at the missing `meridian-roast` row. Its sibling
   declares `test.setTimeout(300_000)`; if this recurs, the honest answer is a declared budget with
   the reason, not a global one.
3. The two firefox `page.goto` timeouts that D-727 answers are fixed but unproven: the fix landed
   after those repeats had run, so the clean pass is what confirms it.

A separate database `tassl_test_cov` exists for `pnpm test:coverage`, so the coverage gate can be
measured without touching the database an e2e run is using.

**Open, and to settle after that measurement:** `docs/tech/14-testing-strategy.md` §3 says the line
thresholds (`src/server/**` ≥ 80 %, `src/components/**` ≥ 70 %) are enforced "in the `unit` job
(unit + integration combined via `pnpm test:coverage`)". They are not: the `unit` job runs
`pnpm test`, and no workflow runs `pnpm test:coverage` at all, so the documented gate has never run.
The cheap resolution is to make the **integration** job run it — that job already pays for Postgres
and already runs the integration project — and to correct §3's row to say so; the reason to measure
first is that turning a gate on is only honest if what it measures already clears it.

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

The clean pass runs **one Playwright project per invocation** — this machine's memory is the binding
constraint and a four-project `--repeat-each=3` was killed twice (see the memory note in
`tassl-local-test-runners-unavailable`). The stage script is in the session scratchpad; the shape is:

```bash
bash stage.sh "$OUT" serve                                   # db:reset + pnpm start (build once, separately)
bash stage.sh "$OUT" chromium      --project=chromium        # each is --repeat-each=3
bash stage.sh "$OUT" firefox       --project=firefox
bash stage.sh "$OUT" webkit        --project=webkit
bash stage.sh "$OUT" mobile-safari --project=mobile-safari
bash stage.sh "$OUT" guides                                  # pnpm test:guides, the three-engine chain
```

Nothing heavy runs beside them: a vitest coverage run or a workflow's agents alongside an e2e pass
tips the machine over, and the failures it then produces are the machine's rather than the product's.

Then, in order:

1. **C8, the load test.** CI green → `preview-deploy` runs → `bash load-test.sh "$OUT" 60 10m 1m`
   (in the scratchpad; it reads the `preview/pr-33` Neon branch, runs `pnpm demo:reset --load-users=60`
   against it, then `pnpm test:load`). Record p95 read, p95 write, `http_req_failed` and the checks rate.
2. **Merge** with `gh pr merge --squash --auto --delete-branch`, and watch `production.yml`.
3. **C17.** `PLAYWRIGHT_BASE_URL=https://tassl.vercel.app pnpm test:smoke`; `pnpm demo:warm`;
   `pnpm env:check`; re-read `/api/health` and confirm `version` is the deployed SHA (QA-002).
4. **Step 15.5, the walkthrough against production.** The guide chain drives it, and D-725 requires
   both halves to point at the deployment:
   ```bash
   PLAYWRIGHT_BASE_URL=https://tassl.vercel.app    TEST_DATABASE_URL="$(cat ~/.config/tassl/neon-url.txt)"    SEED_PASSWORD="$(cat ~/.config/tassl/seed-password.txt)"    GUIDE_SCREENSHOT_ROOT="$OUT/prod-shots"    pnpm exec playwright test --project=guides-chromium-demo
   ```
   No local server is started and no local database is touched; the clock waits are real (the Turn is
   60–120 s, the auto-lock run two minutes). Follow it with `pnpm demo:reset`.
5. **Write the records**: `docs/release/launch-checklist-2026-09-10.md` (the 17 rows of
   `15-cicd-deployment.md` §16, each `pass` only if its own condition was met by a command whose
   output is summarised), `docs/release/walkthrough-notes-2026-09-10.md` (PRD §12 steps 1–17), the
   PROGRESS.md ticks 15.3–15.6, and `docs/qa/QA-REPORT.md` ending `ALL CLEAR`.

Two rows will not be `pass`, and the report says so rather than working around them: the fifteen
Sentry alert rules that are not cron monitors need a token carrying `alerts:write` (the one here is
`org:ci` and answers 403 to every alert endpoint), and the legal-pages review is a human act because
PII is collected (SYS-007).

## Evidence gathered so far (for QA-REPORT.md)
- Sentry (browser, 2026-09-09 17:20 ET): project `tassl` has the project alert "Send a notification for high priority issues" with the action Email; the test event `ops.sentry_test` is issue TASSL-1; cron monitors `nightly-backup` and `restore-drill` exist (the drill's last check-in before today was an error, from the run D-690 fixed).
- Backups: `backup.yml` runs at 2026-09-09 01:01, 03:53 and 08:18 UTC all `success` (the "last three" reading of launch-checklist row 4).
- Restore drill: run 34406394294 on `main`, dispatched 21:20 UTC, `success` in 3 min 15 s (21:20:49 → 21:24:04): the nightly artifact restored onto a throwaway Neon branch, smoke passed against it, the branch deleted, the Sentry cron monitor checked in. Launch-checklist row 5 is `pass`.
- Neon: branches `main`, `preview/pr-31`, `pre-demo-backup-20260909` (3 of 10); compute 6157 s used this month; storage 36 MB; cold start on `/api/ready` 2.23 s, warm 0.16 s.
- Vercel production variables (18): APP_ENV BETTER_AUTH_SECRET CRON_SECRET DATABASE_URL DATABASE_URL_UNPOOLED DEMO_MODE EMAIL_FROM EMAIL_TRANSPORT FEATURE_AI LLM_API_KEY LLM_BASE_URL LLM_PROVIDER NEXT_PUBLIC_APP_URL NEXT_PUBLIC_POSTHOG_KEY NEXT_PUBLIC_SENTRY_DSN SEED_PASSWORD SENTRY_TRACES_SAMPLE_RATE TASSL_APP_DB_PASSWORD; `pnpm env:check` green (41 schema keys; /api/ready 200).
- `demo:warm` against production 2026-09-09 16:05 ET: 14 pages, all 200; first page 2.5 s, the rest 146–335 ms.
- Impeccable `detect`: 0 open findings.
- PostHog (browser, 2026-09-09 21:28 UTC): project 600786 ("Default project", token `phc_nzFi…`, the token inlined in the deployed bundle) → Activity → Events, last hour: `sign_in_succeeded` (library posthog-node, hashed person id) from a production sign-in, plus the two `qa_posthog_probe` events sent with the project token. Events appear about a minute after they are sent; the Live stream view shows nothing for this project (it lists "Waiting for events…" while the Events view has the rows), so the Events view is the one the runbook names.
- Lighthouse (local, `bash scripts/lhci-local.sh`, 3 runs per URL, desktop preset, production build): `/sign-in` performance 99, accessibility 100, best practices 96–100, LCP 836–851 ms, TTI 836–851 ms, CLS 0.000, TBT 0; `/dev/components` performance 97–99, accessibility 100, best practices 100, LCP 882–1161 ms, TTI 902–1682 ms, CLS 0.005, TBT 0–51 ms. All `lighthouserc.json` assertions passed. The demo-path pages behind sign-in are measured by `tests/e2e/perf/web-vitals.spec.ts` (LCP, INP, CLS on the workspace, the debrief and the replay).
- Bundle budgets (`scripts/bundle-budget.ts`, gzip): every route inside its budget; largest first-load: `/dev/components` 190,701 of 205,000; the sign-in page 103,714 of 110,000; script total 530,000 of 530,000 budget line and total 1,060,000 of 1,060,000 are the `lighthouserc.json` resource-summary caps, both met.
- Impeccable (C11, 2026-09-09 22:20 UTC): `npx impeccable@3.6.1 detect --json .` → 0 open findings (gate `scripts/impeccable-gate.mjs` green). `/impeccable audit` on the screens this run added or changed (`/admin/flags` with the Assistant mode and Sentry panels, the assistant-mode chip in the run workspace, the assignment runs table's Replay column, the account menu's Privacy and Terms items, the readable device names on Security), read from the code and from the production build at 1440×900 and 390×844 signed in as the platform admin: one h1 per page; every radio labelled through its title id; both buttons 40 px tall and `aria-disabled` with their reason sentence beside them when they cannot act; no horizontal page overflow at 390 px; every colour a DESIGN.md token (paper, ink, ink-muted, primary, primary-soft); IBM Plex Serif headings, Plex Sans body, Plex Mono for flag names and values; no dark mode exists by design (D-699 context: light only). Scores — Accessibility 4, Performance 4 (no images, dialogs loaded on the press that opens them), Responsive 3 → 4 after the one finding, Theming 4, Implementation integrity 4 (detector clean, no template structure): 20/20 after the fix. The one finding (P3): the flag table and the model-usage table forced a 672 px minimum width, so on a phone their last column sat behind a horizontal scroll inside the panel; both now wrap their columns (`flag-table.tsx`, `llm-usage-table.tsx`). Positive: the switch is a confirmed act (two radios and a save) rather than a toggle that writes on change; the reason a control cannot act is spoken by the control.
- 2026-09-10 02:30–04:10 UTC: the first full E2E pass (`--repeat-each=3`, three engines) was stopped after chromium because it was failing for reasons that had to be fixed at the root rather than watched to the end. Found and fixed: (1) `useRefresh()` (D-709) dropped a remembered refresh when the component that started the flight was unmounted by its own refresh — "51 of 93 confirmed" stayed on screen after a second element was confirmed (3 of 3 repeats; D-713, `src/lib/hooks/use-refresh.ts`, five unit tests); (2) the open-redirect check's backslash case had lost its backslash to an editor and was testing `/evil.example`, a same-site path the form rightly honours — the case is now built from the character code (`tests/e2e/security/headers.spec.ts`); (3) the browser smoke check assumed the seeded course sits on the first page of Courses, which is true of production and false of a database the suites have added courses to — it now walks "Show more courses" (`tests/e2e/smoke/screens.spec.ts`); (4) Better Auth admitted ten sign-ins a minute per client address, which refuses the eleventh student of a section signing in from one campus address (NFR-014) — 120 sign-ins, 60 sign-ups, 600 other auth calls a minute per address now, the per-account lockout (D-704) unchanged, and `tests/integration/auth/flows.test.ts` admits 120 sign-ins from one address and refuses the 121st (D-712). CI's integration job on a70a72b had also failed on seven stale expectations of this session's own D-703/D-707/`app_settings` changes; the six files now expect what the code does. Load test (C8): `pnpm demo:reset --load-users[=N]` makes the load accounts and their assignment (`ensureLoadSeats`, seed test), the k6 script ramps the arrival over one minute and signs each virtual user in once, and the spec sections 04/14/15 §16.2/16 name `tests/load/core-flow.js` (D-711).
- C16 (2026-09-10 05:00–06:30 UTC): five readers compared every guide step and runbook row with its screenshot (348 images). Found: 110 steps naming accessible names a reader never sees, 90 captures showing the top of a page while the step described something below the fold, three stale images (the account menu before Privacy/Terms; "Student seat"), one mid-load capture, one capture before a re-render, five false statements in the runbook (QA-038, QA-039). Fixed at the root: `shot(task, step, show)` scrolls the subject into view (D-714), every guide names visible text, the runbook's facts follow the code, and `scripts/check-guide-coverage.ts` reports 28 tasks and 321 steps matching their specs. The chromium chain is recapturing every image; the reading is repeated on the new images before the report. Also from the stopped ×3 pass: QA-036 (axe read a fading dialog), QA-037 (the Turn walk aimed at the wrong chip after D-705), QA-040 (the llm-bucket test straddled a minute), QA-041 (four workers on one laptop; D-715). The ×3 pass restarts clean once the chain is green.
