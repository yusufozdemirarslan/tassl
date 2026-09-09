import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

// docs/tech/04-repo-structure.md §9 and 14-testing-strategy.md §2.
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  resolve: {
    // `server-only` throws on import unless the bundler resolves its `react-server` condition, which
    // Next.js does for server code and Vitest does not. Without this alias every suite that reaches
    // src/server/auth/session.ts (08 §2.6) dies on import. See tests/setup/server-only.ts.
    alias: {
      'server-only': fileURLToPath(new URL('./tests/setup/server-only.ts', import.meta.url)),
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/server/**', 'src/components/**', 'src/lib/**'],
      thresholds: { 'src/server/**': { lines: 80 }, 'src/components/**': { lines: 70 } },
    },
    projects: [
      {
        extends: true,
        resolve: {
          alias: {
            'server-only': fileURLToPath(new URL('./tests/setup/server-only.ts', import.meta.url)),
            // Phase 13: the Sentry SDK's server entry reads `import.meta.url` as a file path at
            // import time, which Vitest's jsdom transform rewrites to an http URL, so every unit
            // test that reaches defineRoute/defineAction/ops-events would die on import. The real
            // SDK is exercised in tests/integration/system/sentry-noop.test.ts (node env).
            '@sentry/nextjs': fileURLToPath(
              new URL('./tests/setup/sentry-nextjs.ts', import.meta.url),
            ),
          },
        },
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['tests/setup/unit.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['tests/setup/integration.ts'],
          fileParallelism: false,
          testTimeout: 30000,
          // The review and scoring fixtures take a run through the whole loop in a hook; on a
          // loaded machine that is longer than the 10 s default.
          hookTimeout: 60000,
        },
      },
      // The security suites (docs/prompts/02-qa-and-guides.md C5, C9): the prompt-injection
      // battery and the authorization matrix run against the real services on the test database,
      // exactly as the integration project does, under their own name so `pnpm test:security` and
      // the CI gate can run them alone — and, with a provider key, once against the live model.
      {
        extends: true,
        test: {
          name: 'security',
          include: ['tests/security/**/*.spec.ts'],
          environment: 'node',
          setupFiles: ['tests/setup/integration.ts'],
          fileParallelism: false,
          testTimeout: 120000,
          hookTimeout: 120000,
        },
      },
    ],
  },
})
