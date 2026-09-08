// MSW server shared by unit and integration tests (docs/tech/14-testing-strategy.md §2).
//
// The default handler list is empty and stays empty. The unit project runs `server.listen({
// onUnhandledRequest: 'error' })`, so an unhandled request fails the test that made it — which is
// the property Phase 14 rests on: with `FEATURE_AI=false` nothing reaches a network, and the proof
// is that no test on that path installs a handler and none of them fail.
//
// The provider doubles live beside this file (`mimo.ts`, `anthropic.ts`) and are installed per test
// with `server.use(...)`, so a suite that wants a model says so.
import type { RequestHandler } from 'msw'
import { setupServer } from 'msw/node'

export const handlers: RequestHandler[] = []

export const server = setupServer(...handlers)
