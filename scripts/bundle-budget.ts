// scripts/bundle-budget.ts — docs/tech/16-performance-a11y-budgets.md §3.4 (B4, B5).
// Runs in the CI build job after `pnpm build`; sums gzip bytes of the JS each route loads, and
// then checks that lighthouserc.json's `/dev/components` ceilings are still the ones these numbers
// imply (D-433) — the `build` job runs before `lhci`, so a divergence fails early and by name.
//
// Two assertions, not one (D-187): the framework floor — React and the Next App Router runtime,
// charged to every route and not something a screen can trade against — is checked once, and each
// route is then judged on the chunks it adds on top of it. A framework upgrade shows up as one
// failing line instead of every route at once, and the per-route number stays a real ceiling on the
// code we write.
// Turbopack (Next 16) writes no root app-build-manifest.json (D-148): the shared runtime chunks
// are `rootMainFiles` in .next/build-manifest.json and each route's client chunks (layouts above
// it, the page, its client components) are `entryJSFiles` in the route's
// .next/server/app/<route>/page_client-reference-manifest.js.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { gzipSync } from 'node:zlib'

const NEXT = join(process.cwd(), '.next')

/**
 * React 19 and the Next 16 client runtime (`rootMainFiles`), 130,897 bytes gzip on 2026-09-04
 * (D-187); 132,164 on 2026-09-08, after Phase 13 put both browser SDKs behind `import()` so that
 * neither is charged to a route that may not even have a key for it (D-579).
 */
const FRAMEWORK_FLOOR_MAX_BYTES = 175_000

/** Named so the LHCI cross-check at the bottom of this file reads the same budget row. */
const GALLERY_LABEL = 'dev gallery'

/** Bytes a route may add on top of the floor: its layouts, its page, and their client components. */
const budgets: Array<{ pattern: RegExp; maxBytes: number; label: string }> = [
  { pattern: /^\/\(app\)\/runs\/\[runId\](\/|$)/, maxBytes: 130_000, label: 'run route' },
  { pattern: /^\/\(app\)\/review\/runs\/\[runId\]$/, maxBytes: 130_000, label: 'run route' },
  { pattern: /^\/\(app\)\/records\/\[runId\]$/, maxBytes: 130_000, label: 'run route' },
  { pattern: /^\/\(public\)\//, maxBytes: 110_000, label: 'public page' },
  // The gallery renders every primitive at once (D-156); lighthouserc.json carries the total.
  { pattern: /^\/dev\//, maxBytes: 205_000, label: GALLERY_LABEL },
  { pattern: /.*/, maxBytes: 175_000, label: 'other route' },
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

const rootFiles = (buildManifest.rootMainFiles ?? []).filter(
  (f) => f.endsWith('.js') && !f.includes('polyfills'),
)
const floorBytes = rootFiles.reduce((sum, f) => sum + gzipBytes(f), 0)
const floorOk = floorBytes <= FRAMEWORK_FLOOR_MAX_BYTES
if (!floorOk) failed = true
console.log(
  `${floorOk ? 'ok  ' : 'FAIL'} ${String(floorBytes).padStart(7)} / ${FRAMEWORK_FLOOR_MAX_BYTES} framework    (React + Next runtime, every route)`,
)

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
  // The floor is charged once, above; a route answers for what it adds to it.
  const own = new Set<string>(entryFiles)
  for (const f of rootFiles) own.delete(f)
  const js = [...own].filter((f) => f.endsWith('.js') && !f.includes('polyfills'))
  const bytes = js.reduce((sum, f) => sum + gzipBytes(f), 0)
  const budget = budgets.find((b) => b.pattern.test(route))!
  const ok = bytes <= budget.maxBytes
  if (!ok) failed = true
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${String(bytes).padStart(7)} / ${budget.maxBytes} ${budget.label.padEnd(12)} ${route}`,
  )
}
// ---------------------------------------------------------------------------------------------
// The gallery's second ceiling: lighthouserc.json, derived from the numbers above (D-433).
//
// LHCI asserts `resource-summary:script:size` and `:total:size` on the live `/dev/components`, and
// those are transfer sizes — `next start` gzips (`compress: true`), so they are the same unit as
// everything above. The two files therefore describe one page in one unit, and a number raised in
// one of them alone is a silent divergence. So the LHCI ceilings are not written by hand: they are
// built here out of the budgets above plus three named allowances for what LHCI counts and this
// script cannot see, and the run fails if lighthouserc.json disagrees.
//
// Measured on 2026-09-06 (`pnpm exec lhci autorun`, three runs, all identical): script 449,239 of
// 530,000, total 947,699 of 1,060,000.

/** Chunks the page fetches that `entryJSFiles` does not list: the two `recharts` graphs behind
 *  `next/dynamic` (§3.3), `instrumentation-client`, and the per-request header bytes Lighthouse
 *  counts in a transfer size. Measured 131,702 across 31 script requests. */
const GALLERY_DEFERRED_MAX_BYTES = 150_000

/** All seven self-hosted woff2 faces: the gallery draws a type specimen, so it loads the Mono and
 *  Serif faces a product page never asks for (a real page loads four). Measured 445,064. */
const GALLERY_FONT_MAX_BYTES = 460_000

/** The HTML document and the two stylesheets. Measured 56,738. */
const GALLERY_DOCUMENT_MAX_BYTES = 70_000

const galleryRouteBudget = budgets.find((b) => b.label === GALLERY_LABEL)!.maxBytes
const galleryLhciBudgets: Record<string, number> = {
  'resource-summary:script:size':
    FRAMEWORK_FLOOR_MAX_BYTES + galleryRouteBudget + GALLERY_DEFERRED_MAX_BYTES,
  'resource-summary:total:size':
    FRAMEWORK_FLOOR_MAX_BYTES +
    galleryRouteBudget +
    GALLERY_DEFERRED_MAX_BYTES +
    GALLERY_FONT_MAX_BYTES +
    GALLERY_DOCUMENT_MAX_BYTES,
}

type Assertion = [level: string, options?: { maxNumericValue?: number }]
type LhciConfig = {
  ci?: {
    assert?: {
      assertMatrix?: Array<{
        matchingUrlPattern?: string
        assertions?: Record<string, Assertion>
      }>
    }
  }
}

const LHCI_FILE = 'lighthouserc.json'
const GALLERY_URL_PATTERN = '/dev/components$'

const lhci = JSON.parse(readFileSync(join(process.cwd(), LHCI_FILE), 'utf8')) as LhciConfig
const galleryEntry = (lhci.ci?.assert?.assertMatrix ?? []).find(
  (entry) => entry.matchingUrlPattern === GALLERY_URL_PATTERN,
)
if (!galleryEntry) {
  console.error(`no "${GALLERY_URL_PATTERN}" assertMatrix entry in ${LHCI_FILE}`)
  failed = true
} else {
  for (const [audit, expected] of Object.entries(galleryLhciBudgets)) {
    const found = galleryEntry.assertions?.[audit]?.[1]?.maxNumericValue
    const ok = found === expected
    if (!ok) failed = true
    console.log(
      `${ok ? 'ok  ' : 'FAIL'} ${String(found ?? 'missing').padStart(7)} / ${expected} ${LHCI_FILE.padEnd(12)} ${audit}`,
    )
  }
}

if (failed) {
  console.error('bundle budget exceeded (docs/tech/16-performance-a11y-budgets.md §3)')
  process.exit(1)
}
