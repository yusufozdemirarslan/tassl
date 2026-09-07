import { describe, expect, it } from 'vitest'
import { review } from '@/lib/i18n/messages/review'
import { scan, VOCABULARIES } from '../support/product-voice'

// D-457: the reviewer's replay is held to the same three vocabularies as the student's debrief.
//
// The question the step asks is whether `review.` deserves `debrief.`'s treatment, and the answer
// is that two of the three rules are not about who is reading. **Nothing Tassl observes is treated
// as misconduct** and **Tassl describes what happened, never who the person is** are PRD §7
// standing rules about the *product*, and a sentence an instructor reads while deciding a band is
// exactly where a lapse would do the most damage: it is the one surface where a person with
// authority over the student is being handed words about them. FR-131's "no composite, no rank, no
// percentile" is likewise not a student-facing rule — a reviewer is the reader most likely to want
// one, and the screen's whole answer to that want is the arithmetic written out.
//
// So the scan runs with **no allowlist**, and the copy was written to meet it rather than the list
// widened to admit the copy. Three places where that cost a phrasing, and each is a better sentence
// for it:
//
//   * the test control arms "an assistant outage" rather than a failure — which is also what the
//     student is actually shown (`workspace.pausedCauseAssistantFailure`, "The assistant did not
//     answer");
//   * a held run is one "nothing could place", not one that "was not scored";
//   * the void reason `scoring_held` is keyed `review.voidReason.held` and reads "Banding was held",
//     because the key names are scanned too and `scoringHeld` would split to "scoring Held".
//
// The two words the screen genuinely needs and does not own are the run's state chip (`Scored`) and
// a claim's failure family, which live in the `run.` and `claimObject.` namespaces. Neither is in
// this namespace and neither is written twice, so the exemption is structural rather than a waiver.

describe('the review catalogue keeps the product voice', () => {
  it('holds enough of the screen for the scan to mean something', () => {
    // A scan of an empty namespace passes; this is what stops that from being the reason.
    expect(Object.keys(review).length).toBeGreaterThan(150)
    for (const key of Object.keys(review)) expect(key.startsWith('review.')).toBe(true)
  })

  it('uses no word of the three forbidden vocabularies', () => {
    expect(scan(review as unknown as Record<string, string>)).toEqual([])
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
    ['ranking and comparison', 'This run is above the cohort average for the section.'],
  ])('finds a planted %s sentence', (rule, planted) => {
    const findings = scan({
      ...(review as unknown as Record<string, string>),
      'review.planted': planted,
    })
    expect(findings.map((finding) => finding.rule)).toContain(rule)
    expect(findings.every((finding) => finding.path === 'review.planted')).toBe(true)
  })

  it('finds a forbidden word planted in a key name, not only in a value', () => {
    const findings = scan({
      ...(review as unknown as Record<string, string>),
      'review.scoringRank': 'A sentence with nothing wrong in it.',
    })
    expect(findings.map((finding) => finding.word.toLowerCase())).toEqual(
      expect.arrayContaining(['scoring', 'rank']),
    )
  })
})
