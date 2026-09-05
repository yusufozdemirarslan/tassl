// Step 7.2 — cutting a reply into guarded prose and unguarded claim objects
// (docs/tech/11-llm-integration.md §3, FR-051, FR-052, FR-056, D-264).
//
// Two things have to be true of the cut, and they pull in opposite directions.
//
//   *A claim's authored text is never guarded.* It is the one thing in the reply a student may treat
//   as evidence, and an imported package (FR-186) is ordinary business writing: "the defect rate",
//   "professional services", "developing markets", a figure the author sourced. Redacting or flagging
//   any of that changes a claim object between the author who wrote it and the student who stances it.
//
//   *Nothing else escapes the guards.* A model that appends a sentence of its own after a claim, or
//   marks an id nobody surfaced, must not have that sentence carried through unread — that would be a
//   hole in the numeric guard exactly where FR-052 needs one least.
//
// The rule that satisfies both: after a marker, only the claim's own text, verbatim, is consumed.
import { describe, expect, it } from 'vitest'
import { numericGuard } from '@/server/llm/guardrails/numeric-guard'
import { proseOf, renderSegments, segmentReply } from '@/server/llm/guardrails/segments'
import { claimMarker } from '@/server/llm/prompts/assistant-reply'

const C3 = { id: 'C3', text: 'Premium payback is about 11 months.' }
const C7 = { id: 'C7', text: 'The survey puts 31 percent above the 38 dollar price.' }

describe('segmentReply', () => {
  it('carries the claim’s authored text in the claim segment, not in the prose beside it', () => {
    const reply = `One thing on file bears on it. ${claimMarker(C3.id)} ${C3.text}\n\nCheck it.`
    expect(segmentReply(reply, [C3])).toEqual([
      { type: 'text', text: 'One thing on file bears on it. ' },
      { type: 'claim', claimId: 'C3', text: C3.text },
      { type: 'text', text: '\n\nCheck it.' },
    ])
  })

  it('handles several claims, and prose between them', () => {
    const reply = [
      `Lead one. ${claimMarker(C3.id)} ${C3.text}`,
      `Lead two. ${claimMarker(C7.id)} ${C7.text}`,
      'Closing sentence.',
    ].join('\n\n')

    expect(segmentReply(reply, [C3, C7]).map((segment) => segment.type)).toEqual([
      'text',
      'claim',
      'text',
      'claim',
      'text',
    ])
    expect(proseOf(segmentReply(reply, [C3, C7])).join('')).not.toContain('11 months')
  })

  it('round-trips the reply the mock writes', () => {
    const reply = `Lead. ${claimMarker(C3.id)} ${C3.text}\n\nClosing.`
    expect(renderSegments(segmentReply(reply, [C3]))).toBe(reply)
  })

  it('consumes only the claim text, so a sentence the model added after it is still prose', () => {
    const reply = `Lead. ${claimMarker(C3.id)} ${C3.text} Blending the cohorts gives 14 months.`
    const segments = segmentReply(reply, [C3])
    expect(segments[1]).toEqual({ type: 'claim', claimId: 'C3', text: C3.text })
    expect(segments[2]).toEqual({ type: 'text', text: ' Blending the cohorts gives 14 months.' })

    const guarded = numericGuard(segments, new Set(['11']), 'flag')
    expect(guarded.unverified.map((number) => number.value)).toEqual(['14'])
  })

  it('does not treat a paraphrase as authored text', () => {
    const reply = `Lead. ${claimMarker(C3.id)} Premium payback is roughly 11 months.`
    const segments = segmentReply(reply, [C3])
    expect(segments[1]).toEqual({ type: 'claim', claimId: 'C3', text: C3.text })
    expect(segments[2]).toEqual({ type: 'text', text: ' Premium payback is roughly 11 months.' })
  })

  it('gives a marker for an id nobody surfaced no text and no immunity', () => {
    const reply = `Lead. ${claimMarker('C9')} An assertion with 42 in it.`
    const segments = segmentReply(reply, [C3])
    expect(segments[1]).toEqual({ type: 'claim', claimId: 'C9', text: '' })
    expect(segments[2]).toEqual({ type: 'text', text: ' An assertion with 42 in it.' })
    expect(numericGuard(segments, new Set<string>(), 'flag').unverified).toHaveLength(1)
  })

  it('is the whole reply when there is no marker at all', () => {
    const reply = 'I have nothing on file for that request.'
    expect(segmentReply(reply, [])).toEqual([{ type: 'text', text: reply }])
  })
})
