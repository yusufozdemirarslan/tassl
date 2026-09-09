// The API coverage gate (14-testing-strategy.md §3): every endpoint the application mounts is
// exercised by an integration or end-to-end test.
//
// Written the same way round as `tests/integration/rate-limit/coverage.test.ts`: the route files on
// disk are the input, and an endpoint nobody tests is the failure this file exists to catch. An
// endpoint counts as tested when a test source under `tests/integration` or `tests/e2e` names the
// handler symbol the route file re-exports (`adminListUsers`), names its OpenAPI `operationId`, or
// drives its URL (`/api/v1/runs/${runId}/policy-ack`, with or without the `/api/v1` prefix). Any
// of the three is a test that would break if the endpoint did.
//
// The list of exemptions is short and each one says why. Anything else missing fails by name.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const API_ROOT = resolve('src/app/api')
const TEST_ROOTS = [resolve('tests/integration'), resolve('tests/e2e')]

/**
 * Handlers no test names, and why that is right.
 *
 * `/api/auth/[...all]` is Better Auth's own mount: the library handles sign-in, sign-up,
 * verification and the organization endpoints, and `tests/integration/auth/flows.test.ts` drives
 * them through `auth.api` rather than through a symbol of ours.
 */
const EXEMPT_FILES = ['/api/auth/[...all]']

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

function walkSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkSources(full, out)
    else if (/\.(ts|tsx|js)$/.test(entry)) out.push(full)
  }
  return out
}

/** src/app/api/v1/runs/[runId]/route.ts → /api/v1/runs/[runId]. */
function urlFromFile(file: string): string {
  const rel = file.split(sep).join('/')
  const from = rel.indexOf('/src/app/')
  return rel
    .slice(from + '/src/app'.length)
    .replace(/\/route\.ts$/, '')
    .replace(/\/\([^)]+\)/g, '')
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^$()|{}[\]\\]/g, '\\$&')

/**
 * `/api/v1/runs/[runId]/policy-ack` → a pattern matching the path as a test spells it: each
 * `[param]` segment is one segment of anything (a `${runId}`, a literal id), the `/api/v1` prefix
 * is optional, and the path must end at a quote, a query string, whitespace or a bracket so that
 * `/runs/[runId]` does not count as coverage of `/runs/[runId]/trace`.
 */
function urlPattern(url: string): RegExp {
  const body = url
    .replace(/^\/api\/v1/, '')
    .split('/')
    .map((segment) => (/^\[.*\]$/.test(segment) ? '[^/\'"`\\s]+' : escapeRegExp(segment)))
    .join('\\/')
  return new RegExp(`(\\/api\\/v1)?${body}(?=['"\`?\\s)])`)
}

type Mounted = { url: string; symbols: string[]; operationIds: string[] }

/** The handler symbols a route file re-exports (`export { X as GET }`) and its operationIds. */
function mounted(file: string): Mounted {
  const source = readFileSync(file, 'utf8')
  const symbols: string[] = []
  for (const match of source.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of (match[1] ?? '').split(',')) {
      const name = part
        .trim()
        .split(/\s+as\s+/)[0]
        ?.trim()
      if (name && /^[A-Za-z_$][\w$]*$/.test(name) && !/^(GET|POST|PUT|PATCH|DELETE)$/.test(name))
        symbols.push(name)
    }
  }
  const operationIds = [...source.matchAll(/operationId:\s*'([^']+)'/g)]
    .map((match) => match[1])
    .filter((id): id is string => id !== undefined)
  return { url: urlFromFile(file), symbols, operationIds }
}

describe('API coverage (14 §3): every mounted endpoint is exercised by a test', () => {
  const routeFiles = walk(API_ROOT)
  const tests = TEST_ROOTS.flatMap((root) => walkSources(root))
    .filter((file) => !file.endsWith('coverage.test.ts'))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n')

  it('mounts the endpoints this gate reads', () => {
    expect(routeFiles.length).toBeGreaterThan(80)
  })

  it('names every handler, its operationId, or its URL in some test', () => {
    const untested: string[] = []
    for (const file of routeFiles) {
      const route = mounted(file)
      if (EXEMPT_FILES.includes(route.url)) continue
      const bySymbol = route.symbols.some((symbol) => new RegExp(`\\b${symbol}\\b`).test(tests))
      const byOperation = route.operationIds.some((id) => tests.includes(id))
      const byUrl = urlPattern(route.url).test(tests)
      if (!bySymbol && !byOperation && !byUrl) {
        untested.push(`${route.url} (${route.symbols.join(', ') || 'inline handler'})`)
      }
    }
    expect(untested, 'endpoints no integration or E2E test names').toEqual([])
  })

  it('keeps the exemption list to files that exist', () => {
    const urls = new Set(routeFiles.map(urlFromFile))
    for (const exempt of EXEMPT_FILES) {
      expect(urls.has(exempt), `${exempt} is not mounted`).toBe(true)
    }
  })
})
