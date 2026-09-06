// Rubric v1 against PRD Appendix A (FR-142, DATA-053, D-033).
//
// The one property this file defends is that `rubric/v1.ts` and Appendix A are the same document.
// It is worth a test rather than a code review because the failure is silent: a descriptor tightened
// on the way into TypeScript, or an apostrophe normalised by an editor, leaves a rubric that reads
// fine, scores runs, and no longer matches the standard the PRD publishes and a student may appeal
// against. So the assertions re-read `docs/prd/Tassl-PRD.md` on every run and compare character for
// character, in both directions — a sentence in the code that is not in the PRD fails too.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BANDS,
  BOUNDARIES,
  CURRENT_RUBRIC,
  DIMENSIONS,
  RUBRICS,
  bandRank,
  currentRubric,
  higherBand,
  lowerBand,
  rubricFor,
  v1,
} from '@/server/modules/scoring/rubric'

// ---------------------------------------------------------------------------------------------
// Appendix A, read straight out of the PRD
// ---------------------------------------------------------------------------------------------

type Section = {
  title: string
  descriptors: Record<string, string>
  fixedModifiers: string | undefined
  boundaries: string[]
}

/** The seven `### A.n` sections of Appendix A, split into the three things D-033 transcribes. */
function readAppendixA(): Record<string, Section> {
  const md = readFileSync(join(process.cwd(), 'docs', 'prd', 'Tassl-PRD.md'), 'utf8').split('\n')
  const start = md.findIndex((line) => line.startsWith('## Appendix A:'))
  expect(start).toBeGreaterThan(0)

  const sections: Record<string, Section> = {}
  let current: string | null = null
  const bandNames = ['Novice', 'Developing', 'Proficient', 'Professional']
  for (const line of md.slice(start)) {
    const heading = /^### (A\.\d) (.+)$/.exec(line)
    if (heading?.[1] !== undefined && heading[2] !== undefined) {
      current = heading[1]
      sections[current] = {
        title: heading[2],
        descriptors: {},
        fixedModifiers: undefined,
        boundaries: [],
      }
      continue
    }
    if (current === null) continue
    const section = sections[current]
    if (section === undefined) continue
    if (line.startsWith('| ')) {
      const cells = line.split(' | ')
      const band = (cells[0] ?? '').replace(/^\| /, '').trim()
      if (bandNames.includes(band) && cells[1] !== undefined) {
        section.descriptors[band.toLowerCase()] = cells[1].trim()
      }
    }
    if (line.startsWith('Fixed modifiers.')) section.fixedModifiers = line
    if (line.startsWith('- [EDIT] ')) section.boundaries.push(line.slice(2))
  }
  return sections
}

const appendix = readAppendixA()

/** Appendix A.n to the dimension it heads, in the PRD's own order. */
const SECTION_OF: Record<string, (typeof DIMENSIONS)[number]> = {
  'A.1': 'framing',
  'A.2': 'delegation',
  'A.3': 'verification',
  'A.4': 'calibration',
  'A.5': 'decision_quality',
  'A.6': 'adaptation',
  'A.7': 'ownership',
}

// ---------------------------------------------------------------------------------------------
// The transcription
// ---------------------------------------------------------------------------------------------

describe('rubric v1 is Appendix A, character for character (D-033, FR-142)', () => {
  it('reads all seven sections out of the PRD, so a failure below is drift and not a bad parse', () => {
    // A.0 (how to read the appendix) and A.8 (what the PRD does not fix) carry no descriptors and
    // are not transcribed; the seven dimension sections between them are.
    expect(Object.keys(appendix)).toStrictEqual(['A.0', ...Object.keys(SECTION_OF), 'A.8'])
    for (const key of Object.keys(SECTION_OF)) {
      const section = appendix[key]
      expect(Object.keys(section?.descriptors ?? {}).sort(), key).toStrictEqual([
        'developing',
        'novice',
        'professional',
        'proficient',
      ])
      expect(section?.boundaries.length, key).toBe(3)
      expect(section?.fixedModifiers, key).toBeDefined()
    }
  })

  it.each(Object.entries(SECTION_OF))('%s: the four descriptors match', (key, dimension) => {
    const section = appendix[key]
    for (const band of BANDS) {
      expect(v1.dimensions[dimension].descriptors[band], `${key} ${band}`).toBe(
        section?.descriptors[band],
      )
    }
  })

  it.each(Object.entries(SECTION_OF))('%s: the fixed modifiers match', (key, dimension) => {
    expect(v1.dimensions[dimension].fixedModifiers).toBe(appendix[key]?.fixedModifiers)
  })

  it.each(Object.entries(SECTION_OF))(
    '%s: the three [EDIT] boundary sentences match, in order',
    (key, dimension) => {
      const boundaries = BOUNDARIES.map((name) => v1.dimensions[dimension].boundaries[name])
      expect(boundaries).toStrictEqual(appendix[key]?.boundaries)
    },
  )

  it('carries exactly twenty-one boundary sentences, every one of them labelled [EDIT]', () => {
    const sentences = DIMENSIONS.flatMap((dimension) =>
      BOUNDARIES.map((name) => v1.dimensions[dimension].boundaries[name]),
    )
    expect(sentences).toHaveLength(21)
    expect(new Set(sentences).size).toBe(21)
    for (const sentence of sentences) expect(sentence.startsWith('[EDIT] ')).toBe(true)
  })

  it('names its source and says it is uncalibrated (A.0, FR-141)', () => {
    expect(v1.version).toBe('v1')
    expect(v1.source).toContain('Appendix A')
    expect(v1.uncalibrated).toBe(true)
  })
})

// ---------------------------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------------------------

describe('the registry (D-033)', () => {
  it('resolves the current version and every version it holds', () => {
    expect(CURRENT_RUBRIC).toBe('v1')
    expect(currentRubric()).toBe(v1)
    expect(rubricFor('v1')).toBe(v1)
    expect(Object.keys(RUBRICS)).toStrictEqual(['v1'])
  })

  it('refuses a version it does not carry rather than substituting the current one', () => {
    expect(() => rubricFor('v2')).toThrowError(
      expect.objectContaining({ code: 'RUBRIC_VERSION_UNKNOWN' }),
    )
  })
})

// ---------------------------------------------------------------------------------------------
// The band ladder — the whole of FR-005's arithmetic
// ---------------------------------------------------------------------------------------------

describe('the band ladder', () => {
  it('ranks the four bands ascending', () => {
    expect(BANDS.map(bandRank)).toStrictEqual([0, 1, 2, 3])
  })

  it('keeps the higher band, and keeps the one it had when the other is unassessed (FR-005)', () => {
    expect(higherBand('developing', 'proficient')).toBe('proficient')
    expect(higherBand('proficient', 'developing')).toBe('proficient')
    expect(higherBand('proficient', 'proficient')).toBe('proficient')
    expect(higherBand('proficient', null)).toBe('proficient')
    expect(higherBand(null, 'novice')).toBe('novice')
    expect(higherBand(null, null)).toBeNull()
  })

  it('takes the lower band for a cap, and unassessed caps to unassessed', () => {
    expect(lowerBand('professional', 'developing')).toBe('developing')
    expect(lowerBand('novice', 'developing')).toBe('novice')
    expect(lowerBand(null, 'developing')).toBeNull()
  })
})
