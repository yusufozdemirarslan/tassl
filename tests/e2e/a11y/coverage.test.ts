// The axe gate (14 §3): "Screens with an axe test — 100 % of UI-###".
//
// The register it reads, `./screens.json`, is checked against four things that are not it, so a row
// cannot quietly become a fiction:
//
//   * **The id set comes from `docs/tech/COVERAGE.md`**, parsed on every run. A screen added to the
//     requirements register with no row here fails; a row here for a screen the register does not
//     name fails too.
//   * **The names come from `docs/tech/16-performance-a11y-budgets.md` §8.2**, the accessibility
//     table itself.
//   * **The routes come from the app router on disk.** Every route a built screen claims must
//     resolve to a real `page.tsx`, and — the direction that matters — every page in `src/app` must
//     be claimed by some screen or listed under `unregisteredRoutes` with a reason. A screen built
//     without an axe test is the failure this gate exists for, and it is the one a hand-written list
//     can never catch.
//   * **The spec must be one COVERAGE.md names for that id**, must exist, and must run an axe scan.
//
// A screen that is not built yet carries `pending` with a build-plan step, and is asserted to be
// *still* unbuilt: the day its route lands, this goes red until somebody scans it.
//
// It runs under Playwright because `playwright.config.ts` owns `tests/e2e` and its default
// `testMatch` takes `*.test.ts`. It opens no page and needs no server.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { expect, test } from '@playwright/test'

// Playwright transpiles a spec to CommonJS unless the package declares `"type": "module"`, so
// `import.meta.url` is not available here. `process.cwd()` is the repo root — the config's own
// directory, which is where `pnpm test:e2e` runs — and is what `../fixture-package.ts` already uses.
const REPO = process.cwd()
const E2E = join(REPO, 'tests', 'e2e')
const HERE = join(E2E, 'a11y')

const COVERAGE_MD = join(REPO, 'docs', 'tech', 'COVERAGE.md')
const BUDGETS_MD = join(REPO, 'docs', 'tech', '16-performance-a11y-budgets.md')
const BUILD_PLAN = join(REPO, 'docs', 'tech', 'build-plan')
const APP_DIR = join(REPO, 'src', 'app')

type Screen = {
  id: string
  name: string
  routes: string[]
  routeless?: string
  spec: string
  states: string
  pending?: string
}

const register = JSON.parse(readFileSync(join(HERE, 'screens.json'), 'utf8')) as {
  unregisteredRoutes: { route: string; reason: string }[]
  screens: Screen[]
}
const screens = register.screens

const read = (path: string): string => readFileSync(path, 'utf8')

// ---------------------------------------------------------------------------------------------
// The three sources
// ---------------------------------------------------------------------------------------------

/** Every `| UI-### | steps | tests |` row of COVERAGE.md §screens, in order. */
function coverageRows(): { id: string; tests: string[] }[] {
  return [...read(COVERAGE_MD).matchAll(/^\| (UI-\d{3}) \|([^|]*)\|([^|]*)\|/gm)].map((match) => ({
    id: match[1] as string,
    tests: (match[3] ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  }))
}

/** Every `| UI-### Name | route | spec | states |` row of 16 §8.2, in order. */
function budgetRows(): { id: string; name: string }[] {
  return [...read(BUDGETS_MD).matchAll(/^\| (UI-\d{3}) ([^|]+)\|/gm)].map((match) => ({
    id: match[1] as string,
    name: (match[2] ?? '').trim(),
  }))
}

/**
 * COVERAGE.md's own path convention, made into paths under `tests/e2e`.
 *
 * Its header states it: paths are relative to `tests/`; "e2e wt-NN" means
 * `tests/e2e/walkthrough/NN-*.spec.ts`; "a11y" means the matching file in `tests/e2e/a11y/`.
 */
function specsNamedFor(id: string, rows: { id: string; tests: string[] }[]): Set<string> {
  const row = rows.find((entry) => entry.id === id)
  const named = new Set<string>()
  for (const entry of row?.tests ?? []) {
    const walkthrough = /^e2e wt-(\d{2})$/.exec(entry)
    if (walkthrough) {
      const step = Number(walkthrough[1])
      for (const basename of walkthroughSpecs()) {
        if (stepsClaimedBy(basename).includes(step)) named.add(`walkthrough/${basename}`)
      }
      continue
    }
    if (entry.startsWith('e2e ')) named.add(entry.slice('e2e '.length))
    else if (entry.startsWith('a11y/')) named.add(entry)
  }
  return named
}

const walkthroughSpecs = (): string[] =>
  readdirSync(join(E2E, 'walkthrough')).filter((name) => name.endsWith('.spec.ts'))

/** `08-lock` is step 8; `02-05-start-to-frame` is steps 2 to 5. */
function stepsClaimedBy(basename: string): number[] {
  const match = /^(\d{2})(?:-(\d{2}))?-/.exec(basename)
  if (!match) return []
  const from = Number(match[1])
  const to = match[2] === undefined ? from : Number(match[2])
  return Array.from({ length: to - from + 1 }, (_, index) => from + index)
}

/** Every address the App Router serves, derived from the `page.tsx` files themselves. */
function routesOnDisk(directory = APP_DIR): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) {
      found.push(...routesOnDisk(path))
      continue
    }
    if (entry !== 'page.tsx') continue
    const segments = relative(APP_DIR, directory)
      .split(sep)
      .filter((segment) => segment !== '' && !/^\(.*\)$/.test(segment))
    found.push(`/${segments.join('/')}`.replace(/\/$/, '') || '/')
  }
  return found
}

const specSource = (relativePath: string): string | null => {
  try {
    return readFileSync(join(E2E, relativePath), 'utf8')
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------------------------

test.describe('axe screen coverage (14 §3)', () => {
  test('the register lists every UI screen COVERAGE.md names, and no other', () => {
    const rows = coverageRows()
    expect(rows.length, 'COVERAGE.md still carries its UI table').toBeGreaterThan(30)
    expect(
      screens.map((screen) => screen.id),
      'screens.json holds one row per UI id in COVERAGE.md, in the same order',
    ).toEqual(rows.map((row) => row.id))
  })

  test('every screen is named as 16 §8.2 names it', () => {
    const rows = budgetRows()
    expect(rows.length, '16 §8.2 still carries its screen table').toBeGreaterThan(30)
    const byId = new Map(rows.map((row) => [row.id, row.name]))
    for (const screen of screens) {
      expect(byId.get(screen.id), `${screen.id} is not in 16 §8.2`).toBeDefined()
      expect(screen.name, `${screen.id} is named differently in 16 §8.2`).toBe(byId.get(screen.id))
    }
  })

  test('every route a built screen claims is a page that exists', () => {
    const onDisk = new Set(routesOnDisk())
    const unknown: string[] = []
    for (const screen of screens) {
      if (screen.pending !== undefined) continue
      if (screen.routes.length === 0) {
        expect(screen.routeless, `${screen.id} claims no route and gives no reason`).toBeTruthy()
        continue
      }
      for (const route of screen.routes) {
        if (!onDisk.has(route)) unknown.push(`${screen.id} → ${route}`)
      }
    }
    expect(unknown, 'a screen may not point at an address the App Router does not serve').toEqual(
      [],
    )
  })

  test('every page the App Router serves is claimed by a screen or exempted with a reason', () => {
    const claimed = new Set(screens.flatMap((screen) => screen.routes))
    const exempt = new Map(register.unregisteredRoutes.map((entry) => [entry.route, entry.reason]))
    const orphans = routesOnDisk().filter((route) => !claimed.has(route) && !exempt.has(route))
    expect(
      orphans,
      'a screen built with no axe test is exactly what this gate exists to catch: add it to screens.json, or exempt it with a reason',
    ).toEqual([])
    for (const [route, reason] of exempt) {
      expect(reason.length, `the exemption for ${route} gives no reason`).toBeGreaterThan(20)
      expect(
        routesOnDisk().includes(route),
        `${route} is exempted but no longer exists — drop the exemption`,
      ).toBe(true)
    }
  })

  test('every built screen has a spec that COVERAGE.md names, and that spec runs axe', () => {
    const rows = coverageRows()
    const faults: string[] = []
    for (const screen of screens) {
      if (screen.pending !== undefined) continue
      const named = specsNamedFor(screen.id, rows)
      if (!named.has(screen.spec)) {
        faults.push(`${screen.id} → ${screen.spec} is not among COVERAGE.md's tests for it`)
        continue
      }
      const source = specSource(screen.spec)
      if (source === null) {
        faults.push(`${screen.id} → ${screen.spec} (no such file)`)
        continue
      }
      if (!/\baxe\s*\(/.test(source)) {
        faults.push(`${screen.id} → ${screen.spec} runs no axe scan`)
      }
    }
    expect(
      faults,
      'every UI-### screen is scanned by a spec the requirements register names',
    ).toEqual([])
  })

  test('a screen that is not built yet names its build-plan step, and is still unbuilt', () => {
    const plan = readdirSync(BUILD_PLAN)
      .filter((name) => name.endsWith('.md'))
      .map((name) => read(join(BUILD_PLAN, name)))
      .join('\n')
    const onDisk = new Set(routesOnDisk())

    for (const screen of screens) {
      if (screen.pending === undefined) continue
      expect(
        plan.includes(`### Step ${screen.pending} `),
        `${screen.id} is pending on step ${screen.pending}, which no phase file declares`,
      ).toBe(true)
      const built = screen.routes.filter((route) => onDisk.has(route))
      expect(
        built,
        `${screen.id} is marked pending but its route now exists — scan it and take the marker off`,
      ).toEqual([])
    }
  })
})
