// Step 9.2 — the pure question selection (`src/server/modules/defense/selection.ts`), which is the
// whole of FR-121 and FR-122 and the one part of the defense that has to be read rather than run.
//
// Why a suite of its own, and why it is this long. Six to nine questions are drawn from the
// student's own record, and every way this can be wrong is silent: a condition that never fires
// leaves a student unasked about the thing their run turned on and nothing errors; a condition that
// always fires pushes the questions that matter past the cap at nine; an ordering that is not total
// asks two identical runs different interviews. None of that shows up on a screen, and the database
// half (that the events really are written this way, and the rows land in this order) is
// `tests/integration/defense/flow.test.ts`.
//
// The suite also holds one **security** assertion that is not about correctness at all: selection's
// whole input is five members and none of them is `variant_claim_states`, so no question, no order
// and no wording can be a function of an evidence status, a failure family or a planted flag. Phase
// 8 shipped a counter whose delta encoded an authored field (D-328); a question set that differed by
// variant would be the same defect written in prose. The end-to-end half — two runs on the two
// variants producing the same interview against a real package — is
// `tests/integration/defense/flow.test.ts`.
import { describe, expect, it } from 'vitest'
import {
  ASSUMPTION_OVERLAP_MIN,
  QUESTIONS_MAX,
  QUESTIONS_MIN,
  candidatesFor,
  formatFigure,
  readRunRecord,
  renderTemplate,
  selectQuestions,
  tokenOverlap,
  type BankQuestion,
  type SelectionClaim,
  type SelectionDocument,
  type SelectionEvent,
  type SelectionInput,
  type SelectionNamedField,
} from '@/server/modules/defense/selection'

// ---------------------------------------------------------------------------------------------
// A small package, written out so every condition can be met or not met on purpose
// ---------------------------------------------------------------------------------------------

const CLAIM_A = 'claim-a'
const CLAIM_B = 'claim-b'
const CLAIM_LOW = 'claim-low'
const DOC_1 = 'doc-1'

const claim = (over: Partial<SelectionClaim> & { id: string }): SelectionClaim => ({
  text: 'A claim the assistant stated.',
  sourceKind: 'document',
  sourceDocumentId: DOC_1,
  importance: 'supporting',
  consequenceLevel: 'high',
  carriedValues: [],
  position: 0,
  ...over,
})

const CLAIMS: SelectionClaim[] = [
  claim({
    id: CLAIM_A,
    text: 'Premium payback is 11 months.',
    importance: 'load_bearing',
    consequenceLevel: 'high',
    carriedValues: [{ field_key: 'payback_months', value: 11, unit: 'months' }],
    position: 0,
  }),
  claim({
    id: CLAIM_B,
    text: 'Month-three retention is 78 percent.',
    importance: 'supporting',
    consequenceLevel: 'medium',
    sourceDocumentId: null,
    sourceKind: 'assistant',
    carriedValues: [{ value: 78, unit: 'percent' }],
    position: 1,
  }),
  claim({
    id: CLAIM_LOW,
    text: 'The insulated shipper costs 8.80 dollars.',
    consequenceLevel: 'low',
    position: 2,
  }),
]

const DOCUMENTS: SelectionDocument[] = [
  {
    id: DOC_1,
    title: 'Quarterly acquisition cohort table',
    body: 'Blended payback lands at 4.2 months across the last three cohorts.',
  },
]

const NAMED_FIELDS: SelectionNamedField[] = [
  { key: 'budget_share', label: 'Share of the budget', unit: 'percent', position: 0 },
  { key: 'payback_months', label: 'Payback', unit: 'months', position: 1 },
]

const bank = (
  over: Partial<BankQuestion> & { id: string; kind: BankQuestion['kind'] },
): BankQuestion => ({
  claimId: null,
  assumptionIndex: null,
  template: 'A question.',
  condition: {},
  isDefault: false,
  position: 0,
  ...over,
})

const BANK: BankQuestion[] = [
  bank({
    id: 'q-prov-a',
    kind: 'provenance',
    claimId: CLAIM_A,
    template: 'You accepted this: {claim_text} Which document is that from?',
    position: 0,
  }),
  bank({
    id: 'q-prov-b',
    kind: 'provenance',
    claimId: CLAIM_B,
    template: '{claim_text} Who says so?',
    position: 1,
  }),
  bank({
    id: 'q-prov-low',
    kind: 'provenance',
    claimId: CLAIM_LOW,
    template: '{claim_text} Where from?',
    position: 2,
  }),
  bank({
    id: 'q-ver-a',
    kind: 'verification',
    claimId: CLAIM_A,
    template: 'You settled on {stance}. What check did you run?',
    position: 3,
  }),
  bank({
    id: 'q-ver-b',
    kind: 'verification',
    claimId: CLAIM_B,
    template: '{claim_text} You settled on {stance}.',
    position: 4,
  }),
  bank({
    id: 'q-asm-0',
    kind: 'assumption',
    assumptionIndex: 0,
    template: 'You assumed: {assumption}',
    position: 5,
  }),
  bank({
    id: 'q-asm-1',
    kind: 'assumption',
    assumptionIndex: 1,
    template: 'Second: {assumption}',
    position: 6,
  }),
  bank({
    id: 'q-asm-2',
    kind: 'assumption',
    assumptionIndex: 2,
    template: 'Third: {assumption}',
    position: 7,
  }),
  bank({
    id: 'q-conf',
    kind: 'confidence',
    template: 'Your confidence rose. What moved it?',
    position: 8,
  }),
  bank({ id: 'q-fvr', kind: 'frame_vs_response', template: 'Explain the gap.', position: 9 }),
  bank({
    id: 'q-cf',
    kind: 'counterfactual',
    template: 'Take {figure} and make churn worse.',
    condition: { named_field_key: 'payback_months' },
    position: 10,
  }),
  bank({
    id: 'q-fig',
    kind: 'figure_provenance',
    template: 'You wrote {figure} into the brief. Where is it from?',
    position: 11,
  }),
  ...[0, 1, 2, 3, 4, 5].map((index) =>
    bank({
      id: `q-def-${index}`,
      kind: 'default',
      isDefault: true,
      template: `Default question ${index}.`,
      position: 12 + index,
    }),
  ),
]

// ---------------------------------------------------------------------------------------------
// Events, written by hand so a condition can be turned on one at a time
// ---------------------------------------------------------------------------------------------

const at = (minutes: number): Date => new Date(Date.UTC(2026, 8, 4, 10, minutes, 0))

let nextSeq = 0
const event = (
  type: string,
  payload: Record<string, unknown>,
  minutes = nextSeq,
): SelectionEvent => {
  nextSeq += 1
  return { seq: nextSeq, type, occurredAt: at(minutes), payload }
}

/** A run that meets no condition at all: a frame, a brief, an implicit hold, nothing touched. */
function bareRun(over: { events?: SelectionEvent[] } = {}): SelectionInput {
  nextSeq = 0
  const events = over.events ?? [
    event('frame_locked', {
      decision: 'Whether to move spend',
      assumptions: [
        'premium retention holds',
        'value payback stays near four',
        'supplier cost is stable',
      ],
      position: 'Hold',
      confidence: 40,
    }),
    event('decision_locked', {
      recommendation: 'Hold',
      assumptions: [
        'premium retention holds',
        'value payback stays near four',
        'supplier cost is stable',
      ],
      confidence: 40,
      named_values: {},
    }),
    event('turn_response_locked', { response: 'hold', justification: null, implicit: true }),
  ]
  return { events, claims: CLAIMS, documents: DOCUMENTS, namedFields: NAMED_FIELDS, bank: BANK }
}

/** Builds the run from a list of event makers, so a test reads as the run it describes. */
function runWith(build: (add: typeof event) => void): SelectionInput {
  nextSeq = 0
  const events: SelectionEvent[] = []
  const add: typeof event = (type, payload, minutes) => {
    const made = event(type, payload, minutes)
    events.push(made)
    return made
  }
  build(add)
  return { events, claims: CLAIMS, documents: DOCUMENTS, namedFields: NAMED_FIELDS, bank: BANK }
}

const kindsOf = (input: SelectionInput): string[] =>
  candidatesFor(input, readRunRecord(input.events, input.claims)).map((question) => question.kind)

const idsOf = (input: SelectionInput): string[] =>
  candidatesFor(input, readRunRecord(input.events, input.claims)).map(
    (question) => question.questionId,
  )

// ---------------------------------------------------------------------------------------------
// Condition 1 — provenance (10 §9, FR-121)
// ---------------------------------------------------------------------------------------------

describe('provenance: a consequential claim relied on with no Source Trace', () => {
  it('is selected for a claim marked used, and rendered with the claim’s own words', () => {
    const input = runWith((add) => {
      add('delegation', { claim_ids: [CLAIM_A] }, 1)
      add('claim_used', { claim_id: CLAIM_A, via: 'log_mark' }, 2)
    })
    const [question, ...rest] = candidatesFor(input, readRunRecord(input.events, input.claims))
    expect(rest).toEqual([])
    expect(question).toMatchObject({ questionId: 'q-prov-a', kind: 'provenance' })
    expect(question?.renderedText).toBe(
      'You accepted this: Premium payback is 11 months. Which document is that from?',
    )
    // The event the condition was read from: the `claim_used` that made the claim relied on.
    expect(question?.selectingEventSeq).toBe(2)
  })

  it('is not selected once a Source Trace ran on the claim (FR-121)', () => {
    const input = runWith((add) => {
      add('delegation', { claim_ids: [CLAIM_A] }, 1)
      add('claim_used', { claim_id: CLAIM_A, via: 'log_mark' }, 2)
      add('action', { claim_id: CLAIM_A, type: 'source_trace', action_id: 'a1' }, 3)
    })
    expect(kindsOf(input)).toEqual([])
  })

  it('is still selected when some other check ran: FR-121 names the Source Trace', () => {
    const input = runWith((add) => {
      add('claim_used', { claim_id: CLAIM_A, via: 'named_field' }, 1)
      add('action', { claim_id: CLAIM_A, type: 'replication_check', action_id: 'a1' }, 2)
    })
    expect(idsOf(input)).toEqual(['q-prov-a'])
  })

  it('is not selected for a claim that was surfaced but never relied on', () => {
    const input = runWith((add) => {
      add('delegation', { claim_ids: [CLAIM_A] }, 1)
    })
    expect(kindsOf(input)).toEqual([])
  })

  it('is not selected for a low-consequence claim, however hard it was leant on', () => {
    const input = runWith((add) => {
      add('claim_used', { claim_id: CLAIM_LOW, via: 'log_mark' }, 1)
    })
    expect(kindsOf(input)).toEqual([])
  })

  it('puts load-bearing claims first, then the order the student met them in', () => {
    const input = runWith((add) => {
      // B is surfaced and relied on first, and is only supporting; A comes later and is load-bearing.
      add('delegation', { claim_ids: [CLAIM_B] }, 1)
      add('claim_used', { claim_id: CLAIM_B, via: 'log_mark' }, 2)
      add('document_open', { document_id: DOC_1 }, 3)
      add('claim_used', { claim_id: CLAIM_A, via: 'named_field' }, 4)
    })
    expect(idsOf(input)).toEqual(['q-prov-a', 'q-prov-b'])
  })
})

// ---------------------------------------------------------------------------------------------
// Condition 2 — figure provenance (FR-025, D-135)
// ---------------------------------------------------------------------------------------------

describe('figure provenance: a brief figure that matches no claim and no document', () => {
  const lockWith = (namedValues: Record<string, number>) =>
    runWith((add) => {
      add('decision_locked', {
        assumptions: ['a', 'b', 'c'],
        confidence: 40,
        named_values: namedValues,
      })
    })

  /** The figure questions alone: a brief with a figure in it also earns the counterfactual. */
  const figuresOf = (input: SelectionInput) =>
    candidatesFor(input, readRunRecord(input.events, input.claims)).filter(
      (question) => question.kind === 'figure_provenance',
    )

  it('is selected for an unmatched value, rendered with the value and its unit', () => {
    const input = lockWith({ budget_share: 35 })
    const [question, ...rest] = figuresOf(input)
    expect(rest).toEqual([])
    expect(question).toMatchObject({ questionId: 'q-fig', kind: 'figure_provenance' })
    expect(question?.renderedText).toBe('You wrote 35 percent into the brief. Where is it from?')
    // The brief is the event the figure was read from.
    expect(question?.selectingEventSeq).toBe(1)
  })

  it('is not selected for a value a claim carries (FR-101 is the other side of it)', () => {
    expect(figuresOf(lockWith({ payback_months: 11 }))).toEqual([])
  })

  it('is not selected for a value that appears in a document in the room', () => {
    // 4.2 is in the cohort table's body, and no claim binds it to this field.
    expect(figuresOf(lockWith({ payback_months: 4.2 }))).toEqual([])
  })

  it('asks once per unmatched figure, in the author’s field order', () => {
    const input = lockWith({ payback_months: 19, budget_share: 35 })
    expect(figuresOf(input).map((q) => q.renderedText)).toEqual([
      'You wrote 35 percent into the brief. Where is it from?',
      'You wrote 19 months into the brief. Where is it from?',
    ])
  })
})

// ---------------------------------------------------------------------------------------------
// Condition 3 — verification (FR-121)
// ---------------------------------------------------------------------------------------------

describe('verification: a stance that changed after an action', () => {
  it('is selected, and renders the stance the student ended on', () => {
    const input = runWith((add) => {
      add('stance_set', { claim_id: CLAIM_A, stance: 'accept', previous_stance: null }, 1)
      add('action', { claim_id: CLAIM_A, type: 'source_trace', action_id: 'a1' }, 2)
      add('stance_set', { claim_id: CLAIM_A, stance: 'verify', previous_stance: 'accept' }, 3)
    })
    const questions = candidatesFor(input, readRunRecord(input.events, input.claims))
    expect(questions).toHaveLength(1)
    expect(questions[0]).toMatchObject({ questionId: 'q-ver-a', kind: 'verification' })
    expect(questions[0]?.renderedText).toBe('You settled on Verify. What check did you run?')
    expect(questions[0]?.selectingEventSeq).toBe(3)
  })

  it('is not selected when the stance changed with no action before it', () => {
    const input = runWith((add) => {
      add('stance_set', { claim_id: CLAIM_A, stance: 'accept', previous_stance: null }, 1)
      add('stance_set', { claim_id: CLAIM_A, stance: 'verify', previous_stance: 'accept' }, 2)
    })
    expect(kindsOf(input)).toEqual([])
  })

  it('is not selected when the action came after the change', () => {
    const input = runWith((add) => {
      add('stance_set', { claim_id: CLAIM_A, stance: 'accept', previous_stance: null }, 1)
      add('stance_set', { claim_id: CLAIM_A, stance: 'verify', previous_stance: 'accept' }, 2)
      add('action', { claim_id: CLAIM_A, type: 'source_trace', action_id: 'a1' }, 3)
    })
    expect(kindsOf(input)).toEqual([])
  })

  it('is not selected for a first stance, however much work went into it', () => {
    const input = runWith((add) => {
      add('action', { claim_id: CLAIM_A, type: 'source_trace', action_id: 'a1' }, 1)
      add('stance_set', { claim_id: CLAIM_A, stance: 'verify', previous_stance: null }, 2)
    })
    expect(kindsOf(input)).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------
// Condition 4 — assumptions (FR-121)
// ---------------------------------------------------------------------------------------------

describe('assumption: a frame assumption the brief and the Turn departed from', () => {
  const frameAssumptions = [
    'premium retention holds at the piloted level',
    'value tier payback stays near four months',
    'supplier cost per bag is stable',
  ]

  const framed = (
    briefAssumptions: string[],
    turn: { response: string; justification: string | null; implicit: boolean },
  ) =>
    runWith((add) => {
      add('frame_locked', { assumptions: frameAssumptions, confidence: 40 }, 1)
      add('decision_locked', { assumptions: briefAssumptions, confidence: 40, named_values: {} }, 2)
      add('turn_response_locked', turn, 3)
    })

  it('is selected only for the assumption whose words are gone', () => {
    const input = framed(
      [
        'premium retention holds at the piloted level',
        'value tier payback stays near four months',
        'nothing about coffee at all',
      ],
      {
        response: 'hold',
        justification: 'The retention number is the one that matters.',
        implicit: false,
      },
    )
    const questions = candidatesFor(input, readRunRecord(input.events, input.claims))
    const assumptions = questions.filter((q) => q.kind === 'assumption')
    expect(assumptions).toHaveLength(1)
    expect(assumptions[0]).toMatchObject({ questionId: 'q-asm-2' })
    expect(assumptions[0]?.renderedText).toBe('Third: supplier cost per bag is stable')
    expect(assumptions[0]?.selectingEventSeq).toBe(1)
  })

  it('reads the Turn justification as well as the brief, so a defence there counts', () => {
    const input = framed(['one', 'two', 'three'], {
      response: 'hold',
      justification:
        'Premium retention holds at the piloted level, value tier payback stays near four months, and supplier cost per bag is stable.',
      implicit: false,
    })
    expect(kindsOf(input).filter((kind) => kind === 'assumption')).toEqual([])
  })

  it('asks about all three when the response was a reversal, however well they were carried', () => {
    const input = framed(frameAssumptions, {
      response: 'reverse',
      justification: frameAssumptions.join(' '),
      implicit: false,
    })
    const ids = idsOf(input).filter((id) => id.startsWith('q-asm'))
    expect(ids).toEqual(['q-asm-0', 'q-asm-1', 'q-asm-2'])
  })

  it('measures overlap as the share of the assumption’s own tokens (FR-121)', () => {
    expect(tokenOverlap('alpha beta gamma delta', ['alpha beta'])).toBe(0.5)
    expect(tokenOverlap('alpha beta gamma delta', ['alpha'])).toBe(0.25)
    // The threshold is strict: exactly half is not a departure.
    expect(0.5 < ASSUMPTION_OVERLAP_MIN).toBe(false)
    // An empty assumption is not something a brief can depart from.
    expect(tokenOverlap('   ', [])).toBe(1)
  })
})

// ---------------------------------------------------------------------------------------------
// Conditions 5 and 6 — confidence (D-080) and frame versus response (D-106)
// ---------------------------------------------------------------------------------------------

describe('confidence: the lock is strictly above the frame (D-080)', () => {
  const withConfidence = (frame: number, lock: number) =>
    runWith((add) => {
      add('frame_locked', { assumptions: ['a', 'b', 'c'], confidence: frame }, 1)
      add(
        'decision_locked',
        { assumptions: ['a', 'b', 'c'], confidence: lock, named_values: {} },
        2,
      )
    })

  it('is selected when it rose', () => {
    expect(idsOf(withConfidence(40, 55)).filter((id) => id === 'q-conf')).toEqual(['q-conf'])
  })

  it('is not selected when it stayed the same — D-080 says strictly greater', () => {
    expect(idsOf(withConfidence(55, 55)).filter((id) => id === 'q-conf')).toEqual([])
  })

  it('is not selected when it fell', () => {
    expect(idsOf(withConfidence(55, 40)).filter((id) => id === 'q-conf')).toEqual([])
  })
})

describe('frame versus response: only after a response the student filed (D-106)', () => {
  const withTurn = (implicit: boolean) =>
    runWith((add) => {
      add('turn_response_locked', {
        response: 'hold',
        justification: implicit
          ? null
          : 'The retention figure changes the sizing, not the direction.',
        implicit,
      })
    })

  it('is selected for an explicit response', () => {
    expect(idsOf(withTurn(false))).toEqual(['q-fvr'])
  })

  it('is not selected for the implicit hold the window recorded', () => {
    expect(idsOf(withTurn(true))).toEqual([])
  })

  it('is not selected before the Turn has locked at all', () => {
    expect(idsOf(runWith(() => {}))).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------
// Condition 7 — counterfactual (D-339)
// ---------------------------------------------------------------------------------------------

describe('counterfactual: the figure it moves is one the student committed to', () => {
  it('is selected when the named field it names was entered, and renders the figure', () => {
    const input = runWith((add) => {
      add('decision_locked', {
        assumptions: ['a', 'b', 'c'],
        confidence: 40,
        named_values: { payback_months: 11 },
      })
    })
    const questions = candidatesFor(input, readRunRecord(input.events, input.claims))
    const counterfactual = questions.find((q) => q.kind === 'counterfactual')
    expect(counterfactual?.questionId).toBe('q-cf')
    expect(counterfactual?.renderedText).toBe('Take 11 months and make churn worse.')
  })

  it('is not selected when that field was left empty', () => {
    const input = runWith((add) => {
      add('decision_locked', {
        assumptions: ['a', 'b', 'c'],
        confidence: 40,
        named_values: { budget_share: 35 },
      })
    })
    expect(kindsOf(input).filter((kind) => kind === 'counterfactual')).toEqual([])
  })

  it('names no field (D-339): asked once the student committed any figure at all', () => {
    const unkeyed = BANK.map((question) =>
      question.id === 'q-cf' ? { ...question, condition: {} } : question,
    )
    const events: SelectionEvent[] = [
      {
        seq: 1,
        type: 'decision_locked',
        occurredAt: at(1),
        payload: {
          assumptions: ['a', 'b', 'c'],
          confidence: 40,
          named_values: { budget_share: 35 },
        },
      },
    ]
    const withValue: SelectionInput = {
      events,
      claims: CLAIMS,
      documents: DOCUMENTS,
      namedFields: NAMED_FIELDS,
      bank: unkeyed,
    }
    expect(kindsOf(withValue)).toContain('counterfactual')

    const empty: SelectionInput = {
      ...withValue,
      events: [
        {
          seq: 1,
          type: 'decision_locked',
          occurredAt: at(1),
          payload: { assumptions: ['a', 'b', 'c'], confidence: 40, named_values: {} },
        },
      ],
    }
    expect(kindsOf(empty)).not.toContain('counterfactual')
  })
})

// ---------------------------------------------------------------------------------------------
// The cap, the fill and the order (10 §9 steps 1 to 3)
// ---------------------------------------------------------------------------------------------

describe('the shape of the interview', () => {
  /** A run that meets every condition it can, so the cut at nine is real. */
  const busyRun = (): SelectionInput =>
    runWith((add) => {
      add(
        'frame_locked',
        { assumptions: ['alpha one', 'beta two', 'gamma three'], confidence: 30 },
        1,
      )
      add('document_open', { document_id: DOC_1 }, 2)
      add('delegation', { claim_ids: [CLAIM_B] }, 3)
      add('claim_used', { claim_id: CLAIM_A, via: 'log_mark' }, 4)
      add('claim_used', { claim_id: CLAIM_B, via: 'log_mark' }, 5)
      add('stance_set', { claim_id: CLAIM_A, stance: 'accept', previous_stance: null }, 6)
      add('action', { claim_id: CLAIM_A, type: 'replication_check', action_id: 'a1' }, 7)
      add('stance_set', { claim_id: CLAIM_A, stance: 'verify', previous_stance: 'accept' }, 8)
      add('stance_set', { claim_id: CLAIM_B, stance: 'accept', previous_stance: null }, 9)
      add('action', { claim_id: CLAIM_B, type: 'replication_check', action_id: 'a2' }, 10)
      add('stance_set', { claim_id: CLAIM_B, stance: 'challenge', previous_stance: 'accept' }, 11)
      add(
        'decision_locked',
        {
          assumptions: ['nothing', 'in', 'common'],
          confidence: 80,
          named_values: { budget_share: 35, payback_months: 19 },
        },
        12,
      )
      add(
        'turn_response_locked',
        { response: 'revise', justification: 'Sizing comes down.', implicit: false },
        13,
      )
    })

  it('offers the candidates in 10 §9’s order', () => {
    const input = busyRun()
    expect(kindsOf(input)).toEqual([
      'provenance',
      'provenance',
      'figure_provenance',
      'figure_provenance',
      'verification',
      'verification',
      'assumption',
      'assumption',
      'assumption',
      'confidence',
      'frame_vs_response',
      'counterfactual',
    ])
  })

  it('takes the first nine and no more', () => {
    const input = busyRun()
    const selected = selectQuestions(input)
    expect(selected).toHaveLength(QUESTIONS_MAX)
    expect(selected.map((q) => q.kind)).toEqual(kindsOf(input).slice(0, QUESTIONS_MAX))
    // Nothing was filled: the run met more than six conditions.
    expect(selected.some((q) => q.kind === 'default')).toBe(false)
  })

  it('fills to six from the bank’s defaults, in the author’s order', () => {
    const selected = selectQuestions(bareRun())
    expect(selected).toHaveLength(QUESTIONS_MIN)
    expect(selected.map((q) => q.questionId)).toEqual([
      'q-def-0',
      'q-def-1',
      'q-def-2',
      'q-def-3',
      'q-def-4',
      'q-def-5',
    ])
    expect(selected.every((q) => q.selectingEventSeq === null)).toBe(true)
  })

  it('fills only the shortfall, keeping every condition that held', () => {
    const input = runWith((add) => {
      add('claim_used', { claim_id: CLAIM_A, via: 'log_mark' }, 1)
      add(
        'turn_response_locked',
        { response: 'hold', justification: 'It holds.', implicit: false },
        2,
      )
    })
    const selected = selectQuestions(input)
    expect(selected).toHaveLength(QUESTIONS_MIN)
    expect(selected.slice(0, 2).map((q) => q.questionId)).toEqual(['q-prov-a', 'q-fvr'])
    expect(selected.slice(2).map((q) => q.kind)).toEqual([
      'default',
      'default',
      'default',
      'default',
    ])
  })

  it('answers what it can when the bank has too few defaults, rather than refusing', () => {
    const thin = bareRun()
    const selected = selectQuestions({
      ...thin,
      bank: thin.bank.filter((q) => q.kind !== 'default' || q.id === 'q-def-0'),
    })
    expect(selected.map((q) => q.questionId)).toEqual(['q-def-0'])
  })
})

// ---------------------------------------------------------------------------------------------
// Rendering (10 §9 step 4, FR-122)
// ---------------------------------------------------------------------------------------------

describe('template rendering', () => {
  it('fills all five placeholders', () => {
    expect(
      renderTemplate(
        '{claim_text} You said {stance} on it, from {document_title}, against {assumption}, at {figure}.',
        {
          claim_text: 'Payback is 11 months.',
          stance: 'Verify',
          document_title: 'Cohort table',
          assumption: 'retention holds',
          figure: '11 months',
        },
      ),
    ).toBe(
      'Payback is 11 months. You said Verify on it, from Cohort table, against retention holds, at 11 months.',
    )
  })

  it('leaves no placeholder on a student’s screen when a value is missing', () => {
    const rendered = renderTemplate('Where did {claim_text} come from, {document_title}?', {
      claim_text: 'the payback figure',
    })
    expect(rendered).toBe('Where did the payback figure come from,?')
    expect(rendered).not.toContain('{')
  })

  it('renders a figure in the author’s own unit', () => {
    expect(formatFigure(40, 'percent')).toBe('40 percent')
    expect(formatFigure(11, 'months')).toBe('11 months')
    expect(formatFigure(8.8, 'usd')).toBe('8.8 dollars')
    expect(formatFigure(0.4, 'ratio')).toBe('0.4')
    expect(formatFigure(214, 'count')).toBe('214')
    expect(formatFigure(3, 'other')).toBe('3')
  })
})

// ---------------------------------------------------------------------------------------------
// The invariant: the interview is not a function of the variant (12 §8.1, CLAUDE.md)
// ---------------------------------------------------------------------------------------------

describe('nothing about the variant reaches the interview', () => {
  it('takes no input that could carry evidence status, failure family or plantedness', () => {
    // A structural assertion, and the point of it is that it fails the moment somebody adds a sixth
    // member: `SelectionInput` is the events, the claims, the room, the fields and the bank, and
    // `variant_claim_states` — the warranted stance, the evidence status, the failure family, the
    // planted flag and the verification paths — is not among them and cannot be reached from them.
    // The end-to-end half, that two runs on the two variants really do produce the same interview,
    // is `tests/integration/defense/flow.test.ts`.
    expect(Object.keys(bareRun()).sort()).toEqual([
      'bank',
      'claims',
      'documents',
      'events',
      'namedFields',
    ])
  })

  it('is deterministic: the same record selects the same interview twice', () => {
    const input = runWith((add) => {
      add('document_open', { document_id: DOC_1 }, 1)
      add('delegation', { claim_ids: [CLAIM_B] }, 1)
      add('claim_used', { claim_id: CLAIM_A, via: 'log_mark' }, 2)
      add('claim_used', { claim_id: CLAIM_B, via: 'log_mark' }, 2)
    })
    expect(selectQuestions(input)).toEqual(selectQuestions(input))
    // Two claims surfaced in the same minute are still ordered, and by nothing but the record.
    expect(
      selectQuestions(input)
        .slice(0, 2)
        .map((q) => q.questionId),
    ).toEqual(['q-prov-a', 'q-prov-b'])
  })
})
