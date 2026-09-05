// Step 7.3 — the reply assembler (docs/tech/11-llm-integration.md §3; FR-051, FR-052, FR-056).
//
// `assembleReply` is the seam between what a provider said and what a student is handed: it cuts the
// reply into segments, checks the markers, guards the numbers, filters the prose, and decides what
// the delegation is flagged. Three of its four branches are unreachable on the mock, which always
// marks each claim exactly once and never emits a digit it was not given — so this is where the
// branches that exist for a *real* provider are exercised.
//
// It is a unit test because every input is a string: the assembler touches no database, no run and
// no permission, and driving it through a delegation would prove the mock's behaviour rather than
// the assembler's.
import { describe, expect, it } from 'vitest'
import {
  DELEGATION_NO_COMMENTARY_FLAG,
  DELEGATION_REBUILT_FLAG,
  assembleReply,
} from '@/server/modules/assistant'
import { allowedNumbers } from '@/server/llm/guardrails/numeric-guard'

const CLAIMS = [
  { id: 'c-payback', key: 'C3', text: 'Premium payback is about 11 months.' },
  {
    id: 'c-retention',
    key: 'C2',
    text: 'Month-three retention on the premium pilot is 78 percent.',
  },
]

const marker = (id: string): string => `[[claim:${id}]]`

const allowed = (request: string, claims = CLAIMS) =>
  allowedNumbers([...claims.map((claim) => claim.text), request])

describe('assembleReply', () => {
  it('leaves a well-formed reply alone', () => {
    const reply = [
      'The room speaks to that directly.',
      `${marker('c-payback')} ${CLAIMS[0]!.text}`,
      'You can open the underlying document before you rely on it.',
    ].join('\n\n')

    const built = assembleReply(reply, [CLAIMS[0]!], allowed('payback'))

    expect(built.flags).toEqual([])
    expect(built.unverified).toEqual([])
    expect(built.responseText).toBe(reply)
    expect(built.segments.filter((segment) => segment.type === 'claim')).toHaveLength(1)
  })

  it('rebuilds a reply that marked a claim it was given (11 §3)', () => {
    // The model wrote about both claims and marked one: the unmarked claim would reach the student
    // as a sentence they cannot stance, which is the failure the rebuild exists for.
    const reply = `Here is the payback. ${marker('c-payback')} ${CLAIMS[0]!.text} Retention is strong too.`

    const built = assembleReply(reply, CLAIMS, allowed('payback retention'))

    expect(built.flags).toContain(DELEGATION_REBUILT_FLAG)
    const claims = built.segments.filter((segment) => segment.type === 'claim')
    expect(claims.map((segment) => segment.claimId)).toEqual(['c-payback', 'c-retention'])
    // Claims first, the model's prose after (11 §3), and every claim text intact.
    for (const claim of CLAIMS) expect(built.responseText).toContain(claim.text)
    expect(built.responseText.indexOf(CLAIMS[1]!.text)).toBeLessThan(
      built.responseText.indexOf('Here is the payback.'),
    )
  })

  it('rebuilds a reply that marked the same claim twice', () => {
    const reply = `${marker('c-payback')} ${CLAIMS[0]!.text} And again: ${marker('c-payback')} ${CLAIMS[0]!.text}`
    const built = assembleReply(reply, [CLAIMS[0]!], allowed('payback'))

    expect(built.flags).toContain(DELEGATION_REBUILT_FLAG)
    expect(built.segments.filter((segment) => segment.type === 'claim')).toHaveLength(1)
  })

  it('adds the content-policy sentence when the provider returned nothing (11 §3)', () => {
    const built = assembleReply('', [], allowed('anything'))

    expect(built.flags).toEqual([DELEGATION_NO_COMMENTARY_FLAG])
    expect(built.responseText).toBe('The assistant could not add commentary on this request.')
    // The sentence says what happened and nothing about the request: an apology that characterised
    // what was asked would be the assistant commenting on it (FR-056).
    expect(built.responseText).not.toMatch(/\d/)
  })

  it('keeps the claims and adds the sentence when the reply was markers only', () => {
    const reply = `${marker('c-payback')} ${CLAIMS[0]!.text}`
    const built = assembleReply(reply, [CLAIMS[0]!], allowed('payback'))

    expect(built.flags).toEqual([DELEGATION_NO_COMMENTARY_FLAG])
    expect(built.responseText).toContain(CLAIMS[0]!.text)
    expect(built.responseText).toContain('could not add commentary')
  })

  it('flags a number the assistant was never given, and leaves the claim’s own alone (D-068)', () => {
    const reply = [
      'The payback lands inside the year, and churn is running at 4 percent.',
      `${marker('c-payback')} ${CLAIMS[0]!.text}`,
    ].join('\n\n')

    const built = assembleReply(reply, [CLAIMS[0]!], allowed('what is the payback'))

    expect(built.unverified.map((number) => number.value)).toEqual(['4'])
    // The claim's own 11 is in the claim segment, which no guard reads (D-264).
    expect(built.responseText).toContain(CLAIMS[0]!.text)
  })

  /**
   * D-281: the mark reaches the student because it is in the reply, not beside it.
   *
   * `responseText` is what `run_delegations.response_text` stores, what the `delegation` event
   * carries, and what the Delegation Log and the replay render — so a mark that survives into it is
   * a mark the student saw and a faculty seat can see them having seen. The claim's own figure is
   * the control: it is sourced, it is authored, and nothing is drawn round it.
   */
  it('carries the mark into the stored reply, and marks no figure the claim sourced (D-281)', () => {
    const reply = [
      'Premium payback is about 11 months, and churn is running at 4 percent.',
      `${marker('c-payback')} ${CLAIMS[0]!.text}`,
    ].join('\n\n')

    const built = assembleReply(reply, [CLAIMS[0]!], allowed('what is the payback'))

    expect(built.responseText).toContain('[[figure:4]]')
    // The 11 is in the claim's text and in the prose that introduces it. Neither is marked: one is
    // authored and unread by any guard, the other is a figure the room sources.
    expect(built.responseText).not.toContain('[[figure:11]]')
    expect(built.responseText).toContain('Premium payback is about 11 months')
    expect(built.responseText).toContain(CLAIMS[0]!.text)
    expect(built.unverified.map((number) => number.value)).toEqual(['4'])
  })

  /**
   * FR-052's membership test names three sources, and the student's own request is one of them.
   *
   * A student who types a figure into the box and gets it read back has been told nothing new, so
   * marking it would put a provenance mark on the student's own words — the room does source it,
   * and the source is them.
   */
  it('marks no figure the student themselves put in the request (FR-052)', () => {
    const request = 'If the tooling budget were 240,000 dollars, what would the payback be?'
    const reply = `On a budget of 240,000 the payback still turns on this. ${marker('c-payback')} ${CLAIMS[0]!.text}`

    const built = assembleReply(reply, [CLAIMS[0]!], allowed(request))

    expect(built.unverified).toEqual([])
    expect(built.responseText).not.toContain('[[figure:')
    expect(built.responseText).toContain('On a budget of 240,000')
  })

  it('redacts the answer key’s vocabulary from the model’s prose and flags it (FR-056)', () => {
    const reply = [
      'That one is a planted claim and its evidence status is defective.',
      `${marker('c-payback')} ${CLAIMS[0]!.text}`,
    ].join('\n\n')

    const built = assembleReply(reply, [CLAIMS[0]!], allowed('payback'))

    expect(built.flags).toContain('filtered')
    expect(built.responseText).not.toMatch(/planted|defective|evidence status/i)
    expect(built.responseText).toContain('[…]')
    // The claim the student stances is the author's, untouched (D-264).
    expect(built.responseText).toContain(CLAIMS[0]!.text)
  })
})
