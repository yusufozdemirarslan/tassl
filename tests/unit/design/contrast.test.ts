import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// B16 (docs/tech/16-performance-a11y-budgets.md §8.7): recompute the WCAG 2.x contrast of every
// documented pairing from the shipped token values. Text ≥ 4.5:1, UI ≥ 3.0:1. Alpha tokens are
// composited over the surfaces they sit on before measuring.
const css = readFileSync('src/app/globals.css', 'utf8')
const root = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
const token = (name: string): string => {
  const value = root.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1]
  if (!value) throw new Error(`token ${name} is not a hex color in globals.css`)
  return value
}
type Rgb = [number, number, number]
const hexToRgb = (hex: string): Rgb => {
  const n = parseInt(hex.slice(1), 16)
  return [n >> 16, (n >> 8) & 255, n & 255]
}
/** Parses `rgb(r g b / a)` tokens such as --line-control. */
const alphaToken = (name: string): { rgb: Rgb; alpha: number } => {
  const m = root.match(new RegExp(`${name}:\\s*rgb\\((\\d+) (\\d+) (\\d+) / ([0-9.]+)\\)`))
  if (!m) throw new Error(`token ${name} is not an rgb(r g b / a) value in globals.css`)
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], alpha: Number(m[4]) }
}
const composite = (fg: Rgb, alpha: number, bg: Rgb): Rgb =>
  fg.map((c, i) => Math.round(c * alpha + bg[i]! * (1 - alpha))) as Rgb

const channel = (c: number): number => {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
const luminanceRgb = ([r, g, b]: Rgb): number =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
const luminance = (hex: string): number => luminanceRgb(hexToRgb(hex))
const ratio = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
export const contrast = (fg: string, bg: string): number => ratio(luminance(fg), luminance(bg))

const text: Array<[string, string, string]> = [
  ['ink on paper', '--ink', '--paper'],
  ['ink on paper-raised', '--ink', '--paper-raised'],
  ['ink on paper-sunken', '--ink', '--paper-sunken'],
  ['ink-muted on paper', '--ink-muted', '--paper'],
  ['ink-muted on paper-sunken', '--ink-muted', '--paper-sunken'],
  ['primary on paper', '--primary', '--paper'],
  ['red on paper', '--red', '--paper'],
  ['green on paper', '--green', '--paper'],
  ['primary-ink on primary', '--primary-ink', '--primary'],
  ['white on red', '--paper-raised', '--red'],
  ['white on green', '--paper-raised', '--green'],
  ['ink on amber', '--ink', '--amber'],
  ['ink on amber-soft', '--ink', '--amber-soft'],
  ['ink on primary-soft', '--ink', '--primary-soft'],
  ['ink on red-soft', '--ink', '--red-soft'],
  ['ink on green-soft', '--ink', '--green-soft'],
  ['primary on primary-soft', '--primary', '--primary-soft'],
  ['red on red-soft', '--red', '--red-soft'],
  ['paper on ink', '--paper', '--ink'],
  ['stance-escalate on paper', '--stance-escalate', '--paper'],
]

const ui: Array<[string, string, string]> = [
  ['amber on paper (label border and icon)', '--amber', '--paper'],
  ['focus ring on paper', '--focus', '--paper'],
  ['focus ring on paper-raised', '--focus', '--paper-raised'],
  ['green on green-soft (icon)', '--green', '--green-soft'],
  ['ink-faint on paper-raised (decorative)', '--ink-faint', '--paper-raised'],
]

describe('token contrast (WCAG 2.x)', () => {
  it.each(text)('%s ≥ 4.5:1', (_label, fg, bg) => {
    expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5)
  })

  it.each(ui)('%s ≥ 3.0:1', (_label, fg, bg) => {
    expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(3.0)
  })

  it.each([
    ['--paper', 3.0],
    ['--paper-raised', 3.0],
    ['--paper-sunken', 3.0],
  ] as const)(
    '--line-control composited over %s ≥ %s:1 (control boundaries, 16 §8.7)',
    (surface, min) => {
      const { rgb, alpha } = alphaToken('--line-control')
      const shown = composite(rgb, alpha, hexToRgb(token(surface)))
      expect(ratio(luminanceRgb(shown), luminance(token(surface)))).toBeGreaterThanOrEqual(min)
    },
  )

  it('placeholder text (ink at 70 %) reads at ≥ 4.5:1 on raised paper', () => {
    const shown = composite(hexToRgb(token('--ink')), 0.7, hexToRgb(token('--paper-raised')))
    expect(ratio(luminanceRgb(shown), luminance(token('--paper-raised')))).toBeGreaterThanOrEqual(
      4.5,
    )
  })

  it('white on amber stays forbidden as text', () => {
    expect(contrast(token('--paper-raised'), token('--amber'))).toBeLessThan(4.5)
  })

  it('matches the documented ratios within rounding', () => {
    expect(contrast(token('--ink'), token('--paper'))).toBeCloseTo(16.25, 0)
    expect(contrast(token('--primary'), token('--paper'))).toBeCloseTo(5.59, 1)
    expect(contrast(token('--amber'), token('--paper'))).toBeCloseTo(3.4, 1)
    expect(contrast(token('--ink'), token('--amber'))).toBeCloseTo(4.78, 1)
  })
})
