// Step 7.2 — the defect-word filter (docs/tech/11-llm-integration.md §3, FR-056, D-067).
//
// The invariant this defends is the one the whole run rests on: the assistant is useful, it is not
// uniformly reliable, and it never says which is which. It is never told a claim's evidence status,
// so it has no verdict to leak — but a model can still produce the *words* of one, out of an
// injected instruction, out of a student's own phrasing echoed back, or out of nothing. §3 says what
// happens then: replace the match with `[…]`, flag the delegation `filtered`. Not log and ship.
//
// The second thing this file pins is the cost of the filter. A guardrail that mangled ordinary
// analysis would make the assistant look broken, and a student who routes around the assistant is
// not being measured on delegation any more — so the ordinary sentences below have to survive it.
import { describe, expect, it } from 'vitest'
import {
  DEFECT_REDACTION,
  DELEGATION_FILTERED_FLAG,
  containsDefectWord,
  defectWordFilter,
  defectWordsIn,
} from '@/server/llm/guardrails/defect-words'
import { renderSegments, segmentReply, type GuardSegment } from '@/server/llm/guardrails/segments'
import { claimMarker } from '@/server/llm/prompts/assistant-reply'

const filterText = (text: string): string => {
  const [segment] = defectWordFilter([{ type: 'text', text }]).segments
  return segment?.type === 'text' ? segment.text : ''
}

describe('the words §3 names', () => {
  it.each([
    ['That claim is defective.', `That claim is ${DEFECT_REDACTION}.`],
    ['One of these was planted.', `One of these was ${DEFECT_REDACTION}.`],
    ['This is a sound claim.', `This is a ${DEFECT_REDACTION}.`],
    ['The second claim is sound.', `The second ${DEFECT_REDACTION}.`],
    ['Its evidence status is unknown to me.', `Its ${DEFECT_REDACTION} is unknown to me.`],
    ['The failure family here is obvious.', `The ${DEFECT_REDACTION} here is obvious.`],
    ['The warranted stance is verify.', `The ${DEFECT_REDACTION} is verify.`],
  ])('replaces %j', (input, expected) => {
    expect(filterText(input)).toBe(expected)
  })

  it('is case-insensitive and reads a slug or a hyphen as the same phrase', () => {
    expect(filterText('DEFECTIVE, stale_evidence, near-neighbour')).toBe(
      [DEFECT_REDACTION, DEFECT_REDACTION, DEFECT_REDACTION].join(', '),
    )
  })

  it('replaces several matches in one sentence, leaving the rest intact', () => {
    expect(filterText('That claim is defective and its failure family is stale evidence.')).toBe(
      `That claim is ${DEFECT_REDACTION} and its ${DEFECT_REDACTION} is ${DEFECT_REDACTION}.`,
    )
  })
})

describe('band names', () => {
  it('replaces the two that have no other use in a business scenario', () => {
    expect(filterText('Your run reads novice.')).toBe(`Your run reads ${DEFECT_REDACTION}.`)
    expect(filterText('That would be proficient.')).toBe(`That would be ${DEFECT_REDACTION}.`)
  })

  it('replaces the two ordinary words when a scoring word stands beside them', () => {
    expect(filterText('You would place at professional on framing.')).toBe(
      `You would place at ${DEFECT_REDACTION} on framing.`,
    )
    expect(filterText('That answer scores as developing.')).toBe(
      `That answer scores as ${DEFECT_REDACTION}.`,
    )
    expect(filterText('The band for this would be professional.')).toBe(
      `The band for this would be ${DEFECT_REDACTION}.`,
    )
  })

  it('leaves them alone in an ordinary sentence, so the assistant still reads as itself', () => {
    const ordinary = 'Meridian is a professional roastery in a developing market.'
    expect(filterText(ordinary)).toBe(ordinary)
  })
})

// D-427. §3's threat model is an *injected instruction* the model half-obeys, so the interesting
// spellings are the ones that read as the word on the screen and are not the string on the list.
describe('the spellings an evasion arrives in', () => {
  it.each([
    ['a Cyrillic е', 'That claim is dеfective.'],
    ['a zero-width space', 'That claim is defe​ctive.'],
    ['a zero-width non-joiner', 'That claim is de‌fective.'],
    ['a soft hyphen', 'That claim is de­fective.'],
    ['a hyphen', 'That claim is de-fective.'],
    ['full stops between every letter', 'That claim is d.e.f.e.c.t.i.v.e.'],
    ['fullwidth letters', 'That claim is ｄefective.'],
    ['a combining acute', 'That claim is défective.'],
  ])('catches %s', (_name, sentence) => {
    expect(containsDefectWord(sentence)).toBe(true)
    expect(filterText(sentence)).toContain(DEFECT_REDACTION)
    expect(filterText(sentence).toLowerCase()).not.toContain('fective')
  })

  it('catches a multi-word term broken the same way', () => {
    expect(containsDefectWord('Its evidence​status is unknown.')).toBe(true)
    expect(containsDefectWord('Its evidence-status is unknown.')).toBe(true)
    expect(containsDefectWord('The failure­family here is obvious.')).toBe(true)
  })

  it('redacts the invisible characters with the word, not around them', () => {
    // The replacement has to consume what the normalisation stepped over, or the zero-width space
    // is left sitting beside `[…]` and the next reader of the stored text finds a stray character.
    expect(filterText('That claim is defe​ctive.')).toBe(`That claim is ${DEFECT_REDACTION}.`)
    expect(filterText('That claim is de-fective.')).toBe(`That claim is ${DEFECT_REDACTION}.`)
  })

  it('does not treat an ordinary space inside a word as noise, and says why', () => {
    // Deliberate (D-427). Tolerating a space would catch `de fective` and would also catch every
    // sentence below, because `planted` with a space is `plan ted` and `novice` is `no vice`.
    expect(containsDefectWord('That claim is de fective.')).toBe(false)
    for (const ordinary of [
      'The plan Ted proposed keeps the spend where it is.',
      'There is no vice in taking the slower route.',
      'The sound claimed by the room is not the sound in the memo.',
    ]) {
      expect(filterText(ordinary)).toBe(ordinary)
    }
  })
})

describe('what the filter must not eat', () => {
  it.each([
    'That is an extrapolation from two cohorts, and the evidence is a little stale.',
    'The February 2025 deck is eighteen months old; the memo replaces its figure.',
    'The premium tier sounds better on retention than on payback.',
    'Two of the documents disagree about the contribution line.',
    'The value tier is saturated in three metros, which is the founder’s premise.',
  ])('leaves ordinary analysis alone: %j', (sentence) => {
    expect(filterText(sentence)).toBe(sentence)
    expect(containsDefectWord(sentence)).toBe(false)
  })
})

describe('what the filter returns', () => {
  it('reports nothing and changes nothing when the reply is clean', () => {
    const segments: GuardSegment[] = [
      { type: 'text', text: 'Here is what the room says. ' },
      { type: 'claim', claimId: 'C3', text: 'Premium payback is about 11 months.' },
      { type: 'text', text: '\n\nThe sources are in the Evidence Room.' },
    ]
    const result = defectWordFilter(segments)
    expect(result.filtered).toBe(false)
    expect(result.matches).toEqual([])
    expect(result.segments).toEqual(segments)
  })

  it('flags the delegation and names every match with its context', () => {
    const result = defectWordFilter([
      { type: 'text', text: 'The third one is defective; the rest are sound claims.' },
    ])
    expect(result.filtered).toBe(true)
    expect(result.matches.map((match) => match.term)).toEqual(['defective', 'sound claims'])
    expect(result.matches[0]?.context).toContain('The third one is')
    expect(DELEGATION_FILTERED_FLAG).toBe('filtered')
  })

  it('answers the predicate the evals and the leak tests ask', () => {
    expect(containsDefectWord('Which one is planted?')).toBe(true)
    expect(containsDefectWord('Which document is newer?')).toBe(false)
    expect(defectWordsIn('novice and defective').map((match) => match.term)).toEqual([
      'novice',
      'defective',
    ])
  })
})

// FR-186: a package can be imported from another institution, and these are the sentences an
// ordinary business scenario contains. The filter exists to stop the model naming a claim's
// evidence status, not to censor the package — so a claim segment is not read at all, and the
// author's word survives whether or not it is on the list.
describe('a claim’s authored text is carried through, whatever words the author used', () => {
  const AUTHORED = [
    { id: 'C1', text: 'The defect rate on the narrow-web line fell to 2.1 percent in June.' },
    { id: 'C2', text: 'Professional services revenue is rated stable through the fiscal year.' },
    {
      id: 'C3',
      text: 'Inventory levels in the developing markets are graded at four weeks of cover.',
    },
    { id: 'C4', text: 'Two cohorts were dropped as unsound and the sample is now 180 responses.' },
  ]

  it.each(AUTHORED)('leaves $id alone as a claim segment', (claim) => {
    const result = defectWordFilter([{ type: 'claim', claimId: claim.id, text: claim.text }])
    expect(result.segments).toEqual([{ type: 'claim', claimId: claim.id, text: claim.text }])
    expect(result.matches).toEqual([])
    expect(result.filtered).toBe(false)
  })

  it('survives the whole path a reply takes: segment, filter, render', () => {
    // The shape `assistant-reply@1` fixes and the mock emits: a connective sentence, the marker,
    // then the claim text. Before the claim segment carried its text, every one of these landed in
    // a text segment and came back redacted, with the delegation wrongly flagged `filtered`.
    const reply = AUTHORED.map(
      (claim) =>
        `Here is what the room already says on that. ${claimMarker(claim.id)} ${claim.text}`,
    ).join('\n\n')

    const result = defectWordFilter(segmentReply(reply, AUTHORED))
    expect(result.filtered).toBe(false)
    expect(result.matches).toEqual([])
    expect(renderSegments(result.segments)).toBe(reply)
    for (const claim of AUTHORED) expect(renderSegments(result.segments)).toContain(claim.text)
  })

  it('still redacts the model’s own prose in the same reply', () => {
    const claim = { id: 'C1', text: 'The defect rate on the narrow-web line fell to 2.1 percent.' }
    const reply = `That one is defective. ${claimMarker(claim.id)} ${claim.text} The rest are sound claims.`

    const result = defectWordFilter(segmentReply(reply, [claim]))
    expect(result.filtered).toBe(true)
    expect(result.matches.map((match) => match.term)).toEqual(['defective', 'sound claims'])
    expect(renderSegments(result.segments)).toBe(
      `That one is ${DEFECT_REDACTION}. ${claimMarker(claim.id)} ${claim.text} The rest are ${DEFECT_REDACTION}.`,
    )
  })
})
