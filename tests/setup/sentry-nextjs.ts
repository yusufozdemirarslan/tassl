// `@sentry/nextjs` for the jsdom unit project (vitest.config.ts aliases it here), the same device
// `tests/setup/server-only.ts` already uses for the other package Vitest cannot resolve the way
// Next.js does.
//
// Why an alias rather than a real import: the package's server entry pulls a bundler plugin that
// reads `fileURLToPath(import.meta.url)` at import time, and Vitest's jsdom transform rewrites
// `import.meta.url` to an `http://` URL, so *any* unit test that reaches `defineRoute`,
// `defineAction`, or `ops-events` dies on import; and the browser entry, which would be the right
// answer, fails to resolve `next/constants` under pnpm. Neither failure is about Tassl.
//
// This is not a place to prove anything about Sentry. The real SDK is loaded, initialized, and
// exercised in `tests/integration/system/sentry-noop.test.ts`, which runs in the node environment
// and asserts the behaviour that matters — that with an empty DSN every call is silent. What this
// stub must do is preserve *control flow*, so a unit test measures the code under it: `startSpan`
// and `withMonitor` call their callback and return its value, `withScope` calls its callback.
import { vi } from 'vitest'

type Scope = {
  setTag: (key: string, value: unknown) => Scope
  setTags: (tags: Record<string, unknown>) => Scope
  setUser: (user: unknown) => Scope
  setLevel: (level: string) => Scope
  setContext: (key: string, context: unknown) => Scope
  setExtra: (key: string, value: unknown) => Scope
  setFingerprint: (parts: string[]) => Scope
}

const scope: Scope = {
  setTag: () => scope,
  setTags: () => scope,
  setUser: () => scope,
  setLevel: () => scope,
  setContext: () => scope,
  setExtra: () => scope,
  setFingerprint: () => scope,
}

export const init = vi.fn()
export const captureException = vi.fn(() => 'test-event-id')
export const captureMessage = vi.fn(() => 'test-event-id')
export const captureRequestError = vi.fn()
export const captureRouterTransitionStart = vi.fn()
export const setTag = vi.fn()
export const setTags = vi.fn()
export const setUser = vi.fn()
export const setContext = vi.fn()
export const setMeasurement = vi.fn()
export const flush = vi.fn(async () => true)
export const getClient = vi.fn(() => undefined)
export const getCurrentScope = vi.fn(() => scope)
export const getIsolationScope = vi.fn(() => scope)

export function withScope<T>(callback: (scope: Scope) => T): T {
  return callback(scope)
}

export function startSpan<T>(_options: unknown, callback: (span: unknown) => T): T {
  return callback(undefined)
}

export function withMonitor<T>(_slug: string, callback: () => T): T {
  return callback()
}
