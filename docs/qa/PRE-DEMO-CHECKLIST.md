# Pre-demo checklist — the morning of the demo (10 minutes)

Statements only. Run top to bottom on the presenter's laptop, from the repository root, with the
runbook (`docs/guides/demo-runbook.md`) open on the second screen.

## 1. Quotas (2 minutes)

1. Open https://console.neon.tech → project `red-smoke-66780807` → **Usage**. Read compute hours
   used this month; the Free plan allows 100 CU-hours. Read storage; the plan allows 0.5 GB. Open
   **Branches**; the plan allows 10 and the demo needs two free (`pre-demo-backup-<date>` exists,
   plus one preview branch per open pull request).
2. Open https://vercel.com → team `hewotllc-3732` → project `tassl` → **Usage**. Read function
   invocations, Active CPU, and bandwidth against the Hobby limits shown on that page.
3. Open https://sentry.io → organization `hewot-llc` → project `tassl` → **Issues**, filter
   `environment:production`, last 24 hours. Every issue is one you recognise from a previous demo
   or a resolved one; a new unresolved issue is read before the demo starts.
4. Open the MiMo token dashboard for the `LLM_API_KEY` in use (https://token-plan-sgp.xiaomimimo.com,
   the account that issued the key) and read the remaining credit. One demo run spends under
   0.05 USD at the configured prices (`LLM_INPUT_USD_PER_MTOK` = `LLM_OUTPUT_USD_PER_MTOK` = 0.61).

## 2. Warm-up and mode (3 minutes)

5. `PLAYWRIGHT_BASE_URL=https://tassl.vercel.app SEED_PASSWORD="$(cat ~/.config/tassl/seed-password.txt)" pnpm demo:warm`
   prints `demo:warm passed` with the page timings. Neon is awake and every demo-path function is
   warm after this.
6. `pnpm env:check` prints `env parity: … production carries every required key; … /api/ready → 200`.
7. Sign in at https://tassl.vercel.app/sign-in as `admin@tassl.local` → **Admin** → **Flags** →
   **Assistant mode** shows the mode this demo runs with: **Live model** for the real assistant,
   **Scripted assistant** for the fixed replies. Change it with **Save assistant mode** when the
   plan for the day differs; it takes effect on the next assistant request.
8. On the same page, **Model usage** shows today's calls and tokens under the ceilings
   (`LLM_USER_DAILY_TOKEN_BUDGET` 200,000 per person, `LLM_GLOBAL_MONTHLY_TOKEN_BUDGET` 20,000,000).

## 3. Dry run at projector resolution (5 minutes)

9. Windows **Display settings**: resolution 1920 × 1080, scale 125 %. Browser zoom 100 %.
10. Two browser profiles (or one normal and one private window): profile A signs in as
    `instructor@tassl.local`, profile B as `student1@tassl.local`.
11. Profile A: **Courses** → **Marketing Strategy Walkthrough** → **Assignments** →
    **Decision Run 1 (walkthrough)**. Every run of an earlier rehearsal on that assignment is deleted
    from its **Runs** table with **Delete** → **Delete the run**, so the student seat can start fresh.
12. Profile B: **Runs** → **Start Decision Run 1 (walkthrough)** → **Begin the Readiness Check** →
    answer one item → **Runs** in the rail → the row shows the run in progress. This proves sign-in,
    the database, and the run pages on the projector.
13. Profile A: **Review** → the queue loads. **Packages** → **Meridian Roast (fixture)** → the version
    page shows **Confirmed**.
14. Profile B: **Runs** → the run → the Readiness Check resumes where it was left (the clock is
    server time). Leave it there, or finish it, according to the runbook's plan for the day.
15. Both profiles stay signed in. The runbook's break-glass table is visible on the second screen.

## 4. Records of the day

16. The numbers read in steps 1–4 and 8 are written in the runbook's "Day of" note at the top of
    `docs/guides/demo-runbook.md` under the date, so the next demo has a baseline.
