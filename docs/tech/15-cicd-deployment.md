# 15 — CI/CD and Deployment

**Purpose / Read this when:** you create or edit anything under `.github/`, set up the GitHub, Vercel, or Neon side of the project (Phase 0), ship to production, roll back, restore a backup, attach a custom domain, or run the launch checklist (Phase 15). Every workflow file here is complete and is copied verbatim into the repository.

**Requirements covered:** SYS-016, SYS-017, SYS-009, SYS-013, SYS-015, SYS-019, SYS-023, INT-001, INT-002, INT-006, INT-009, INT-011, NFR-006, NFR-007, NFR-011, NFR-013, NFR-014, NFR-015, FR-118, SYS-007. Decisions applied: D-002, D-012, D-023, D-036, D-037, D-038, D-039, D-053, D-069, D-070, D-071, D-072, D-073, D-085, D-101, D-102.

## 1. Pipeline overview

```mermaid
flowchart LR
  subgraph pr[pr.yml: pull_request to main]
    C1[checks.yml gates] --> PD[preview-deploy: Neon branch + vercel deploy --prebuilt]
  end
  subgraph prod[production.yml: push to main]
    C2[checks.yml gates] --> B[vercel build --prod] --> M[pnpm db:migrate on production] --> D[vercel deploy --prebuilt --prod] --> S[scripts/smoke.sh] --> R[Sentry release]
  end
  subgraph cron[schedules]
    BK[backup.yml 03:30 UTC: pg_dump, encrypt, artifact 30 d]
    CL[preview-cleanup.yml: PR closed, delete Neon branch and alias]
  end
```

Gate order inside `checks.yml` (each job `needs` the previous one, D-072, D-073): `lint → typecheck → unit → integration → build → e2e → impeccable → lhci → openapi-check → security`. The order is fixed by SYS-017 and is the same on PRs and on `main`. Every gate runs with the non-secret defaults from `05-environment-config.md`; no gate receives a repository secret.

## 2. Environments

Consistent with `05-environment-config.md` §5. There is no staging environment; previews serve that role.

| Environment | `APP_ENV` | Where | Database | URL | Env source | Deployed by | Public |
|---|---|---|---|---|---|---|---|
| local | `local` | developer machine, `pnpm dev` | Docker Compose `postgres:17-alpine` (`compose.yaml`) | `http://localhost:3000` | `.env` copied from `.env.example` | nobody | n/a |
| test | `test` | GitHub Actions runner | `postgres:17-alpine` service container, database `tassl_test` | `http://localhost:3000` | `env:` block of `checks.yml` | nobody (server started by Playwright or the lhci job) | n/a |
| preview | `preview` | Vercel preview deployment, one per PR | Neon branch `preview/pr-<n>` (child of `main`) | `https://tassl-pr-<n>.vercel.app` (alias set by `pr.yml`) | Vercel project env, preview scope, plus per-deployment `--env` from `pr.yml` | `pr.yml` job `preview-deploy` | no: Vercel Authentication (D-101) |
| production | `production` | Vercel production | Neon branch `main` | `NEXT_PUBLIC_APP_URL` (Vercel-assigned domain until `APP_DOMAIN` is set, D-053) | Vercel project env, production scope | `production.yml` job `deploy` | yes |

`<n>` above is the pull request number substituted by the workflow expression `${{ github.event.number }}`.

## 3. Conventions shared by every workflow

- Runner: `ubuntu-latest`. Node from `.nvmrc` (24, D-002). pnpm version from `package.json` `packageManager` (`pnpm@11.25.0`): `pnpm/action-setup@v6` is used without a `version` input so it reads that field.
- The four setup steps are packaged once as the composite action `.github/actions/setup/action.yml` (§4.1) so every job is `checkout` + `setup` + its command.
- Job `name:` equals the job id. Jobs of a reusable workflow are reported by GitHub as `<caller job id> / <called job id>`; both callers name the caller job `checks`, so the check-run names are `checks / lint`, `checks / typecheck`, and so on. Branch protection (§10) lists exactly those names.
- Workflow-internal shell variables (`PR_NUMBER`, `PREVIEW_ALIAS`, `PROD_URL`, `SENTRY_ENABLED`) are never read by the application; application variables are only the names in `05-environment-config.md` plus `SENTRY_RELEASE`, which is read by `@sentry/nextjs` itself (release naming, §7).
- All gate configuration files (`lighthouserc.json`, `.impeccable/config.json`, `playwright.config.ts`, `vitest.config.ts`) must exist from the first push to `main`, because `production.yml` runs the full gate on every push.

## 4. `.github/workflows/checks.yml` (reusable gates)

### 4.1 `.github/actions/setup/action.yml`

```yaml
name: setup
description: pnpm from package.json packageManager, Node from .nvmrc with the pnpm store cached, frozen install
runs:
  using: composite
  steps:
    - uses: pnpm/action-setup@v6
    - uses: actions/setup-node@v7
      with:
        node-version-file: .nvmrc
        cache: pnpm
    - run: pnpm install --frozen-lockfile
      shell: bash
```

### 4.2 `.github/workflows/checks.yml`

```yaml
name: checks

on:
  workflow_call:

permissions:
  contents: read
  pull-requests: read

# Non-secret defaults from 05-environment-config.md. One service database serves
# DATABASE_URL, DATABASE_URL_UNPOOLED and TEST_DATABASE_URL in CI.
env:
  APP_ENV: test
  NEXT_PUBLIC_APP_URL: http://localhost:3000
  APP_DOMAIN: ''
  LOG_LEVEL: info
  DATABASE_URL: postgres://tassl:tassl@localhost:5432/tassl_test
  DATABASE_URL_UNPOOLED: postgres://tassl:tassl@localhost:5432/tassl_test
  TEST_DATABASE_URL: postgres://tassl:tassl@localhost:5432/tassl_test
  BETTER_AUTH_SECRET: local-dev-secret-do-not-use-in-prod-0123456789
  GOOGLE_CLIENT_ID: ''
  GOOGLE_CLIENT_SECRET: ''
  EMAIL_TRANSPORT: console
  RESEND_API_KEY: ''
  EMAIL_FROM: 'Tassl <no-reply@tassl.local>'
  NOTIFY_EMAIL_COPIES: 'true'
  FEATURE_AI: 'false'
  FEATURE_SAMPLE_DATA: 'true'
  FEATURE_TEST_CONTROLS: 'true'
  LLM_PROVIDER: mock
  LLM_BASE_URL: https://token-plan-sgp.xiaomimimo.com/v1
  LLM_MODEL: mimo-v2.5-pro
  LLM_API_KEY: ''
  LLM_TIMEOUT_MS: '60000'
  LLM_MAX_OUTPUT_TOKENS: '4096'
  LLM_REASONING: 'off'
  LLM_FALLBACK_PROVIDER: none
  LLM_FALLBACK_MODEL: claude-sonnet-5
  ANTHROPIC_API_KEY: ''
  LLM_INPUT_USD_PER_MTOK: '0.61'
  LLM_OUTPUT_USD_PER_MTOK: '0.61'
  LLM_USER_DAILY_TOKEN_BUDGET: '200000'
  LLM_GLOBAL_MONTHLY_TOKEN_BUDGET: '20000000'
  TRIGGER_MATCHING: deterministic_first
  ASSISTANT_NUMERIC_GUARD: flag
  NEXT_PUBLIC_POSTHOG_KEY: ''
  NEXT_PUBLIC_POSTHOG_HOST: https://us.i.posthog.com
  NEXT_PUBLIC_SENTRY_DSN: ''
  SENTRY_AUTH_TOKEN: ''
  SENTRY_ORG: ''
  SENTRY_PROJECT: tassl
  SENTRY_TRACES_SAMPLE_RATE: '1.0'
  CRON_SECRET: local-cron-secret
  JOBS_DRAIN_ON_ENQUEUE: 'true'
  SEED_PASSWORD: Walkthrough-Pass-2026
  PLAYWRIGHT_BASE_URL: http://localhost:3000

jobs:
  lint:
    name: lint
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v7
      - uses: ./.github/actions/setup
      - run: pnpm lint

  typecheck:
    name: typecheck
    needs: lint
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v7
      - uses: ./.github/actions/setup
      - run: pnpm typecheck

  unit:
    name: unit
    needs: typecheck
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v7
      - uses: ./.github/actions/setup
      - run: pnpm test

  integration:
    name: integration
    needs: unit
    runs-on: ubuntu-latest
    timeout-minutes: 20
    services:
      postgres:
        image: postgres:17-alpine
        env:
          POSTGRES_USER: tassl
          POSTGRES_PASSWORD: tassl
          POSTGRES_DB: tassl_test
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U tassl -d tassl_test"
          --health-interval 5s
          --health-timeout 3s
          --health-retries 20
    steps:
      - uses: actions/checkout@v7
      - uses: ./.github/actions/setup
      - run: pnpm db:migrate
      - run: pnpm test:integration

  build:
    name: build
    needs: integration
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v7
      - uses: ./.github/actions/setup
      - run: pnpm build
      - run: pnpm exec tsx scripts/bundle-budget.ts

  e2e:
    name: e2e
    needs: build
    runs-on: ubuntu-latest
    timeout-minutes: 40
    services:
      postgres:
        image: postgres:17-alpine
        env:
          POSTGRES_USER: tassl
          POSTGRES_PASSWORD: tassl
          POSTGRES_DB: tassl_test
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U tassl -d tassl_test"
          --health-interval 5s
          --health-timeout 3s
          --health-retries 20
    steps:
      - uses: actions/checkout@v7
      - uses: ./.github/actions/setup
      - run: pnpm exec playwright install --with-deps chromium
      # playwright.config.ts webServer runs: pnpm db:reset && pnpm build && pnpm start (D-073).
      # CI installs chromium only; firefox and webkit run in the Phase 15 release check (§16).
      - run: pnpm test:e2e --project=chromium
      - uses: actions/upload-artifact@v7
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 14
          if-no-files-found: ignore

  impeccable:
    name: impeccable
    needs: e2e
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v7
      - uses: ./.github/actions/setup
      - name: Detect
        run: npx impeccable@3.6.1 detect --json . > impeccable-report.json || echo "detect exited $? (the gate below decides)"
      - name: Fail on findings not waived in .impeccable/config.json
        run: node scripts/impeccable-gate.mjs impeccable-report.json .impeccable/config.json
      - uses: actions/upload-artifact@v7
        if: always()
        with:
          name: impeccable-report
          path: impeccable-report.json
          retention-days: 14

  lhci:
    name: lhci
    needs: impeccable
    runs-on: ubuntu-latest
    timeout-minutes: 25
    services:
      postgres:
        image: postgres:17-alpine
        env:
          POSTGRES_USER: tassl
          POSTGRES_PASSWORD: tassl
          POSTGRES_DB: tassl_test
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U tassl -d tassl_test"
          --health-interval 5s
          --health-timeout 3s
          --health-retries 20
    steps:
      - uses: actions/checkout@v7
      - uses: ./.github/actions/setup
      - run: pnpm db:reset
      - run: pnpm build
      # URLs and budgets live in lighthouserc.json (16-performance-a11y-budgets.md).
      - uses: treosh/lighthouse-ci-action@v12
        with:
          configPath: ./lighthouserc.json
          uploadArtifacts: true
          temporaryPublicStorage: true

  openapi-check:
    name: openapi-check
    needs: lhci
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v7
      - uses: ./.github/actions/setup
      - run: pnpm openapi:check

  security:
    name: security
    needs: openapi-check
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - uses: ./.github/actions/setup
      - run: pnpm audit --audit-level=high
      # Free for repositories owned by a personal account (D-039 creates the repo under the
      # builder's account); an organization-owned repository would need GITLEAKS_LICENSE.
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### 4.3 `scripts/impeccable-gate.mjs` and `.impeccable/config.json`

```js
#!/usr/bin/env node
// Fails when `impeccable detect --json` reports findings that are not waived.
// Usage: node scripts/impeccable-gate.mjs <report.json> <.impeccable/config.json>
import { readFileSync } from 'node:fs'

const [reportPath = 'impeccable-report.json', configPath = '.impeccable/config.json'] = process.argv.slice(2)
const report = JSON.parse(readFileSync(reportPath, 'utf8'))
// Waivers are Impeccable's own detector ignores (D-130); the detector has already applied them,
// so every finding that reaches this script is open. The config is read only to print the
// active ignore counts beside the result.
let ignores = { ignoreRules: [], ignoreFiles: [], ignoreValues: [] }
try {
  const detector = JSON.parse(readFileSync(configPath, 'utf8')).detector ?? {}
  ignores = { ignoreRules: detector.ignoreRules ?? [], ignoreFiles: detector.ignoreFiles ?? [], ignoreValues: detector.ignoreValues ?? [] }
} catch {
  // no config: nothing ignored
}
const findings = Array.isArray(report)
  ? report
  : (report.findings ?? report.issues ?? report.results ?? report.violations ?? [])
const ruleOf = (f) => String(f.rule ?? f.id ?? f.pattern ?? f.name ?? 'unknown')
const fileOf = (f) => String(f.file ?? f.path ?? f.filePath ?? '')
for (const f of findings) console.log(`${ruleOf(f)}  ${fileOf(f)}  ${f.message ?? f.description ?? ''}`)
console.log(`${findings.length} open findings (ignores active: ${ignores.ignoreRules.length} rules, ${ignores.ignoreFiles.length} files, ${ignores.ignoreValues.length} values)`)
process.exit(findings.length === 0 ? 0 : 1)
```

Waivers use Impeccable's documented configuration keys in `.impeccable/config.json` (D-130): `detector.ignoreRules` (rule ids), `detector.ignoreFiles` (globs), and `detector.ignoreValues` (`[{ "rule": "...", "value": "...", "reason": "..." }]`, as written by `npx impeccable@3.6.1 ignores add-value <rule> <value> --reason "..."`). Every waiver's reason is also recorded in `.impeccable/critique/waivers.md` (tracked). The file starts as:

```json
{ "detector": { "ignoreRules": [], "ignoreFiles": [], "ignoreValues": [] } }
```

## 5. `.github/workflows/pr.yml`

```yaml
name: pr

on:
  pull_request:
    branches: [main]

concurrency:
  group: pr-${{ github.event.number }}
  cancel-in-progress: true

permissions:
  contents: read
  pull-requests: write

jobs:
  checks:
    uses: ./.github/workflows/checks.yml
    permissions:
      contents: read
      pull-requests: read

  preview-deploy:
    name: preview-deploy
    needs: checks
    if: ${{ vars.DEPLOY_ENABLED == 'true' }}
    runs-on: ubuntu-latest
    timeout-minutes: 30
    env:
      VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
      VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
      VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
      PR_NUMBER: ${{ github.event.number }}
      PREVIEW_ALIAS: tassl-pr-${{ github.event.number }}.vercel.app
    steps:
      - uses: actions/checkout@v7
      - uses: ./.github/actions/setup

      # D-071: one Neon branch per PR, created (or reused) before the deployment exists.
      - name: Create the Neon preview branch
        id: neon
        uses: neondatabase/create-branch-action@v6
        with:
          project_id: ${{ vars.NEON_PROJECT_ID }}
          parent_branch: main
          branch_name: preview/pr-${{ github.event.number }}
          api_key: ${{ secrets.NEON_API_KEY }}

      - name: Assert branch outputs
        run: |
          test -n "${{ steps.neon.outputs.db_url }}"
          test -n "${{ steps.neon.outputs.db_url_pooled }}"

      # D-070: migrate before serving. Migrations use the unpooled string.
      - name: Migrate the preview branch
        env:
          DATABASE_URL: ${{ steps.neon.outputs.db_url }}
          DATABASE_URL_UNPOOLED: ${{ steps.neon.outputs.db_url }}
        run: pnpm db:migrate

      - name: Pull preview project settings
        run: npx vercel@59.11.2 pull --yes --environment=preview --token "$VERCEL_TOKEN"

      - name: Build
        env:
          APP_ENV: preview
          NEXT_PUBLIC_APP_URL: https://${{ env.PREVIEW_ALIAS }}
          DATABASE_URL: ${{ steps.neon.outputs.db_url_pooled }}
          DATABASE_URL_UNPOOLED: ${{ steps.neon.outputs.db_url }}
        run: npx vercel@59.11.2 build --token "$VERCEL_TOKEN"

      - name: Deploy and alias
        run: |
          npx vercel@59.11.2 deploy --prebuilt --token "$VERCEL_TOKEN" \
            --env DATABASE_URL="${{ steps.neon.outputs.db_url_pooled }}" \
            --env DATABASE_URL_UNPOOLED="${{ steps.neon.outputs.db_url }}" \
            --env APP_ENV=preview \
            --env NEXT_PUBLIC_APP_URL="https://$PREVIEW_ALIAS" \
            > deployment-url.txt
          npx vercel@59.11.2 alias set "$(cat deployment-url.txt)" "$PREVIEW_ALIAS" --token "$VERCEL_TOKEN"

      - name: Comment the preview URL on the PR
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          gh pr comment "$PR_NUMBER" --edit-last --create-if-none --body "$(printf 'Preview: https://%s\nDeployment: %s\nNeon branch: preview/pr-%s\n(Vercel Authentication is on for previews, D-101)' "$PREVIEW_ALIAS" "$(cat deployment-url.txt)" "$PR_NUMBER")"
```

Notes:

- `NEXT_PUBLIC_APP_URL` for previews is supplied per deployment (build step env and `--env`) as `https://tassl-pr-<n>.vercel.app`, and the deployment is aliased to that name, so Better Auth's `baseURL` matches the host users open. The preview scope of the Vercel project therefore carries no `NEXT_PUBLIC_APP_URL` value (§11.5). If `vercel alias set` reports the alias is taken by another Vercel account, change the `PREVIEW_ALIAS` prefix in this file (one constant) and record the new prefix in `DECISIONS.md`.
- `vercel build` inlines `NEXT_PUBLIC_*` values at build time; `--env` sets the runtime values of the deployment (`src/server/config.ts` reads `process.env` at boot).
- The preview job needs secrets, so it never runs for pull requests from forks; the repository is private and both team members push branches to it.

## 6. `.github/workflows/preview-cleanup.yml`

```yaml
name: preview-cleanup

on:
  pull_request:
    types: [closed]

permissions:
  contents: read

jobs:
  cleanup:
    name: cleanup
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      # A PR closed before its first successful preview deploy has no branch; do not fail the run for that.
      - uses: neondatabase/delete-branch-action@v3
        continue-on-error: true
        with:
          project_id: ${{ vars.NEON_PROJECT_ID }}
          branch: preview/pr-${{ github.event.number }}
          api_key: ${{ secrets.NEON_API_KEY }}
      - name: Remove the preview alias
        env:
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
          VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
        run: npx vercel@59.11.2 alias rm "tassl-pr-${{ github.event.number }}.vercel.app" --yes --token "$VERCEL_TOKEN" || echo "alias absent"
```

## 7. `.github/workflows/production.yml`

```yaml
name: production

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: production
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  checks:
    uses: ./.github/workflows/checks.yml
    permissions:
      contents: read
      pull-requests: read

  deploy:
    name: deploy
    needs: checks
    if: ${{ vars.DEPLOY_ENABLED == 'true' }}
    runs-on: ubuntu-latest
    timeout-minutes: 40
    env:
      VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
      VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
      VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
      SENTRY_ENABLED: ${{ secrets.SENTRY_AUTH_TOKEN != '' }}
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - uses: ./.github/actions/setup

      - name: Pull production project settings
        run: npx vercel@59.11.2 pull --yes --environment=production --token "$VERCEL_TOKEN"

      # SENTRY_AUTH_TOKEN enables source-map upload in next.config.ts (withSentryConfig);
      # SENTRY_RELEASE is read by @sentry/nextjs and must equal the release created below.
      - name: Build
        env:
          SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
          SENTRY_ORG: ${{ vars.SENTRY_ORG }}
          SENTRY_PROJECT: tassl
          SENTRY_RELEASE: ${{ github.sha }}
        run: npx vercel@59.11.2 build --prod --token "$VERCEL_TOKEN"

      # D-070: expand/contract migrations run against the unpooled production string before the deploy.
      - name: Migrate production
        env:
          DATABASE_URL: ${{ secrets.PRODUCTION_DATABASE_URL_UNPOOLED }}
          DATABASE_URL_UNPOOLED: ${{ secrets.PRODUCTION_DATABASE_URL_UNPOOLED }}
        run: pnpm db:migrate

      - name: Deploy
        run: npx vercel@59.11.2 deploy --prebuilt --prod --token "$VERCEL_TOKEN" > deployment-url.txt

      # The production domain is the value of NEXT_PUBLIC_APP_URL pulled above; the raw deployment
      # URL is protected by Vercel Authentication (Standard Protection), so smoke hits the domain.
      - name: Resolve the production URL
        id: url
        run: |
          PROD_URL="$(grep '^NEXT_PUBLIC_APP_URL=' .vercel/.env.production.local | cut -d= -f2- | tr -d '"')"
          test -n "$PROD_URL"
          echo "prod_url=$PROD_URL" >> "$GITHUB_OUTPUT"

      - name: Smoke
        run: pnpm smoke "${{ steps.url.outputs.prod_url }}"

      - name: Sentry release
        if: env.SENTRY_ENABLED == 'true'
        uses: getsentry/action-release@v3
        env:
          SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
          SENTRY_ORG: ${{ vars.SENTRY_ORG }}
          SENTRY_PROJECT: tassl
        with:
          environment: production
          release: ${{ github.sha }}

      - uses: actions/upload-artifact@v7
        with:
          name: production-deployment-${{ github.sha }}
          path: deployment-url.txt
          retention-days: 90
```

`workflow_dispatch` exists so a production rebuild can be triggered without a commit after an environment variable changes (`gh workflow run production.yml --ref main`), for example after the custom-domain step (§15). `SENTRY_ENABLED` skips the release step until `SENTRY_AUTH_TOKEN` is set in Phase 13.

## 8. `.github/workflows/backup.yml` and `scripts/backup.sh`

D-069: Neon point-in-time restore plus a nightly logical dump kept 30 days (NFR-015: RPO 24 h for the dump).

```yaml
name: backup

on:
  schedule:
    - cron: '30 3 * * *'
  workflow_dispatch:

permissions:
  contents: read

jobs:
  dump:
    name: dump
    runs-on: ubuntu-latest
    timeout-minutes: 30
    env:
      NEXT_PUBLIC_SENTRY_DSN: ${{ vars.NEXT_PUBLIC_SENTRY_DSN }}
    steps:
      - uses: actions/checkout@v7
      - name: Sentry cron check-in (in_progress)
        run: bash scripts/sentry-checkin.sh nightly-backup in_progress '30 3 * * *' 30 60

      # Official PostgreSQL apt repository (postgresql.org/download/linux/ubuntu); pg_dump 17 matches Neon's Postgres 17 (D-036).
      - name: Install postgresql-client-17
        run: |
          sudo apt-get update
          sudo apt-get install -y --no-install-recommends curl ca-certificates
          sudo install -d /usr/share/postgresql-common/pgdg
          sudo curl --fail -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
          . /etc/os-release
          echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" | sudo tee /etc/apt/sources.list.d/pgdg.list
          sudo apt-get update
          sudo apt-get install -y --no-install-recommends postgresql-client-17
          pg_dump --version

      - name: Dump and encrypt
        id: dump
        env:
          PRODUCTION_DATABASE_URL_UNPOOLED: ${{ secrets.PRODUCTION_DATABASE_URL_UNPOOLED }}
          BACKUP_ENCRYPTION_KEY: ${{ secrets.BACKUP_ENCRYPTION_KEY }}
        run: |
          bash scripts/backup.sh backups
          echo "date=$(date -u +%Y-%m-%d)" >> "$GITHUB_OUTPUT"

      - uses: actions/upload-artifact@v7
        with:
          name: tassl-backup-${{ steps.dump.outputs.date }}
          path: backups/
          retention-days: 30
          if-no-files-found: error
      - name: Sentry cron check-in (ok)
        run: bash scripts/sentry-checkin.sh nightly-backup ok
      - name: Sentry cron check-in (error)
        if: failure()
        run: bash scripts/sentry-checkin.sh nightly-backup error
```

`scripts/sentry-checkin.sh` (used by `backup.yml`, `scripts/restore-drill.sh`, and the launch checklist; a no-op that exits 0 when `NEXT_PUBLIC_SENTRY_DSN` is empty, D-098). It uses Sentry's DSN-authenticated cron check-in endpoint (`https://<dsn-host>/api/<project-id>/cron/<monitor-slug>/<public-key>/`), the same mechanism as the restore drill in `13-observability-ops.md` §8.4, so no org slug or API token is needed:

```bash
#!/usr/bin/env bash
# Sentry Cron Monitor check-in through the DSN cron endpoint.
# Usage: bash scripts/sentry-checkin.sh <monitor-slug> <in_progress|ok|error> [<crontab>] [<checkin-margin-min>] [<max-runtime-min>]
# Passing the crontab upserts the monitor's schedule (monitor_config); ok/error check-ins omit it.
set -euo pipefail
SLUG="${1:?monitor slug}"
STATUS="${2:?status: in_progress|ok|error}"
SCHEDULE="${3:-}"
MARGIN="${4:-30}"
MAXRUN="${5:-60}"
DSN="${NEXT_PUBLIC_SENTRY_DSN:-}"
if [ -z "$DSN" ]; then echo "sentry-checkin: NEXT_PUBLIC_SENTRY_DSN empty; skipped"; exit 0; fi
rest="${DSN#https://}"; key="${rest%%@*}"; rest="${rest#*@}"; host="${rest%%/*}"; project="${rest##*/}"
if [ -n "$SCHEDULE" ]; then
  BODY="{\"status\":\"$STATUS\",\"environment\":\"production\",\"monitor_config\":{\"schedule\":{\"type\":\"crontab\",\"value\":\"$SCHEDULE\"},\"checkin_margin\":$MARGIN,\"max_runtime\":$MAXRUN,\"timezone\":\"UTC\"}}"
else
  BODY="{\"status\":\"$STATUS\",\"environment\":\"production\"}"
fi
curl -fsS -o /dev/null -X POST "https://$host/api/$project/cron/$SLUG/$key/" \
  -H 'Content-Type: application/json' --data "$BODY"
echo "sentry-checkin: $SLUG $STATUS"
```

`scripts/backup.sh`:

```bash
#!/usr/bin/env bash
# pg_dump (custom format) of the production database, encrypted with AES-256-CBC.
# Usage: PRODUCTION_DATABASE_URL_UNPOOLED=... BACKUP_ENCRYPTION_KEY=... bash scripts/backup.sh [out-dir]
set -euo pipefail
: "${PRODUCTION_DATABASE_URL_UNPOOLED:?set PRODUCTION_DATABASE_URL_UNPOOLED}"
: "${BACKUP_ENCRYPTION_KEY:?set BACKUP_ENCRYPTION_KEY}"
OUT_DIR="${1:-backups}"
DATE="$(date -u +%Y-%m-%d)"
DUMP="$OUT_DIR/tassl-$DATE.dump"
mkdir -p "$OUT_DIR"
pg_dump --format=custom --no-owner --file "$DUMP" "$PRODUCTION_DATABASE_URL_UNPOOLED"
openssl enc -aes-256-cbc -pbkdf2 -pass env:BACKUP_ENCRYPTION_KEY -in "$DUMP" -out "$DUMP.enc"
rm -f "$DUMP"
sha256sum "$DUMP.enc" > "$DUMP.enc.sha256"
echo "wrote $DUMP.enc ($(du -h "$DUMP.enc" | cut -f1))"
```

Decrypting an artifact (used by the restore drill, §13): `openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_ENCRYPTION_KEY -in tassl-2026-09-02.dump.enc -out tassl-2026-09-02.dump`.

## 9. `scripts/smoke.sh`

Run by `production.yml` after every deploy and by the restore drill. Exit code 0 means every check passed.

```bash
#!/usr/bin/env bash
# Post-deploy smoke test. Usage: bash scripts/smoke.sh <base-url>
set -euo pipefail
BASE="${1:-${NEXT_PUBLIC_APP_URL:-}}"
[ -n "$BASE" ] || { echo 'usage: scripts/smoke.sh <base-url> (or set NEXT_PUBLIC_APP_URL)'; exit 2; }
BASE="${BASE%/}"

expect_status() { # path expected-status
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$BASE$1")"
  if [ "$code" != "$2" ]; then echo "FAIL $1 -> $code (expected $2)"; exit 1; fi
  echo "ok   $1 -> $code"
}

expect_status /api/health 200
expect_status /api/ready 200
expect_status /sign-in 200
expect_status /privacy 200
expect_status /terms 200
expect_status /api/v1/openapi.yaml 200
curl -sS --max-time 20 "$BASE/api/health" | grep -q '"status":"ok"' || { echo "FAIL /api/health body"; exit 1; }
curl -sS --max-time 20 "$BASE/api/ready" | grep -q '"status":"ready"' || { echo "FAIL /api/ready body"; exit 1; }

# Unauthenticated app routes redirect to /sign-in (src/proxy.ts).
FINAL="$(curl -sS -o /dev/null -w '%{url_effective}' -L --max-time 20 "$BASE/home")"
case "$FINAL" in */sign-in*) echo "ok   /home -> $FINAL" ;; *) echo "FAIL /home -> $FINAL"; exit 1 ;; esac

# Security headers are asserted on https only (12-security.md; SYS-015).
case "$BASE" in
  https://*)
    HDRS="$(curl -sSI --max-time 20 "$BASE/sign-in")"
    for h in strict-transport-security content-security-policy x-content-type-options x-frame-options referrer-policy x-request-id; do
      echo "$HDRS" | grep -qi "^$h:" || { echo "FAIL missing header $h"; exit 1; }
      echo "ok   header $h"
    done
    ;;
esac
echo "smoke passed for $BASE"
```

## 10. Required status checks and branch protection

`.github/branch-protection.json`:

```json
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "checks / lint",
      "checks / typecheck",
      "checks / unit",
      "checks / integration",
      "checks / build",
      "checks / e2e",
      "checks / impeccable",
      "checks / lhci",
      "checks / openapi-check",
      "checks / security"
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": false
}
```

Apply and verify (from the repo root; `gh` substitutes `{owner}` and `{repo}` from the current repository):

```bash
gh api -X PUT "repos/{owner}/{repo}/branches/main/protection" --input .github/branch-protection.json
gh api "repos/{owner}/{repo}/branches/main/protection" --jq '.required_status_checks.contexts, .enforce_admins.enabled, .required_linear_history.enabled'
gh repo edit --enable-squash-merge --enable-merge-commit=false --enable-rebase-merge=false --delete-branch-on-merge
```

Rules: `required_pull_request_reviews` is `null` because the team has two people and self-merge is allowed (`04-repo-structure.md` §6); `preview-deploy` is not required; `strict: true` requires the branch to be current with `main` before merge; squash merge is the only merge method.

## 11. Phase 0 setup: GitHub, Vercel, Neon (exact order)

Preconditions: `gh auth login` done, `git init -b main` and `gh repo create tassl --private --source=. --push` done (D-039), Node 24 active (`nvm use --lts`), `corepack enable`. Secret values are the only human inputs: obtain each from the console page in §17 and `export` it in the shell before running the block that uses it. Working files with secret values go to `$HOME/.config/tassl/` (outside the repository), never into `docs/` or `.env.example`.

### 11.1 Vercel project

```bash
S="$HOME/.config/tassl"; mkdir -p "$S"; chmod 700 "$S"
npx vercel@59.11.2 login                                   # browser login on the builder's machine; CI uses --token
npx vercel@59.11.2 link --yes --project tassl              # creates the project "tassl" when it does not exist; writes .vercel/project.json (gitignored)
VERCEL_ORG_ID="$(node -p "require('./.vercel/project.json').orgId")"
VERCEL_PROJECT_ID="$(node -p "require('./.vercel/project.json').projectId")"
# VERCEL_TOKEN: https://vercel.com/account/tokens -> Create Token, scope = the team shown in .vercel/project.json, expiration 1 year
gh secret set VERCEL_TOKEN --body "$VERCEL_TOKEN"
gh secret set VERCEL_ORG_ID --body "$VERCEL_ORG_ID"
gh secret set VERCEL_PROJECT_ID --body "$VERCEL_PROJECT_ID"
```

### 11.2 Vercel project settings (D-002, D-038, D-101)

```bash
# Node.js 24.x (Settings -> General -> Node.js Version) and Standard Protection
# (Settings -> Deployment Protection -> Vercel Authentication: previews and non-domain production URLs).
curl -sf -X PATCH "https://api.vercel.com/v9/projects/$VERCEL_PROJECT_ID?teamId=$VERCEL_ORG_ID" \
  -H "Authorization: Bearer $VERCEL_TOKEN" -H "Content-Type: application/json" \
  -d '{"nodeVersion":"24.x","ssoProtection":{"deploymentType":"prod_deployment_urls_and_all_previews"}}' > /dev/null
# Fluid compute is on by default for new projects: verify at Settings -> Functions -> Fluid Compute = Enabled.
# Read the Vercel-assigned production domain (tassl.vercel.app when free, otherwise the assigned *.vercel.app name).
PROD_DOMAIN="$(curl -sf "https://api.vercel.com/v9/projects/$VERCEL_PROJECT_ID/domains?teamId=$VERCEL_ORG_ID" \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).domains.filter(d=>d.name.endsWith('.vercel.app'))[0].name")"
echo "$PROD_DOMAIN"; printf 'https://%s' "$PROD_DOMAIN" > "$S/prod-url.txt"
```

### 11.3 Neon project (D-036, D-037)

```bash
# NEON_API_KEY: https://console.neon.tech/app/settings/api-keys -> Generate new API key
npx neon@4.14.0 auth                                        # browser login; or export NEON_API_KEY and skip
npx neon@4.14.0 projects create --name tassl --pg-version 17 --region-id aws-us-east-1 --output json > "$S/neon-project.json"
NEON_PROJECT_ID="$(node -p "require('$S/neon-project.json').project.id")"
echo "$NEON_PROJECT_ID"
npx neon@4.14.0 connection-string main --project-id "$NEON_PROJECT_ID" --pooled | tr -d '\n' > "$S/neon-url-pooled.txt"
npx neon@4.14.0 connection-string main --project-id "$NEON_PROJECT_ID" | tr -d '\n' > "$S/neon-url.txt"
# History retention 7 days (D-069): Console -> Project -> Settings -> Storage -> History retention = 7 days.
# Scripted equivalent; the API rejects a value above the plan's maximum, in which case set the maximum
# shown in the console and record the value in DECISIONS.md.
curl -sf -X PATCH "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID" \
  -H "Authorization: Bearer $NEON_API_KEY" -H "Content-Type: application/json" \
  -d '{"project":{"history_retention_seconds":604800}}' > /dev/null
gh secret set NEON_API_KEY --body "$NEON_API_KEY"
gh variable set NEON_PROJECT_ID --body "$NEON_PROJECT_ID"
gh secret set PRODUCTION_DATABASE_URL_UNPOOLED < "$S/neon-url.txt"
```

### 11.4 Remaining GitHub secrets and variables

```bash
openssl rand -hex 32 | tr -d '\n' > "$S/backup-encryption-key.txt"   # keep a copy in the team password manager: without it no backup can be restored
gh secret set BACKUP_ENCRYPTION_KEY < "$S/backup-encryption-key.txt"
# Phase 13 (Sentry): SENTRY_AUTH_TOKEN from https://sentry.io/settings/account/api/auth-tokens/ (scopes project:releases, org:read);
# SENTRY_ORG is the organization slug from Sentry -> Organization settings.
[ -n "${SENTRY_AUTH_TOKEN:-}" ] && gh secret set SENTRY_AUTH_TOKEN --body "$SENTRY_AUTH_TOKEN"   # Phase 13 sets it; skipped in Phase 0
[ -n "${SENTRY_ORG:-}" ] && gh variable set SENTRY_ORG --body "$SENTRY_ORG"                      # Phase 13
[ -n "${NEXT_PUBLIC_SENTRY_DSN:-}" ] && gh variable set NEXT_PUBLIC_SENTRY_DSN --body "$NEXT_PUBLIC_SENTRY_DSN"   # Phase 13
gh variable set DEPLOY_ENABLED --body true   # gates the preview-deploy and deploy jobs (D-134); set last in Phase 0
```

### 11.5 Vercel environment variables (values piped from files, never from `echo` on the command line)

```bash
openssl rand -base64 32 | tr -d '\n' > "$S/better-auth-secret-production.txt"
openssl rand -base64 32 | tr -d '\n' > "$S/better-auth-secret-preview.txt"
openssl rand -hex 32    | tr -d '\n' > "$S/cron-secret-production.txt"
openssl rand -hex 32    | tr -d '\n' > "$S/cron-secret-preview.txt"
printf 'production' > "$S/app-env-production.txt"; printf 'preview' > "$S/app-env-preview.txt"
# SEED_PASSWORD (D-040): choose a 12+ character value and store it in the password manager.
printf '%s' "$SEED_PASSWORD" > "$S/seed-password.txt"

V="npx vercel@59.11.2"
$V env add DATABASE_URL production            --token "$VERCEL_TOKEN" < "$S/neon-url-pooled.txt"
$V env add DATABASE_URL_UNPOOLED production   --token "$VERCEL_TOKEN" < "$S/neon-url.txt"
$V env add DATABASE_URL preview               --token "$VERCEL_TOKEN" < "$S/neon-url-pooled.txt"   # main-branch strings; pr.yml overrides per deployment with --env
$V env add DATABASE_URL_UNPOOLED preview      --token "$VERCEL_TOKEN" < "$S/neon-url.txt"
$V env add BETTER_AUTH_SECRET production      --token "$VERCEL_TOKEN" < "$S/better-auth-secret-production.txt"
$V env add BETTER_AUTH_SECRET preview         --token "$VERCEL_TOKEN" < "$S/better-auth-secret-preview.txt"
$V env add CRON_SECRET production             --token "$VERCEL_TOKEN" < "$S/cron-secret-production.txt"
$V env add CRON_SECRET preview                --token "$VERCEL_TOKEN" < "$S/cron-secret-preview.txt"
$V env add NEXT_PUBLIC_APP_URL production     --token "$VERCEL_TOKEN" < "$S/prod-url.txt"            # preview scope: supplied per deployment by pr.yml (§5)
$V env add APP_ENV production                 --token "$VERCEL_TOKEN" < "$S/app-env-production.txt"
$V env add APP_ENV preview                    --token "$VERCEL_TOKEN" < "$S/app-env-preview.txt"
$V env add SEED_PASSWORD production           --token "$VERCEL_TOKEN" < "$S/seed-password.txt"
$V env ls --token "$VERCEL_TOKEN"
```

Every other variable keeps its `src/server/config.ts` default in preview and production until its phase sets it: `LOG_LEVEL` (default `info`), `FEATURE_*` (D-023 defaults), `LLM_*` (Phase 14 adds `LLM_API_KEY` and flips `FEATURE_AI`), `EMAIL_TRANSPORT`, `RESEND_API_KEY`, `EMAIL_FROM` (Phase 3 sets `resend`), `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE` (Phase 13). Each of those is added with the same `vercel env add <NAME> production < file` form.

### 11.6 Vercel Marketplace Neon integration (the alternative path)

Installing Neon from https://vercel.com/marketplace/neon (Vercel → Storage → Create Database → Neon, or "Connect existing Neon project") injects `DATABASE_URL` and `DATABASE_URL_UNPOOLED` into the Vercel project automatically for the selected environments. When the integration is used, the four `vercel env add DATABASE_URL*` lines in §11.5 are skipped and the integration's automatic preview branching is left off (D-071: `pr.yml` creates and migrates the branch itself, before the deployment exists). Phase 0 uses the CLI path in §11.3 and §11.5, which is deterministic and needs no dashboard clicks; the integration is the documented alternative and can be installed later without changing any workflow.

### 11.7 `vercel.json` (from `04-repo-structure.md` §9)

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "git": { "deploymentEnabled": false },
  "crons": [{ "path": "/api/internal/jobs/drain", "schedule": "0 4 * * *" }]
}
```

`git.deploymentEnabled: false` keeps a single deploy path (GitHub Actions with the CLI); the cron sweep is D-012. Vercel sends `CRON_SECRET` as `Authorization: Bearer` to the cron path.

### 11.8 First production deploy (Phase 0 exit)

Merging the Phase 0 pull request into `main` runs `production.yml`: gates, `vercel build --prod`, `pnpm db:migrate` on the Neon `main` branch (creates the `pgboss` schema), `vercel deploy --prebuilt --prod`, smoke. Verify with `gh run watch` on the run id printed by `gh run list --workflow=production.yml --limit 1`, then `bash scripts/smoke.sh "$(cat "$S/prod-url.txt")"` from the builder's machine.

## 12. Migrations on deploy (D-070)

```mermaid
sequenceDiagram
  participant GA as production.yml
  participant N as Neon main (unpooled)
  participant V as Vercel
  GA->>V: vercel build --prod (artifacts in .vercel/output)
  GA->>N: pnpm db:migrate (drizzle-kit migrate, then scripts/pgboss-migrate.ts)
  N-->>GA: migrations applied (expand-only in this release)
  GA->>V: vercel deploy --prebuilt --prod
  V-->>GA: deployment URL; production domain re-pointed
  GA->>V: scripts/smoke.sh against NEXT_PUBLIC_APP_URL
```

Rules:

1. Migrations run before the new code serves traffic and after the build succeeds, so a failed build never migrates.
2. Expand/contract only. A release adds columns, tables, indexes, and enum values (expand); the release after it drops what the previous code no longer reads (contract). A destructive change never ships in the same release as the code that stops using it, so the previous deployment stays compatible for instant rollback (§14).
3. Migrations use `PRODUCTION_DATABASE_URL_UNPOOLED` (owner role `neondb_owner`, `06-data-model.md` §4). The application connects through the pooled string as `tassl_app`.
4. `pnpm db:migrate` is idempotent: re-running a workflow (`gh workflow run production.yml --ref main`) applies nothing new.
5. Preview branches receive the same migrations in `pr.yml` before their deployment, so a migration that fails does so on the PR, not on `main`.
6. The `contract` step of a two-release change has a hand-written reverse file in `drizzle/down/` (`06-data-model.md` §4); expand steps have none because they are safe to leave in place.

## 13. Backups and restore (D-069, NFR-015)

| Mechanism | Frequency | Retention | Restore path |
|---|---|---|---|
| Neon point-in-time history | continuous | 7 days (§11.3) | `npx neon@4.14.0 branches restore main "^self@$RESTORE_TO" --project-id "$NEON_PROJECT_ID"` after the timestamp is confirmed in the incident notes (`13-observability-ops.md` runbook) |
| Nightly logical dump (`backup.yml`) | 03:30 UTC daily | 30 days as a GitHub Actions artifact `tassl-backup-<date>` | `scripts/restore-drill.sh` (below), RTO 1 h |

Weekly restore drill (`scripts/restore-drill.sh` runs these steps; `06-data-model.md` §6):

```bash
S="$HOME/.config/tassl"; NEON_PROJECT_ID="$(gh variable get NEON_PROJECT_ID)"
RUN_ID="$(gh run list --workflow=backup.yml --status success --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run download "$RUN_ID" --dir restore
ENC="$(ls restore/*/tassl-*.dump.enc | head -n 1)"
BACKUP_ENCRYPTION_KEY="$(cat "$S/backup-encryption-key.txt")" openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_ENCRYPTION_KEY -in "$ENC" -out restore/tassl.dump
DRILL="restore-drill-$(date -u +%Y-%m-%d)"
npx neon@4.14.0 branches create --name "$DRILL" --parent main --project-id "$NEON_PROJECT_ID"
DRILL_URL="$(npx neon@4.14.0 connection-string "$DRILL" --project-id "$NEON_PROJECT_ID" | tr -d '\n')"
pg_restore --clean --if-exists --no-owner --dbname "$DRILL_URL" restore/tassl.dump
DATABASE_URL="$DRILL_URL" DATABASE_URL_UNPOOLED="$DRILL_URL" pnpm db:migrate
DATABASE_URL="$DRILL_URL" DATABASE_URL_UNPOOLED="$DRILL_URL" pnpm build && (DATABASE_URL="$DRILL_URL" DATABASE_URL_UNPOOLED="$DRILL_URL" pnpm start > /dev/null 2>&1 &) && sleep 8
bash scripts/smoke.sh http://localhost:3000
npx neon@4.14.0 branches delete "$DRILL" --project-id "$NEON_PROJECT_ID"
rm -rf restore
```

Record the elapsed time in the drill log (`13-observability-ops.md`); the drill passes when `smoke.sh` exits 0 within 60 minutes of starting the download (RTO 1 h).

## 14. Rollback

| Situation | Action | Command |
|---|---|---|
| Bad code, no contract migration in the release (the normal case under D-070) | Vercel instant rollback to the previous production deployment, then revert the merge on `main` through a PR so the next push does not redeploy it | `npx vercel@59.11.2 rollback --token "$VERCEL_TOKEN"` (previous deployment) or `npx vercel@59.11.2 rollback "$(cat deployment-url.txt)" --token "$VERCEL_TOKEN"` with the URL from the `production-deployment-<sha>` artifact of the bad run; then `BAD_SHA="$(git rev-parse origin/main)"; git switch -c fix/revert-"$BAD_SHA" && git revert -m 1 "$BAD_SHA"` and open a PR |
| Bad code and the release contained a contract migration | Instant rollback as above, then reverse the contract step with its paired `drizzle/down/` file (the file re-creates what was dropped and removes the migration's row from `drizzle.__drizzle_migrations`) | `psql "$(cat "$S/neon-url.txt")" -v ON_ERROR_STOP=1 -f drizzle/down/0007_contract_example.sql` (substitute the actual file name from `drizzle/down/`) |
| Data damage (bad write, not bad schema) | Neon point-in-time restore of `main` to a timestamp before the damage; the workflow's migrations are re-applied by the next deploy if the restore point predates them | `RESTORE_TO=2026-09-02T03:00:00Z; npx neon@4.14.0 branches restore main "^self@$RESTORE_TO" --project-id "$NEON_PROJECT_ID"` |
| Preview broken | Nothing to roll back; push a fix to the PR, `pr.yml` redeploys and re-aliases | none |

`vercel rollback` re-points the production domain within seconds and needs no build. A rollback never edits stored run data (FR-008).

## 15. Custom domain (D-053, keyed on `APP_DOMAIN`)

Phase 15 step, run once on the builder's machine. `APP_DOMAIN` is empty by default (`05-environment-config.md`), in which case nothing happens and the Vercel-assigned domain stays active.

```bash
S="$HOME/.config/tassl"; V="npx vercel@59.11.2"
if [ -n "${APP_DOMAIN:-}" ]; then
  $V domains add "$APP_DOMAIN" --token "$VERCEL_TOKEN"
  $V domains inspect "$APP_DOMAIN" --token "$VERCEL_TOKEN"     # prints the DNS records Vercel expects and the verification state
fi
```

DNS at the registrar (propagation is checked with `dig +short "$APP_DOMAIN"`):

| Record | Host | Value | When |
|---|---|---|---|
| CNAME | the subdomain (for example `app`) | `cname.vercel-dns.com` | `APP_DOMAIN` is a subdomain such as `app.example.edu` |
| A | `@` | `76.76.21.21` | `APP_DOMAIN` is an apex such as `example.edu` |

After `vercel domains inspect` reports the domain verified and the certificate issued (Vercel issues it automatically):

```bash
printf 'https://%s' "$APP_DOMAIN" > "$S/prod-url.txt"
printf '%s' "$APP_DOMAIN" > "$S/app-domain.txt"
$V env rm NEXT_PUBLIC_APP_URL production --yes --token "$VERCEL_TOKEN"
$V env add NEXT_PUBLIC_APP_URL production --token "$VERCEL_TOKEN" < "$S/prod-url.txt"
$V env add APP_DOMAIN production --token "$VERCEL_TOKEN" < "$S/app-domain.txt"      # next.config.ts allowed hosts
gh workflow run production.yml --ref main                                            # rebuild: NEXT_PUBLIC_* values are inlined at build time
```

Then update the two external references to the URL: the Google OAuth redirect URI (`${NEXT_PUBLIC_APP_URL}/api/auth/callback/google`, Google Cloud Console → APIs & Services → Credentials) and the Resend sending domain (`EMAIL_FROM`). The old Vercel-assigned domain keeps working as a redirect to the custom domain (Vercel's default for the project's other domains).

## 16. Launch checklist (Phase 15)

`PROD_URL` in every command is read once: `PROD_URL="$(cat "$HOME/.config/tassl/prod-url.txt")"`. PII is collected (name, email), so the legal review row is mandatory (SYS-007, D-017).

| # | Check | Command or place | Pass condition |
|---|---|---|---|
| 1 | TLS and HSTS on the active domain | `curl -sI "$PROD_URL/" \| grep -iE '^(HTTP/\|strict-transport-security)'` | `HTTP/2 200` and a `strict-transport-security` line with `max-age=63072000` |
| 2 | Security headers (SYS-015, NFR-011) | `curl -sI "$PROD_URL/sign-in"` | every header in the table below present with the listed value |
| 3 | Health and routes | `bash scripts/smoke.sh "$PROD_URL"` | `smoke passed` |
| 4 | Backups running | `gh run list --workflow=backup.yml --limit 3` | last three runs `success`; `gh run download "$(gh run list --workflow=backup.yml --status success --limit 1 --json databaseId --jq '.[0].databaseId')"` yields one `tassl-YYYY-MM-DD.dump.enc` file |
| 5 | Restore verified by a drill | §13 commands | `smoke.sh` exits 0 against the restored branch within 60 min; duration logged |
| 6 | Alerts on (`13-observability-ops.md`) | Sentry → Alerts | every rule in `13-observability-ops.md` §7 exists and is enabled, starting with `NFR-007 5xx rate`, `NFR-007 readiness down`, `NFR-001 scoring slow`, and the three cron monitors; notification action = email to the builder's Sentry account |
| 7 | Sentry receiving events | `NEXT_PUBLIC_SENTRY_DSN="$(gh variable get NEXT_PUBLIC_SENTRY_DSN)" APP_ENV=production pnpm exec tsx scripts/sentry-test.ts` | the event id printed appears under Sentry → Issues within 1 min, tagged `environment:production` |
| 8 | Sentry release tagging | Sentry → Releases | the latest release equals the `main` head sha and shows source maps |
| 9 | PostHog receiving events | sign in at `$PROD_URL/sign-in` as `instructor@tassl.local`; PostHog → Activity → Live events | a `$pageview` for `/home` and the sign-in event from `17-analytics-events.md` arrive within 1 min |
| 10 | Load test done (NFR-014, D-102) | §16.2 | k6 exits 0: p95 read < 400 ms, p95 write < 800 ms at 60 VUs for 10 min; summary file attached to the release PR |
| 11 | Legal pages reviewed by a human | `$PROD_URL/privacy`, `$PROD_URL/terms` | the builder records the review date in the release PR description; the pages name the data collected (name, email, run traces) and the processors (Vercel, Neon, Resend, PostHog, Sentry, Xiaomi MiMo, Anthropic) |
| 12 | Production env vars set | `npx vercel@59.11.2 env ls production --token "$VERCEL_TOKEN"` | rows exist for `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `BETTER_AUTH_SECRET`, `CRON_SECRET`, `NEXT_PUBLIC_APP_URL`, `APP_ENV`, `SEED_PASSWORD`, `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_POSTHOG_KEY`, `EMAIL_TRANSPORT`, `RESEND_API_KEY`, `EMAIL_FROM`, `LLM_API_KEY`, `FEATURE_AI`; no row for `FEATURE_TEST_CONTROLS` (default `true` stays, D-023: the walkthrough step 7 needs it, FR-118) |
| 13 | Seed accounts present in production (D-040) | `DATABASE_URL="$(cat "$S/neon-url.txt")" DATABASE_URL_UNPOOLED="$(cat "$S/neon-url.txt")" SEED_PASSWORD="$(cat "$S/seed-password.txt")" pnpm db:seed` | sign-in as `student1@tassl.local` succeeds |
| 14 | Cron registered | Vercel → Project → Settings → Cron Jobs | `/api/internal/jobs/drain` at `0 4 * * *`; last run status `200` |
| 15 | Branch protection | `gh api "repos/{owner}/{repo}/branches/main/protection" --jq '.required_status_checks.contexts'` | the ten `checks / ...` names from §10 |
| 16 | Cross-browser E2E | `pnpm exec playwright install --with-deps && pnpm test:e2e` (local, all three projects) | 0 failures on chromium, firefox, webkit (NFR-010) |
| 17 | Walkthrough script | `docs/tech/build-plan/phase-15-release.md` §Walkthrough | steps 1 to 17 completed on both variants (FR-250, FR-251) |

### 16.1 Expected security headers on `$PROD_URL/sign-in`

Set by `src/proxy.ts`; `12-security.md` is the authority for the CSP directive list.

| Header | Expected value |
|---|---|
| `strict-transport-security` | `max-age=63072000; includeSubDomains; preload` |
| `content-security-policy` | present; begins with `default-src 'self'` |
| `x-content-type-options` | `nosniff` |
| `x-frame-options` | `DENY` |
| `referrer-policy` | `strict-origin-when-cross-origin` |
| `permissions-policy` | `camera=(), microphone=(), geolocation=()` |
| `cross-origin-opener-policy` | `same-origin` |
| `x-request-id` | a UUID (D-086) |
| `cache-control` on `/api/health` and `/api/ready` | `no-store` |

### 16.2 Load test (k6, `scripts/load/run-loop.js`)

Install k6:

```bash
# macOS
brew install k6
# Ubuntu (official k6 apt repository)
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install -y k6
```

Target: the preview of the release PR (D-102). Previews sit behind Vercel Authentication (D-101), so k6 sends the project's Protection Bypass for Automation secret: Vercel → Project → Settings → Deployment Protection → Protection Bypass for Automation → Generate; Vercel stores it as the project variable `VERCEL_AUTOMATION_BYPASS_SECRET`, which is copied into the shell for this run only and is never a GitHub secret.

```bash
S="$HOME/.config/tassl"; NEON_PROJECT_ID="$(gh variable get NEON_PROJECT_ID)"
PR="$(gh pr view --json number --jq .number)"                       # the release PR, checked out locally
PREVIEW_URL="https://tassl-pr-$PR.vercel.app"
BRANCH_URL="$(npx neon@4.14.0 connection-string "preview/pr-$PR" --project-id "$NEON_PROJECT_ID" | tr -d '\n')"
DATABASE_URL="$BRANCH_URL" DATABASE_URL_UNPOOLED="$BRANCH_URL" SEED_PASSWORD="$(cat "$S/seed-password.txt")" pnpm exec tsx scripts/load/seed-users.ts   # 60 load-test students on the preview branch only
k6 run -e BASE_URL="$PREVIEW_URL" -e BYPASS="$VERCEL_AUTOMATION_BYPASS_SECRET" -e SEED_PASSWORD="$(cat "$S/seed-password.txt")" \
  -e VUS=60 -e DURATION=10m --summary-export load-summary.json scripts/load/run-loop.js
```

`scripts/load/run-loop.js` contract: reads `BASE_URL`, `BYPASS` (sent as the `x-vercel-protection-bypass` header on every request), `SEED_PASSWORD`, `VUS` (default 60), `DURATION` (default `10m`); each VU signs in as `load-student-NNN@tassl.local` (`NNN` = VU number, zero-padded), opens the walkthrough assignment, starts a run, and loops readiness → frame → delegation → stance → lock; requests are tagged `kind:read` or `kind:write`; thresholds `http_req_duration{kind:read}: p(95)<400`, `http_req_duration{kind:write}: p(95)<800`, `http_req_failed: rate<0.01` (NFR-008, NFR-014). `scripts/load/seed-users.ts` creates those 60 accounts in the walkthrough section idempotently and refuses to run when `APP_ENV=production`.

### 16.3 `scripts/sentry-test.ts`

```ts
// Sends one test error to the configured DSN and waits for delivery. Used by launch checklist row 7.
import * as Sentry from '@sentry/nextjs'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? ''
if (!dsn) {
  console.error('NEXT_PUBLIC_SENTRY_DSN is empty; nothing sent')
  process.exit(1)
}
Sentry.init({ dsn, environment: process.env.APP_ENV ?? 'local', release: process.env.SENTRY_RELEASE, tracesSampleRate: 0 })
const eventId = Sentry.captureException(new Error(`Tassl launch check ${new Date().toISOString()}`))
await Sentry.flush(5000)
console.log(`sent event ${eventId}; expect it under Sentry -> Issues within one minute`)
```

## 17. Secrets and variables inventory

CI-only values live in GitHub (`gh secret set`, `gh variable set`); application values live in Vercel (`vercel env add`); nothing secret is ever in `.env.example` or in a workflow file. Vercel *sensitive* variables never reach the runner through `vercel pull`, so the CI build steps read `BETTER_AUTH_SECRET` and `CRON_SECRET` from the GitHub secrets `BETTER_AUTH_SECRET_PREVIEW`, `CRON_SECRET_PREVIEW`, `BETTER_AUTH_SECRET_PRODUCTION`, and `CRON_SECRET_PRODUCTION`, which hold the same values as the Vercel environments (D-160). Rotation runbook: `13-observability-ops.md` §Runbook: rotate a secret; `05-environment-config.md` §6.

| Name | Store | Secret | Obtained from | Used by |
|---|---|---|---|---|
| `VERCEL_TOKEN` | GitHub secret | yes | https://vercel.com/account/tokens | `pr.yml`, `production.yml`, `preview-cleanup.yml` |
| `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | GitHub secrets | yes (identifiers, treated as secrets) | `.vercel/project.json` after `vercel link` | same |
| `NEON_API_KEY` | GitHub secret | yes | https://console.neon.tech/app/settings/api-keys | `pr.yml`, `preview-cleanup.yml` |
| `NEON_PROJECT_ID` | GitHub variable | no | `neon projects create --output json` (`.project.id`); Neon Console → Project → Settings → General | `pr.yml`, `preview-cleanup.yml`, drill |
| `PRODUCTION_DATABASE_URL_UNPOOLED` | GitHub secret | yes | `neon connection-string main` (unpooled); same value as the Vercel production `DATABASE_URL_UNPOOLED` | `production.yml` migrate, `backup.yml` |
| `BACKUP_ENCRYPTION_KEY` | GitHub secret and the password manager | yes | `openssl rand -hex 32` | `backup.yml`, restore drill |
| `DEPLOY_ENABLED` | GitHub variable | no | `gh variable set DEPLOY_ENABLED --body true` at the end of Phase 0 (D-134) | `pr.yml` `preview-deploy`, `production.yml` `deploy` (`if: vars.DEPLOY_ENABLED == 'true'`) |
| `NEXT_PUBLIC_SENTRY_DSN` | GitHub variable and Vercel env (production, preview) | no | Sentry → Project → Settings → Client Keys (DSN); set in Phase 13 | `backup.yml` and the restore drill cron check-ins (`scripts/sentry-checkin.sh`), app runtime |
| `SENTRY_AUTH_TOKEN` | GitHub secret | yes | https://sentry.io/settings/account/api/auth-tokens/ (scopes `project:releases`, `org:read`) | `production.yml` build and release |
| `SENTRY_ORG` | GitHub variable | no | Sentry → Organization settings (slug) | `production.yml` |
| `APP_DOMAIN` | shell variable in the Phase 15 step; Vercel production env once set | no | the registrar | §15 |
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | Vercel env (production, preview) | yes | `neon connection-string` | app, `drizzle.config.ts` |
| `BETTER_AUTH_SECRET`, `CRON_SECRET` | Vercel env (production, preview; distinct values) | yes | `openssl rand -base64 32`, `openssl rand -hex 32` | app |
| `NEXT_PUBLIC_APP_URL`, `APP_ENV`, `SEED_PASSWORD` | Vercel env (production; `APP_ENV` also preview) | `SEED_PASSWORD` yes | §11.2, §11.5 | app, seed |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Vercel project (generated by Vercel); shell only | yes | Vercel → Settings → Deployment Protection → Protection Bypass for Automation | k6 load test (§16.2) |
| `GITHUB_TOKEN` | provided by Actions | yes | automatic | gitleaks, `gh pr comment` |
