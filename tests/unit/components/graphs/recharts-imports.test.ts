// 16 §3.2 and §3.3, as a test rather than as a note in a spec.
//
// `recharts` is 90 KB of gzip. The budget script catches it once it has reached a route's entry
// chunk, which is late and reads as an unrelated number; this catches the import that would put it
// there. Two rules, both from 16 §3.2: the library is imported only from `src/components/graphs/*`,
// and it never appears in a layout, in `src/components/ui`, or anywhere in the run workspace.
//
// The third rule — that the chart components are reached through `next/dynamic` — is asserted on
// the barrel, because that is the only door §3.3 gives them.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx)$/.test(entry) ? [full] : []
  })
}

const IMPORTS_RECHARTS = /from\s+['"]recharts['"]|import\(['"]recharts['"]\)/

describe('recharts stays where 16 §3.2 puts it', () => {
  const importers = sourceFiles(SRC)
    .filter((file) => IMPORTS_RECHARTS.test(readFileSync(file, 'utf8')))
    .map((file) => relative(ROOT, file).replaceAll('\\', '/'))

  it('is imported only from src/components/graphs', () => {
    expect(importers.length).toBeGreaterThan(0)
    for (const file of importers) {
      expect(file.startsWith('src/components/graphs/'), file).toBe(true)
    }
  })

  it('never reaches a layout, a UI primitive, or the run workspace', () => {
    for (const file of importers) {
      expect(file).not.toMatch(/layout\.tsx$/)
      expect(file).not.toMatch(/^src\/components\/ui\//)
      expect(file).not.toMatch(/^src\/components\/features\/run\//)
      expect(file).not.toMatch(/^src\/app\//)
    }
  })

  it('does not reach the frame-beside-decision record, which the Turn screen draws', () => {
    // The Turn screen renders `FrameBesideDecision` inside the run workspace (D-348), so a chart
    // there would put recharts on a route that may never carry it.
    const record = readFileSync(join(SRC, 'components/graphs/frame-beside-decision.tsx'), 'utf8')
    expect(IMPORTS_RECHARTS.test(record)).toBe(false)
    expect(record).not.toContain("from './graph-frame'")
  })

  it('reaches every recharts graph through next/dynamic', () => {
    const barrel = readFileSync(join(SRC, 'components/graphs/index.tsx'), 'utf8')
    const chartFiles = sourceFiles(join(SRC, 'components/graphs'))
      .filter((file) => IMPORTS_RECHARTS.test(readFileSync(file, 'utf8')))
      .map((file) => relative(join(SRC, 'components/graphs'), file).replace(/\.tsx?$/, ''))

    expect(barrel).toContain("import dynamic from 'next/dynamic'")
    for (const chart of chartFiles) {
      expect(barrel).toContain(`import('./${chart.replaceAll('\\', '/')}')`)
    }
    // Nothing re-exports a chart module statically from the barrel.
    for (const chart of chartFiles) {
      expect(barrel).not.toMatch(new RegExp(`export \\{[^}]*\\} from '\\./${chart}'`))
    }
  })
})
