// scripts/bundle-budget.ts — docs/tech/16-performance-a11y-budgets.md §3.4 (B4, B5).
// Runs in the CI build job after `pnpm build`; sums gzip bytes of the JS each route loads.
// Turbopack (Next 16) writes no root app-build-manifest.json (D-148): the shared runtime chunks
// are `rootMainFiles` in .next/build-manifest.json and each route's client chunks (layouts above
// it, the page, its client components) are `entryJSFiles` in the route's
// .next/server/app/<route>/page_client-reference-manifest.js.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { gzipSync } from 'node:zlib'

const NEXT = join(process.cwd(), '.next')
const budgets: Array<{ pattern: RegExp; maxBytes: number; label: string }> = [
  { pattern: /^\/\(app\)\/runs\/\[runId\](\/|$)/, maxBytes: 250_000, label: 'run route' },
  { pattern: /^\/\(app\)\/review\/runs\/\[runId\]$/, maxBytes: 250_000, label: 'run route' },
  { pattern: /^\/\(app\)\/records\/\[runId\]$/, maxBytes: 250_000, label: 'run route' },
  { pattern: /^\/\(public\)\//, maxBytes: 180_000, label: 'public page' },
  // The gallery renders every primitive at once; 300 KB here and in lighthouserc.json (D-156).
  { pattern: /^\/dev\//, maxBytes: 300_000, label: 'dev gallery' },
  { pattern: /.*/, maxBytes: 250_000, label: 'other route' },
]

type RscManifest = Record<string, { entryJSFiles?: Record<string, string[]> }>

const routes = JSON.parse(
  readFileSync(join(NEXT, 'app-path-routes-manifest.json'), 'utf8'),
) as Record<string, string>
const buildManifest = JSON.parse(readFileSync(join(NEXT, 'build-manifest.json'), 'utf8')) as {
  rootMainFiles?: string[]
}

const cache = new Map<string, number>()
const gzipBytes = (file: string): number => {
  const hit = cache.get(file)
  if (hit !== undefined) return hit
  const bytes = gzipSync(readFileSync(join(NEXT, file)), { level: 6 }).length
  cache.set(file, bytes)
  return bytes
}

/** Client chunks of one route from its client-reference manifest (a JS file assigning globalThis.__RSC_MANIFEST). */
function routeEntryFiles(pageKey: string): string[] | undefined {
  const segments = pageKey.split('/').filter(Boolean)
  const file = join(
    NEXT,
    'server',
    'app',
    ...segments.slice(0, -1),
    'page_client-reference-manifest.js',
  )
  if (!existsSync(file)) return undefined
  const sandbox: Record<string, unknown> = {}
  sandbox.globalThis = sandbox
  vm.runInNewContext(readFileSync(file, 'utf8'), sandbox)
  const manifest = sandbox.__RSC_MANIFEST as RscManifest | undefined
  const entry = manifest?.[pageKey] ?? Object.values(manifest ?? {})[0]
  return Object.values(entry?.entryJSFiles ?? {}).flat()
}

let failed = false
for (const pageKey of Object.keys(routes)
  .filter((k) => k.endsWith('/page'))
  .sort()) {
  const route = pageKey.slice(0, -'/page'.length) || '/'
  const entryFiles = routeEntryFiles(pageKey)
  if (!entryFiles) {
    if (route.startsWith('/_')) continue // Next's built-in error routes have no manifest of their own
    console.error(`no client-reference manifest for ${route}`)
    failed = true
    continue
  }
  const files = new Set<string>([...(buildManifest.rootMainFiles ?? []), ...entryFiles])
  const js = [...files].filter((f) => f.endsWith('.js') && !f.includes('polyfills'))
  const bytes = js.reduce((sum, f) => sum + gzipBytes(f), 0)
  const budget = budgets.find((b) => b.pattern.test(route))!
  const ok = bytes <= budget.maxBytes
  if (!ok) failed = true
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${String(bytes).padStart(7)} / ${budget.maxBytes} ${budget.label.padEnd(12)} ${route}`,
  )
}
if (failed) {
  console.error('bundle budget exceeded (docs/tech/16-performance-a11y-budgets.md §3)')
  process.exit(1)
}
