// No `import 'server-only'` here: this module is also loaded by tsx scripts (seed, worker,
// openapi-generate, drizzle config). The client/server boundary is enforced by the ESLint
// boundaries rule (components and lib may not import src/server) and by `src/server/auth/session.ts`,
// which does import 'server-only' because it uses next/headers.
import 'dotenv/config' // loads .env for tsx scripts (seed, worker, generators); Next.js has already loaded it, and dotenv never overrides existing values (D-131)
import { z } from 'zod'

const bool = z.enum(['true', 'false']).transform((v) => v === 'true')

const ServerEnvSchema = z
  .object({
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
    LLM_BASE_URL: z.string().url().default('https://token-plan-sgp.xiaomimimo.com/v1'),
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
  })
  .superRefine((env, ctx) => {
    const deployed = env.APP_ENV === 'production' || env.APP_ENV === 'preview'
    if (deployed) {
      if (env.BETTER_AUTH_SECRET.startsWith('local-dev-secret'))
        ctx.addIssue({
          code: 'custom',
          message: 'BETTER_AUTH_SECRET must be set outside local/test',
        })
      if (env.CRON_SECRET === 'local-cron-secret')
        ctx.addIssue({ code: 'custom', message: 'CRON_SECRET must be set outside local/test' })
      if (!env.DATABASE_URL_UNPOOLED)
        ctx.addIssue({
          code: 'custom',
          message: 'DATABASE_URL_UNPOOLED required outside local/test',
        })
      if (env.NEXT_PUBLIC_APP_URL.startsWith('http://localhost'))
        ctx.addIssue({
          code: 'custom',
          message: 'NEXT_PUBLIC_APP_URL must be set outside local/test',
        })
    }
    if (env.APP_ENV === 'production') {
      if (env.LLM_PROVIDER === 'openai-compatible' && !env.LLM_API_KEY)
        ctx.addIssue({ code: 'custom', message: 'LLM_API_KEY required for openai-compatible' })
      if (env.EMAIL_TRANSPORT === 'resend' && !env.RESEND_API_KEY)
        ctx.addIssue({ code: 'custom', message: 'RESEND_API_KEY required for resend transport' })
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
export const effectiveLlmProvider = (): ServerEnv['LLM_PROVIDER'] =>
  env.FEATURE_AI ? env.LLM_PROVIDER : 'mock'
