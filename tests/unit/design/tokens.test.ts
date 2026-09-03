import { readFileSync } from 'node:fs'
import YAML from 'yaml'
import { describe, expect, it } from 'vitest'

// DESIGN.md is Impeccable's design authority; globals.css is what ships. They must agree (D-025).
const design = readFileSync('DESIGN.md', 'utf8')
const css = readFileSync('src/app/globals.css', 'utf8')

function rootTokens(): Map<string, string> {
  const root = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
  const out = new Map<string, string>()
  for (const m of root.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g))
    out.set(m[1]!, m[2]!.trim().toLowerCase())
  return out
}

function designColorRows(): Map<string, string> {
  const section = design.split(/^## Colors\s*$/m)[1]?.split(/^## /m)[0] ?? ''
  const out = new Map<string, string>()
  for (const m of section.matchAll(/^\|\s*`(--[a-z0-9-]+)`\s*\|\s*`(#[0-9a-fA-F]{6})`/gm)) {
    out.set(m[1]!, m[2]!.toLowerCase())
  }
  return out
}

function frontmatter(): {
  colors?: Record<string, string>
  rounded?: Record<string, string>
  spacing?: Record<string, string>
} {
  const block = design.match(/^---\n([\s\S]*?)\n---/)?.[1]
  return block ? (YAML.parse(block) as ReturnType<typeof frontmatter>) : {}
}

describe('design tokens', () => {
  const tokens = rootTokens()
  const rows = designColorRows()

  it('DESIGN.md §Colors lists every color token from 09-frontend-spec.md §2.2', () => {
    expect(rows.size).toBeGreaterThanOrEqual(23)
    for (const name of [
      '--paper',
      '--ink',
      '--primary',
      '--amber',
      '--red',
      '--green',
      '--focus',
      '--stance-escalate',
    ]) {
      expect(rows.has(name), name).toBe(true)
    }
  })

  it('every color in DESIGN.md §Colors appears in globals.css with the same value', () => {
    const mismatches = [...rows]
      .filter(([name, value]) => tokens.get(name) !== value)
      .map(([name, value]) => `${name}: DESIGN.md ${value} vs css ${tokens.get(name) ?? 'missing'}`)
    expect(mismatches).toEqual([])
  })

  it('the frontmatter color tokens match the :root values by slug', () => {
    const colors = frontmatter().colors ?? {}
    expect(Object.keys(colors).length).toBeGreaterThanOrEqual(20)
    const mismatches = Object.entries(colors)
      .filter(([slug, value]) => tokens.get(`--${slug}`) !== value.toLowerCase())
      .map(
        ([slug, value]) =>
          `${slug}: frontmatter ${value} vs css ${tokens.get(`--${slug}`) ?? 'missing'}`,
      )
    expect(mismatches).toEqual([])
  })

  it('radius and spacing scales match', () => {
    const fm = frontmatter()
    expect(fm.rounded).toEqual({
      sm: tokens.get('--radius-sm'),
      md: tokens.get('--radius-md'),
      lg: tokens.get('--radius-lg'),
    })
    for (const [key, value] of Object.entries(fm.spacing ?? {})) {
      expect(tokens.get(`--space-${key}`), `--space-${key}`).toBe(value)
    }
  })

  it('never uses pure black, pure gray, or gradients', () => {
    expect(css).not.toMatch(/#000000|#000\b|oklch\(0 0 0\)|linear-gradient|radial-gradient/i)
    // Equal channels = pure gray or black; white is the one neutral that is allowed (paper-raised).
    for (const value of tokens.values()) {
      expect(value, value).not.toMatch(/^#(?!ffffff)(?:([0-9a-f]{2})\1\1)$/)
    }
  })
})
