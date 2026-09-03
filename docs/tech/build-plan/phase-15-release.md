# Phase 15 — Release and Walkthrough

**Purpose / Read this when:** everything is built and the real provider is on (Phase 14). This phase executes the launch checklist, hardens the production database role, seeds the production seats, verifies monitoring, attaches the custom domain when `APP_DOMAIN` is set, runs the walkthrough that accepts the build (PRD §12), and hands over the post-launch runbook.

**Requirements covered:** FR-250 to FR-254 (live acceptance), FR-235, NFR-007, NFR-008, NFR-014, NFR-015, SYS-007 (human review), SYS-016, INT-002, D-053, D-104, D-110, D-128; every ID is closed by the walkthrough record.

## Goal

The build is accepted by the walkthrough on the production deployment, with every launch checklist row ticked and the post-launch runbook in the builder's hands.

## Prerequisites

- Phase 14 exit criteria pass.
- Read `15-cicd-deployment.md` §15–16, `13-observability-ops.md` §8, PRD §12 "The walkthrough".
- The builder has the published seed case text ready (PRD §12).

## Steps

### Step 15.1 — Production database role and connection strings
**Goal:** Production and preview connect as `tassl_app` (D-085, D-110).
**Covers:** NFR-004, D-110
**Prerequisites:** Phase 14 complete
**Files to create / modify:** none
**Commands (in order, from repo root):**
```bash
mkdir -p "$HOME/.config/tassl" && chmod 700 "$HOME/.config/tassl"
openssl rand -base64 24 | tr -d '\n' > "$HOME/.config/tassl/tassl_app_db_password"
PROD_UNPOOLED="$(gh secret list >/dev/null; npx neon@4.14.0 connection-string main --project-id "$(gh variable get NEON_PROJECT_ID)")"
TASSL_APP_DB_PASSWORD="$(cat "$HOME/.config/tassl/tassl_app_db_password")" DATABASE_URL_UNPOOLED="$PROD_UNPOOLED" pnpm exec tsx scripts/db-app-role.ts
npx vercel@59.11.2 env add TASSL_APP_DB_PASSWORD production < "$HOME/.config/tassl/tassl_app_db_password"
```
Then build the app-role connection strings by replacing the user and password in the pooled and unpooled strings (`postgres://tassl_app:<password>@<host>/<db>?sslmode=require`), write them to `$HOME/.config/tassl/database_url_app` and `database_url_unpooled_app`, and:
```bash
npx vercel@59.11.2 env rm DATABASE_URL production --yes && npx vercel@59.11.2 env add DATABASE_URL production < "$HOME/.config/tassl/database_url_app"
npx vercel@59.11.2 env rm DATABASE_URL_UNPOOLED production --yes && npx vercel@59.11.2 env add DATABASE_URL_UNPOOLED production < "$HOME/.config/tassl/database_url_unpooled_app"
gh workflow run production.yml --ref main && gh run watch --exit-status
```
Keep `PRODUCTION_DATABASE_URL_UNPOOLED` (GitHub secret, owner role) unchanged: migrations and backups run as the owner.
**Implementation notes:** `scripts/db-app-role.ts` runs `ALTER ROLE tassl_app LOGIN PASSWORD $1` as the owner. After redeploy, `/api/ready` must still return 200 (the app role has SELECT on `information_schema`).
**Secrets (if any):** `TASSL_APP_DB_PASSWORD` as generated.
**Tests to write:** none (production configuration; grants are covered by `tests/integration/db/grants.test.ts`).
**Verify (all must pass):**
```bash
bash scripts/smoke.sh "$(grep NEXT_PUBLIC_APP_URL .vercel/.env.production.local 2>/dev/null | cut -d= -f2- || echo https://tassl.vercel.app)"
```
**Commit:** none.
**Rollback:** restore the owner-role strings from the Phase 0 files in `$HOME/.config/tassl/` with the same `env rm` and `env add` commands, then redeploy.

### Step 15.2 — Production seeds and the real scenario package
**Goal:** The walkthrough institution, seat accounts, course, section, and assignments exist in production; the real package is generated from the builder's seed case and confirmed.
**Covers:** FR-190 to FR-198 (live), FR-235, D-040, D-128
**Prerequisites:** Step 15.1 complete
**Files to create / modify:** none
**Commands (in order, from repo root):**
```bash
openssl rand -base64 18 | tr -d '\n' > "$HOME/.config/tassl/seed_password"
npx vercel@59.11.2 env add SEED_PASSWORD production < "$HOME/.config/tassl/seed_password" --force
APP_ENV=production SEED_PASSWORD="$(cat "$HOME/.config/tassl/seed_password")" DATABASE_URL="$PROD_UNPOOLED" DATABASE_URL_UNPOOLED="$PROD_UNPOOLED" pnpm db:seed
```
Then in the browser (production URL): sign in as `instructor@tassl.local`, open Packages → New package from a seed case, paste the seed text with title, publisher, license terms, tick "The license permits adaptation", enter the concept set, choose "Create and generate"; wait for the seven steps; open the confirmation workspace and confirm or edit every element (the builder acts as disciplinary authority); tick the teaching-note check; confirm the version. Open the course, create two assignments on the new version (defective and sound variants, `is_walkthrough` on) and the two-minute auto-lock assignment on the defective variant (`workingClockSeconds: 120`).
**Implementation notes:** The seed refuses the default password in production (D-111). The fixture package is seeded too and stays available for rehearsal; the walkthrough uses the generated package (PRD §6).
**Secrets (if any):** `SEED_PASSWORD` as generated; the seed case text is the builder's input (not a secret).
**Tests to write:** none.
**Verify (all must pass):**
```bash
curl -fsS -c /tmp/tassl.cookies -H 'Content-Type: application/json' -X POST "$PROD_URL/api/auth/sign-in/email" -d "{\"email\":\"instructor@tassl.local\",\"password\":\"$(cat "$HOME/.config/tassl/seed_password")\"}" >/dev/null && curl -fsS -b /tmp/tassl.cookies "$PROD_URL/api/v1/me" | grep -q instructor@tassl.local && rm -f /tmp/tassl.cookies
```
(`PROD_URL` is the production URL from Step 15.1.) In the browser, the package version view shows `confirmed` with the confirmation record and measures.
**Commit:** none.
**Rollback:** delete the walkthrough runs and assignments from the interface; the seed is idempotent.

### Step 15.3 — Launch checklist execution
**Goal:** Every row of `15-cicd-deployment.md` §16 is verified and recorded.
**Covers:** NFR-007, NFR-008, NFR-014, NFR-015, SYS-007, SYS-016
**Prerequisites:** Step 15.2 complete
**Files to create / modify:**
- `docs/release/launch-checklist-<date>.md` — create; the checklist table with a result column, copied from `15-cicd-deployment.md` §16
**Commands (in order, from repo root):** the commands listed per row in `15-cicd-deployment.md` §16, including: TLS and HSTS (`curl -sI "$PROD_URL"`), security headers table (`curl -sI` against a page and `/api/v1/me`), backups verified by a restore drill (`bash scripts/restore-drill.sh`), alerts on (Sentry alert rules listed), Sentry receiving events (`pnpm exec tsx scripts/sentry-test.ts` with the production DSN), PostHog receiving events (open the PostHog live events view while signing in), load test (`k6 run scripts/load/run-loop.js` against a preview with `scripts/load/seed-users.ts` and `VERCEL_AUTOMATION_BYPASS_SECRET` exported; p95 within NFR-008), environment variable audit (`npx vercel@59.11.2 env ls production`), firefox and webkit E2E locally (`pnpm test:e2e --project=firefox && pnpm test:e2e --project=webkit`), legal pages reviewed by a human (PII is collected: name and email), `FEATURE_TEST_CONTROLS` stays `true` for the walkthrough.
**Implementation notes:** A row that fails is fixed before proceeding; the checklist file records the command output summary per row.
**Secrets (if any):** none new.
**Tests to write:** none.
**Verify (all must pass):**
```bash
grep -c '| pass |' "docs/release/launch-checklist-$(date +%F).md" | grep -qE '^1[6-9]$|^[2-9][0-9]$'
```
**Commit:** `docs(release): launch checklist executed`
**Rollback:** none (record only).

### Step 15.4 — Custom domain (conditional on `APP_DOMAIN`)
**Goal:** When `APP_DOMAIN` is set in the production environment, the domain is attached and `NEXT_PUBLIC_APP_URL` updated; otherwise the step is a no-op.
**Covers:** D-053, INT-002
**Prerequisites:** Step 15.3 complete
**Files to create / modify:** none
**Commands (in order, from repo root):**
```bash
npx vercel@59.11.2 env pull --environment=production --yes .env.production.tmp
APP_DOMAIN="$(grep -E '^APP_DOMAIN=' .env.production.tmp | cut -d= -f2- | tr -d '"')"; rm -f .env.production.tmp
if [ -n "$APP_DOMAIN" ]; then
  npx vercel@59.11.2 domains add "$APP_DOMAIN"
  echo "Create a CNAME record for $APP_DOMAIN pointing to cname.vercel-dns.com, then wait for verification:"
  until npx vercel@59.11.2 domains inspect "$APP_DOMAIN" | grep -q 'Verified'; do sleep 30; done
  printf 'https://%s' "$APP_DOMAIN" | npx vercel@59.11.2 env add NEXT_PUBLIC_APP_URL production --force
  gh workflow run production.yml --ref main && gh run watch --exit-status
  echo "Add https://$APP_DOMAIN/api/auth/callback/google to the Google OAuth client's redirect URIs if Google sign-in is enabled."
else
  echo "APP_DOMAIN not set: keeping the Vercel-assigned domain"
fi
```
**Implementation notes:** DNS instructions per `15-cicd-deployment.md` §15; the redeploy re-inlines `NEXT_PUBLIC_APP_URL`.
**Secrets (if any):** none.
**Tests to write:** none.
**Verify (all must pass):**
```bash
URL="$(npx vercel@59.11.2 env pull --environment=production --yes .env.production.tmp >/dev/null && grep -E '^NEXT_PUBLIC_APP_URL=' .env.production.tmp | cut -d= -f2- | tr -d '"'; rm -f .env.production.tmp)"; curl -sI "$URL" | grep -qi 'strict-transport-security' && bash scripts/smoke.sh "$URL"
```
**Commit:** none.
**Rollback:** `npx vercel@59.11.2 domains rm "$APP_DOMAIN" --yes` and restore `NEXT_PUBLIC_APP_URL`.

### Step 15.5 — The walkthrough (definition of done)
**Goal:** The builder and the editor complete PRD §12 steps 1–17 on the production deployment: one session per variant, seats swapped, the short third run for the auto-lock branch; every step works from the interface without a code change, restart, or stored-data edit (except the step 7 test control).
**Covers:** FR-250 to FR-254 and, through them, every build-slice FR
**Prerequisites:** Step 15.4 complete; FEATURE_TEST_CONTROLS=true in production
**Files to create / modify:**
- `docs/release/walkthrough-notes-<date>.md` — create from the template below; one row per step with seat, variant, observed result, and pass/fail
**Commands (in order, from repo root):** none (browser session). Script, in the order the student seat meets it (PRD §12):

| Step | Seat | What must be observed |
|---|---|---|
| 1 Package | faculty | Package view: id, version, the builder's confirmation record |
| 2 Run start | student | Policy display: outside-AI policy, weight, mapping, "this run counts" |
| 3 Readiness | student | 16 items in 8 minutes; concept-map result with no score or rank; Standard Mode |
| 4 Brief and room | student | Brief ≤ 200 words; 6–12 dated, attributed documents; opens recorded; assistant locked |
| 5 Frame | student | Every field required within its limit; incomplete frame refused; irreversible lock; assistant unlocks without comment |
| 6 Working period | student | Planted claim surfaces as a versioned claim object; log fills; Source Trace on another claim returns document, passage, date, author at 1 minute; a stance changed after the action with both kept; one Challenge and one Reject on non-load-bearing claims; one Escalate with the authored reply at 5 minutes; outside-tool declaration with the no-penalty sentence |
| 7 Forced failure | faculty then student | Faculty arms the control; the next assistant call fails; Paused; clock stopped; cost credited on resume |
| 8 Lock | student | Lock refused naming the unstanced relied-on claim; completed lock with typed numbers and word limits; post-lock edit refused; 50-word Addendum offered. On the two-minute run: frame locked, brief left unfiled, auto-lock with empty fields and unstanced claims recorded |
| 9 Turn | student | Fires 60–120 s after lock; assistant, room, and actions reopen for 12 minutes; window claim needs a stance; hold, revise, or reverse filed with ≤ 150 words and updated confidence beside the frozen record |
| 10 Defense | student | 6–9 typed questions including the provenance question for the stale figure; one authored follow-up per question; no assistant, no room; brief, frame, and Turn response visible |
| 11 Scoring and draft debrief | student | Seven draft bands with evidence or unassessed; no composite score; draft debrief within 10 minutes with mapping, weight, and draft points |
| 12 Faculty replay | faculty | Trace in order; four graphs; bands with evidence one click away; confirm one, override one with a note, confirm five; the run leaves Scored only after the seventh; default mapping applied with its arithmetic; claim object view fields visible |
| 13 Debrief | student | Confirmed bands and note in place; claim-by-claim in run order; missed defect with document and action; something done well; confidence line; Turn beside frame; clock; counterfactual; the two questions → Recorded |
| 14 Export and record | faculty then student | Course export file with bands, mapping, points; the Judgment Record with the four graphs, confirmed bands, mode and variant, and the record trace without weight, mapping, or points |
| 15 Neutralize and void | faculty | Neutralize one claim: recompute never lowers, re-export; void the short run with re-offer; no partial result |
| 16 Sound variant | swapped | Steps 2–14 on the sound variant; the sound claim warranted Accept is accepted without checking and scored as warranted |
| 17 Standing rules and accessibility | faculty then student | One dimension set unassessed: points recomputed over the remaining dimensions; whole run completes in text; screen reader reads documents; keyboard-only operation; each graph opens to its table and description |

**Implementation notes:** Seats are agreed at the start of each session and recorded in the notes; the recommended pattern swaps seats between variants. Any step that fails is a defect: fix it in a normal PR through the pipeline and repeat the affected session. Walkthrough runs are labeled and may be kept or deleted (D-104).
**Secrets (if any):** none.
**Tests to write:** none (the automated equivalent is `tests/e2e/walkthrough/*`, which must be green before this step).
**Verify (all must pass):**
```bash
pnpm test:e2e -- tests/e2e/walkthrough
grep -c '| pass |' "docs/release/walkthrough-notes-$(date +%F).md" | grep -qE '^(1[7-9]|[2-9][0-9])$'
```
**Commit:** `docs(release): walkthrough notes; build accepted`
**Rollback:** none (record only).

### Step 15.6 — Post-launch: monitoring verification, test controls, runbook handover, progress close-out
**Goal:** Alerts and dashboards show real data, the test control is switched off for any use beyond the build, and the operating runbooks are confirmed reachable.
**Covers:** NFR-007, NFR-016, SYS-013, SYS-014
**Prerequisites:** Step 15.5 complete
**Files to create / modify:**
- `docs/tech/PROGRESS.md` — tick every step
- `docs/release/post-launch-runbook.md` — create; links to `13-observability-ops.md` §8 runbooks (deploy, rollback, migration, restore, rotate a secret, LLM outage, held run, stuck job) and the weekly cadence: restore drill (Monday), dependency PRs review, Sentry alert review, PostHog LLM cost panel review, secret rotation calendar (180 days, D-129)
**Commands (in order, from repo root):**
```bash
printf 'false' | npx vercel@59.11.2 env add FEATURE_TEST_CONTROLS production --force
gh workflow run production.yml --ref main && gh run watch --exit-status
pnpm docs:build
git add -A && git commit -m "docs(release): post-launch runbook and progress close-out" && git push origin main
```
**Implementation notes:** Switching `FEATURE_TEST_CONTROLS` off after acceptance follows `12-security.md` §3; re-enable it (and redeploy) before repeating a walkthrough session. Sentry must show the walkthrough's events; PostHog must show `run_scored` events with `is_walkthrough: true`.
**Secrets (if any):** none.
**Tests to write:** none.
**Verify (all must pass):**
```bash
npx vercel@59.11.2 env ls production | grep -q 'FEATURE_TEST_CONTROLS' && bash scripts/smoke.sh "$URL" && ! grep -q '\[ \]' docs/tech/PROGRESS.md
```
**Commit:** as above.
**Rollback:** `printf 'true' | npx vercel@59.11.2 env add FEATURE_TEST_CONTROLS production --force && gh workflow run production.yml --ref main`

## Phase exit criteria

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm test:e2e && pnpm evals && pnpm build && pnpm docs:build
gh run list --workflow production.yml --limit 1 --json conclusion -q '.[0].conclusion' | grep -qx success
test -f "docs/release/walkthrough-notes-$(date +%F).md" || ls docs/release/walkthrough-notes-*.md
```

Requirement IDs now fully implemented: every build-slice ID in `COVERAGE.md`; the walkthrough notes are the acceptance record for FR-250 to FR-254.
