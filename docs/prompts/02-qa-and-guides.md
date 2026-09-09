# Claude Code Prompt — Tassl User Guides, Guide-Driven Tests, Full QA, and Fix-Everything Run

> **How to run:** Save as `docs/prompts/02-qa-and-guides.md`. Start Claude Code at the repo root with `claude --permission-mode acceptEdits`, select the model for this run, and send the short instruction in Section 11. If the session ends before the last line of `docs/qa/QA-REPORT.md` reads `ALL CLEAR`, send the same instruction again — the run resumes from `docs/qa/PROGRESS-QA.md`.

---

## 0. Fixed context — already decided, do not ask

| Item | Value |
|---|---|
| App | **Tassl**, built per `docs/tech/` and `docs/tech/build-plan/phase-00` … `phase-15`. Stack: Next.js App Router (Node runtime), TypeScript, Tailwind + shadcn/ui, Drizzle + Postgres (Neon in production), Better Auth (or Auth.js — check `DECISIONS.md`), Vitest, Playwright + axe, MSW, Lighthouse CI, Sentry, PostHog, Resend, Vercel AI SDK behind an `LlmProvider` interface (`openai-compatible` → MiMo-V2.5-Pro, `mock`, fallback), `FEATURE_AI` flag, Impeccable for UI. |
| Purpose of this run | Deliver a **fully working, demo-proof app**: a judged, non-commercial demo. Every problem found is fixed in this run. The output is a live production deployment that passes every check, plus guides and tests that prove it. |
| Outcome rule | **Nothing is left open.** No "known issue", no "recommended next step", no "decide whether to…", no question to the user — in chat, in the report, in the runbook, anywhere. Every sentence you write is a statement of what was done or what is true. |
| Hosting constraints | Vercel Hobby with Fluid compute (default for new projects): function duration **300 s default and maximum**, request/response body **4.5 MB max**, functions run in **`iad1`** unless configured, **1,024 file descriptors** shared across concurrent executions. Neon Free: **10 branches**, **100 CU-hours/month**, **0.5 GB storage**, compute suspends after 5 minutes idle and cold-starts on the next request. GitHub Actions: 2,000 min/month if the repo is private, unlimited if public. |
| Personas ("both sides") | Use the persona names from `docs/tech/01-prd-analysis.md`. If the PRD does not name them, use **Instructor** (creates courses, assignments, scenario packages; authors content; reviews results) and **Learner** (runs scenarios, works with the assistant, delegates, locks answers, defends, gets debriefed). |
| Demo mode | `DEMO_MODE=true` in production: email verification auto-confirmed, console email transport, seeded demo accounts. Primary demo login is email + password. Google OAuth is secondary and only admits accounts listed as test users in the Google Cloud consent screen (app in Testing status). |
| External actions | Anything that requires a human action outside the repo — paying for a plan, buying a domain, editing the Google console, adding a card — is **not a fix path**. Always choose the in-repo path that makes the app fully functional without it (`DEMO_MODE`, email+password, `mock` AI fallback, free-tier-safe settings). The runbook may state as a fact how an external action is performed; it never asks whether to do it. |
| Language | Guides and report in plain English for a reader who has never done software QA. Technical detail goes in appendices. |

## 1. Mission — three parts, in this order

**Part A — User guides.** A complete, step-by-step user guide for each persona plus a presenter's demo runbook. Every step names the exact button, menu, and field label as it appears in the running app and states what the user sees next.

**Part B — Guide-driven tests.** Every task in every guide becomes a Playwright test whose steps mirror the guide 1:1, captures a screenshot at every step, embeds those screenshots in the guides, and a coverage check fails CI if any guide step has no test. A guide step that cannot pass is a defect in the app; the app is fixed until it passes.

**Part C — Full QA and fix-everything.** Run the complete checklist in Section 6 against the local production build and the live deployment. Fix everything found, in severity order, until every section is 🟢. Redeploy. Re-verify against the live URL.

**The run is complete only when all of the following are true:** `pnpm qa:all` is green locally on all browsers; the fixed app is deployed to production from `main`; `pnpm test:smoke` passes against the live production URL; `docs/qa/FIXED-ISSUES.md` has zero rows with a status other than `fixed`; `docs/qa/QA-REPORT.md` is complete and its last line is `ALL CLEAR`.

## 2. Hard rules

1. **Never stop for input, never ask.** Resolve every ambiguity with `docs/tech/DECISIONS.md`, its Decision Policy, and the rules here; log new decisions in `DECISIONS.md`. The only permitted stop is if the repo has no `docs/tech/` folder.
2. **Everything found gets fixed in this run.** Severity (Section 7) decides the *order* of fixing, never whether to fix. There is no "log only" category.
3. **No placeholders** in any file you write: no `TBD`, `TODO`, `[EDIT ME]`, `<your-…>`, "as needed", "optional" without a stated default. Secrets are named by env var, with where to obtain them and a non-secret default that keeps the app working.
4. **Unbuilt is a problem.** Read `docs/tech/PROGRESS.md` first. If any phase is unfinished, execute the remaining phase files first, following `docs/tech/00-README.md`, then begin Step 0. No feature in the PRD is left as "not in this version".
5. **Guides describe the real app.** Read labels from the code (`grep` component text, route files, `aria-label`s), then open every screen in the production build and confirm. Never describe a screen from the spec alone.
6. **Production build, not dev.** Local testing runs against `pnpm build && pnpm start` with `.env.test` (mock LLM, console email, local Postgres via Docker Compose). Live checks run against the production URL from `vercel project ls` / the Vercel dashboard, recorded in the report.
7. **Every fix gets a regression test** that would have caught it. Every defect gets a row in `docs/qa/FIXED-ISSUES.md`: id, severity, where a judge would have seen it, root cause, fix commit, guarding test, status `fixed`.
8. **Never fake a pass.** No loosened assertions, no `test.skip`/`test.fixme`, no timeouts widened beyond the budget, no caught-and-swallowed errors, no deleted tests. A flaky test is fixed at its root cause, not retried.
9. **Never skip a check.** If a tool is missing, install it; if it cannot be installed, use the named alternative (k6 → autocannon; `cspell` via `npx`; gitleaks binary → `npx gitleaks`).
10. **Commit at the end of each part and after each C-section** with conventional messages. Never commit secrets; `.env*` stays ignored.
11. **Context and resumability.** Write files incrementally. Run long suites in the background and keep working. Delegate independent read-only audits (C4 authorization review, C5 prompt-injection design, C9 security review) to subagents and apply their findings in the main session. Update `docs/qa/PROGRESS-QA.md` after every section with: sections done, section in progress, open fix in progress, next command. When context fills, `/compact` and continue from that file. If the session ends, the next session resumes from it — the report is never written with unfinished sections.
12. **Do not touch** the PRD or rewrite `docs/tech/build-plan/*` (executing unfinished phases per rule 4 is allowed; re-planning is not).

## 3. Step 0 — Orientation and baseline (write `docs/qa/00-baseline.md`)

1. Read `CLAUDE.md`, `docs/tech/PROGRESS.md`, `DECISIONS.md`, `COVERAGE.md`, `01-prd-analysis.md` (screens, flows, personas), `09-frontend-spec.md`, `07-api-spec.md`, `11-llm-integration.md`, `05-environment-config.md`, `15-cicd-deployment.md`.
2. `git log --oneline | head -50`, `git status`; confirm a clean tree (commit or stash anything pending).
3. Start local infra: `docker compose up -d`, `pnpm db:migrate`, `pnpm db:seed`. Record the seeded demo accounts (emails, roles) in `docs/qa/demo-accounts.md` (gitignored). These are the accounts the guides use.
4. `pnpm typecheck && pnpm lint && pnpm test && pnpm test:integration`, then `pnpm build && pnpm start &` and `pnpm test:e2e`. Record pass/fail counts, duration, and every failure verbatim. Fix nothing yet — baseline only.
5. Fetch and skim three references; write a 40–60 line `docs/qa/research-notes.md` listing only items **not already** in Section 6 that apply to Tassl, then treat them as additional C-items to check and fix:
   - https://nextjs.org/docs/app/guides/production-checklist
   - https://vercel.com/docs/functions/limitations
   - OWASP Top 10 for LLM Applications (2025) — search for the current page.
6. Identify the **demo path**: the exact click sequence a judge will see (instructor creates/assigns → learner runs a scenario with the assistant → delegates → locks → defends → sees trace/scoring → debrief → instructor reviews). Write `docs/qa/demo-path.md`. Every later section treats this path as P0.
7. Create `docs/qa/PROGRESS-QA.md` and `docs/qa/FIXED-ISSUES.md` (empty table with the columns from rule 7).

## 4. Part A — User guides (`docs/guides/`)

Files: `README.md` (index, who reads what, demo accounts reference), `instructor-guide.md`, `learner-guide.md`, `demo-runbook.md`.

**Structure of each persona guide:**
1. **Who this is for / what you can do** — 5–8 lines.
2. **Getting started** — sign in with the demo account (exact email; password in `docs/qa/demo-accounts.md`), first screen explained, navigation map (every top-level menu item, one line each).
3. **Tasks** — one `### Task N: <verb phrase>` per job the persona performs, in the order a new user would do them. Each task: *Goal* (one line); *Steps* (numbered; each names the exact UI label in **bold** and ends with "→ You see: …"); a *Screenshot* line per step (`![Task N step M](screenshots/<persona>/task-NN-step-MM.png)`, produced in Part B); *If something goes wrong* (the 1–3 realistic messages the user can hit and what they mean). Cover every screen in the screen inventory this persona can reach, every state (empty, loading, error) they can encounter, and the whole demo path.
4. **Working with the AI assistant** (learner) / **What the AI does and does not do** (instructor): purpose, what it refuses, what happens when AI is unavailable (the banner and fallback behavior), and that the demo may run with a scripted assistant.
5. **Troubleshooting & FAQ** — 8–12 real questions derived from the code paths (rate-limit message, locked answer, session expired, cold-start delay).
6. **Glossary** — every domain term (run, scenario package, delegation, reliance, lock, turn, defense, trace, debrief) in one sentence, consistent with the UI copy.
7. Footer: `Verified by automated tests: <date>, commit <sha>` — written by the coverage script in Part B, not by hand.

**Demo runbook (`demo-runbook.md`)** for the presenter: T-60 min warm-up (`pnpm demo:warm`, quota numbers to read off the Neon and Vercel dashboards, Sentry quiet, production login works); the demo path click-by-click with what to say and expected timings; a *break-glass* table (symptom → cause → exact commands → measured time to recover) covering AI provider slow or down, Neon compute suspended or cold, Vercel deployment error, Google sign-in refusing a judge, rate limit hit, browser tab lost mid-run, projector resolution; and the **fully offline fallback**: `docker compose up -d && pnpm demo:reset && pnpm build && pnpm start` on the laptop with `LLM_PROVIDER=mock`. Every row is a statement of what to do, never a choice to make.

**Rules:** UI labels verbatim; second person, present tense; one action per step; no marketing language; screenshots referenced exactly where the tests write them; guides and app copy use identical terms — if the app is inconsistent ("Scenario" on one screen, "Package" on another), fix the app copy to match the glossary.

## 5. Part B — Guide-driven tests (`tests/e2e/guides/`)

**Mapping rule:** one `test.describe` per guide, one `test` per `### Task N`, one `await test.step("N.M <step text>", …)` per numbered step, same order and wording as the guide. The assertion of each step is the guide's "→ You see:" line. If a step cannot be asserted as written, fix whichever is wrong — guide or app — and re-run.

**Files:** `tests/e2e/guides/instructor-guide.spec.ts`, `tests/e2e/guides/learner-guide.spec.ts`, `tests/e2e/guides/demo-path.spec.ts` (the full demo path end to end as one test, tagged `@smoke`), `tests/e2e/guides/fixtures.ts` (login helpers for the seeded accounts, deterministic clock, `page.on('pageerror')` and `page.on('console')` collectors that fail the test on any uncaught error or `console.error`).

**Screenshots:** after every step, `page.screenshot({ path: 'docs/guides/screenshots/<persona>/task-NN-step-MM.png' })` at 1440×900, light mode. Committed; referenced by the guides. Seeded data is fake, so nothing is masked.

**Coverage check:** `scripts/check-guide-coverage.ts` parses `### Task N:` headings and numbered steps from each guide, parses `test(` and `test.step(` titles from the matching spec, and fails with a list if any task or step lacks a test or any test lacks a guide step. On success it rewrites the guide footer with today's date and `git rev-parse --short HEAD`. Wire as `pnpm test:guides` (check → Playwright on all projects → check) and add it to the PR workflow.

**AI steps:** locally the `mock` provider is deterministic; guide text describes assistant behavior generically ("the assistant replies with a suggestion you can accept or reject"); tests assert structure (a reply appears, controls enable, the reply is stored), not wording. With `LLM_PROVIDER=openai-compatible` and a key present, the same tests must also pass — run them that way once and record the result.

**Smoke against production:** `tests/e2e/smoke/*.spec.ts` (tag `@smoke`: home loads, sign in, one screen per persona, `/api/health` 200, `/api/ready` 200, AI banner state correct) runnable with `PLAYWRIGHT_BASE_URL=<production URL> pnpm test:smoke`. Add a post-deploy job to the production workflow that runs it.

## 6. Part C — QA audit and fixes

For every item: run the check, fix whatever fails (Section 7), re-run until it passes, record the evidence in the report appendix. **A C-section is finished only when it is 🟢.**

**C1 Static, build, and hygiene**
- `pnpm typecheck`, `pnpm lint`, `pnpm build` with zero warnings; `pnpm audit --prod` with no high/critical — resolve by upgrade, `pnpm.overrides`, or replacing the dependency; `npx depcheck` unused deps removed.
- No `console.log` in `src/` (except the logger); no `TODO|FIXME|lorem|placeholder|EDIT ME` in `src/` or `docs/guides/`; `npx cspell "docs/guides/**/*.md"` clean (project dictionary for domain terms).
- **Clean-clone build**: `git clone <repo> /tmp/tassl-clean && cd /tmp/tassl-clean && pnpm install --frozen-lockfile && pnpm build` succeeds. Lockfile committed; `.nvmrc` matches `engines`.
- **Secrets**: `gitleaks detect --source . --log-opts="--all"` clean (rewrite history only if a real secret is found, and rotate it); `.env*` ignored; no secret-shaped strings in the client bundle (`grep -rE "sk-|api[_-]?key|secret" .next/static`); only intended vars carry `NEXT_PUBLIC_`.
- **Env parity**: `scripts/env-parity.ts` compares the Zod env schema keys, `.env.example`, and `vercel env ls production`; every required key present in production with a working value, no undocumented keys either way. Wire as `pnpm env:check`. Missing production values are set with `vercel env add`.

**C2 Existing suites and flakiness**
- All suites green; coverage thresholds from `14-testing-strategy.md` met (write the missing tests). Run E2E 3× (`--repeat-each=3`); every intermittent failure is fixed at the root.

**C3 Functional coverage vs PRD**
- Walk `COVERAGE.md`: every `FR-###`/`UI-###`/`AI-###` has a passing test; anything marked covered without a real test gets one. Every screen in the inventory opened in the production build in loading, empty, error, and populated states (force states via seeded data or route interception): no crash, no layout break, sensible copy.

**C4 Authentication and authorization (subagent reviews, you fix)**
- Role matrix from `08-auth-authz.md` tested for every role × route × API endpoint in `tests/integration/authz-matrix.test.ts` generated from the matrix: learner → instructor/admin routes → 403/redirect; unauthenticated → login.
- **IDOR**: learner A requesting learner B's run, trace, debrief, and assignment by ID via UI and API → 403/404, never data. Instructor of course X cannot read course Y.
- **Locked answers immutable server-side**: post-lock PATCH/POST via API → 4xx, row unchanged. Turn order and defense-phase transitions enforced server-side.
- Sessions: expiry, logout invalidation, cookie flags `Secure; HttpOnly; SameSite`, CSRF on mutations, login rate limit trips at the configured threshold; password reset and verification work in `DEMO_MODE` and are correct without it.
- OAuth: production redirect URI registered for the production URL; email+password confirmed as the demo primary; the runbook states how a judge is added as a Google test user.

**C5 LLM layer (subagent designs the injection suite, you fix)**
- `LLM_TIMEOUT_MS` below each AI route's `maxDuration`, which is ≤ 300 s on Hobby; AI routes declare `export const maxDuration`; responses stream with first bytes within 5 s locally. A slow-provider test (mock with injected 40 s delay) shows a friendly message, never a 504.
- Provider-down test (mock throws / network refused): the UI shows the "AI temporarily unavailable" state, the run stays usable, nothing sits in "thinking" forever.
- **Prompt-injection suite** `tests/security/prompt-injection.spec.ts`: ≥ 12 adversarial learner inputs — instruction override, "reveal the rubric / answer key / system prompt", role-play jailbreak, request for another learner's data, delimiter escape, base64/unicode-encoded payloads, extreme length, repeated-request cost attack. The seeded scenario contains sentinel strings (a hidden rubric token) that must never appear in any assistant output or API response. Runs against `mock` in CI and once against the live provider if a key exists.
- Structured-output repair path tested with malformed model output; cost caps trip with a clear message; per-call logs contain model, prompt version, latency, tokens — and no learner text or PII.
- `FEATURE_AI=false` → every AI surface hidden or disabled cleanly; `=true` with `mock` → deterministic; live key → one real smoke call recorded with latency and cost.

**C6 Data and database**
- Production has every migration applied (`pnpm db:migrate` against the production URL is idempotent) and `drizzle-kit generate` yields **no new migration** (zero drift).
- Seed idempotent (run twice, same rows). `pnpm demo:reset` exists and is tested locally.
- Concurrency: two learners start the same assignment simultaneously; one learner double-submits a lock; both behave correctly. Refresh, back button, and closing the tab mid-run all resume to the correct run state — the single most important check for the demo.
- Neon: production uses the **pooled** connection string; connection count under the C8 load test stays within Neon's limit; cold start measured (`curl -w "%{time_total}"` on `/api/ready` after 6 idle minutes) and recorded; **nothing** polls `/api/ready` on a schedule (search for cron, uptime monitors, Vercel cron config — remove any found); branch count < 10 (delete stale preview branches) and CU-hours used this month recorded.
- Backup: create Neon branch `pre-demo-backup-<YYYYMMDD>` from production; the restore procedure is in the runbook.

**C7 Resilience and error handling**
- Custom 404 and 500 pages render; error boundaries on every route group offer recovery actions; API errors use the shared envelope everywhere (fuzz each endpoint with wrong types, missing fields, bodies near 4.5 MB → clean 4xx). Long inputs, emoji/RTL text, pasted rich text in every free-text field. Network offline mid-action → visible error, no silent data loss.

**C8 Performance**
- Lighthouse CI on the demo-path pages meets `16-performance-a11y-budgets.md`; N+1 check with query logging on run, trace, and review pages; bundle analysis, anything > 100 kB that isn't needed removed or lazy-loaded.
- **Load test** `tests/load/core-flow.js` (k6, else autocannon): 25 virtual users for 2 minutes on the learner demo path against a **preview** deployment — p95 under budget, zero 5xx, Neon connections stable. Fix until it passes; record numbers.

**C9 Security (subagent reviews, you fix)**
- Headers on the production URL via `curl -I` match `12-security.md`: CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, frame protection. Open-redirect check on login `callbackUrl`. Rate limits verified on auth and AI endpoints. Upload validation if uploads exist. No raw SQL without parameters. `robots.txt` → `noindex` (the judged demo stays out of search engines).

**C10 Accessibility**
- axe passes on every screen; keyboard-only completion of the entire demo path; focus trapped in modals and restored on close; visible focus rings; contrast per Impeccable audit.

**C11 UI, copy, and projector readiness**
- `/impeccable audit` and `npx impeccable detect --json .` across the app; fix findings. Viewports: 1920×1080 at `deviceScaleFactor: 1.25` (projector with OS zoom 125 %), 1440×900, 1024×768, 390×844. Light and dark mode if both exist. Loading skeletons wherever data loads; empty states wherever lists can be empty; terminology identical to the glossary; dates/times in the browser timezone.

**C12 Cross-browser**
- Playwright projects: chromium, firefox, webkit, plus mobile Safari viewport. Guide tests pass on all.

**C13 Observability**
- Sentry receives a test event from production (via an admin-only route) and has an alert rule emailing on new issues; PostHog receives the demo-path events; logs contain no PII or secrets; `/api/health` and `/api/ready` return 200 in production.

**C14 Deployment and configuration**
- Vercel project: Fluid compute on, Node version matches `.nvmrc`, framework preset Next.js, function region set to match the Neon region; production env vars complete (C1 parity); `DEMO_MODE=true`, `FEATURE_AI` and `LLM_PROVIDER` as intended. Latest production deployment built from `main` HEAD; instant-rollback target (`vercel rollback` to the previous production deployment) written in the runbook. Neon branches < 10. Vercel usage checked against Hobby limits.

**C15 Demo safeguards (build all four)**
1. **Runtime AI kill switch**: admin-only setting (`app_settings` table, key `ai_mode` = `live | mock`) read per request by the LLM provider factory, toggled from `/admin`, with tests. The runbook also states the env-var route (`vercel env rm LLM_PROVIDER production && vercel env add LLM_PROVIDER production` → `mock` → `vercel redeploy <deployment-url>`) with its measured time as a second layer.
2. `pnpm demo:warm` (`scripts/demo-warm.ts`): hits `/api/ready`, then loads every demo-path page as the demo instructor and learner, so Neon is awake and functions are warm.
3. `pnpm demo:reset` (`scripts/demo-reset.ts`): restores the seeded demo state — fresh course, assignments, scenario packages, one completed run with trace/score/debrief so review screens are never empty, unused learner accounts ready.
4. `docs/qa/PRE-DEMO-CHECKLIST.md`: a 10-minute morning-of checklist — quota numbers to read off the Neon and Vercel dashboards, MiMo credit balance, warm-up, one full dry run of the demo path at projector resolution, AI mode confirmed, runbook open on a second screen. Statements only.

**C16 Guides verified**
- `pnpm test:guides` green on all browsers; every screenshot present and current; footer dates updated; a full read of both guides against the screenshots for wording and accuracy.

**C17 Redeploy and live verification**
- Merge all fixes to `main`; the production workflow deploys. `PLAYWRIGHT_BASE_URL=<production URL> pnpm test:smoke` passes; `pnpm demo:warm` against production passes; `pnpm env:check` passes; the demo path is walked once manually in a real browser against production. Any failure loops back to the relevant C-section.

## 7. Severity — decides order only

| Severity | Definition | Order |
|---|---|---|
| **P0** | Crash, data loss, security leak (cross-user data, secrets, rubric exposure), any failure on the demo path | First, immediately, before continuing the section |
| **P1** | A documented task fails or misbehaves off the demo path; copy that would confuse a judge; accessibility blocker | Next, before the section is marked 🟢 |
| **P2** | Cosmetic, inconsistency, minor performance miss on a non-demo page | Last within the section — still fixed before the section is marked 🟢 |

Every fix follows rule 7 (regression test + `FIXED-ISSUES.md` row) and rule 8 (never fake a pass).

## 8. Deliverables (all must exist at the end)

- `docs/guides/README.md`, `instructor-guide.md`, `learner-guide.md`, `demo-runbook.md`, `screenshots/**`
- `tests/e2e/guides/*.spec.ts`, `tests/e2e/smoke/*.spec.ts`, `tests/security/prompt-injection.spec.ts`, `tests/integration/authz-matrix.test.ts`, `tests/load/core-flow.js`
- `scripts/check-guide-coverage.ts`, `scripts/env-parity.ts`, `scripts/demo-warm.ts`, `scripts/demo-reset.ts`
- `package.json` scripts: `test:guides`, `test:smoke`, `test:security`, `test:load`, `env:check`, `demo:warm`, `demo:reset`, `qa:all` (everything except load)
- `.github/workflows/*`: guide coverage + `test:guides` in PR checks; post-deploy `test:smoke` in the production workflow
- `docs/qa/00-baseline.md`, `research-notes.md`, `demo-path.md`, `PROGRESS-QA.md`, `FIXED-ISSUES.md`, `PRE-DEMO-CHECKLIST.md`, `QA-REPORT.md`
- `docs/tech/DECISIONS.md` updated with every decision made in this run; `CLAUDE.md` updated with the new commands and the rule "guides and tests are one artifact — change both together"
- A live production deployment from `main` HEAD that passes C17

## 9. `docs/qa/QA-REPORT.md` — format

Statements only. No questions, no recommendations, no "consider", no "you may want to". If a sentence would ask the reader to decide something, the decision has not been made yet — make it, do it, and write what was done.

1. **Verdict** — one paragraph: Tassl is ready for the demo; production URL; commit SHA; the demo accounts.
2. **Results table** — one row per C1–C17: 🟢, what was tested (one line), problems found (count), problems fixed (same count).
3. **What was fixed** — numbered, each with the symptom a judge would have seen, the root cause, the fix, and the test that now guards it.
4. **Operating facts** — the constraints the demo runs under, stated as facts: free-tier quotas and current usage, Google sign-in limited to listed test users, AI runs live with the scripted fallback one click away, and the offline fallback command.
5. **Numbers** — tests by type, coverage %, Lighthouse scores, load-test p95 and error rate, Neon cold-start time, CU-hours and branches used, Vercel usage vs limits, live LLM smoke-call latency and cost.
6. **How to re-run everything** — `pnpm qa:all`; `pnpm test:smoke` against production; `pnpm test:load` against a preview.
7. **Appendix** — per-item evidence.
8. Last line, alone: `ALL CLEAR`

## 10. Execution order and resumability

Step 0 → (any unfinished build phases) → Part A → Part B → C1–C3 → C4–C6 → C7–C9 → C10–C14 → C15 → C16 → C17 → report. Commit after each. Update `docs/qa/PROGRESS-QA.md` after every section and after every fix. When context fills, `/compact` and continue from that file. If the session ends for any reason, the next session reads `PROGRESS-QA.md` and continues; the report is written only after C17 passes. There is no early-exit path.

## 11. The instruction to send in Claude Code

```
Read docs/prompts/02-qa-and-guides.md and execute it end to end. Do not stop for input and do not ask me anything. Fix every problem you find — nothing is left open, no known issues, no recommendations, no questions in any file. You are finished only when pnpm qa:all is green on all browsers, the fixed app is deployed to production, pnpm test:smoke passes against the live URL, and the last line of docs/qa/QA-REPORT.md is ALL CLEAR. If context runs low, update docs/qa/PROGRESS-QA.md, compact, and continue.
```

---

Begin with Step 0 now. Do not stop for confirmation at any point; run Step 0 through Section 9 in one pass and stop only when the last line of `docs/qa/QA-REPORT.md` is `ALL CLEAR`.
