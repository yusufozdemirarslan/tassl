import { readFileSync } from 'node:fs'
import { globSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// D-158: Tailwind 4 compiles `outline-none` to `--tw-outline-style: none`, which
// `focus-visible:outline-2` reads back, so a class string that carries both never shows a ring.
const files = globSync('src/**/*.tsx')
const literal = /(['"`])((?:(?!\1)[\s\S])*?)\1/g

describe('focus recipe (DESIGN.md §Components, D-158)', () => {
  it('scans the component tree', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it.each(files)('%s never pairs an outline reset with the focus recipe', (file) => {
    const source = readFileSync(file, 'utf8')
    const offenders: string[] = []
    for (const match of source.matchAll(literal)) {
      const text = match[2] ?? ''
      if (/focus-visible:outline-/.test(text) && /\boutline-(none|hidden)\b/.test(text)) {
        offenders.push(text.slice(0, 120))
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })
})
