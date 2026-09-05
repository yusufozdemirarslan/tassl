// Step 5.1 — sentence counting for `COUNTERFACTUAL_SENTENCES`, "the counterfactual has exactly 3
// sentences" (docs/tech/10-backend-spec-modules.md §4, PRD §7.14).
//
// The counterfactual from the Meridian Roast fixture is the case that matters: a decimal, a number
// mid-sentence, and three full stops. The rest of this file fixes the heuristic's edges so that a
// later change to it has to admit what it is changing.
import { describe, expect, it } from 'vitest'
import { countSentences } from '@/lib/sentences'

const COUNTERFACTUAL =
  'Churn rises 0.5 pts. Payback slips to 14 months. The premium tier still clears the bar.'

describe('countSentences', () => {
  it('counts nothing in an empty string', () => {
    expect(countSentences('')).toBe(0)
  })

  it('counts nothing in whitespace alone', () => {
    expect(countSentences('   \n\t ')).toBe(0)
  })

  it('counts the three sentences of a counterfactual, decimal and all', () => {
    expect(countSentences(COUNTERFACTUAL)).toBe(3)
  })

  it('counts the same three when the text ends with a newline', () => {
    expect(countSentences(`${COUNTERFACTUAL}\n`)).toBe(3)
  })

  it('counts the same three across newlines and doubled spaces between them', () => {
    expect(
      countSentences('Churn rises 0.5 pts.\nPayback slips to 14 months.  The tier clears the bar.'),
    ).toBe(3)
  })

  it('counts one sentence, however long, when nothing terminates it', () => {
    expect(countSentences('Churn rises and payback slips and the tier still clears the bar')).toBe(
      1,
    )
  })

  it('counts a final fragment with no full stop as the sentence someone wrote', () => {
    expect(countSentences('Churn rises. Payback slips. The tier clears')).toBe(3)
  })

  it('does not split a decimal, a version, or a thousands separator', () => {
    expect(countSentences('Payback is 11.5 months against a 10.0 target.')).toBe(1)
    expect(countSentences('Revenue reached 1.250.000 euros.')).toBe(1)
  })

  it('does not split on an abbreviation followed by more of the same sentence', () => {
    expect(countSentences('Hold the tier, e.g. the value line, until the pilot reports.')).toBe(1)
    expect(countSentences('The deck, approx. 40 percent stale, was superseded.')).toBe(1)
    expect(countSentences('Ms. Chen signed the supplier contract.')).toBe(1)
    expect(countSentences('U.S. retention fell to 61 percent.')).toBe(1)
  })

  it('does not split on the initials of a name', () => {
    expect(countSentences('J. R. Alvarez wrote the founder note. It reads as fact.')).toBe(2)
  })

  it('counts questions, exclamations, and an ellipsis as sentence ends', () => {
    expect(countSentences('Is payback 11 months? The deck says so. Verify it!')).toBe(3)
    expect(countSentences('Payback slips… The tier still clears.')).toBe(2)
  })

  it('counts a sentence that ends inside quotation marks', () => {
    expect(countSentences('The memo says "retention is 61 percent." The deck disagrees.')).toBe(2)
  })

  it('counts a sentence that opens with a figure', () => {
    expect(countSentences('Payback slips. 14 months is past the bar.')).toBe(2)
  })

  it('joins a following lowercase clause to the sentence before it, as documented', () => {
    expect(countSentences('Payback slips. churn rises.')).toBe(1)
  })

  it('never splits on a semicolon or a dash, however long the clause', () => {
    expect(countSentences('Payback slips; churn rises — the tier still clears the bar.')).toBe(1)
  })

  it('counts a numbered counterfactual as its three points, not six', () => {
    // An author who writes the three sentences as a list is writing three sentences; before the
    // list-marker rule this counted six and COUNTERFACTUAL_SENTENCES refused the package.
    expect(
      countSentences(
        '1. Verify the payback figure. 2. Escalate the pricing route. 3. Hold the tier.',
      ),
    ).toBe(3)
    expect(
      countSentences('1. Churn rises.\n2. Payback slips.\n3. The premium tier still clears.'),
    ).toBe(3)
  })

  it('counts a number inside a sentence as part of it', () => {
    // The marker rule only applies at the head of a line, so an ordinary decimal or an inline
    // enumeration still reads as prose.
    expect(countSentences('Retention fell to 61 percent. Payback slipped to 14 months.')).toBe(2)
    expect(countSentences('The deck lists 3. That figure is stale.')).toBe(2)
  })
})
