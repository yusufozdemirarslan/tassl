# Post-launch runbook

**Purpose / Read this when:** Tassl is live and you are the person operating it. Every task below
names the runbook in `docs/tech/13-observability-ops.md` §8 that holds the commands, or the QA
document that holds the facts; nothing here is decided on the day.

## The runbooks

| Situation | Runbook |
|---|---|
| Ship a change | `13-observability-ops.md` §8.1 (a) deploy — a pull request through the eleven `checks / …` contexts, squash-merged; `production.yml` migrates, deploys, smokes with curl and with the browser smoke (`pnpm test:smoke`) |
| A deploy is wrong | §8.2 (b) rollback — `npx vercel@59.11.2 rollback` to the previous production deployment (about one minute), then a fix through the pipeline |
| A migration | §8.3 (c) database migration — expand/contract, applied by `production.yml` against the unpooled string before the deploy |
| Data loss | §8.4 (d) restore from a Neon backup — the nightly artifact of `backup.yml`; the drill of `restore-drill.yml` proves it every Monday (last observed green: run 34406394294, 2026-09-09, 3 min 15 s). Before a demo: `pre-demo-backup-<date>` branch from `main` (`npx neon@4.14.0 branches create --project-id red-smoke-66780807 --name pre-demo-backup-YYYYMMDD --parent main`) |
| A secret must change | §8.5 (e) rotate a secret — `vercel env add … --force` (plain values with `--no-sensitive`), a redeploy, the calendar below |
| The model provider is slow or down | §8.6 (f) LLM provider outage — first layer: `/admin/flags` → **Assistant mode** → **Scripted assistant** → **Save assistant mode** (next request); second layer: `printf mock \| npx vercel@59.11.2 env add LLM_PROVIDER production --force --no-sensitive` then `npx vercel@59.11.2 redeploy <deployment-url>` (about four minutes) |
| A run is held | §8.7 (g) held scoring run — the replay's **Band this run by hand** |
| A job is stuck or dead-lettered | §8.8 (h) — `pnpm jobs:retry`, `pg-boss` dead-letter redrive |
| Before a demo | `docs/qa/PRE-DEMO-CHECKLIST.md` (ten minutes), then `docs/guides/demo-runbook.md` |
| After a demo | `pnpm demo:reset` against production restores the seeded state; the deletions on the assignment page do the same by hand |

## Weekly cadence

| Day | Task | Where the result lands |
|---|---|---|
| Monday 06:00 UTC | `restore-drill.yml` runs by schedule; read its conclusion and the Sentry cron monitor `restore-drill` | GitHub → Actions → restore-drill; Sentry → Monitors |
| Monday 07:00 UTC | `cross-browser.yml` runs the engine suites on firefox and webkit by schedule; the guide chain runs on every pull request | GitHub → Actions → cross-browser |
| Monday | Review the dependency pull requests; merge the ones whose checks are green | GitHub → Pull requests |
| Monday | Sentry: read the last week's issues in `tassl`; the project alert "Send a notification for high priority issues" emails new high-priority issues | Sentry → Issues |
| Monday | PostHog: read the **Model usage** panel on `/admin/flags` (calls, tokens, estimated cost today and this month against the budgets) and PostHog → Activity → Events for `run_scored` and `rate_limited` | `/admin/flags`; PostHog project 600786 |
| Every night 03:30 UTC | `backup.yml` takes the encrypted dump; the Sentry cron monitor `nightly-backup` records the check-in | GitHub → Actions → backup; Sentry → Monitors |
| Every day 04:00 UTC | Vercel cron `/api/internal/jobs/drain` sweeps the queues; the Sentry cron monitor `jobs-drain-daily` records it | Vercel → Cron Jobs; Sentry → Monitors |

## Secret rotation calendar (D-129: every 180 days)

| Secret | Where it is set | Next rotation |
|---|---|---|
| `BETTER_AUTH_SECRET` | Vercel production and preview; GitHub `BETTER_AUTH_SECRET_PRODUCTION` / `_PREVIEW` | 2027-03-03 |
| `CRON_SECRET` | Vercel production and preview; GitHub `CRON_SECRET_PRODUCTION` / `_PREVIEW` | 2027-03-03 |
| `LLM_API_KEY` | Vercel production and preview; GitHub `LLM_API_KEY`; the MiMo token dashboard | 2027-03-03 |
| `TASSL_APP_DB_PASSWORD` and the `tassl_app` connection strings | Vercel production; `~/.config/tassl/` on the operator machine; `scripts/db-app-role.ts` | 2027-03-08 |
| `SEED_PASSWORD` | Vercel production; `~/.config/tassl/seed-password.txt` | 2027-03-08 |
| `NEON_API_KEY`, `VERCEL_TOKEN`, `SENTRY_AUTH_TOKEN` | GitHub secrets; `~/.config/tassl/` | 2027-03-03 |
| Protection Bypass for Automation | Vercel project setting (regenerate); `~/.config/tassl/vercel-bypass.txt` | 2027-03-09 |

## Facts that decide the day

- Free tiers: Vercel Hobby (Fluid compute, 300 s maximum function duration, 4.5 MB request and
  response bodies, region `iad1`); Neon Free (10 branches, 100 CU-hours a month, 0.5 GB storage,
  compute suspends after five idle minutes: the first request of a quiet hour takes about 2.2 s on
  `/api/ready`, the next ones under 0.2 s).
- Google sign-in admits only accounts listed as test users on the Google Cloud consent screen (the
  app is in Testing status); email and password is the primary login; production runs `DEMO_MODE=true`
  so sign-up completes without an email.
- Nothing polls `/api/ready` on a schedule (D-698); `pnpm demo:warm` wakes the deployment on demand.
- `FEATURE_TEST_CONTROLS` stays at its default (`true`) so an instructor can arm the assistant outage
  of walkthrough step 7; every use is audited.
