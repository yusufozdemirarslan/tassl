// Step 7.1 — the numeric guard (docs/tech/11-llm-integration.md §3, D-068, FR-052, AI-002).
//
// The rule the product depends on: the assistant may quote a figure it was given and may not invent
// one. So the two halves of this file are "the same number spelled differently is the same number"
// — otherwise the guard would flag every legitimate quotation and the marker would mean nothing —
// and "a number from nowhere is reported, and in block mode withheld".
import { describe, expect, it } from 'vitest'
import { env } from '@/server/config'
import {
  WITHHELD,
  allowedNumbers,
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

  it('passes a grouped, percent or currency spelling of an allowed number', () => {
    const result = numericGuard(
      [text('That is 78 percent of subscribers and $500,000 of budget.')],
      allowed,
      'flag',
    )
    expect(result.unverified).toEqual([])
  })

  it('flags a number the sources do not support, with the sentence around it', () => {
    const result = numericGuard(
      [text('Blending the cohorts gives a payback of 14 months.')],
      allowed,
      'flag',
    )
    expect(result.unverified).toHaveLength(1)
    expect(result.unverified[0]?.value).toBe('14')
    expect(result.unverified[0]?.context).toContain('payback of 14 months')
    // flag mode leaves the text exactly as the model wrote it (D-068).
    expect(result.segments[0]).toEqual(text('Blending the cohorts gives a payback of 14 months.'))
  })

  it('replaces the whole literal in block mode, and reports it too', () => {
    const result = numericGuard(
      [text('A payback of 14.5 months and 78 percent retention.')],
      allowed,
      'block',
    )
    expect(result.segments[0]).toEqual(
      text(`A payback of ${WITHHELD} months and 78 percent retention.`),
    )
    expect(result.unverified.map((n) => n.value)).toEqual(['14.5'])
  })

  it('replaces every offender in one segment without disturbing the offsets of the others', () => {
    const result = numericGuard([text('It is 14 or 15 or maybe 16.')], allowed, 'block')
    expect(result.segments[0]).toEqual(
      text(`It is ${WITHHELD} or ${WITHHELD} or maybe ${WITHHELD}.`),
    )
    expect(result.unverified.map((n) => n.value)).toEqual(['14', '15', '16'])
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
