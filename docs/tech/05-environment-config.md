# 05 — Environment and Configuration

**Purpose / Read this when:** you add, read, or rotate an environment variable, or set up local, preview, or production environments. `pnpm dev` must run with the defaults in `.env.example` and no secrets.

**Requirements covered:** SYS-013, SYS-023, SYS-025, NFR-011, INT-001 to INT-008; supports AI-001 to AI-005 through the LLM variables.

## 1. Environment variables

`Envs` column: L = local, P = preview, R = production, T = test (CI). "Required" means the process refuses to start without it in that environment; otherwise the default applies. Secrets are marked; every secret has a working non-secret default so every step verifies without it.

| Name | Purpose | Default / example (non-secret) | Envs required | Secret | Read in | Where the secret value is obtained |
|---|---|---|---|---|---|---|
| `APP_ENV` | Which environment the process believes it is in: `local`, `test`, `preview`, `production` | `local` | set explicitly in P, R, T | no | `src/server/config.ts` | — |
| `NEXT_PUBLIC_APP_URL` | Absolute public URL; Better Auth `baseURL`; email links | `http://localhost:3000` | P, R | no | `src/lib/env.public.ts`, `src/server/auth/auth.ts` | — |
| `APP_DOMAIN` | Custom production domain; empty means "use the Vercel-assigned domain" | empty | none | no | `phase-15` domain step, `next.config.ts` (allowed hosts) | — |
| `LOG_LEVEL` | pino level | `debug` locally, `info` elsewhere | none | no | `src/server/logging/logger.ts` | — |
| `DATABASE_URL` | Pooled Postgres connection string | `postgres://tassl:tassl@localhost:5432/tassl` | L, P, R, T | yes (contains password) | `src/server/db/client.ts`, `src/server/jobs/boss.ts` | Neon Console → Project → Connection Details (pooled); Phase 0 sets it with `vercel env add` from `neon connection-string` (`15-cicd-deployment.md` §11.5, D-071) |
| `DATABASE_URL_UNPOOLED` | Direct connection for migrations and `pg_dump` | same as `DATABASE_URL` | P, R | yes | `drizzle.config.ts`, `scripts/*` | Same page, "unpooled" toggle |
| `TEST_DATABASE_URL` | Integration/E2E database | `postgres://tassl:tassl@localhost:5432/tassl_test` | T | no | `tests/setup/integration.ts`, `scripts/db-reset.ts` | — |
| `TASSL_APP_DB_PASSWORD` | Password of the `tassl_app` database role used by `DATABASE_URL` in preview and production (D-110) | empty (owner role used locally) | R (Phase 15 sets it) | yes | `scripts/db-app-role.ts` | Generated: `openssl rand -base64 24`; stored with `vercel env add TASSL_APP_DB_PASSWORD production`; rotated with the Neon role password |
| `BETTER_AUTH_SECRET` | Session and token signing key (≥ 32 chars) | `local-dev-secret-do-not-use-in-prod-0123456789` | P, R | yes | `src/server/auth/auth.ts` | Generate: `openssl rand -base64 32`; store with `vercel env add BETTER_AUTH_SECRET production` |
| `GOOGLE_CLIENT_ID` | Google OAuth client id | empty (button hidden) | none | no | `src/server/auth/auth.ts` | Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID (Web) with redirect `${NEXT_PUBLIC_APP_URL}/api/auth/callback/google` |
| `GOOGLE_CLIENT_SECRET` | Google OAuth secret | empty | none | yes | same | Same page |
| `EMAIL_TRANSPORT` | `console` or `resend` | `console` | none | no | `src/server/email/transport.ts` | — |
| `RESEND_API_KEY` | Resend API key | empty (console transport) | R (when `EMAIL_TRANSPORT=resend`) | yes | `src/server/email/transport.ts` | https://resend.com/api-keys → Create API Key (Sending access) |
| `EMAIL_FROM` | From header | `Tassl <no-reply@tassl.local>` | R | no | `src/server/email/send.ts` | Resend → Domains → verified domain |
| `NOTIFY_EMAIL_COPIES` | Send email copies of in-app notifications | `true` | none | no | `src/server/modules/notifications/service.ts` | — |
| `FEATURE_AI` | Master switch: `false` forces the mock provider (D-029) | `false` | none | no | `src/lib/flags.ts` | — |
| `FEATURE_SAMPLE_DATA` | Show illustrative sample data views | `true` | none | no | `src/lib/flags.ts` | — |
| `FEATURE_TEST_CONTROLS` | Build-phase test controls (forced assistant failure) | `true` | none | no | `src/lib/flags.ts` | — |
| `LLM_PROVIDER` | `mock`, `openai-compatible`, `anthropic` | `mock` | none | no | `src/server/llm/registry.ts` | — |
| `LLM_BASE_URL` | OpenAI-compatible base URL | `https://api.xiaomimimo.com/v1` | none | no | `src/server/llm/providers/openai-compatible/index.ts` | — |
| `LLM_MODEL` | Model id | `mimo-v2.5-pro` | none | no | same | — |
| `LLM_API_KEY` | Provider key (sent as `api-key` and `Authorization: Bearer`) | empty (mock stays active) | R when `LLM_PROVIDER=openai-compatible` | yes | same | https://platform.xiaomimimo.com/#/console/api-keys → Create API Key |
| `LLM_TIMEOUT_MS` | Per-call timeout | `60000` | none | no | `src/server/llm/provider.ts` | — |
| `LLM_MAX_OUTPUT_TOKENS` | Cap per call | `4096` | none | no | same | — |
| `LLM_REASONING` | `off` sends `thinking: {type:'disabled'}`; `on` enables | `off` | none | no | openai-compatible provider | — |
| `LLM_FALLBACK_PROVIDER` | `none` or `anthropic` | `none` | none | no | `src/server/llm/provider.ts` | — |
| `LLM_FALLBACK_MODEL` | Fallback model id | `claude-sonnet-5` | none | no | same | — |
| `ANTHROPIC_API_KEY` | Fallback provider key | empty | none | yes | `src/server/llm/providers/anthropic/index.ts` | https://console.anthropic.com/settings/keys |
| `LLM_INPUT_USD_PER_MTOK` | Cost estimate input | `0.61` | none | no | `src/server/llm/calls.ts` | — |
| `LLM_OUTPUT_USD_PER_MTOK` | Cost estimate output | `0.61` | none | no | same | — |
| `LLM_USER_DAILY_TOKEN_BUDGET` | Hard stop per user per day | `200000` | none | no | `src/server/llm/guardrails/budgets.ts` | — |
| `LLM_GLOBAL_MONTHLY_TOKEN_BUDGET` | Hard stop global per month | `20000000` | none | no | same | — |
| `TRIGGER_MATCHING` | `deterministic_first` or `llm_first` | `deterministic_first` | none | no | `src/server/modules/assistant/triggers.ts` | — |
| `ASSISTANT_NUMERIC_GUARD` | `flag` or `block` | `flag` | none | no | `src/server/llm/guardrails/numeric-guard.ts` | — |
| `NEXT_PUBLIC_POSTHOG_KEY` | PostHog project API key (public by design); also used server-side | empty (analytics no-op) | none | no | `src/instrumentation-client.ts`, `src/server/analytics/posthog.ts` | PostHog → Project settings → Project API key |
| `NEXT_PUBLIC_POSTHOG_HOST` | PostHog ingest host | `https://us.i.posthog.com` | none | no | same | — |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry DSN (public) | empty (Sentry no-op) | none | no | `sentry.*.config.ts`, `src/instrumentation-client.ts` | Sentry → Project → Settings → Client Keys (DSN) |
| `SENTRY_AUTH_TOKEN` | Source map upload in CI | empty (upload skipped) | R workflow only | yes | `next.config.ts` (`withSentryConfig`) | https://sentry.io/settings/account/api/auth-tokens/ → Create (scopes: `project:releases`, `org:read`) |
| `SENTRY_ORG` | Sentry org slug | empty | R workflow | no | `next.config.ts` | Sentry → Organization settings |
| `SENTRY_PROJECT` | Sentry project slug | `tassl` | R workflow | no | same | — |
| `SENTRY_TRACES_SAMPLE_RATE` | Tracing sample | `1.0` locally/preview, `0.1` production | none | no | sentry configs | — |
| `CRON_SECRET` | Authorizes `/api/internal/jobs/drain` | `local-cron-secret` | P, R | yes | `src/app/api/internal/jobs/drain/route.ts` | Generate: `openssl rand -hex 32`; Vercel sends it as `Authorization: Bearer` when named `CRON_SECRET` |
| `JOBS_DRAIN_ON_ENQUEUE` | Run `after()` drain after enqueue | `true` | none | no | `src/server/jobs/enqueue.ts` | — |
| `SEED_PASSWORD` | Password for seed seat accounts | `Walkthrough-Pass-2026` (local/test only) | R when running `db:seed` there | yes | `src/server/db/seed.ts` | Chosen by the builder; `vercel env add SEED_PASSWORD production` |
| `PLAYWRIGHT_BASE_URL` | E2E target | `http://localhost:3000` | none | no | `playwright.config.ts` | — |
| `CI` | Set by GitHub Actions | unset | — | no | tooling | — |

CI-only secrets (GitHub repository secrets, never app env): `VERCEL_TOKEN` (https://vercel.com/account/tokens), `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` (from `.vercel/project.json` after `vercel link`), `NEON_API_KEY` (https://console.neon.tech/app/settings/api-keys), `PRODUCTION_DATABASE_URL_UNPOOLED` (same value as the Vercel production `DATABASE_URL_UNPOOLED`), `SENTRY_AUTH_TOKEN`, `BACKUP_ENCRYPTION_KEY` (`openssl rand -hex 32`). CI-only variables (`gh variable set`): `NEON_PROJECT_ID` (Neon Console → Project → Settings → General), `SENTRY_ORG`, `NEXT_PUBLIC_SENTRY_DSN` (for the workflow cron check-ins), `DEPLOY_ENABLED` (`true` once Phase 0 has set the Vercel environment; the deploy jobs are skipped while it is unset, D-134). Build-step-only: `SENTRY_RELEASE` (set to `github.sha` by `production.yml`, D-121). Shell-only, never stored anywhere: `VERCEL_AUTOMATION_BYPASS_SECRET` for the k6 load test (Vercel → Project → Settings → Deployment Protection → Protection Bypass for Automation, D-127).

## 2. `.env.example` (verbatim)

```dotenv
# ---- App ----
APP_ENV=local
NEXT_PUBLIC_APP_URL=http://localhost:3000
APP_DOMAIN=
LOG_LEVEL=debug

# ---- Database (Docker Compose locally; Neon in preview/production) ----
DATABASE_URL=postgres://tassl:tassl@localhost:5432/tassl
DATABASE_URL_UNPOOLED=postgres://tassl:tassl@localhost:5432/tassl
TEST_DATABASE_URL=postgres://tassl:tassl@localhost:5432/tassl_test
TASSL_APP_DB_PASSWORD=

# ---- Auth (Better Auth) ----
BETTER_AUTH_SECRET=local-dev-secret-do-not-use-in-prod-0123456789
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# ---- Email ----
EMAIL_TRANSPORT=console
RESEND_API_KEY=
EMAIL_FROM=Tassl <no-reply@tassl.local>
NOTIFY_EMAIL_COPIES=true

# ---- Feature flags ----
FEATURE_AI=false
FEATURE_SAMPLE_DATA=true
FEATURE_TEST_CONTROLS=true

# ---- LLM (mock by default; FEATURE_AI=false forces mock regardless) ----
LLM_PROVIDER=mock
LLM_BASE_URL=https://api.xiaomimimo.com/v1
LLM_MODEL=mimo-v2.5-pro
LLM_API_KEY=
LLM_TIMEOUT_MS=60000
LLM_MAX_OUTPUT_TOKENS=4096
LLM_REASONING=off
LLM_FALLBACK_PROVIDER=none
LLM_FALLBACK_MODEL=claude-sonnet-5
ANTHROPIC_API_KEY=
LLM_INPUT_USD_PER_MTOK=0.61
LLM_OUTPUT_USD_PER_MTOK=0.61
LLM_USER_DAILY_TOKEN_BUDGET=200000
LLM_GLOBAL_MONTHLY_TOKEN_BUDGET=20000000
TRIGGER_MATCHING=deterministic_first
ASSISTANT_NUMERIC_GUARD=flag

# ---- Analytics and observability (empty = disabled) ----
NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_AUTH_TOKEN=
SENTRY_ORG=
SENTRY_PROJECT=tassl
SENTRY_TRACES_SAMPLE_RATE=1.0

# ---- Jobs ----
CRON_SECRET=local-cron-secret
JOBS_DRAIN_ON_ENQUEUE=true

# ---- Seed ----
SEED_PASSWORD=Walkthrough-Pass-2026

# ---- Tests ----
PLAYWRIGHT_BASE_URL=http://localhost:3000
```

## 3. Config loading (fail fast)

`src/server/config.ts`

```ts
// No `import 'server-only'` here: this module is also loaded by tsx scripts (seed, worker,
// openapi-generate, drizzle config). The client/server boundary is enforced by the ESLint
// boundaries rule (components and lib may not import src/server) and by `src/server/auth/session.ts`,
// which does import 'server-only' because it uses next/headers.
import 'dotenv/config' // loads .env for tsx scripts (seed, worker, generators); Next.js has already loaded it, and dotenv never overrides existing values (D-131)
import { z } from 'zod'

const bool = z.enum(['true', 'false']).transform((v) => v === 'true')

const ServerEnvSchema = z.object({
  APP_ENV: z.enum(['local', 'test', 'preview', 'production']).default('local'),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  APP_DOMAIN: z.string().default(''),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  DATABASE_URL: z.string().min(1),
  DATABASE_URL_UNPOOLED: z.string().min(1).optional(),
  TEST_DATABASE_URL: z.string().optional(),
  BETTER_AUTH_SECRET: z.string().min(32),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  EMAIL_TRANSPORT: z.enum(['console', 'resend']).default('console'),
  RESEND_API_KEY: z.string().default(''),
  EMAIL_FROM: z.string().default('Tassl <no-reply@tassl.local>'),
  NOTIFY_EMAIL_COPIES: bool.default(true),
  FEATURE_AI: bool.default(false),
  FEATURE_SAMPLE_DATA: bool.default(true),
  FEATURE_TEST_CONTROLS: bool.default(true),
  LLM_PROVIDER: z.enum(['mock', 'openai-compatible', 'anthropic']).default('mock'),
  LLM_BASE_URL: z.string().url().default('https://api.xiaomimimo.com/v1'),
  LLM_MODEL: z.string().default('mimo-v2.5-pro'),
  LLM_API_KEY: z.string().default(''),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(4096),
  LLM_REASONING: z.enum(['off', 'on']).default('off'),
  LLM_FALLBACK_PROVIDER: z.enum(['none', 'anthropic']).default('none'),
  LLM_FALLBACK_MODEL: z.string().default('claude-sonnet-5'),
  ANTHROPIC_API_KEY: z.string().default(''),
  LLM_INPUT_USD_PER_MTOK: z.coerce.number().nonnegative().default(0.61),
  LLM_OUTPUT_USD_PER_MTOK: z.coerce.number().nonnegative().default(0.61),
  LLM_USER_DAILY_TOKEN_BUDGET: z.coerce.number().int().positive().default(200000),
  LLM_GLOBAL_MONTHLY_TOKEN_BUDGET: z.coerce.number().int().positive().default(20000000),
  TRIGGER_MATCHING: z.enum(['deterministic_first', 'llm_first']).default('deterministic_first'),
  ASSISTANT_NUMERIC_GUARD: z.enum(['flag', 'block']).default('flag'),
  NEXT_PUBLIC_POSTHOG_KEY: z.string().default(''),
  NEXT_PUBLIC_POSTHOG_HOST: z.string().url().default('https://us.i.posthog.com'),
  NEXT_PUBLIC_SENTRY_DSN: z.string().default(''),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(1),
  CRON_SECRET: z.string().min(8).default('local-cron-secret'),
  JOBS_DRAIN_ON_ENQUEUE: bool.default(true),
  SEED_PASSWORD: z.string().min(12).default('Walkthrough-Pass-2026'),
}).superRefine((env, ctx) => {
  const deployed = env.APP_ENV === 'production' || env.APP_ENV === 'preview'
  if (deployed) {
    if (env.BETTER_AUTH_SECRET.startsWith('local-dev-secret')) ctx.addIssue({ code: 'custom', message: 'BETTER_AUTH_SECRET must be set outside local/test' })
    if (env.CRON_SECRET === 'local-cron-secret') ctx.addIssue({ code: 'custom', message: 'CRON_SECRET must be set outside local/test' })
    if (!env.DATABASE_URL_UNPOOLED) ctx.addIssue({ code: 'custom', message: 'DATABASE_URL_UNPOOLED required outside local/test' })
    if (env.NEXT_PUBLIC_APP_URL.startsWith('http://localhost')) ctx.addIssue({ code: 'custom', message: 'NEXT_PUBLIC_APP_URL must be set outside local/test' })
  }
  if (env.APP_ENV === 'production') {
    if (env.LLM_PROVIDER === 'openai-compatible' && !env.LLM_API_KEY) ctx.addIssue({ code: 'custom', message: 'LLM_API_KEY required for openai-compatible' })
    if (env.EMAIL_TRANSPORT === 'resend' && !env.RESEND_API_KEY) ctx.addIssue({ code: 'custom', message: 'RESEND_API_KEY required for resend transport' })
  }
})

export type ServerEnv = z.infer<typeof ServerEnvSchema>

function load(): ServerEnv {
  const parsed = ServerEnvSchema.safeParse(process.env)
  if (!parsed.success) {
    // Printed once, then the process exits: misconfiguration must never serve traffic.
    console.error('Invalid server environment:', z.prettifyError(parsed.error))
    throw new Error('INVALID_SERVER_ENV')
  }
  return parsed.data
}

export const env: ServerEnv = load()
export const effectiveLlmProvider = (): ServerEnv['LLM_PROVIDER'] => (env.FEATURE_AI ? env.LLM_PROVIDER : 'mock')
```

`src/lib/env.public.ts` (client-safe; only `NEXT_PUBLIC_*`, inlined at build):

```ts
import { z } from 'zod'

export const publicEnv = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  NEXT_PUBLIC_POSTHOG_KEY: z.string().default(''),
  NEXT_PUBLIC_POSTHOG_HOST: z.string().url().default('https://us.i.posthog.com'),
  NEXT_PUBLIC_SENTRY_DSN: z.string().default(''),
}).parse({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
  NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
})
```

`src/lib/flags.ts` (server-side reads `env`; client receives flags through a `<FlagsProvider>` rendered by the app layout with only the three booleans):

```ts
export type Flags = { ai: boolean; sampleData: boolean; testControls: boolean }
```

`src/instrumentation.ts` imports `@/server/config` in `register()` so an invalid environment fails at boot, before the first request.

## 4. Client/server boundary

- Only variables prefixed `NEXT_PUBLIC_` reach the browser; they are inlined at build time, so a change requires a rebuild.
- `src/server/config.ts` is never imported by client code: the ESLint boundaries rule forbids `src/components` and `src/lib` from importing `src/server`, and `src/server/auth/session.ts` (which every page uses for the session) starts with `import 'server-only'` so any accidental client import fails the build.
- Feature flags reach the client through `<FlagsProvider>`; secrets never do.
- `LLM_*`, `DATABASE_*`, `*_SECRET`, `*_KEY` variables are redacted in logs by pino's `redact` paths (`13-observability-ops.md`).

## 5. Environments

| Environment | Where | Database | Env source |
|---|---|---|---|
| local | developer machine | Docker Compose Postgres 17 | `.env` copied from `.env.example` |
| test (CI) | GitHub Actions | `postgres:17-alpine` service | workflow `env:` block with the same defaults, `APP_ENV=test` |
| preview | Vercel preview deployment per PR | Neon branch `preview/pr-<n>` | Vercel project env (preview scope) + per-deployment `--env DATABASE_URL=...` |
| production | Vercel production | Neon `main` branch | Vercel project env (production scope) |

There is no staging environment; previews serve that role.

## 6. Secrets management and rotation

- Vercel: `vercel env add <NAME> production` (sensitive by default), `vercel env add <NAME> preview`. Never `vercel env add` development values that are secrets; local uses `.env`.
- GitHub: `gh secret set <NAME> --body "<value>"` for CI-only secrets.
- Neon: passwords rotate from Neon Console → Roles → Reset password; then update `DATABASE_URL`/`DATABASE_URL_UNPOOLED` in Vercel and `PRODUCTION_DATABASE_URL_UNPOOLED` in GitHub; redeploy.
- Rotation runbook: `13-observability-ops.md` §Runbook: rotate a secret.
- `BETTER_AUTH_SECRET` rotation invalidates sessions; announce and rotate at a low-traffic time.
- Secret scanning: gitleaks in the PR workflow (`12-security.md`).
