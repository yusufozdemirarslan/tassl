// Environment parity (docs/prompts/02-qa-and-guides.md C1): the Zod server schema, `.env.example`,
// and the Vercel production environment must agree.
//
//   pnpm env:check                 # schema ↔ .env.example, and (with the Vercel CLI logged in)
//                                  # schema ↔ `vercel env ls production`, then /api/ready on the
//                                  # production URL
//   pnpm env:check --offline       # schema ↔ .env.example only
//
// Rules:
//   1. Every key the schema declares is documented in `.env.example`, and `.env.example` documents
//      nothing the schema does not read (the two test-runner keys below excepted).
//   2. Every key that production must carry (no safe default, or an intended deployment choice)
//      exists in Vercel production; nothing undocumented lives there either way.
//   3. The production URL answers 200 on `/api/ready`, which is the only honest "working value"
//      check for variables whose values the CLI never prints.
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = process.cwd()

/**
 * Keys `.env.example` documents that the server schema does not read: the test runner's base URL,
 * and the three the Sentry build plugin reads in next.config.ts (source-map upload, 13 §3.6).
 */
const RUNNER_KEYS = new Set([
  'PLAYWRIGHT_BASE_URL',
  'SENTRY_ORG',
  'SENTRY_PROJECT',
  'SENTRY_AUTH_TOKEN',
])

/**
 * Production variables that are read by scripts rather than by the server schema, with the script
 * that reads each one. Anything else in production that the schema does not declare fails the check.
 */
const SCRIPT_KEYS: Record<string, string> = {
  TASSL_APP_DB_PASSWORD: 'scripts/db-app-role.ts (Step 15.1: the least-privileged app role)',
}

/**
 * What production must carry. Keys with a safe default that production may legitimately leave to
 * the default are not listed; keys whose default would be wrong or unsafe in production are.
 */
const PRODUCTION_REQUIRED = [
  'APP_ENV',
  'NEXT_PUBLIC_APP_URL',
  'DATABASE_URL',
  'DATABASE_URL_UNPOOLED',
  'BETTER_AUTH_SECRET',
  'CRON_SECRET',
  'SEED_PASSWORD',
  'EMAIL_TRANSPORT',
  'EMAIL_FROM',
  'FEATURE_AI',
  'LLM_PROVIDER',
  'LLM_BASE_URL',
  'LLM_API_KEY',
  'NEXT_PUBLIC_SENTRY_DSN',
  'NEXT_PUBLIC_POSTHOG_KEY',
  'SENTRY_TRACES_SAMPLE_RATE',
  'DEMO_MODE',
]

function schemaKeys(): string[] {
  const source = readFileSync(join(REPO, 'src', 'server', 'config.ts'), 'utf8')
  const body = source.slice(source.indexOf('z\n  .object({'), source.indexOf('.superRefine('))
  // `z.…` and `bool.…` (the boolean helper) are the two ways the schema declares a key.
  return [...body.matchAll(/^\s{4}([A-Z][A-Z0-9_]+):\s*(?:z|bool)\./gm)].map(
    (match) => match[1] ?? '',
  )
}

function exampleKeys(): string[] {
  const source = readFileSync(join(REPO, '.env.example'), 'utf8')
  return source
    .split(/\r?\n/)
    .map((line) => /^([A-Z][A-Z0-9_]+)=/.exec(line)?.[1])
    .filter((key): key is string => Boolean(key))
}

function vercelKeys(environment: 'production'): string[] {
  const output = execSync(`npx vercel@59.11.2 env ls ${environment}`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return output
    .split(/\r?\n/)
    .map((line) => /^\s*([A-Z][A-Z0-9_]+)\s/.exec(line)?.[1])
    .filter((key): key is string => Boolean(key))
}

function productionUrl(): string {
  const output = execSync(
    'npx vercel@59.11.2 env pull --environment=production --yes .env.parity.tmp',
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  void output
  const pulled = readFileSync(join(REPO, '.env.parity.tmp'), 'utf8')
  execSync(process.platform === 'win32' ? 'del .env.parity.tmp' : 'rm -f .env.parity.tmp', {
    stdio: 'ignore',
  })
  const match = /^NEXT_PUBLIC_APP_URL="?([^"\r\n]+)"?/m.exec(pulled)
  if (!match?.[1]) throw new Error('NEXT_PUBLIC_APP_URL is not set in production')
  return match[1]
}

async function main(): Promise<void> {
  const offline = process.argv.includes('--offline')
  const problems: string[] = []
  const schema = schemaKeys()
  const example = exampleKeys()
  if (schema.length < 30)
    problems.push(`only ${schema.length} keys parsed from src/server/config.ts`)

  const exampleSet = new Set(example)
  const schemaSet = new Set(schema)
  for (const key of schema) if (!exampleSet.has(key)) problems.push(`.env.example lacks ${key}`)
  for (const key of example)
    if (!schemaSet.has(key) && !RUNNER_KEYS.has(key) && !(key in SCRIPT_KEYS))
      problems.push(`.env.example documents ${key}, which the schema does not read`)
  for (const key of PRODUCTION_REQUIRED)
    if (!schemaSet.has(key))
      problems.push(`PRODUCTION_REQUIRED names ${key}, which the schema does not read`)

  let live = 'skipped (--offline)'
  if (!offline) {
    const production = new Set(vercelKeys('production'))
    for (const key of PRODUCTION_REQUIRED)
      if (!production.has(key)) problems.push(`Vercel production lacks ${key}`)
    for (const key of production)
      if (!schemaSet.has(key) && !(key in SCRIPT_KEYS))
        problems.push(`Vercel production carries ${key}, which nothing documents`)
    const url = productionUrl()
    const response = await fetch(`${url}/api/ready`, { cache: 'no-store' })
    live = `${url}/api/ready → ${response.status}`
    if (response.status !== 200) problems.push(`production /api/ready answered ${response.status}`)
  }

  if (problems.length > 0) {
    console.error(`env parity: ${problems.length} problem(s)`)
    for (const problem of problems) console.error(`  - ${problem}`)
    // `process.exitCode` rather than `process.exit()`: an immediate exit while the CLI's child
    // handles are closing trips a libuv assertion on Windows.
    process.exitCode = 1
    return
  }
  console.log(
    `env parity: ${schema.length} schema keys documented; production carries every required key; ${live}`,
  )
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
