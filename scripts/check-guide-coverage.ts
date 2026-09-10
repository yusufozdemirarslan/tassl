// Guide ↔ test coverage gate (docs/prompts/02-qa-and-guides.md Part B).
//
// The guides and the guide-driven Playwright specs are one artifact: every `### Task N:` in a guide
// is a `test('Task N: …')` in the matching spec, every numbered step of that task is a
// `test.step('N.M <step text>')`, in the same order and wording, and nothing exists in the spec
// that the guide does not describe. This script re-derives both sides from the files on every run
// and fails with the full list of differences.
//
//   pnpm exec tsx scripts/check-guide-coverage.ts            # check only (CI, pre-test)
//   pnpm exec tsx scripts/check-guide-coverage.ts --stamp    # check, then rewrite each guide footer
//                                                            # ("Verified by automated tests: <date>,
//                                                            # commit <sha>") and require every
//                                                            # screenshot the guides reference to exist
//
// Guide format (machine-parsed):
//   ### Task N: <title>
//   ... M. <action sentence> → You see: <expected>
//       ![Task N step M](screenshots/<persona>/task-NN-step-MM.png)
// Spec format:
//   test('Task N: <title>', …)  and  await test.step('N.M <action sentence without ** markers>', …)
//
// The demo runbook is a guide too: its "## The demo path" section is a numbered list, and
// tests/e2e/guides/demo-path.spec.ts holds one test whose steps are 'N <item text>'.
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const REPO = process.cwd()
const GUIDES = join(REPO, 'docs', 'guides')
const SPECS = join(REPO, 'tests', 'e2e', 'guides')

type Step = {
  task: number
  step: number
  text: string
  expected: string
  screenshot: string | null
}
type Task = { number: number; title: string; steps: Step[] }

const normalize = (s: string): string =>
  s.replace(/\*\*/g, '').replace(/[`]/g, '').replace(/\s+/g, ' ').replace(/[’]/g, "'").trim()

/** Every `### Task N:` in the guide with its numbered `→ You see:` steps and screenshot lines. */
function parseGuide(path: string): Task[] {
  const text = readFileSync(path, 'utf8')
  const lines = text.split(/\r?\n/)
  const tasks: Task[] = []
  let current: Task | null = null
  let inTasks = false
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (/^## /.test(line)) inTasks = /^## Tasks\b/.test(line)
    if (!inTasks) continue
    const heading = /^### Task (\d+): (.+)$/.exec(line)
    if (heading) {
      current = { number: Number(heading[1]), title: normalize(heading[2] ?? ''), steps: [] }
      tasks.push(current)
      continue
    }
    if (!current) continue
    const step = /^(\d+)\.\s+(.+?)\s+→ You see:\s+(.+)$/.exec(line)
    if (step) {
      const next = lines[i + 1] ?? ''
      const shot = /!\[[^\]]*\]\(([^)]+)\)/.exec(next)
      current.steps.push({
        task: current.number,
        step: Number(step[1]),
        text: normalize(step[2] ?? ''),
        expected: normalize(step[3] ?? ''),
        screenshot: shot ? (shot[1] ?? null) : null,
      })
    }
  }
  return tasks
}

/**
 * The steps of the runbook's "## The demo path" section: numbered list items, or the rows of its
 * `| Step | Click | Say | Time |` tables, where the step text is the Click cell.
 */
function parseRunbook(path: string): { step: number; text: string }[] {
  const text = readFileSync(path, 'utf8')
  const lines = text.split(/\r?\n/)
  const items: { step: number; text: string }[] = []
  let inPath = false
  for (const line of lines) {
    if (/^## /.test(line)) inPath = /^## (\d+\.\s+)?The demo path\b/.test(line)
    if (!inPath) continue
    const item = /^(\d+)\.\s+(.+)$/.exec(line)
    if (item) {
      items.push({ step: Number(item[1]), text: normalize(item[2] ?? '') })
      continue
    }
    const row = /^\|\s*(\d+)\s*\|\s*(.+?)\s*\|/.exec(line)
    if (row) items.push({ step: Number(row[1]), text: normalize(row[2] ?? '') })
  }
  return items
}

/** `test('…')` titles and `test.step('…')` titles, in file order. */
function parseSpec(path: string): { tests: string[]; steps: string[] } {
  const text = readFileSync(path, 'utf8')
  const tests: string[] = []
  const steps: string[] = []
  const pattern = /\btest(\.step)?\s*\(\s*(['"`])((?:\\.|(?!\2).)*)\2/g
  for (const match of text.matchAll(pattern)) {
    const title = normalize((match[3] ?? '').replace(/\\(['"`])/g, '$1'))
    if (match[1]) steps.push(title)
    else tests.push(title)
  }
  return { tests, steps }
}

function compareGuide(guide: string, spec: string, problems: string[]): Task[] {
  const guidePath = join(GUIDES, guide)
  const specPath = join(SPECS, spec)
  if (!existsSync(guidePath)) {
    problems.push(`${guide}: guide file is missing`)
    return []
  }
  if (!existsSync(specPath)) {
    problems.push(`${spec}: spec file is missing`)
    return []
  }
  const tasks = parseGuide(guidePath)
  const parsed = parseSpec(specPath)
  if (tasks.length === 0) problems.push(`${guide}: no "### Task N:" headings found`)

  const wantTests = tasks.map((task) => `Task ${task.number}: ${task.title}`)
  const wantSteps = tasks.flatMap((task) =>
    task.steps.map((step) => `${task.number}.${step.step} ${step.text}`),
  )
  for (const task of tasks) {
    if (task.steps.length === 0)
      problems.push(`${guide}: Task ${task.number} has no numbered steps`)
    task.steps.forEach((step, index) => {
      if (step.step !== index + 1)
        problems.push(`${guide}: Task ${task.number} step numbering breaks at ${step.step}`)
      if (!step.screenshot)
        problems.push(`${guide}: Task ${task.number} step ${step.step} has no screenshot line`)
    })
  }
  tasks.forEach((task, index) => {
    if (task.number !== index + 1)
      problems.push(`${guide}: task numbering breaks at Task ${task.number}`)
  })

  const haveTests = new Set(parsed.tests)
  const haveSteps = new Set(parsed.steps)
  for (const title of wantTests)
    if (!haveTests.has(title)) problems.push(`${spec}: no test titled "${title}"`)
  for (const title of wantSteps)
    if (!haveSteps.has(title)) problems.push(`${spec}: no test.step titled "${title}"`)
  const wantTestSet = new Set(wantTests)
  const wantStepSet = new Set(wantSteps)
  for (const title of parsed.tests)
    if (!wantTestSet.has(title)) problems.push(`${guide}: no task for the test "${title}"`)
  for (const title of parsed.steps)
    if (!wantStepSet.has(title)) problems.push(`${guide}: no step for the test.step "${title}"`)
  // Order: the spec's steps must follow the guide's order.
  const orderedWant = wantSteps.filter((title) => haveSteps.has(title))
  const orderedHave = parsed.steps.filter((title) => wantStepSet.has(title))
  if (orderedWant.join('\n') !== orderedHave.join('\n'))
    problems.push(`${spec}: test.step order differs from the guide's step order`)
  return tasks
}

function compareRunbook(problems: string[]): void {
  const guidePath = join(GUIDES, 'demo-runbook.md')
  const specPath = join(SPECS, 'demo-path.spec.ts')
  if (!existsSync(guidePath)) {
    problems.push('demo-runbook.md: guide file is missing')
    return
  }
  if (!existsSync(specPath)) {
    problems.push('demo-path.spec.ts: spec file is missing')
    return
  }
  const items = parseRunbook(guidePath)
  if (items.length === 0) problems.push('demo-runbook.md: "## The demo path" has no numbered items')
  const parsed = parseSpec(specPath)
  const want = items.map((item) => `${item.step} ${item.text}`)
  const have = new Set(parsed.steps)
  for (const title of want)
    if (!have.has(title)) problems.push(`demo-path.spec.ts: no test.step titled "${title}"`)
  const wantSet = new Set(want)
  for (const title of parsed.steps)
    if (!wantSet.has(title))
      problems.push(`demo-runbook.md: no demo-path item for the test.step "${title}"`)
  if (!parsed.tests.some((title) => /@smoke/.test(title)))
    problems.push('demo-path.spec.ts: the demo path test is not tagged @smoke')
}

function stamp(guide: string, tasks: Task[], problems: string[]): void {
  const guidePath = join(GUIDES, guide)
  for (const task of tasks)
    for (const step of task.steps) {
      const file = step.screenshot ? resolve(dirname(guidePath), step.screenshot) : null
      if (!file || !existsSync(file))
        problems.push(`${guide}: screenshot missing for Task ${task.number} step ${step.step}`)
    }
  if (problems.length > 0) return
  const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  const date = new Date().toISOString().slice(0, 10)
  const text = readFileSync(guidePath, 'utf8')
  const footer = `Verified by automated tests: ${date}, commit ${sha}`
  const replaced = text.replace(/Verified by automated tests: [^\n]*\s*$/, `${footer}\n`)
  writeFileSync(guidePath, replaced.endsWith('\n') ? replaced : `${replaced}\n`)
}

function main(): void {
  const shouldStamp = process.argv.includes('--stamp')
  const problems: string[] = []
  const pairs: [string, string][] = [
    ['instructor-guide.md', 'instructor-guide.spec.ts'],
    ['learner-guide.md', 'learner-guide.spec.ts'],
  ]
  const parsed = pairs.map(([guide, spec]) => [guide, compareGuide(guide, spec, problems)] as const)
  compareRunbook(problems)
  if (shouldStamp) for (const [guide, tasks] of parsed) stamp(guide, tasks, problems)
  const taskCount = parsed.reduce((sum, [, tasks]) => sum + tasks.length, 0)
  const stepCount = parsed.reduce(
    (sum, [, tasks]) => sum + tasks.reduce((inner, task) => inner + task.steps.length, 0),
    0,
  )
  if (problems.length > 0) {
    console.error(`guide coverage: ${problems.length} problem(s)`)
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }
  console.log(
    `guide coverage: ${taskCount} tasks and ${stepCount} steps across ${pairs.length} guides match their specs` +
      (shouldStamp ? '; footers stamped' : ''),
  )
}

main()
