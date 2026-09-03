import { defineConfig, devices } from '@playwright/test'

// docs/tech/04-repo-structure.md §9. CI installs chromium only and runs --project=chromium (D-126).
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
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
    },
  },
})
