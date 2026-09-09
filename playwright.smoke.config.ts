import { defineConfig, devices } from '@playwright/test'

// The smoke lane (docs/prompts/02-qa-and-guides.md Part B): the @smoke tests of
// `tests/e2e/smoke/*.spec.ts`, run against a deployment that already exists — production after a
// deploy, a preview, or a local `pnpm start`. It never resets a database and never starts a server:
// the main `playwright.config.ts` does both, which is exactly what a smoke test of a live URL must
// not do.
//
//   PLAYWRIGHT_BASE_URL=https://tassl.vercel.app pnpm test:smoke
//
// The seat password comes from SEED_PASSWORD (the production value on the operator's machine, the
// documented default locally).
export default defineConfig({
  testDir: 'tests/e2e',
  // The full demo path (tests/e2e/guides/demo-path.spec.ts, also tagged @smoke) is not in this
  // lane on purpose: it writes runs on the demo seats, so against production it is a rehearsal an
  // operator runs by hand with `pnpm test:demo-path` and follows with `pnpm demo:reset` (D-701).
  testMatch: [/smoke\/.*\.spec\.ts$/],
  grep: /@smoke/,
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
  },
  projects: [{ name: 'smoke' }],
})
