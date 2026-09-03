// MSW server shared by unit and integration tests (docs/tech/14-testing-strategy.md §2).
// Handlers for the LLM provider (mimo.ts), Anthropic, Resend, and PostHog arrive with their phases.
import type { RequestHandler } from 'msw'
import { setupServer } from 'msw/node'

export const handlers: RequestHandler[] = []

export const server = setupServer(...handlers)
