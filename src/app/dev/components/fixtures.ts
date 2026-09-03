// Fixture props for the component gallery (UI-060). Graph fixtures are added in Phase 10.
// Server-only: tokenRows() reads DESIGN.md at render time, so this module must never reach a client
// bundle (the interactive demos keep their own fixtures in demos.tsx).
import 'server-only'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import type { Institution } from '@/components/layout/institution-switcher'
import type { RailItem } from '@/components/layout/rail'

export const institutions: Institution[] = [
  { id: 'org-gw', name: 'George Washington University' },
  { id: 'org-gu', name: 'Georgetown University' },
]

export const user = { name: 'Marco Villanueva', email: 'marco@student.example.edu' }

export const rail: RailItem[] = [
  { href: '/home', label: 'Home', icon: 'home' },
  { href: '/runs' as RailItem['href'], label: 'Runs', icon: 'runs' },
  { href: '/courses' as RailItem['href'], label: 'Courses', icon: 'courses' },
  { href: '/review' as RailItem['href'], label: 'Review', icon: 'review' },
]

export const tokens: Array<{ name: string; use: string }> = [
  { name: 'paper', use: 'page ground' },
  { name: 'paper-raised', use: 'panels, dialogs, inputs' },
  { name: 'paper-sunken', use: 'input wells, timeline track' },
  { name: 'ink', use: 'primary text' },
  { name: 'ink-muted', use: 'secondary text' },
  { name: 'ink-faint', use: 'decorative strokes only' },
  { name: 'line', use: 'hairlines' },
  { name: 'line-strong', use: 'dashed sample borders' },
  { name: 'line-control', use: 'control boundaries' },
  { name: 'primary', use: 'actions, links, selection' },
  { name: 'primary-soft', use: 'selected row wash' },
  { name: 'amber', use: 'draft, provisional (border, icon, fill only)' },
  { name: 'amber-soft', use: 'draft chip wash' },
  { name: 'red', use: 'refusals, errors' },
  { name: 'red-soft', use: 'error wash' },
  { name: 'green', use: 'confirmed, matched' },
  { name: 'green-soft', use: 'confirmation wash' },
  { name: 'focus', use: 'focus ring' },
  { name: 'stance-accept', use: 'stance: accept' },
  { name: 'stance-verify', use: 'stance: verify' },
  { name: 'stance-challenge', use: 'stance: challenge' },
  { name: 'stance-reject', use: 'stance: reject' },
  { name: 'stance-escalate', use: 'stance: escalate' },
]

export type TokenRow = {
  name: string
  /** The value as DESIGN.md records it (`#F6F7F9`, or `rgb(20 26 38 / 0.55)` for alpha tokens). */
  value: string
  use: string
  /** WCAG 2.x ratio against --paper, formatted `16.25:1` (alpha tokens are composited over paper first); `—` when it cannot be measured. */
  contrast: string
}

const HEX = /^#[0-9a-fA-F]{6}$/
const NONE = '—'

// WCAG 2.x relative luminance and contrast: the same formula as tests/unit/design/contrast.test.ts,
// so the gallery shows the numbers the budget test enforces (16 §8.7).
const channel = (c: number): number => {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
const luminance = (hex: string): number => {
  const n = parseInt(hex.slice(1), 16)
  return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}
export const contrast = (fg: string, bg: string): number => {
  const a = luminance(fg)
  const b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

const ALPHA = /^rgb\((\d+) (\d+) (\d+) \/ ([0-9.]+)\)$/
/** Contrast against paper; alpha tokens are composited over paper first, as the budget test does. */
export const contrastLabel = (value: string, paper: string): string => {
  if (HEX.test(value)) return `${contrast(value, paper).toFixed(2)}:1`
  const m = ALPHA.exec(value)
  if (!m) return NONE
  const n = parseInt(paper.slice(1), 16)
  const bg = [n >> 16, (n >> 8) & 255, n & 255]
  const alpha = Number(m[4])
  const shown = [m[1], m[2], m[3]].map((c, i) =>
    Math.round(Number(c) * alpha + bg[i]! * (1 - alpha)),
  )
  const hex = `#${shown.map((c) => c.toString(16).padStart(2, '0')).join('')}`
  return `${contrast(hex, paper).toFixed(2)}:1 over paper`
}

/** The `colors` map from DESIGN.md's YAML frontmatter, read at render time so the table never drifts from the spec. */
function designColors(): Record<string, string> {
  const source = readFileSync(join(process.cwd(), 'DESIGN.md'), 'utf8')
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)?.[1]
  if (!frontmatter) throw new Error('DESIGN.md has no YAML frontmatter')
  const parsed: unknown = parse(frontmatter)
  const colors =
    parsed && typeof parsed === 'object' ? (parsed as { colors?: unknown }).colors : undefined
  if (!colors || typeof colors !== 'object') {
    throw new Error('DESIGN.md frontmatter has no colors map')
  }
  return Object.fromEntries(
    Object.entries(colors).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
}

/** Token rows for the gallery: DESIGN.md's value, the ratio against --paper, and the documented use. */
export function tokenRows(): TokenRow[] {
  const colors = designColors()
  const paper = colors['paper']
  const measurable = paper !== undefined && HEX.test(paper)
  return tokens.map(({ name, use }) => {
    const value = colors[name] ?? NONE
    return {
      name,
      value,
      use,
      contrast: measurable ? contrastLabel(value, paper) : NONE,
    }
  })
}

export const typeScale: Array<{ className: string; label: string; sample: string }> = [
  { className: 'font-serif text-h1', label: 'h1 · Serif 600 · 36/44', sample: 'Make the call.' },
  {
    className: 'font-serif text-h2',
    label: 'h2 · Serif 500 · 30/38',
    sample: 'Frame the decision',
  },
  { className: 'font-serif text-h3', label: 'h3 · Serif 500 · 24/32', sample: 'Evidence Room' },
  { className: 'font-serif text-h4', label: 'h4 · Serif 500 · 20/28', sample: 'Named fields' },
  {
    className: 'text-lead',
    label: 'lead · Sans 400 · 18/28',
    sample: 'The board meets on Friday and expects a recommendation.',
  },
  {
    className: 'text-reading',
    label: 'reading · Sans 400 · 16/26',
    sample:
      'Everything the student writes and reads at length sits at this size, with a 72ch measure.',
  },
  {
    className: 'text-body',
    label: 'body · Sans 400 · 14/22',
    sample: 'The default UI size for controls and panels.',
  },
  {
    className: 'text-meta font-medium',
    label: 'label · Sans 500 · 13/20',
    sample: 'Buttons, chips, table headers, metadata',
  },
  {
    className: 'font-mono text-mono',
    label: 'mono · Mono 400 · 14/20',
    sample: 'req 8f1c…e2a4 · 00:42:17 · 1,204 words',
  },
  {
    className: 'font-mono text-mono-sm',
    label: 'mono dense · Mono 400 · 12/18',
    sample: 'accept verify challenge reject escalate',
  },
]

/** The spacing scale (DESIGN.md §Layout): step → px. */
export const spacing: Array<{ step: number; px: number }> = [
  { step: 1, px: 4 },
  { step: 2, px: 8 },
  { step: 3, px: 12 },
  { step: 4, px: 16 },
  { step: 5, px: 24 },
  { step: 6, px: 32 },
  { step: 7, px: 48 },
  { step: 8, px: 64 },
]

export const runs = [
  {
    id: 'run-1',
    scenario: 'Meridian Foods pricing',
    variant: 'defective',
    state: 'working',
    clock: '00:38:10',
  },
  {
    id: 'run-2',
    scenario: 'Meridian Foods pricing',
    variant: 'sound',
    state: 'decision_locked',
    clock: '00:00:00',
  },
  {
    id: 'run-3',
    scenario: 'Northwind logistics',
    variant: 'defective',
    state: 'scored',
    clock: '—',
  },
]
