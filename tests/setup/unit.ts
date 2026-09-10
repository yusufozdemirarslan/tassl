// Unit project setup (docs/tech/14-testing-strategy.md §2): jest-dom matchers, MSW, real timers
// and a clean DOM between tests. Frozen time is opt-in through tests/setup/time.ts.
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'
import { server } from './msw/server'

// Set before src/server/config loads .env (dotenv never overrides an existing value, D-131).
process.env.APP_ENV = 'test'
process.env.LOG_LEVEL ??= 'warn'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(async () => {
  // The refresh coalescer keeps its flight in module state (D-709); a component unmounted before
  // its transition settled would otherwise queue the next test's refresh behind it. Imported here
  // rather than at the top: a static import would load `next/navigation` before the test file's
  // `vi.mock` of it is registered, and every component under test would then reach the real router.
  const { resetRefreshState } = await import('@/lib/hooks/use-refresh')
  resetRefreshState()
  cleanup()
  server.resetHandlers()
  vi.useRealTimers()
})
afterAll(() => server.close())
