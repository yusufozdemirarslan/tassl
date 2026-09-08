// PostHog, server side: docs/tech/17-analytics-events.md §5.3 (D-119).
// No `server-only`: the worker and the tsx scripts load it (D-143).
//
// Without NEXT_PUBLIC_POSTHOG_KEY this module never constructs a client and never opens a socket
// (D-098) — that is the whole of the no-key behaviour, and the reason every test suite runs with an
// empty key.
import { after } from 'next/server'
import { PostHog } from 'posthog-node'
import { env } from '@/server/config'
import { getRequestContext } from '@/server/http/request-context'

/** Keyed by the request-context store object, so nothing is added to the store itself. */
const perRequest = new WeakMap<object, PostHog>()
let processClient: PostHog | null = null

function create(): PostHog {
  return new PostHog(env.NEXT_PUBLIC_POSTHOG_KEY, {
    host: env.NEXT_PUBLIC_POSTHOG_HOST,
    flushAt: 20,
    flushInterval: 10000,
    // The only IP a server event could carry is Vercel's, and PostHog would geolocate it as if it
    // were the student's (17 §6).
    disableGeoip: true,
  })
}

/**
 * Returns null when the key is empty.
 * Inside a request: one client per request, flushed by `after()` once the response is done, because
 * a serverless invocation can be frozen the moment it returns.
 * Outside a request (`pnpm jobs:worker`, scripts): one process-wide client closed by
 * `shutdownPosthog()`.
 */
export function getPosthogServer(): PostHog | null {
  if (!env.NEXT_PUBLIC_POSTHOG_KEY) return null
  const ctx = getRequestContext()
  if (ctx) {
    const existing = perRequest.get(ctx)
    if (existing) return existing
    const client = create()
    try {
      after(() => client.shutdown(2000))
      perRequest.set(ctx, client)
      return client
    } catch {
      // after() is unavailable in this scope (a static render, a job, a script): fall through to
      // the process client rather than dropping the event.
    }
  }
  processClient ??= create()
  return processClient
}

/** Called by scripts/jobs-worker.ts on SIGINT/SIGTERM and by tests. */
export async function shutdownPosthog(): Promise<void> {
  if (!processClient) return
  const client = processClient
  processClient = null
  await client.shutdown(2000)
}
