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
        },
      },
    ],
  },
})
