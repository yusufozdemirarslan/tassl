import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
import prettier from 'eslint-config-prettier/flat'
import boundaries from 'eslint-plugin-boundaries'

// Layering rules: docs/tech/04-repo-structure.md §2.
// Elements are folders; the per-file roles inside a module (schema/actions/router/service/
// repository/index) are file categories. Anything not explicitly allowed is an error.
const moduleFile = (categories) => ({ element: { type: 'module' }, file: { categories } })

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        { type: 'app', pattern: 'src/app', partialMatch: false },
        { type: 'components', pattern: 'src/components', partialMatch: false },
        { type: 'lib', pattern: 'src/lib', partialMatch: false },
        { type: 'module', pattern: 'src/server/modules/*', capture: ['name'], partialMatch: false },
        { type: 'db', pattern: 'src/server/db', partialMatch: false },
        { type: 'llm', pattern: 'src/server/llm', partialMatch: false },
        { type: 'server-lib', pattern: 'src/server', partialMatch: false },
      ],
      // Each module file gets exactly one category (stopMatching); everything else is internal.
      'boundaries/files': [
        { pattern: 'src/server/modules/*/index.ts', category: 'public', stopMatching: true },
        { pattern: 'src/server/modules/*/schema.ts', category: 'schema', stopMatching: true },
        { pattern: 'src/server/modules/*/actions.ts', category: 'actions', stopMatching: true },
        { pattern: 'src/server/modules/*/router.ts', category: 'router', stopMatching: true },
        { pattern: 'src/server/modules/*/service.ts', category: 'service', stopMatching: true },
        {
          pattern: 'src/server/modules/*/repository.ts',
          category: 'repository',
          stopMatching: true,
        },
        { pattern: 'src/server/modules/*/**', category: 'internal' },
        // The fail-fast environment (05 §3) is the one server-lib file the db layer may import.
        { pattern: 'src/server/config.ts', category: 'config' },
        // The after-commit registry is the one jobs file the transaction wrapper may import (D-165).
        { pattern: 'src/server/jobs/after-commit.ts', category: 'tx-hooks' },
        // The seed script signs seats up through Better Auth, so it may reach server-lib (06 §5).
        { pattern: 'src/server/db/seed.ts', category: 'seed' },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          // Files inside one module are the same element; still check them (service → repository …).
          checkInternals: true,
          policies: [
            {
              from: { element: { type: 'app' } },
              allow: [
                { to: { element: { type: ['app', 'components', 'lib', 'server-lib'] } } },
                { to: moduleFile(['public', 'schema', 'actions', 'router']) },
              ],
            },
            {
              from: { element: { type: 'components' } },
              allow: [
                { to: { element: { type: ['components', 'lib'] } } },
                { to: moduleFile(['schema', 'actions']) },
              ],
            },
            { from: { element: { type: 'lib' } }, allow: [{ to: { element: { type: 'lib' } } }] },
            // A module schema reaches `src/lib` and nothing else: 10 §17 builds every free-text
            // field from `wordLimit(n)`, which lives in `src/lib/words.ts` so the form and the
            // server count words with one implementation (D-075). Anything under `src/server`
            // stays out, which is what keeps a schema readable from a Server Component.
            {
              from: { element: { type: 'module' }, file: { categories: ['schema'] } },
              allow: [{ to: { element: { type: 'lib' } } }],
            },
            // A router or an action reaches its own module's service and schema, and another
            // module's *public index* — the same door a job handler uses (D-290). Cross-module
            // `service` is still matched by the rule below it, because `courses/router.ts` imports
            // `runs/schema.ts` and the categories are named together; what the index adds is the
            // door CLAUDE.md asks for, which `review/router.ts` takes to reach `runs`.
            {
              from: { element: { type: 'module' }, file: { categories: ['actions', 'router'] } },
              allow: [
                { to: { element: { type: ['server-lib', 'lib'] } } },
                { to: moduleFile(['service', 'schema', 'public']) },
              ],
            },
            {
              from: { element: { type: 'module' }, file: { categories: ['service'] } },
              allow: [
                { to: { element: { type: ['server-lib', 'lib', 'llm'] } } },
                { to: moduleFile(['repository', 'schema', 'internal', 'public']) },
              ],
            },
            {
              from: { element: { type: 'module' }, file: { categories: ['repository'] } },
              allow: [{ to: { element: { type: ['db', 'lib'] } } }, { to: moduleFile(['schema']) }],
            },
            {
              from: { element: { type: 'module' }, file: { categories: ['public'] } },
              allow: [{ to: moduleFile(['service', 'schema']) }],
            },
            {
              from: { element: { type: 'module' }, file: { categories: ['internal'] } },
              allow: [
                { to: { element: { type: ['lib', 'server-lib', 'llm'] } } },
                { to: moduleFile(['internal', 'schema']) },
              ],
            },
            {
              from: { element: { type: 'server-lib' } },
              allow: [
                { to: { element: { type: ['server-lib', 'lib', 'db'] } } },
                // Job handlers (src/server/jobs/handlers/*) call a module's service through its
                // public index.ts, exactly as the queue table in 10 §7 names them (D-173).
                { to: moduleFile(['public']) },
              ],
            },
            {
              from: { element: { type: 'llm' } },
              allow: [{ to: { element: { type: ['llm', 'lib', 'server-lib', 'db'] } } }],
            },
            {
              from: { element: { type: 'db' }, file: { categories: ['seed'] } },
              allow: [
                { to: { element: { type: ['db', 'lib', 'server-lib'] } } },
                // 06 §5 item 4: the seed imports the fixture package through the scenarios service,
                // because `importPackage` is what turns a document's element keys into rows. Writing
                // those rows here instead would be a second implementation of the resolution authors
                // depend on, free to drift from it (D-214). A module's public index only.
                { to: { element: { type: 'module' }, file: { categories: ['public'] } } },
              ],
            },
            {
              from: { element: { type: 'db' } },
              allow: [
                { to: { element: { type: ['db', 'lib'] } } },
                {
                  to: {
                    element: { type: 'server-lib' },
                    file: { categories: ['config', 'tx-hooks'] },
                  },
                },
              ],
            },
          ],
        },
      ],
      'react/jsx-no-literals': [
        'error',
        { noStrings: true, ignoreProps: true, allowedStrings: ['·', '—', '(', ')', ':', '/'] },
      ],
    },
  },
  {
    files: ['src/lib/i18n/**', 'src/app/dev/**', 'tests/**', 'evals/**'],
    rules: { 'react/jsx-no-literals': 'off' },
  },
  // Analytics confinement: docs/tech/17-analytics-events.md §6 and §9.4.
  // Only three files may touch a PostHog SDK, so every event in the product goes through the typed
  // helpers and is validated against `EVENTS`; and no code anywhere may write a person property,
  // which is how the "hashed identity, nothing else" rule survives a future edit.
  {
    files: ['src/**/*.{ts,tsx}', 'evals/**/*.ts', 'scripts/**/*.ts'],
    ignores: [
      'src/instrumentation-client.ts',
      'src/lib/analytics/client.ts',
      'src/server/analytics/posthog.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'posthog-js',
              message:
                'Import trackClient/identifyClient/resetClient from @/lib/analytics/client instead (17 §6).',
            },
            {
              name: 'posthog-node',
              message:
                'Use track() from @/server/analytics/track; the client lives in @/server/analytics/posthog (17 §6).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}', 'evals/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='posthog'][property.name='setPersonProperties']",
          message: 'No person properties: PostHog holds a hashed id and nothing else (17 §6).',
        },
        {
          selector: "MemberExpression[object.name='posthog'][property.name='people']",
          message: 'No person properties: PostHog holds a hashed id and nothing else (17 §6).',
        },
        {
          selector:
            "CallExpression[callee.object.name='posthog'][callee.property.name='identify'][arguments.length>1]",
          message:
            'identify() takes the hashed distinct id only; a second argument sets person properties (17 §6).',
        },
        {
          selector: 'Property[key.value=/^\\$set(_once)?$/]',
          message: 'No $set or $set_once: PostHog holds a hashed id and nothing else (17 §6).',
        },
      ],
    },
  },
  globalIgnores([
    '.next/**',
    '.claude/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'drizzle/**',
    'coverage/**',
    'playwright-report/**',
    'test-results/**',
  ]),
])
