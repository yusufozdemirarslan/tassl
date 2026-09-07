import { describe, expect, it } from 'vitest'
import { record } from '@/lib/i18n/messages/record'
import { scan, VOCABULARIES } from '../support/product-voice'

// D-468: the Judgment Record is held to the same three vocabularies as the debrief and the replay.
//
// The debrief teaches and the replay decides; the record is the thing the student keeps. It is the
// document that leaves Tassl, the one a person may still be reading a year later, and the last place
// a word about the person rather than the work belongs. Two of the three rules are not about who is
// reading at all — **nothing Tassl observes is treated as a question of conduct** and **Tassl
// describes what happened, never who the person is** are PRD §7 standing rules about the product —
// and the third, FR-131's "no composite, no rank, no percentile", is exactly what a permanent record
// would be most tempting to summarise into.
//
// The scan runs with no allowlist, and the copy was written to meet it. Two words the screen needs
// and does not own are the band names and the four graph titles, which live in the `band.` and
// `graph.` namespaces and are not written twice.

describe('the record catalogue keeps the product voice', () => {
  it('holds enough of the screen for the scan to mean something', () => {
    // A scan of an empty namespace passes; this is what stops that from being the reason.
    expect(Object.keys(record).length).toBeGreaterThan(25)
    for (const key of Object.keys(record)) expect(key.startsWith('record.')).toBe(true)
  })

  it('uses no word of the three forbidden vocabularies', () => {
    expect(scan(record as unknown as Record<string, string>)).toEqual([])
  })

  it('is scanned against all three lists, not a subset of them', () => {
    expect(VOCABULARIES.map((vocabulary) => vocabulary.name)).toEqual([
      'misconduct',
      'character and motive',
      'ranking and comparison',
    ])
  })
})

describe('the scan can still fail on this namespace', () => {
  it.each([
    ['misconduct', 'The student was caught using an outside tool.'],
    ['character and motive', 'This run was careless and the student failed to check the figure.'],
    ['ranking and comparison', 'This record is above the cohort average for the section.'],
  ])('finds a planted %s sentence', (rule, planted) => {
    const findings = scan({
      ...(record as unknown as Record<string, string>),
      'record.planted': planted,
    })
    expect(findings.map((finding) => finding.rule)).toContain(rule)
    expect(findings.every((finding) => finding.path === 'record.planted')).toBe(true)
  })
})
