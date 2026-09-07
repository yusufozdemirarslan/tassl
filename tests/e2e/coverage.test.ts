// The E2E flow gate (14 §3): "PRD user flows with an E2E test — 100 %".
//
// A coverage file that lists what somebody remembered is a list that drifts, and a gate built on one
// passes for years after the thing it guards has gone. So nothing here is copied: **the set of flow
// ids is re-derived from the two documents that define them, on every run.**
//
//   * The seventeen numbered steps of `docs/prd/Tassl-PRD.md` §12 "The walkthrough" — parsed out of
//     the PRD itself, with their own titles. A step added, removed, renumbered or renamed there
//     fails here until `flows.json` says the same thing.
//   * The subsections of `docs/tech/01-prd-analysis.md` §6 — the seven flow diagrams, likewise by
//     heading.
//   * The three 14 §3 names in the same breath as those: auth, authoring, admin.
//
// And nothing is taken on trust in the other direction either. Every spec a flow names must exist
// and must declare at least one `test(`; every step must be covered by the spec whose filename
// carries its own number, and not only by another step's file; and every walkthrough spec on disk
// must be claimed by some step. So a spec file that is deleted, renamed or orphaned is a failure
// rather than a silence. A flow that is not built yet says so with the build-plan step that will
// build it, and is checked to be *still* unbuilt — the marker cannot be left behind.
//
// This runs under Playwright rather than Vitest because `playwright.config.ts` owns `tests/e2e`
// (`testDir`), and Playwright's default `testMatch` takes `*.test.ts` as well as `*.spec.ts`. It
// opens no page and needs no server: it is filesystem and text, and it runs in every project.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

// Playwright transpiles a spec to CommonJS unless the package declares `"type": "module"`, so
// `import.meta.url` is not available here. `process.cwd()` is the repo root — the config's own
// directory, which is where `pnpm test:e2e` runs — and is what `../fixture-package.ts` already uses.
const REPO = process.cwd()
const HERE = join(REPO, 'tests', 'e2e')

const PRD = join(REPO, 'docs', 'prd', 'Tassl-PRD.md')
const PRD_ANALYSIS = join(REPO, 'docs', 'tech', '01-prd-analysis.md')
const BUILD_PLAN = join(REPO, 'docs', 'tech', 'build-plan')

type Flow = {
  id: string
  source: 'prd-12-walkthrough' | 'prd-analysis-6' | 'testing-strategy-3'
  step?: number
  section?: string
  title: string
  specs: string[]
  pending?: string
}

const register = JSON.parse(readFileSync(join(HERE, 'flows.json'), 'utf8')) as { flows: Flow[] }
const flows = register.flows

const read = (path: string): string => readFileSync(path, 'utf8')

/** Everything under a heading, up to the next heading at the same level or above. */
function sectionOf(markdown: string, heading: string): string {
  const start = markdown.indexOf(heading)
  expect(start, `"${heading}" is no longer in the document`).toBeGreaterThan(-1)
  const level = /^#+/.exec(heading)?.[0].length ?? 2
  const rest = markdown.slice(start + heading.length)
  const end = rest.search(new RegExp(`^#{1,${String(level)}} `, 'm'))
  return end === -1 ? rest : rest.slice(0, end)
}

/**
 * The walkthrough steps, as the PRD writes them: `N. Title. <prose>`.
 *
 * The title is the first sentence, which in every one of the seventeen is a noun phrase naming the
 * step ("Package", "Run start", "Standing rules and accessibility").
 */
function walkthroughSteps(): { step: number; title: string }[] {
  const body = sectionOf(read(PRD), '### The walkthrough')
  return [...body.matchAll(/^(\d+)\.\s+([^.]+)\./gm)].map((match) => ({
    step: Number(match[1]),
    title: (match[2] ?? '').trim(),
  }))
}

/** The `### 6.N Title` headings of the user-flow section. */
function analysisFlows(): { section: string; title: string }[] {
  const body = sectionOf(read(PRD_ANALYSIS), '## 6. User flows')
  return [...body.matchAll(/^### (6\.\d+) (.+)$/gm)].map((match) => ({
    section: match[1] ?? '',
    title: (match[2] ?? '').trim(),
  }))
}

/** The numbers a walkthrough spec's filename claims: `08-lock` is 8, `02-05-start-to-frame` is 2..5. */
function stepsClaimedBy(basename: string): number[] {
  const match = /^(\d{2})(?:-(\d{2}))?-/.exec(basename)
  if (!match) return []
  const from = Number(match[1])
  const to = match[2] === undefined ? from : Number(match[2])
  const claimed: number[] = []
  for (let step = from; step <= to; step += 1) claimed.push(step)
  return claimed
}

const specSource = (relative: string): string | null => {
  try {
    return readFileSync(join(HERE, relative), 'utf8')
  } catch {
    return null
  }
}

test.describe('E2E flow coverage (14 §3)', () => {
  test('every walkthrough step the PRD numbers is a flow, under its own title', () => {
    const steps = walkthroughSteps()

    // The PRD's own count. Stated so that a parse that silently matched nothing — a renumbering, a
    // reformat — fails here rather than passing over an empty list.
    expect(
      steps.map((entry) => entry.step),
      'PRD §12 numbers its walkthrough steps 1 to 17',
    ).toEqual(Array.from({ length: 17 }, (_, index) => index + 1))

    const registered = flows.filter((flow) => flow.source === 'prd-12-walkthrough')
    expect(
      registered.map((flow) => ({ step: flow.step, title: flow.title })),
      'flows.json must carry one flow per walkthrough step, with the PRD’s own title',
    ).toEqual(steps)

    for (const flow of registered) {
      expect(flow.id, 'a walkthrough flow is `wt-NN`').toBe(
        `wt-${String(flow.step).padStart(2, '0')}`,
      )
    }
  })

  test('every user-flow subsection of 01-prd-analysis §6 is a flow', () => {
    const sections = analysisFlows()
    expect(sections.length, '§6 draws the seven flow diagrams').toBeGreaterThanOrEqual(7)

    const registered = flows.filter((flow) => flow.source === 'prd-analysis-6')
    expect(
      registered.map((flow) => ({ section: flow.section, title: flow.title })),
      'flows.json must carry one flow per §6 subsection, under its own heading',
    ).toEqual(sections)
  })

  test('the three flows 14 §3 names beside §6 are registered', () => {
    const named = flows
      .filter((flow) => flow.source === 'testing-strategy-3')
      .map((flow) => flow.id)
      .sort()
    expect(
      named,
      '14 §3: "the flows of 01-prd-analysis.md §6 plus auth, authoring, admin"',
    ).toEqual(['admin', 'auth', 'authoring'])
  })

  test('every flow names at least one spec, and every spec it names exists and holds a test', () => {
    expect(flows.length, 'the register is not empty').toBeGreaterThan(20)

    const missing: string[] = []
    for (const flow of flows) {
      expect(flow.specs.length, `${flow.id} names no spec`).toBeGreaterThan(0)
      if (flow.pending !== undefined) continue
      for (const relative of flow.specs) {
        const source = specSource(relative)
        if (source === null) {
          missing.push(`${flow.id} → ${relative} (no such file)`)
          continue
        }
        if (!/\btest(?:\.\w+)?\s*\(/.test(source)) {
          missing.push(`${flow.id} → ${relative} (declares no test)`)
        }
      }
    }
    expect(missing, 'every flow of PRD §12 and §6 has a running E2E spec').toEqual([])
  })

  test('every step has the spec its own number names, and no walkthrough spec on disk is unclaimed', () => {
    const onDisk = readdirSync(join(HERE, 'walkthrough'))
      .filter((name) => name.endsWith('.spec.ts'))
      .sort()
    expect(onDisk.length, 'the walkthrough directory holds specs').toBeGreaterThan(10)

    // Each step's *own* spec: the file whose leading number is that step. A step may be covered by
    // more than one spec — step 16 is "steps 2 to 14 again on the sound variant", so
    // `16-sound-variant.spec.ts` legitimately stands for a dozen of them — but it may not be covered
    // *only* by another step's file, which is how a step silently loses its own coverage.
    const without: string[] = []
    for (const flow of flows) {
      if (flow.source !== 'prd-12-walkthrough') continue
      const own = flow.specs.some(
        (relative) =>
          relative.startsWith('walkthrough/') &&
          stepsClaimedBy(relative.slice('walkthrough/'.length)).includes(flow.step as number),
      )
      if (!own) without.push(`${flow.id} names no spec whose filename numbers step ${flow.step}`)
    }
    expect(without, 'every walkthrough step is covered by the spec its own number names').toEqual(
      [],
    )

    // And the other direction: every spec file in the directory is named by some step.
    const claimed = new Set(
      flows
        .filter((flow) => flow.source === 'prd-12-walkthrough')
        .flatMap((flow) => flow.specs)
        .filter((relative) => relative.startsWith('walkthrough/'))
        .map((relative) => relative.slice('walkthrough/'.length)),
    )
    expect(
      onDisk.filter((basename) => !claimed.has(basename)),
      'a walkthrough spec that no step claims is a step that has quietly lost its coverage',
    ).toEqual([])
  })

  test('a flow that is not built yet names the build-plan step that will build it, and is still unbuilt', () => {
    const phases = readdirSync(BUILD_PLAN).filter((name) => name.endsWith('.md'))
    const plan = phases.map((name) => read(join(BUILD_PLAN, name))).join('\n')

    for (const flow of flows) {
      if (flow.pending === undefined) continue
      expect(
        plan.includes(`### Step ${flow.pending} `),
        `${flow.id} is pending on step ${flow.pending}, which no phase file declares`,
      ).toBe(true)
      // The marker cannot outlive the work: the moment a spec appears at the path the flow names,
      // this fails and the `pending` has to come off.
      for (const relative of flow.specs) {
        expect(
          specSource(relative),
          `${flow.id} is marked pending but ${relative} now exists — take the marker off`,
        ).toBeNull()
      }
    }
  })
})
