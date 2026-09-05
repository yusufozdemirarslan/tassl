// The confirmed scenario package version the instructor specs point their assignments at.
//
// It is the seeded one: `pnpm db:seed` imports `src/server/db/fixtures/meridian-roast.package.json`
// and confirms it (06 §5 item 4), so the suite runs against the package the walkthrough runs
// against rather than a minimal stand-in built for the tests. That was not possible before Phase 5,
// when nothing confirmed a version and `tests/factories/package.ts` wrote the smallest one an
// assignment could point at.
//
// The seeded ids are database-generated, so they cannot be derived from a label the way the factory
// package's were. `tests/e2e/global-setup.ts` reads them once, before any worker starts, and writes
// them here — to a file rather than to the environment, because Playwright starts each worker in
// its own process and a spec must be able to read them without opening a database connection of its
// own.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Every row the suite writes carries this in its name, which is what lets the purge be exact. */
export const SUITE_PREFIX = 'E2E Phase 4'

/** Addresses the roster spec invites; the purge removes pending invitations under this prefix. */
export const SUITE_INVITE_PREFIX = 'e2e-phase-4-invite'

/** Where the setup leaves what it read; `test-results/` is already git-ignored and per-run. */
export const FIXTURE_FILE = join(process.cwd(), 'test-results', 'seeded-package.json')

export type SeededPackage = {
  packageId: string
  versionId: string
  versionNumber: number
  title: string
  workingClockSeconds: number
  variantIds: { defective: string; sound: string }
}

let cached: SeededPackage | null = null

/**
 * What the setup found. A spec that calls this before the setup has run gets a sentence naming the
 * cause rather than a JSON parse error twelve frames down.
 */
export function seededPackage(): SeededPackage {
  if (cached) return cached
  let raw: string
  try {
    raw = readFileSync(FIXTURE_FILE, 'utf8')
  } catch {
    throw new Error(
      `No seeded package at ${FIXTURE_FILE}. tests/e2e/global-setup.ts writes it from the seeded ` +
        'Meridian Roast version; run the suite through `pnpm test:e2e` so the setup runs first.',
    )
  }
  cached = JSON.parse(raw) as SeededPackage
  return cached
}

/** A course, section, or assignment name no other run collides with, under the suite prefix. */
export function suiteName(what: string): string {
  return `${SUITE_PREFIX} ${what} ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}
