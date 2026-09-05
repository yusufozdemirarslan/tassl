// Step 7.1 — the numeric guard (docs/tech/11-llm-integration.md §3, D-068, FR-052, AI-002).
//
// The rule the product depends on: the assistant may quote a figure it was given and may not invent
// one. So the two halves of this file are "the same number spelled differently is the same number"
// — otherwise the guard would flag every legitimate quotation and the marker would mean nothing —
// and "a number from nowhere is reported and marked, and in block mode taken out as well".
//
// D-281 is why the marking half matters here rather than only in the panel: both modes now rewrite
// the prose, so the mark is in `response_text` and the student, the Delegation Log and the replay
// read one reply. The cases that keep it honest are the two that assert nothing is marked — a
// figure the room sources, and any figure inside a claim segment.
import { describe, expect, it } from 'vitest'
import { env } from '@/server/config'
import {
  allowedNumbers,
  figureMarker,
  normalizeNumber,
  numbersIn,
  numericGuard,
} from '@/server/llm/guardrails/numeric-guard'
import type { GuardSegment } from '@/server/llm/guardrails/segments'

const text = (value: string): GuardSegment => ({ type: 'text', text: value })

describe('normalizeNumber', () => {
  it('reads the same value out of every spelling of it', () => {
    for (const spelling of ['1200', '1,200', '1200.00', '01200', '1,200.0']) {
      expect(normalizeNumber(spelling)).toBe('1200')
    }
    expect(normalizeNumber('19.40')).toBe('19.4')
    expect(normalizeNumber('0.50')).toBe('0.5')
    expect(normalizeNumber('00')).toBe('0')
  })
})

describe('numbersIn', () => {
  it('keeps a grouped number whole rather than splitting it on the comma', () => {
    expect(numbersIn('The board set aside 500,000 dollars')).toEqual(['500000'])
  })

  it('strips the percent sign and the currency symbol, which are not part of the number', () => {
    expect(numbersIn('$310 at 78% of 1,200.50')).toEqual(['310', '78', '1200.5'])
  })

  it('reads each field of a date, so a dated source allows the date it carries', () => {
    expect(numbersIn('dated 2026-08-04')).toEqual(['2026', '8', '4'])
  })
})

describe('numericGuard', () => {
  const allowed = allowedNumbers([
    'Premium payback is about 11 months on a contribution of $28.20.',
    'The board set aside 500,000 dollars.',
    'Month-three retention is 78%.',
  ])

  it('passes a number the source carries, however either side spells it', () => {
    const result = numericGuard(
      [
        text(
          'The payback is 11 months, the contribution 28.20 dollars, the budget 500000 dollars.',
        ),
      ],
      allowed,
      'flag',
    )
    expect(result.unverified).toEqual([])
    expect(result.segments).toEqual([
      text('The payback is 11 months, the contribution 28.20 dollars, the budget 500000 dollars.'),
    ])
  })

  /**
   * The test the whole marker rests on (D-281): a sourced figure is not marked.
   *
   * A marked figure is a statement about provenance, and it is only ever *about* provenance while
   * the room's own numbers come out of here untouched. Every spelling a source's number can take —
   * grouped, percent, currency, and a claim's carried value the text rounded — is here, because a
   * guard that marked any of them would be marking the assistant for quoting the package, and a
   * student would learn to distrust the quotations rather than the inventions.
   */
  it('marks nothing when the room sources the figure, in any spelling of it', () => {
    const result = numericGuard(
      [text('That is 78 percent of subscribers and $500,000 of budget.')],
      allowed,
      'flag',
    )
    expect(result.unverified).toEqual([])
    expect(result.segments).toEqual([
      text('That is 78 percent of subscribers and $500,000 of budget.'),
    ])
    const sourced = result.segments[0]
    expect(sourced?.type === 'text' && sourced.text.includes('[[figure:')).toBe(false)
  })

  it('marks a number the sources do not support in place, and reports the sentence around it', () => {
    const result = numericGuard(
      [text('Blending the cohorts gives a payback of 14 months.')],
      allowed,
      'flag',
    )
    expect(result.unverified).toHaveLength(1)
    expect(result.unverified[0]?.value).toBe('14')
    // The reviewer's context is the sentence as it was written, without the marker in it.
    expect(result.unverified[0]?.context).toContain('payback of 14 months')
    // flag mode keeps the figure the model wrote, spelling and all, inside the marker (D-281).
    expect(result.segments[0]).toEqual(
      text(`Blending the cohorts gives a payback of ${figureMarker('14')} months.`),
    )
  })

  it('keeps a grouped figure’s own spelling inside the marker', () => {
    const result = numericGuard([text('That is 1,240 subscribers.')], allowed, 'flag')
    expect(result.segments[0]).toEqual(text(`That is ${figureMarker('1,240')} subscribers.`))
    expect(result.unverified.map((n) => n.value)).toEqual(['1240'])
  })

  it('takes the whole literal out in block mode, leaving the mark, and reports it too', () => {
    const result = numericGuard(
      [text('A payback of 14.5 months and 78 percent retention.')],
      allowed,
      'block',
    )
    expect(result.segments[0]).toEqual(
      text(`A payback of ${figureMarker('')} months and 78 percent retention.`),
    )
    expect(result.unverified.map((n) => n.value)).toEqual(['14.5'])
    // The digits are gone: block mode withholds the figure, it does not merely annotate it.
    const guarded = result.segments[0]
    expect(guarded?.type === 'text' && guarded.text.includes('14.5')).toBe(false)
  })

  it('replaces every offender in one segment without disturbing the offsets of the others', () => {
    const result = numericGuard([text('It is 14 or 15 or maybe 16.')], allowed, 'block')
    const withheld = figureMarker('')
    expect(result.segments[0]).toEqual(
      text(`It is ${withheld} or ${withheld} or maybe ${withheld}.`),
    )
    expect(result.unverified.map((n) => n.value)).toEqual(['14', '15', '16'])
  })

  it('marks each offender in one segment in flag mode, each with its own figure', () => {
    const result = numericGuard([text('It is 14 or 15 or maybe 16.')], allowed, 'flag')
    expect(result.segments[0]).toEqual(
      text(`It is ${figureMarker('14')} or ${figureMarker('15')} or maybe ${figureMarker('16')}.`),
    )
  })

  /**
   * A marker in a stored reply is always the guard's own (D-281).
   *
   * `[[figure:` is four characters a provider can write — quoting a document, echoing a reply it was
   * shown — and a marker that arrived with the model would hand a student a mark nothing checked.
   * It is unwrapped to its contents, which are then guarded like any other prose: an unsourced
   * number comes back marked, and a sourced one comes back plain.
   */
  it('unwraps a marker the model wrote itself and guards what was inside it', () => {
    const result = numericGuard(
      [text('It is [[figure:14]] months, on [[figure:78]] percent retention.')],
      allowed,
      'flag',
    )
    expect(result.segments[0]).toEqual(
      text(`It is ${figureMarker('14')} months, on 78 percent retention.`),
    )
    expect(result.unverified.map((n) => n.value)).toEqual(['14'])
  })

  it('never checks or rewrites a claim segment: authored text is the one thing it may quote', () => {
    // The claim segment carries the author's own text, figures and all, and no number in it is in
    // the allowed set. Nothing about it may be flagged or withheld — the author sourced it.
    const segments: GuardSegment[] = [
      {
        type: 'claim',
        claimId: '11111111-1111-4111-8111-111111111111',
        text: 'Premium payback is about 11 months, on 1,240 subscribers.',
      },
      text('and that is the figure.'),
    ]
    const result = numericGuard(segments, new Set<string>(), 'block')
    expect(result.segments).toEqual(segments)
    expect(result.unverified).toEqual([])
    // And so a marker can never land inside the package's own words (D-264, D-281): the guard is
    // not asked to be careful with authored text, it is never given it.
    expect(JSON.stringify(result.segments)).not.toContain('[[figure:')
  })

  it('takes the carried value of a claim as allowed, whatever the claim text rounded it to', () => {
    const withValues = allowedNumbers(['Premium payback is about 16 months.'], [15.98, 19.4])
    const result = numericGuard([text('15.98 divided into 19.40.')], withValues, 'flag')
    expect(result.unverified).toEqual([])
  })

  it('defaults to the mode the environment names', () => {
    const result = numericGuard([text('a payback of 14 months')], allowed)
    expect(result.mode).toBe(env.ASSISTANT_NUMERIC_GUARD)
    expect(result.mode).toBe('flag')
  })
})
