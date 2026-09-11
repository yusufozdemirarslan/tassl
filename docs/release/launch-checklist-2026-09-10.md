# Launch checklist — 2026-09-10

**Purpose / Read this when:** you are running Step 15.3 of `build-plan/phase-15-release.md`, or you
want to know what was verified before this release of Tassl went live and what was not.

The rows are `15-cicd-deployment.md` §16 in order. `PROD_URL` is `https://tassl.vercel.app` (no
`APP_DOMAIN` is set, so Step 15.4 is a no-op and the Vercel-assigned domain is the active one). The
release is `main` at `77cb94b`, which `/api/health` reports as the version it is serving.

> **Re-verified on 2026-09-11 against the release then live** (`production.yml` green on `main`, all
> eleven checks, deploy 4.3 minutes, Vercel status Ready; `/api/health` reports the sha it serves). Rows 1–3, 12, 13 and 17 were run
> again in full against that release and all six pass; rows 4, 5, 7–10, 14–16 are unchanged evidence
> from runs that are named in the row itself; rows 6 and 11 are still `partial` and `blocked` for
> the same reasons, which no redeploy changes. Row 17's walk took 10.5 minutes on this release and
> carried the network guard of D-737.

A row is `pass` only if its own pass condition was met by a command whose output is summarised here.
A row that depends on a credential nobody has created is `blocked`, and says on what. Nothing is
marked `pass` on the strength of a test that stands in for the check.

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | TLS and HSTS on the active domain | pass | `/sign-in` answers `HTTP/1.1 200` with `strict-transport-security: max-age=63072000; includeSubDomains; preload`. §16's condition names `HTTP/2 200` on `/`, which `/` does not return: an anonymous request is `307` to `/sign-in` by design, and `scripts/smoke.sh` asserts that redirect. Read on the page that is actually public. |
| 2 | Security headers (SYS-015, NFR-011) | pass | All eight present on `/sign-in` with the §16.1 values: `content-security-policy` beginning `default-src 'self'` with a per-request nonce, `cross-origin-opener-policy: same-origin`, `permissions-policy: camera=(), microphone=(), geolocation=()`, `referrer-policy: strict-origin-when-cross-origin`, `strict-transport-security` as above, `x-content-type-options: nosniff`, `x-frame-options: DENY`, `x-request-id` a UUID. `cache-control: no-store` on `/api/health` and `/api/ready`. |
| 3 | Health and routes | pass | `bash scripts/smoke.sh https://tassl.vercel.app` → `smoke passed`. `PLAYWRIGHT_BASE_URL=https://tassl.vercel.app pnpm test:smoke` → 8 passed in 24.0 s, including `/api/health` carrying the deployed sha. |
| 4 | Backups running | pass | The last three `backup.yml` runs are `success`: 2026-09-10 08:17, 2026-09-09 08:18 and 2026-09-09 03:53 UTC. The artifact holds one `tassl-YYYY-MM-DD.dump.enc`. |
| 5 | Restore verified by a drill | pass | `restore-drill.yml` run 34406394294 on `main`, `success` in 3 min 15 s: the nightly artifact's checksum verified, restored onto a throwaway Neon branch, `smoke.sh` green against it, the branch deleted, and the Sentry cron monitor checked in. Well inside §16's 60-minute bound. |
| 6 | Alerts on | partial | The three cron monitors — `nightly-backup`, `restore-drill`, `jobs-drain-daily` — exist, because a cron monitor creates itself from its first check-in, and the project alert "Send a notification for high priority issues" exists with the Email action. Of the other fifteen rules in `13-observability-ops.md` §7, fourteen are not created and one, `NFR-007 readiness down`, is deliberately absent (D-698: nothing may poll `/api/ready` on a schedule). Creating the fourteen needs a Sentry token carrying `alerts:write`; the token on the builder's machine is an organisation CI token, scope `org:ci`, and it answers 403 to every project and alert-rule endpoint. That value is a secret, which is the one human input this run has. |
| 7 | Sentry receiving events | pass | `scripts/sentry-test.ts` with the production DSN produced an event that appeared under Sentry → Issues as `ops.sentry_test`, level Warning, short id `TASSL-1`, within a minute. `/admin/flags` → **Send a test event to Sentry** does the same from inside the deployment (D-708). |
| 8 | Sentry release tagging | pass | The deploy uploads source maps as artifact bundles keyed by debug id, and inlines the release as `SENTRY_RELEASE`; `/api/health` reports it as `77cb94baf31f14ebcecd72820277b163836ceb4a`, which is `main` HEAD. |
| 9 | PostHog receiving events | pass | PostHog project 600786 → Activity → Events: `sign_in_succeeded` (library `posthog-node`, hashed person id) from a production sign-in, plus two `qa_posthog_probe` events. Events appear about a minute after they are sent; the Live stream view shows nothing for this project, so the Events view is the one the runbook names. |
| 10 | Load test (NFR-014, D-102) | pass | k6 against the PR-35 preview, 60 virtual users, one-minute ramp then ten minutes: **99,580 checks, 100 % succeeded, `http_req_failed` 0.00 %**, p95 read 212.63 ms against a 400 ms budget and p95 write 438.14 ms against 800 ms, 24,880 iterations. Two earlier attempts measured nothing and are recorded rather than hidden: the first was merged into mid-run and hit `DEPLOYMENT_NOT_FOUND` (D-733), and the second exposed a real defect in the script itself — k6 empties the per-VU cookie jar between iterations, so each user ran one iteration signed in and the rest signed out (D-734, QA-064). |
| 11 | Legal pages reviewed by a human | blocked | `/privacy` and `/terms` both answer 200 and name the data collected (name, email, run traces) and the processors (Vercel, Neon, Resend, PostHog, Sentry, Xiaomi MiMo, Anthropic). The review itself is a human act and is the builder's: PII is collected (SYS-007, D-017), so the build cannot sign it off. |
| 12 | Production env vars set | pass | Eighteen variables; `pnpm env:check` green over 41 schema keys with `/api/ready → 200`. Correctly absent: `FEATURE_TEST_CONTROLS`, whose default `true` is what walkthrough step 7 needs (D-023). `RESEND_API_KEY` is empty and `EMAIL_TRANSPORT` is `console` (D-686): production logs email and delivers none, because there is no sending domain to verify. Seeded seats are unaffected; self-service sign-up cannot complete, which is why `DEMO_MODE` exists (D-692). |
| 13 | Seed accounts present in production (D-040) | pass | Five seat accounts, the walkthrough course and section, the confirmed Meridian Roast fixture version and the three assignments. Sign-in verified end to end for `instructor@tassl.local`, `student1@tassl.local` and `admin@tassl.local` during `demo:warm` and the demo path. |
| 14 | Cron registered | pass | `vercel crons ls` → one job, `/api/internal/jobs/drain` at `0 4 * * *`. |
| 15 | Branch protection | pass | `gh api repos/…/branches/main/protection` lists the eleven `checks / …` contexts, `checks / guides` included. |
| 16 | Cross-browser E2E | pass | `cross-browser.yml` run 34515616056, `--repeat-each=3` over all four Playwright projects (D-731): chromium 297 runs in 19.9 m, firefox 294 in 21.0 m, webkit 294 in 24.0 m, mobile-safari 24 in 2.1 m — **909 test runs, 0 failed**. The row had said "local, all three projects"; the builder's 16 GB cannot hold that run, and three attempts produced only kills, so it runs where it means something. |
| 17 | Walkthrough script | pass | The demo path — PRD §12 steps 1–17 as the 27 rows of `docs/guides/demo-runbook.md` — walked against production in a real Chromium in 7.5 minutes, both seats, 27 screenshots, zero console errors. Recorded in `walkthrough-notes-2026-09-10.md`. |

Fifteen `pass`, one `partial` (row 6), one `blocked` (row 11). Neither of the two is worked around:
each says what is missing and what would close it.
