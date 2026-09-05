// Step 6.1 — the payload schema of every trace event type (docs/tech/10-backend-spec-modules.md
// §10, FR-241). `trace.append` parses through `EVENT_PAYLOAD_SCHEMAS` before it inserts, so these
// schemas are the only thing standing between a service with a typo and a run_events row that
// Phase 10's graphs, bands and export cannot read back.
//
// The file is written as a table rather than as thirty-two tests by hand, on purpose: `PAYLOADS`
// carries one documented payload per type and is typed `Record<RunEventTypeValue, …>`, so a type
// added to the enum without a payload here is a compile error, not a gap nobody noticed. The three
// assertions each type earns are then mechanical:
//
//   1. the documented payload parses;
//   2. removing any *required* field is refused — every field, not a sample, with optionality read
//      from the schema itself so the two cannot drift;
//   3. an unknown field is refused, which is also the whole of `brief_opened`'s case: it has no
//      fields to remove, and `{}` plus anything is the only way it can be wrong.
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { runEventType } from '@/server/db/schema/enums'
import {
  EVENT_PAYLOAD_SCHEMAS,
  RUN_EVENT_TYPES,
  TraceEventViewSchema,
  type EventPayload,
  type RunEventTypeValue,
} from '@/server/modules/trace/schema'

const ID = {
  claim: '11111111-1111-4111-8111-111111111111',
  document: '22222222-2222-4222-8222-222222222222',
  open: '33333333-3333-4333-8333-333333333333',
  delegation: '44444444-4444-4444-8444-444444444444',
  action: '55555555-5555-4555-8555-555555555555',
  escalation: '66666666-6666-4666-8666-666666666666',
  pause: '77777777-7777-4777-8777-777777777777',
  turn: '88888888-8888-4888-8888-888888888888',
  question: '99999999-9999-4999-8999-999999999999',
  runQuestion: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  item: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  neutralization: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  run: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  variant: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
} as const

/**
 * One payload per event type, spelled the way 10 §10's table spells it. These double as the
 * worked examples of the table: field names snake_case, ids as UUID strings, instants as ISO.
 */
const PAYLOADS: { [T in RunEventTypeValue]: EventPayload<T> } = {
  policy_displayed: {
    outside_ai_policy: 'declared',
    weight: 15,
    mapping: { novice: 1, developing: 2, proficient: 3, professional: 4 },
    run_type: 'decision',
    counts_statement: true,
  },
  lifecycle: { from: 'assigned', to: 'readiness', cause: 'acknowledgePolicy' },
  readiness_item: {
    item_id: ID.item,
    item_key: 'R7',
    category: 'defect_concept',
    concept_key: 'retention_cohorts',
    answer_key: 'c',
    correct: false,
  },
  readiness_skipped: { reason: 'expired', unanswered_count: 4 },
  document_open: {
    open_id: ID.open,
    document_id: ID.document,
    document_key: 'D3',
    before_first_delegation: true,
    in_turn_window: false,
  },
  document_close: {
    open_id: ID.open,
    document_id: ID.document,
    duration_ms: 41000,
    before_first_delegation: true,
    skim: false,
    in_turn_window: false,
  },
  frame_locked: {
    decision: 'Whether premium economics justify moving spend from the value tier',
    assumptions: ['Retention holds', 'Price sensitivity is low', 'Supplier cost is stable'],
    position: 'Lean toward holding spend',
    confidence: 40,
  },
  delegation: {
    delegation_id: ID.delegation,
    seq: 1,
    request_text: 'What is the premium payback?',
    response_text: 'Premium payback is 11 months.',
    claim_ids: [ID.claim],
    why: 'Needed the payback number for the brief.',
    in_turn_window: false,
    flags: [],
    unverified_numbers: [{ value: '11', context: 'months of payback' }],
    failed: false,
  },
  claim_used: {
    claim_id: ID.claim,
    via: 'named_field',
    field_key: 'payback_months',
  },
  stance_set: {
    claim_id: ID.claim,
    stance: 'verify',
    previous_stance: 'accept',
    action_ids: [ID.action],
    in_turn_window: false,
  },
  action: {
    action_id: ID.action,
    type: 'source_trace',
    claim_id: ID.claim,
    clock_cost_ms: 60000,
    result: { documentId: ID.document, title: 'Positioning deck', datedOn: '2025-02-10' },
    in_turn_window: false,
  },
  escalation: {
    escalation_id: ID.escalation,
    claim_id: ID.claim,
    statement: 'I cannot tell whether this cohort comparison was actually computed.',
    response_id: 'claim',
    response_text: 'The comparison was not recomputed for this cohort.',
    clock_cost_ms: 300000,
    counts_against_limit: true,
    in_turn_window: false,
  },
  outside_tool_declared: { purpose: 'Used a spreadsheet to recompute payback' },
  pause: { pause_id: ID.pause, cause: 'assistant_failure', related_delegation_id: ID.delegation },
  resume: { pause_id: ID.pause, paused_ms: 92000, clock_credited_ms: 0 },
  lock_refused: {
    reason: 'unstanced_relied_on',
    claim_id: ID.claim,
    claim_text: 'Premium payback is 11 months.',
  },
  decision_locked: {
    recommendation: 'Move a fifth of the budget in the second quarter.',
    rationale: 'The payback holds at the cohort we can defend.',
    assumptions: ['Retention holds', 'Price sensitivity is low', 'Supplier cost is stable'],
    change_my_mind: 'A recomputed cohort with worse churn.',
    named_values: { payback_months: 11 },
    confidence: 65,
    auto: false,
    speed_outlier: false,
    relied_on_claim_ids: [ID.claim],
    unstanced_relied_on_claim_ids: [],
    elapsed_ms: 1_140_000,
  },
  brief_opened: {},
  brief_closed: { duration_ms: 320000 },
  addendum: { text: 'I would have traced the payback figure first.' },
  turn_delivered: {
    turn_id: ID.turn,
    text: 'Supplier costs moved eight percent overnight.',
    voice: 'supplier_notice',
    window_ends_at: '2026-09-05T12:00:00.000Z',
    window_claim_ids: [ID.claim],
  },
  turn_response_locked: {
    response: 'revise',
    justification: 'The supplier move changes the payback I relied on.',
    confidence: 55,
    implicit: false,
  },
  defense_question: {
    run_question_id: ID.runQuestion,
    question_id: ID.question,
    kind: 'provenance',
    seq: 1,
    rendered_text: 'Where did the 11-month payback come from?',
    follow_up_of: null,
    selecting_event_seq: 12,
  },
  defense_answer: {
    run_question_id: ID.runQuestion,
    text: 'From the assistant; I did not check the date.',
    duration_ms: 42000,
  },
  draft_band: {
    dimension: 'verification',
    band: 'developing',
    status: 'drafted',
    reason: '',
    basis: 'trace',
    provisional: true,
    graph_keys: ['stance_matrix', 'clock_timeline'],
    evidence_event_seqs: [12, 18],
    quotes: [{ event_seq: 18, text: 'I did not check the date.' }],
    rationale: 'One action, none on a load-bearing claim.',
  },
  band_decision: {
    dimension: 'verification',
    decision: 'overridden',
    band: 'proficient',
    note: 'The Source Trace was read correctly in the defense.',
  },
  claim_neutralized: {
    neutralization_id: ID.neutralization,
    claim_id: ID.claim,
    reason: 'wrong_verification_result',
    credit_challenge: true,
    note: 'The authored Source Trace named the wrong document.',
    recompute: {
      dimensions: ['verification', 'calibration'],
      bands_before: { verification: 'developing', calibration: 'novice' },
      bands_after: { verification: 'proficient', calibration: 'developing' },
      points_before: 2,
      points_after: 2.5,
    },
  },
  run_voided: {
    reason: 'unscoreable',
    note: 'The room would not load.',
    re_offered_run_id: ID.run,
  },
  run_reoffered: { from_run_id: ID.run, variant_id: ID.variant },
  debrief_opened: { version: 'confirmed' },
  debrief_answer: {
    stance_to_change: 'I would have traced C3 before accepting it.',
    do_differently: 'Read the retention memo before the deck.',
  },
  probe_fired: {
    claim_id: ID.claim,
    scripted_reversal: 'You are right to push back — I overstated that.',
  },
}

/**
 * The fields of one payload schema, split by whether the schema accepts their absence. Optionality
 * is read from the schema rather than listed here, so a field that becomes optional (or stops
 * being) moves between the two lists on its own.
 *
 * A nullable field is *required*: `null` is a value the writer must supply, which is exactly the
 * distinction 10 §10 draws when it writes `answer_key: null` for an unanswered readiness item and
 * `field_key?` for a claim used through a named field.
 */
function fieldsOf(type: RunEventTypeValue): { required: string[]; optional: string[] } {
  const shape = (EVENT_PAYLOAD_SCHEMAS[type] as z.ZodObject).shape
  const required: string[] = []
  const optional: string[] = []
  for (const [key, field] of Object.entries(shape)) {
    if ((field as z.ZodType).safeParse(undefined).success) optional.push(key)
    else required.push(key)
  }
  return { required, optional }
}

const without = (payload: object, key: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(payload).filter(([name]) => name !== key))

describe('trace event payload schemas', () => {
  it('covers every type in the run_event_type enum, and nothing else', () => {
    // The enum is the database's list (06 §3.4); the schema registry is the code's. A type in one
    // and not the other is either an event that cannot be stored or a column value nothing checks.
    expect([...RUN_EVENT_TYPES].sort()).toEqual([...runEventType.enumValues].sort())
    expect(Object.keys(EVENT_PAYLOAD_SCHEMAS).sort()).toEqual([...RUN_EVENT_TYPES].sort())
  })

  it.each(RUN_EVENT_TYPES)('%s accepts its documented payload', (type) => {
    const result = EVENT_PAYLOAD_SCHEMAS[type].safeParse(PAYLOADS[type])
    expect(result.success ? null : z.prettifyError(result.error)).toBeNull()
  })

  it.each(RUN_EVENT_TYPES)('%s refuses a field it does not declare', (type) => {
    const parsed = EVENT_PAYLOAD_SCHEMAS[type].safeParse({
      ...PAYLOADS[type],
      surprise_field: 'no',
    })
    expect(parsed.success).toBe(false)
  })

  it.each(RUN_EVENT_TYPES)('%s refuses a payload missing any required field', (type) => {
    const { required } = fieldsOf(type)
    // `brief_opened` is the one payload with no required field; its case is the test above.
    if (type === 'brief_opened') {
      expect(required).toEqual([])
      return
    }
    expect(required.length).toBeGreaterThan(0)
    for (const key of required) {
      const parsed = EVENT_PAYLOAD_SCHEMAS[type].safeParse(without(PAYLOADS[type], key))
      expect(parsed.success, `${type} accepted a payload with no ${key}`).toBe(false)
    }
  })

  it.each(RUN_EVENT_TYPES)('%s accepts a payload without its optional fields', (type) => {
    const { optional } = fieldsOf(type)
    let payload: Record<string, unknown> = { ...PAYLOADS[type] }
    for (const key of optional) payload = without(payload, key)
    const result = EVENT_PAYLOAD_SCHEMAS[type].safeParse(payload)
    expect(result.success ? null : z.prettifyError(result.error)).toBeNull()
  })
})

describe('the rules a payload carries beyond its field list', () => {
  it('holds a frame to exactly three assumptions (FR-040)', () => {
    const two = { ...PAYLOADS.frame_locked, assumptions: ['One', 'Two'] }
    const four = { ...PAYLOADS.frame_locked, assumptions: ['One', 'Two', 'Three', 'Four'] }
    expect(EVENT_PAYLOAD_SCHEMAS.frame_locked.safeParse(two).success).toBe(false)
    expect(EVENT_PAYLOAD_SCHEMAS.frame_locked.safeParse(four).success).toBe(false)
  })

  it('holds confidence to 0–100, and lets it be absent as null', () => {
    const over = { ...PAYLOADS.frame_locked, confidence: 101 }
    expect(EVENT_PAYLOAD_SCHEMAS.frame_locked.safeParse(over).success).toBe(false)
    const implicitHold = {
      ...PAYLOADS.turn_response_locked,
      justification: null,
      confidence: null,
      implicit: true,
    }
    expect(EVENT_PAYLOAD_SCHEMAS.turn_response_locked.safeParse(implicitHold).success).toBe(true)
  })

  it('lets an unanswered readiness item carry a null answer and a null correctness', () => {
    const unanswered = { ...PAYLOADS.readiness_item, answer_key: null, correct: null }
    expect(EVENT_PAYLOAD_SCHEMAS.readiness_item.safeParse(unanswered).success).toBe(true)
  })

  it('refuses a payload whose ids are not UUIDs', () => {
    const bad = { ...PAYLOADS.stance_set, claim_id: 'C3' }
    expect(EVENT_PAYLOAD_SCHEMAS.stance_set.safeParse(bad).success).toBe(false)
  })

  it('refuses a negative duration and a fractional sequence', () => {
    expect(
      EVENT_PAYLOAD_SCHEMAS.document_close.safeParse({
        ...PAYLOADS.document_close,
        duration_ms: -1,
      }).success,
    ).toBe(false)
    expect(
      EVENT_PAYLOAD_SCHEMAS.defense_question.safeParse({ ...PAYLOADS.defense_question, seq: 1.5 })
        .success,
    ).toBe(false)
  })

  it('carries a payload through the read view intact', () => {
    // `defineRoute` validates every answer against `spec.output` and serializes what comes back, so
    // a view schema that dropped payload fields would empty the trace endpoint without failing.
    const parsed = TraceEventViewSchema.parse({
      seq: 4,
      type: 'stance_set',
      occurredAt: '2026-09-05T10:05:00.000Z',
      clockRemainingMs: 1_200_000,
      actorId: 'user-1',
      payload: PAYLOADS.stance_set,
    })
    expect(parsed.payload).toEqual(PAYLOADS.stance_set)
  })

  it('takes a neutralization recompute that touched only some dimensions (10 §11.5)', () => {
    const partial = {
      ...PAYLOADS.claim_neutralized,
      recompute: {
        ...PAYLOADS.claim_neutralized.recompute,
        dimensions: ['verification'],
        bands_before: { verification: 'developing' },
        bands_after: { verification: null },
      },
    }
    const result = EVENT_PAYLOAD_SCHEMAS.claim_neutralized.safeParse(partial)
    expect(result.success ? null : z.prettifyError(result.error)).toBeNull()
  })
})
