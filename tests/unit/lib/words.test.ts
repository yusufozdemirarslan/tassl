// Step 5.1 — word counting, markup stripping, and the word-limit bound (docs/tech/10-backend-spec.md
// §5, 10-backend-spec-modules.md §17, 12-security.md §4 row A03, D-075, FR-103).
//
// `countWords` is the number the student watches while typing and the number the server refuses on,
// so what this file pins down is a promise made to both ends at once.
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { countWords, stripMarkup, wordLimit } from '@/lib/words'

// Invisible characters are named rather than typed: a literal one in a source file is unreadable in
// a diff and easy to lose to an editor that trims it.
const NBSP = String.fromCharCode(0x00a0)
const NUL = String.fromCharCode(0x0000)
const BELL = String.fromCharCode(0x0007)
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b)
const BOM = String.fromCharCode(0xfeff)
const RIGHT_TO_LEFT_OVERRIDE = String.fromCharCode(0x202e)

describe('countWords (D-075)', () => {
  it('counts nothing in an empty string', () => {
    expect(countWords('')).toBe(0)
  })

  it('counts nothing in whitespace alone', () => {
    expect(countWords('   \t \n  ')).toBe(0)
  })

  it('counts one word however much space surrounds it', () => {
    expect(countWords('  premium  ')).toBe(1)
  })

  it('treats any run of whitespace as one separator', () => {
    expect(countWords('hold    the   value     tier')).toBe(4)
  })

  it('splits on newlines and tabs as readily as on spaces', () => {
    expect(countWords('hold\nthe\tvalue\r\ntier')).toBe(4)
  })

  it('counts punctuation as part of the word it hangs on', () => {
    expect(countWords('Churn rises, payback slips.')).toBe(4)
  })

  it('counts a hyphenated word once and an em dash as its own token', () => {
    expect(countWords('a well-sourced claim')).toBe(3)
    expect(countWords('churn — payback')).toBe(3)
  })

  it('counts words that are not written in ASCII', () => {
    expect(countWords('café naïve résumé')).toBe(3)
    expect(countWords('日本語 テスト')).toBe(2)
  })

  it('splits on a non-breaking space, which a paste often carries', () => {
    expect(countWords(`eleven${NBSP}months`)).toBe(2)
  })
})

describe('stripMarkup (10 §5)', () => {
  it('leaves plain prose alone apart from trimming it', () => {
    expect(stripMarkup('  Premium payback is 11 months.  ')).toBe('Premium payback is 11 months.')
  })

  it('returns an empty string for whitespace alone', () => {
    expect(stripMarkup('   \n  ')).toBe('')
    expect(stripMarkup('')).toBe('')
  })

  it('removes HTML tags and keeps the words inside them', () => {
    expect(stripMarkup('<p>Hold <strong>spend</strong> in the value tier</p>')).toBe(
      'Hold spend in the value tier',
    )
  })

  it('keeps comparisons that only look like tags', () => {
    expect(stripMarkup('churn < 6 percent > baseline')).toBe('churn < 6 percent > baseline')
  })

  it('removes comments and declarations, closed or not', () => {
    expect(stripMarkup('<!-- reviewer note -->Shift a bounded share')).toBe('Shift a bounded share')
    expect(stripMarkup('<!DOCTYPE html>Shift a bounded share')).toBe('Shift a bounded share')
    expect(stripMarkup('Shift a bounded share<!-- unfinished')).toBe('Shift a bounded share')
  })

  it('reduces a markdown link to the words a reader would read', () => {
    expect(stripMarkup('See the [retention memo](https://example.test/memo) for the number')).toBe(
      'See the retention memo for the number',
    )
  })

  it('reduces an image and a reference link the same way, and drops the definition line', () => {
    expect(stripMarkup('![the deck](deck.png) is stale')).toBe('the deck is stale')
    expect(stripMarkup('The [deck][1] is stale\n\n[1]: https://example.test/deck')).toBe(
      'The deck is stale',
    )
  })

  it('removes control characters but keeps the tab and the newline that separate words', () => {
    expect(stripMarkup(`one${NUL}${BELL}two`)).toBe('onetwo')
    expect(stripMarkup('one\ttwo\nthree')).toBe('one\ttwo\nthree')
    expect(countWords(stripMarkup('one\ttwo\nthree'))).toBe(3)
  })

  it('normalizes carriage returns so the stored text has one kind of line break', () => {
    expect(stripMarkup('one\r\ntwo\rthree')).toBe('one\ntwo\nthree')
  })

  it('removes zero-width and bidirectional characters a paste can hide in the text', () => {
    expect(stripMarkup(`${BOM}eleven${ZERO_WIDTH_SPACE}months${RIGHT_TO_LEFT_OVERRIDE}`)).toBe(
      'elevenmonths',
    )
  })

  it('leaves emphasis markers alone, since they cost no words and the author typed them', () => {
    expect(stripMarkup('**hold** the _value_ tier')).toBe('**hold** the _value_ tier')
  })
})

describe('wordLimit (10 §17)', () => {
  const three = wordLimit(3)

  it('accepts text of exactly the limit', () => {
    const parsed = three.safeParse('hold the tier')

    expect(parsed.success).toBe(true)
    expect(parsed.data).toBe('hold the tier')
  })

  it('refuses text one word over the limit', () => {
    expect(three.safeParse('hold the value tier').success).toBe(false)
  })

  it('answers with the WORD_LIMIT code and the limit, not with prose', () => {
    const issue = three.safeParse('hold the value tier').error?.issues[0]

    expect(issue?.message).toBe('WORD_LIMIT')
    expect(issue?.code === 'custom' ? issue.params : undefined).toEqual({ limit: 3 })
  })

  it('reaches the screen as a field error under the field that broke the limit', () => {
    const form = z.object({ decision: three })
    const parsed = form.safeParse({ decision: 'hold the value tier' })

    expect(parsed.error && z.flattenError(parsed.error)).toEqual({
      formErrors: [],
      fieldErrors: { decision: ['WORD_LIMIT'] },
    })
  })

  it('strips before it counts, so markup can never spend a word', () => {
    const parsed = three.safeParse('<p>hold <em>the</em> tier</p>')

    expect(parsed.success).toBe(true)
    expect(parsed.data).toBe('hold the tier')
  })

  it('hands on the stripped, trimmed text as the value to store', () => {
    expect(wordLimit(10).parse('  <b>Hold</b> the value tier  ')).toBe('Hold the value tier')
  })

  it('lets .min(1) read the stripped text, so markup alone is empty', () => {
    const required = wordLimit(50).min(1)

    expect(required.safeParse('<p></p>   ').success).toBe(false)
    expect(required.safeParse('  <p>hold</p> ').success).toBe(true)
  })

  it('agrees with countWords at the limit and one word past it', () => {
    const fifty = wordLimit(50)
    const atTheLimit = Array.from({ length: 50 }, (_, index) => `word${index}`).join(' ')

    expect(countWords(atTheLimit)).toBe(50)
    expect(fifty.safeParse(atTheLimit).success).toBe(true)
    expect(fifty.safeParse(`${atTheLimit} over`).success).toBe(false)
  })
})
