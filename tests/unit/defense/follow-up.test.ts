// Step 9.2 — the follow-up trigger (`src/server/modules/defense/follow-up.ts`): D-031's three tests
// and D-090's override.
//
// It is worth a suite because it is the one rule in the defense that decides whether a student is
// pressed a second time, and because PRD §7.12 forbids a model from deciding it. That makes the rule
// a promise: a student who names a source, a number or a reason is not pressed, and one who names
// none of the three is. Both halves fail silently — a trigger that never fires makes the follow-up
// dead weight in every confirmed bank, and one that always fires makes it noise — and neither shows
// up on a screen.
//
// The database half (that the follow-up is inserted at most once per question, carries
// `follow_up_of`, and writes its own `defense_question` event) is
// `tests/integration/defense/flow.test.ts`.
import { describe, expect, it } from 'vitest'
import {
  REASON_MARKERS,
  TITLE_TOKEN_RUN,
  followUpReasonFor,
  namesDocument,
  namesNumber,
  namesReason,
  normalizeText,
  readsBackTheBrief,
} from '@/server/modules/defense/follow-up'

const TITLES = [
  'Quarterly acquisition cohort table',
  'Retention and Payback Memo: correcting the premium payback figure',
  'Minutes',
]

const BRIEF =
  'Move 30 percent of the quarter to premium acquisition. The payback memo of 4 August corrects the eleven-month figure, so the share is bounded and reviewed at the next cohort readout.'

const context = { documentTitles: TITLES, brief: BRIEF }

// ---------------------------------------------------------------------------------------------
// D-031, test one: a number
// ---------------------------------------------------------------------------------------------

describe('names a number', () => {
  it('finds a digit anywhere in the answer', () => {
    expect(namesNumber('The cohort table put it at 4.2 months.')).toBe(true)
    expect(namesNumber('214')).toBe(true)
    expect(namesNumber('Q3')).toBe(true)
  })

  it('does not treat a spelled-out number as one', () => {
    // Deliberate: D-031 says "no digit", and a rule that guessed at "eleven" would be a rule
    // nobody could predict from the sentence it is written in.
    expect(namesNumber('It was about eleven months, I think.')).toBe(false)
  })

  it('is false for an empty answer', () => {
    expect(namesNumber('')).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------
// D-031, test two: a document title
// ---------------------------------------------------------------------------------------------

describe('names a document', () => {
  it('needs a run of two consecutive words from a title', () => {
    expect(TITLE_TOKEN_RUN).toBe(2)
    expect(namesDocument('It came from the cohort table.', TITLES)).toBe(true)
    expect(namesDocument('The payback memo said so.', TITLES)).toBe(true)
  })

  it('does not fire on a single token a title happens to share with prose', () => {
    expect(namesDocument('I reviewed it carefully.', TITLES)).toBe(false)
    expect(namesDocument('There was a table somewhere.', TITLES)).toBe(false)
    expect(namesDocument('The memo, I think.', TITLES)).toBe(false)
  })

  it('reads through punctuation and case', () => {
    expect(namesDocument('the QUARTERLY   ACQUISITION deck', TITLES)).toBe(true)
    expect(namesDocument('"Retention and Payback" — that one.', TITLES)).toBe(true)
  })

  it('cannot match a one-word title, which is the cost of the two-token floor', () => {
    expect(namesDocument('I read the minutes.', TITLES)).toBe(false)
  })

  it('is false with no titles and for an empty answer', () => {
    expect(namesDocument('the cohort table', [])).toBe(false)
    expect(namesDocument('', TITLES)).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------
// D-031, test three: a reason marker
// ---------------------------------------------------------------------------------------------

describe('names a reason', () => {
  it('finds each of D-031’s five markers', () => {
    expect(REASON_MARKERS).toEqual(['because', 'since', 'so that', 'given', 'as the'])
    expect(namesReason('I took it because the memo was newer.')).toBe(true)
    expect(namesReason('Since nobody had checked it, I asked.')).toBe(true)
    expect(namesReason('I bounded the share so that a miss is survivable.')).toBe(true)
    expect(namesReason('Given the survey base, I would not plan on it.')).toBe(true)
    expect(namesReason('I read it as the tier’s number.')).toBe(true)
  })

  it('matches on word boundaries, not on substrings', () => {
    expect(namesReason('Sincerely, I do not know.')).toBe(false)
    expect(namesReason('The givens were all in the deck.')).toBe(false)
    expect(namesReason('I asked the assistant.')).toBe(false)
  })

  it('is false for an empty answer', () => {
    expect(namesReason('   ')).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------
// D-090: the brief, read back
// ---------------------------------------------------------------------------------------------

describe('reads back the brief (D-090)', () => {
  it('fires on a normalized substring of the brief, whatever the spacing or punctuation', () => {
    expect(
      readsBackTheBrief('The payback memo of 4 August corrects the eleven-month figure', BRIEF),
    ).toBe(true)
    expect(readsBackTheBrief('  the  PAYBACK   memo,  of 4 august!  ', BRIEF)).toBe(true)
  })

  it('does not fire on an answer that says something the brief does not', () => {
    expect(readsBackTheBrief('I traced it to the cohort table and it held.', BRIEF)).toBe(false)
  })

  it('does not fire on an empty answer, which is not a quotation of anything', () => {
    expect(readsBackTheBrief('', BRIEF)).toBe(false)
    expect(readsBackTheBrief('   ', BRIEF)).toBe(false)
  })

  it('normalizes both sides the same way', () => {
    expect(normalizeText('  The  memo. ')).toBe('the memo')
    expect(normalizeText('4.2 months')).toBe('4 2 months')
  })
})

// ---------------------------------------------------------------------------------------------
// The rule as the service applies it
// ---------------------------------------------------------------------------------------------

describe('followUpReasonFor', () => {
  it('asks when the answer names no source, no number and no reason (FR-123)', () => {
    expect(followUpReasonFor('The assistant said so.', context)).toBe('no_source_number_or_reason')
    expect(followUpReasonFor('I do not know.', context)).toBe('no_source_number_or_reason')
  })

  it('asks on an empty answer, for the honest reason', () => {
    expect(followUpReasonFor('', context)).toBe('no_source_number_or_reason')
  })

  it('does not ask when the answer names any one of the three', () => {
    expect(followUpReasonFor('It was 4.2 months.', context)).toBeNull()
    expect(followUpReasonFor('From the cohort table.', context)).toBeNull()
    expect(followUpReasonFor('I held it because nobody had rechecked it.', context)).toBeNull()
  })

  it('asks anyway when the answer is the brief read aloud (D-090)', () => {
    // It has digits, a document title and a reason marker: every one of D-031's tests passes, and
    // it is still the least informative answer in the interview.
    const quoted =
      'The payback memo of 4 August corrects the eleven-month figure, so the share is bounded'
    expect(namesNumber(quoted)).toBe(true)
    expect(namesDocument(quoted, TITLES)).toBe(true)
    expect(followUpReasonFor(quoted, context)).toBe('verbatim_brief')
  })

  it('reports D-031 rather than D-090 when both would fire', () => {
    // A fragment of the brief that names nothing: D-031's rule is the one FR-123 states, so it is
    // the reason recorded.
    expect(followUpReasonFor('bounded and reviewed at the next cohort readout', context)).toBe(
      'no_source_number_or_reason',
    )
  })

  it('is not fooled by a brief that is empty', () => {
    expect(
      followUpReasonFor('From the cohort table.', { documentTitles: TITLES, brief: '' }),
    ).toBeNull()
  })
})
