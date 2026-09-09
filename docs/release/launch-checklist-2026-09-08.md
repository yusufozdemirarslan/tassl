# Launch checklist — 2026-09-08

**Purpose / Read this when:** you are running Step 15.3 of `build-plan/phase-15-release.md`, or you
want to know what was verified before Tassl was declared live and what was not.

The rows are `15-cicd-deployment.md` §16 in order. `PROD_URL` is `https://tassl.vercel.app`
(no `APP_DOMAIN` is set, so Step 15.4 is a no-op and the Vercel-assigned domain is the active one).

A row is `pass` only if its own pass condition was met by a command whose output is summarised here.
A row that depends on a credential the builder has not created yet is `blocked`, and says on what.
Nothing is marked `pass` on the strength of a test that stands in for the check.

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | TLS and HSTS on the active domain | pass | `strict-transport-security: max-age=63072000; includeSubDomains; preload` on `/` and on `/sign-in`; `/sign-in` is `HTTP/1.1 200`. The §16 condition names `HTTP/2 200` on `/`, which `/` no longer returns: an anonymous request is `307` to `/sign-in` by design (`scripts/smoke.sh` asserts that redirect). Read on the page that is actually public. |
| 2 | Security headers (SYS-015, NFR-011) | pass | All eight present on `/sign-in` with the §16.1 values: `content-security-policy` beginning `default-src 'self'` with a per-request nonce, `cross-origin-opener-policy: same-origin`, `permissions-policy: camera=(), microphone=(), geolocation=()`, `referrer-policy: strict-origin-when-cross-origin`, `strict-transport-security` as above, `x-content-type-options: nosniff`, `x-frame-options: DENY`, `x-request-id` a UUID. `cache-control: no-store` on both `/api/health` and `/api/ready`. |
| 3 | Health and routes | pass | `bash scripts/smoke.sh https://tassl.vercel.app` → `smoke passed`, 11 of 11 checks. |
| 4 | Backups running | pass | `backup.yml` had **never produced a backup** before this checklist. Its first dispatch failed in one second — `pg_dump` 16.15 against Neon's 17.11 — because the runner ships a 16 client that `/usr/bin/pg_dump` keeps resolving to after `postgresql-client-17` is installed beside it (D-680, PR #27). Fixed and re-run: two consecutive `success` runs, artifact `tassl-backup-2026-09-09` (253,471 bytes, 30-day retention). A third run is needed for the "last three" reading. |
| 5 | Restore verified by a drill | blocked | `scripts/restore-drill.sh` had never run either: it writes `GITHUB_STEP_SUMMARY` and checks in as a Sentry cron monitor, so it was written for Actions, but no workflow called it and its stated prerequisite (PostgreSQL 17 client tools) is not installed on the builder's machine. `restore-drill.yml` now runs it Monday 06:00 UTC and on dispatch (D-681, PR #27). The drill itself has not yet been executed. |
| 6 | Alerts on | blocked | No Sentry project exists. `NEXT_PUBLIC_SENTRY_DSN` is unset in production, so no alert rule and no cron monitor can be created. The builder is creating the project. |
| 7 | Sentry receiving events | blocked | Same: needs `NEXT_PUBLIC_SENTRY_DSN`. |
| 8 | Sentry release tagging | blocked | Same: needs `SENTRY_AUTH_TOKEN` and `SENTRY_ORG` for the release step to upload source maps. |
| 9 | PostHog receiving events | blocked | No PostHog project exists; `NEXT_PUBLIC_POSTHOG_KEY` is unset in production. Analytics are emitted to the log (`analytics …` lines are visible in the seed output), so the call sites work; nothing is being received. |
| 10 | Load test (NFR-014, D-102) | not run | k6 against a preview with `VERCEL_AUTOMATION_BYPASS_SECRET` exported. |
| 11 | Legal pages reviewed by a human | blocked | `/privacy` and `/terms` both return 200. The review itself is a human act and is the builder's; PII is collected (name, email, run traces), so this row cannot be signed off by the build. |
| 12 | Production env vars set | partial | Present: `APP_ENV`, `BETTER_AUTH_SECRET`, `CRON_SECRET`, `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `EMAIL_FROM`, `EMAIL_TRANSPORT`, `FEATURE_AI`, `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_PROVIDER`, `NEXT_PUBLIC_APP_URL`, `SEED_PASSWORD`, `TASSL_APP_DB_PASSWORD`. Correctly absent: `FEATURE_TEST_CONTROLS` (D-023 — the default `true` is what walkthrough step 7 needs). Missing: `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_POSTHOG_KEY` (rows 6–9), and `RESEND_API_KEY`. `EMAIL_TRANSPORT` is set explicitly to `console`, which is the documented non-secret default: **production sends no email**, it logs it. Every notification path works; nothing is delivered until a Resend key and a verified sending domain exist. |
| 13 | Seed accounts present in production (D-040) | pass | `pnpm db:seed` against production: 5 seat accounts, course `b6343396`, section, the confirmed Meridian Roast fixture version (93 elements, 8 claims, 9 documents), 3 assignments. Sign-in verified end to end: `POST /api/auth/sign-in/email` as `instructor@tassl.local` → 200, then `GET /api/v1/me` returns that email with the `instructor` membership of Walkthrough University. That request also proves the Step 15.1 role swap, because it is a session write made by the app as `tassl_app`. |
| 14 | Cron registered | pass | `vercel crons ls` → one job, `/api/internal/jobs/drain` at `0 4 * * *`. |
| 15 | Branch protection | pass | Was **not enabled**; the `.github/branch-protection.json` in the repository had never been applied, which is why PR #27 auto-merged with no check green. Applied: the ten `checks / …` contexts from §10, `strict`, `enforce_admins`, `required_linear_history`, no force pushes, no deletions. Repository auto-merge enabled so `gh pr merge --auto` behaves as the build procedure assumes. |
| 16 | Cross-browser E2E | blocked | Firefox and WebKit are installed, but `pnpm test:e2e` needs a local Postgres: `playwright.config.ts`'s `webServer` runs `pnpm db:reset` first, and Docker is not installed on the builder's machine. CI runs chromium only, by design. Needs `docker compose up -d --wait` on a machine that has Docker. |
| 17 | Walkthrough script | not run | Step 15.5. |

## What this checklist found

Three controls were green for phases without ever having run, and one product path could not
complete at all. Each is recorded as a decision and fixed in a PR through the pipeline:

- **D-680** — the nightly backup had never taken a backup (row 4).
- **D-681** — the restore drill had no workflow to call it (row 5).
- **D-682** — the secret scanner had never read the repository's history. `gitleaks-action` scopes
  its scan to the event and a push gets `--log-opts=-1`, so every run ever done read one commit. A
  full scan found six findings, all already waived and all six waivers dead: a `.gitleaksignore`
  fingerprint names the commit that introduced the line, and squash-merging gives that line a new
  commit, so each waiver was green on its own PR and inert from the merge onward. All six are
  confirmed non-secrets and no credential has ever been committed (row 15's neighbourhood).
- **D-683** — a scenario package could not be generated from a seed case in production at all: the
  pipeline cannot finish inside one invocation's drain budget, and the documented recovery restarted
  at step 1 and hit a foreign key violation, leaving the version with no way forward or back.

## Step 15.2: the real package is generated but not confirmed

`Harbour & Vine: the national listing decision` — an original teaching case written for this build,
published by Walkthrough University, so the `licensePermitsAdaptation` attestation is truthful
rather than a claim over somebody else's case. Package `77c538c0`, version `eb1ba885`, all seven
generation steps succeeded, `validation: {ok: true, failures: []}`, 10 documents, 3 stakeholders,
8 claims, 2 variants, 31 defense questions, 16 readiness items, 12 generation passes.

It is **not confirmed**, and should not be until a person has read it, because a first review pass
already found things a confirmation record is supposed to catch:

- **The brief promises the wrong clock.** It ends "You have 45 minutes"; `workingClockSeconds` is
  1500, which is 25. A student would be told one thing and given another before the run starts. The
  prompt is at fault — it never stated the rule, and its own example brief says twenty-five minutes —
  so `gen-reskin-brief-stakeholders@2` now states it. The element itself still needs editing or
  regenerating on this version.
- **`FAMILY_LACKS_ETHICAL_DEFECT`** — the generated family has no ethical defect variant.
- **`READINESS_CONCEPT_SINGLE_ITEM`** — a concept in the set is covered by only one readiness item.

Confirming every element is the disciplinary authority's act (FR-192, FR-198). It is deliberately
not scripted: a confirmation record asserts that a person read each element, and generating that
assertion from a loop would make the record false. It waits for the builder in the browser.

## Outstanding before this checklist can be completed

1. A Sentry project (`NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`) — rows 6, 7, 8.
2. A PostHog project (`NEXT_PUBLIC_POSTHOG_KEY`) — row 9.
3. A Resend key and verified sending domain, if production is to send email rather than log it — row 12.
4. The restore drill executed once — row 5.
5. The k6 load test — row 10.
6. Cross-browser E2E locally — row 16.
7. A human legal review of `/privacy` and `/terms` — row 11.
8. The walkthrough — row 17, Step 15.5.
