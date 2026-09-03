import { z } from 'zod'

// Client-safe environment: only NEXT_PUBLIC_* values, inlined by Next.js at build time.
export const publicEnv = z
  .object({
    NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
    NEXT_PUBLIC_POSTHOG_KEY: z.string().default(''),
    NEXT_PUBLIC_POSTHOG_HOST: z.string().url().default('https://us.i.posthog.com'),
    NEXT_PUBLIC_SENTRY_DSN: z.string().default(''),
  })
  .parse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  })
