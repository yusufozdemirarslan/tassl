// COVERAGE.md is the join between a requirement and the test that proves it (docs/tech/COVERAGE.md).
// A row that names a test which no longer exists is worse than no row at all: it reads as coverage
// and proves nothing. A rename, a move, or a deleted spec breaks the join silently, so the join is
// checked here — every path a row names is opened, and a glob must match at least one file.
//
// Prose in the test column is left alone: FR-250's "e2e walkthrough suite" names the directory in
// words, not a file, and only items that look like a path (a `.spec.ts`/`.test.ts(x)` ending, or a
// `*`) are resolved.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COVERAGE = 'docs/tech/COVERAGE.md'
const REGISTER = 'docs/tech/01-prd-analysis.md'
const WALKTHROUGH_DIR = 'tests/e2e/walkthrough'

/** The prefixes the requirement register issues ids under (01-prd-analysis.md §5). */
const PREFIX = '(?:FR|NFR|SYS|UI|AN|INT|DATA|AI)'

/** A path whose last segment carries a `*`: at least one file in the directory must match. */
function globExists(path: string): boolean {
  const dir = dirname(path)
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return false
  const pattern = new RegExp(
    `^${path
      .slice(dir.length + 1)
      .replace(/[.]/g, '[.]')
      .replace(/[*]/g, '.*')}$`,
  )
  return readdirSync(dir).some((file) => pattern.test(file))
}

const exists = (path: string): boolean => (path.includes('*') ? globExists(path) : existsSync(path))

const looksLikeAPath = (item: string): boolean =>
  /\.(test|spec)\.(ts|tsx)$/.test(item) || item.includes('*')

/** Where a test named in the table lives, or null when the cell is prose. */
function resolve(item: string): string | null {
  if (item.startsWith('e2e ')) {
    const rest = item.slice(4).trim()
    return looksLikeAPath(rest) ? join('tests/e2e', rest) : null
  }
  if (item.startsWith('a11y/')) return join('tests/e2e', item)
  if (item.startsWith('a11y ')) {
    const rest = item.slice(5).trim()
    return looksLikeAPath(rest) ? join('tests/e2e/a11y', rest) : null
  }
  if (item.startsWith('evals/')) return item
  return looksLikeAPath(item) ? join('tests', item) : null
}

type Named = { id: string; item: string }

function namedTests(): Named[] {
  const rows: Named[] = []
  for (const line of readFileSync(COVERAGE, 'utf8').split('\n')) {
    if (!line.startsWith('|')) continue
    const cells = line.split('|').map((cell) => cell.trim())
    const [, id, , tests] = cells
    if (!id || !tests || id === 'ID' || id.startsWith('---')) continue
    for (const raw of tests.split(/[,;]/)) {
      // A trailing note in parentheses explains the row; it is not part of the path.
      const item = raw
        .replace(/`/g, '')
        .replace(/\s*\([^)]*\)?\s*$/, '')
        .trim()
      if (item === '' || item === '—' || item === '-') continue
      rows.push({ id, item })
    }
  }
  return rows
}

describe('COVERAGE.md names tests that exist', () => {
  const rows = namedTests()

  it('reads the requirement table', () => {
    // The file joins every requirement of 01-prd-analysis.md §5; a parse that found a handful of
    // rows would pass the check below while proving nothing.
    expect(rows.length).toBeGreaterThan(400)
  })

  it('opens every walkthrough step it names', () => {
    const files = readdirSync(WALKTHROUGH_DIR)
    const missing = rows
      .filter((row) => row.item.startsWith('e2e wt-'))
      .filter((row) => {
        const step = row.item.slice('e2e wt-'.length).trim()
        return !files.some((file) => file.startsWith(`${step}-`))
      })
      .map((row) => `${row.id} → ${row.item}`)
    expect(missing).toEqual([])
  })

  it('opens every test file it names', () => {
    const missing = rows
      .map((row) => ({ row, path: resolve(row.item) }))
      .filter((entry): entry is { row: Named; path: string } => entry.path !== null)
      .filter((entry) => !exists(entry.path))
      .map((entry) => `${entry.row.id} → ${entry.row.item} (${entry.path})`)
    expect(missing).toEqual([])
  })
})

// COVERAGE.md's other promise is the one printed above its table: "Every ID from
// `01-prd-analysis.md` §5 appears exactly once below." A requirement that reaches the register and
// never reaches COVERAGE is built and tested by luck; a row in COVERAGE for an id the register no
// longer issues is a row nobody will check again. Both drift silently, so both are checked here.

/** Every id the register issues, read off its `| FR-100 | FR | …` rows. */
function registerIds(): string[] {
  const ids: string[] = []
  const row = new RegExp(String.raw`^\|\s*(${PREFIX}-\d+)\s*\|\s*${PREFIX}\s*\|`)
  for (const line of readFileSync(REGISTER, 'utf8').split('\n')) {
    const match = row.exec(line)
    if (match?.[1]) ids.push(match[1])
  }
  return ids
}

/** `DATA-012 to DATA-026` is fifteen ids; the table writes a run of them that way. */
function expand(from: string, to: string): string[] {
  const [prefix = '', first = ''] = from.split(/-(?=\d+$)/)
  const last = to.split(/-(?=\d+$)/)[1] ?? ''
  const ids: string[] = []
  for (let n = Number(first); n <= Number(last); n += 1) {
    ids.push(`${prefix}-${String(n).padStart(3, '0')}`)
  }
  return ids
}

/** Every id COVERAGE.md claims, with the ranges in its first column opened out. */
function coveredIds(): string[] {
  const ids: string[] = []
  const one = new RegExp(String.raw`^${PREFIX}-\d+$`)
  const range = new RegExp(String.raw`^(${PREFIX}-\d+)\s+to\s+(${PREFIX}-\d+)$`)
  for (const line of readFileSync(COVERAGE, 'utf8').split('\n')) {
    if (!line.startsWith('|')) continue
    const cell = (line.split('|')[1] ?? '').trim()
    if (cell === '' || cell === 'ID' || cell.startsWith('---')) continue
    for (const raw of cell.split(',')) {
      const item = raw.trim()
      const span = range.exec(item)
      if (span?.[1] && span[2]) ids.push(...expand(span[1], span[2]))
      else if (one.test(item)) ids.push(item)
    }
  }
  return ids
}

describe('the requirement register and COVERAGE.md name the same requirements', () => {
  const register = registerIds()

  it('issues each id once', () => {
    expect(register.length).toBeGreaterThan(300)
    const seen = new Set<string>()
    expect(register.filter((id) => seen.size === seen.add(id).size)).toEqual([])
  })

  it('refers only to requirements it issues', () => {
    // A note pointing at an id nobody wrote reads as a cross-reference and is a dead end: FR-100's
    // "Named fields come from the package (FR-158)" pointed at nothing for the whole build, and
    // the requirement it meant is FR-191.
    const issued = new Set(register)
    const referenced = new Set(
      readFileSync(REGISTER, 'utf8').match(new RegExp(String.raw`\b${PREFIX}-\d+\b`, 'g')) ?? [],
    )
    expect([...referenced].filter((id) => !issued.has(id)).sort()).toEqual([])
  })

  it('covers every issued id exactly once, and covers nothing else', () => {
    const covered = coveredIds()
    const seen = new Set<string>()
    expect(covered.filter((id) => seen.size === seen.add(id).size)).toEqual([])

    const issued = new Set(register)
    expect(register.filter((id) => !seen.has(id))).toEqual([])
    expect([...seen].filter((id) => !issued.has(id)).sort()).toEqual([])
  })
})
