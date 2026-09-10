import { defineConfig, devices } from '@playwright/test'

// The lane serves the database it resets.
//
// `pnpm db:reset` resets TEST_DATABASE_URL; `pnpm start` reads DATABASE_URL. In CI those are the
// same value, so the reset lands on the database the server serves. Locally `.env` points them at
// `tassl_test` and `tassl`, so the reset wiped one database while the suite ran against another —
// e2e state accumulated in `tassl` forever, and a spec that asserted an empty list passed on a new
// machine and failed on one that had run the suite before. Pinning the server to the same URL the
// reset targets makes local behave as CI does, and keeps the developer's own `tassl` untouched.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://tassl:tassl@localhost:5432/tassl_test'

// Set on this process too, not only on the server's. `global-setup.ts` writes the confirmed
// package version through `@/server/db/client`, which reads `env.DATABASE_URL` from whatever
// process imports it — so pinning only the server would have the setup seed one database while the
// suite queried another. This runs before the config is used and therefore before that import.
process.env.DATABASE_URL = TEST_DATABASE_URL
process.env.DATABASE_URL_UNPOOLED = TEST_DATABASE_URL

/**
 * The guide-driven suite as a chain of projects (docs/prompts/02-qa-and-guides.md Part B, D-693,
 * D-707). Per engine: a reset, the instructor guide, the student guide, a reset, the demo path —
 * each project depending on the previous one, and the first of an engine on the last of the
 * previous engine. The resets (`reset.setup.ts`) take the previous stage's runs off the seeded
 * assignments and empty the server's in-memory rate-limit windows, which is what lets one seat
 * walk the same screens fifteen times in one server. `pnpm test:guides` names the last project and
 * Playwright runs the whole chain through its dependencies.
 */
function guideProjects() {
  const engines = [
    ['chromium', devices['Desktop Chrome']],
    ['firefox', devices['Desktop Firefox']],
    ['webkit', devices['Desktop Safari']],
  ] as const
  const spec = (file: string) => new RegExp(`guides[/]${file.replace(/[.]/g, '[.]')}$`)
  const stages = [
    ['reset-1', spec('reset.setup.ts')],
    ['instructor', spec('instructor-guide.spec.ts')],
    ['student', spec('learner-guide.spec.ts')],
    ['reset-2', spec('reset.setup.ts')],
    ['demo', spec('demo-path.spec.ts')],
  ] as const
  const projects = []
  let previous: string | undefined
  for (const [engine, device] of engines) {
    for (const [stage, testMatch] of stages) {
      const name = `guides-${engine}-${stage}`
      projects.push({
        name,
        use: { ...device },
        testMatch,
        ...(previous === undefined ? {} : { dependencies: [previous] }),
      })
      previous = name
    }
  }
  return projects
}

// docs/tech/04-repo-structure.md §9. CI installs chromium only and runs --project=chromium (D-126).
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  // The instructor specs (step 4.2 to 4.4) need a confirmed scenario package version, which the
  // seeded database does not hold until Phase 5; the setup writes one and clears what an earlier
  // run left behind, and the teardown clears what this one creates. Both are idempotent, so the
  // suite can be run repeatedly against the same database.
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  // A full-page axe scan plus a real sign-in is more than Playwright's 30 s default allows on a
  // loaded machine; the assertions are unchanged, only the patience (D-188).
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  // Two families of projects.
  //
  // The three engine projects run every spec except the guide-driven ones. The perf spec measures
  // Largest Contentful Paint and layout shift, which are Chromium-only entry types (16 §2.4), so it
  // belongs to the chromium project by configuration rather than skipping itself inside the test.
  //
  // The guide-driven specs (tests/e2e/guides, docs/prompts/02-qa-and-guides.md Part B) take the
  // seeded student seat through the seeded assignments — the run a real student takes — so two
  // engines cannot take it at once (one live run per student per assignment, D-041). They run as
  // three projects chained by `dependencies`, which serialises them; `pnpm test:guides` names the
  // three, and the guides' own setup deletes the previous engine's runs before it starts.
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /guides\//,
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      testIgnore: [/guides\//, /perf\//],
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testIgnore: [/guides\//, /perf\//],
    },
    ...guideProjects(),
  ],
  webServer: {
    command: 'pnpm db:reset && pnpm build && pnpm start',
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 240000,
    env: {
      LLM_PROVIDER: 'mock',
      FEATURE_AI: 'false',
      EMAIL_TRANSPORT: 'console',
      APP_ENV: 'test',
      // The forced-failure spec and every scored/done poll depend on these two; pinned here so a
      // local .env that differs cannot change what the suite proves.
      FEATURE_TEST_CONTROLS: 'true',
      JOBS_DRAIN_ON_ENQUEUE: 'true',
      DATABASE_URL: TEST_DATABASE_URL,
      DATABASE_URL_UNPOOLED: TEST_DATABASE_URL,
    },
  },
})
