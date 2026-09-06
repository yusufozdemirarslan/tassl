// Step 10.1 — the exported trace document (docs/prd/Tassl-PRD.md §12; 10-backend-spec-modules.md
// §10; FR-170, FR-240 to FR-243, D-370).
//
// The document's shape is a specification a person can read, so the example below is written out by
// hand rather than produced by the builder: a test that fed `buildTraceExport` its own output would
// prove the two agree and nothing about whether either matches PRD §12. Every field here is
// transcribed from that section and from 10 §10's tables.
//
// What the four groups of tests are for:
//
//   * **The example parses**, in both forms, with the header fields, the events, the claim table
//     and the computed block PRD §12 lists.
//   * **A course-form key in the record form is refused** — `weight`, `mapping` or `points`, at any
//     depth, which is FR-170's whole rule. `strictObject` is what makes it a parse error rather
//     than a leak, so the test asks for the error at each of the three depths it can occur at.
//   * **The record form carries nothing 12 §8.1 forbids a student**: no field `owner-view.ts` marks
//     `reviewer_only` may appear in a record-form payload (D-370).
//   * **`x_tassl_extensions` is the build's additions to PRD §12's event list** (FR-241), derived
//     rather than transcribed, so a thirty-third event type announces itself.
import { describe, expect, it } from 'vitest'
import {
  CourseTraceExportSchema,
  RecordTraceExportSchema,
  TRACE_EXPORT_VERSION,
  X_TASSL_EXTENSIONS,
  traceExportSchema,
} from '@/server/modules/trace/export-schema'
import { fieldPolicyFor } from '@/server/modules/trace/owner-view'
import { RUN_EVENT_TYPES, type RunEventTypeValue } from '@/server/modules/trace/schema'

const RUN_ID = '11111111-1111-4111-8111-111111111111'
const PACKAGE_ID = '22222222-2222-4222-8222-222222222222'
const CLAIM_ID = '33333333-3333-4333-8333-333333333333'
const ITEM_ID = '44444444-4444-4444-8444-444444444444'
const DELEGATION_ID = '55555555-5555-4555-8555-555555555555'

const MAPPING = { novice: 1, developing: 2, proficient: 3, professional: 4 }

/** The header PRD §12 "Run header" lists, in the course form. */
const COURSE_HEADER = {
  run_id: RUN_ID,
  package_id: PACKAGE_ID,
  package_version: 1,
  variant_key: 'defective',
  mode: 'standard',
  package_confirmation_record: [
    {
      element_type: 'claim',
      element_id: CLAIM_ID,
      decision: 'confirmed',
      decided_by_role: 'instructor',
      decided_at: '2026-09-01T10:00:00.000Z',
    },
    {
      element_type: 'brief',
      element_id: null,
      decision: 'edited',
      decided_by_role: 'instructor',
      decided_at: '2026-09-01T10:01:00.000Z',
    },
  ],
  policy: { outside_ai_policy: 'declared', weight: 5, mapping: MAPPING },
  working_clock_seconds: 1500,
  working_clock_uncalibrated: true,
  readiness: [
    { concept_key: 'source-provenance', status: 'held' },
    { concept_key: 'cohort-comparison', status: 'not_held' },
  ],
  transitions: [
    { state: 'readiness', at: '2026-09-02T09:00:00.000Z' },
    { state: 'framing', at: '2026-09-02T09:08:00.000Z' },
  ],
  is_walkthrough: true,
  x_tassl_extensions: [...X_TASSL_EXTENSIONS],
}

/** One event of each of the four types the two forms treat differently, plus one they do not. */
const COURSE_EVENTS = [
  {
    seq: 1,
    type: 'policy_displayed',
    occurred_at: '2026-09-02T09:00:00.000Z',
    clock_remaining_ms: null,
    payload: {
      outside_ai_policy: 'declared',
      weight: 5,
      mapping: MAPPING,
      run_type: 'decision',
      counts_statement: true,
    },
  },
  {
    seq: 2,
    type: 'readiness_item',
    occurred_at: '2026-09-02T09:05:00.000Z',
    clock_remaining_ms: null,
    payload: {
      item_id: ITEM_ID,
      item_key: 'R1',
      category: 'foundation',
      concept_key: 'source-provenance',
      answer_key: 'b',
      correct: true,
    },
  },
  {
    seq: 3,
    type: 'delegation',
    occurred_at: '2026-09-02T09:30:00.000Z',
    clock_remaining_ms: 1_200_000,
    payload: {
      delegation_id: DELEGATION_ID,
      seq: 1,
      request_text: 'What is the premium payback?',
      response_text: 'Eleven months, from the cohort table.',
      claim_ids: [CLAIM_ID],
      why: null,
      in_turn_window: false,
      flags: ['out_of_scenario'],
      unverified_numbers: [{ value: '11', context: 'months' }],
      failed: false,
    },
  },
  {
    seq: 4,
    type: 'brief_opened',
    occurred_at: '2026-09-02T09:40:00.000Z',
    clock_remaining_ms: 600_000,
    payload: {},
  },
]

/** One row per consequential claim in the variant, as 10 §10 lists the fields. */
const CLAIMS = [
  {
    claim_id: CLAIM_ID,
    claim_version: 1,
    key: 'C3',
    evidence_status: 'defective',
    failure_family: 'stale_evidence',
    importance: 'load_bearing',
    consequence_level: 'high',
    warranted_stance: 'verify',
    stance_taken: 'accept',
    stance_taken_at: '2026-09-02T09:35:00.000Z',
    previous_stance: null,
    actions: ['source_trace'],
    relied_on: true,
    relied_on_via: ['named_field'],
    neutralized: false,
    inconsistency_credited: false,
    readiness_context: { concept_key: 'source-provenance', status: 'held' },
  },
]

const COMPUTED = {
  confidence: { frame: 40, lock: 45, turn: 55 },
  false_challenge_rate: 0.727,
  rubric_version: 'v1',
  exported_at: '2026-09-06T12:00:00.000Z',
  export_version: TRACE_EXPORT_VERSION,
}

const courseExample = () => ({
  header: structuredClone(COURSE_HEADER),
  events: structuredClone(COURSE_EVENTS),
  claims: structuredClone(CLAIMS),
  computed: { ...structuredClone(COMPUTED), points: 2.286 },
})

/** The same object without one key, for writing an expectation the way the projection builds it. */
function without(payload: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(payload).filter(([name]) => name !== key))
}

/** The same run, in the form the student's Judgment Record holds (FR-243). */
const recordExample = () => {
  const example = courseExample()
  return {
    header: {
      ...example.header,
      policy: { outside_ai_policy: 'declared' },
    },
    events: [
      {
        ...example.events[0]!,
        payload: { outside_ai_policy: 'declared', run_type: 'decision', counts_statement: true },
      },
      example.events[1]!,
      {
        ...example.events[2]!,
        // `flags` is the reviewer's observation on the delegation (12 §8.1, FR-055), so the
        // student's copy is the payload without it.
        payload: without(example.events[2]!.payload as Record<string, unknown>, 'flags'),
      },
      example.events[3]!,
    ],
    claims: example.claims,
    computed: structuredClone(COMPUTED),
  }
}

describe('the exported trace document', () => {
  it('accepts the documented example in the course form', () => {
    const parsed = CourseTraceExportSchema.safeParse(courseExample())
    expect(parsed.error?.issues ?? []).toEqual([])
    expect(parsed.success).toBe(true)
  })

  it('accepts the documented example in the record form', () => {
    const parsed = RecordTraceExportSchema.safeParse(recordExample())
    expect(parsed.error?.issues ?? []).toEqual([])
    expect(parsed.success).toBe(true)
  })

  it('answers the form asked for', () => {
    expect(traceExportSchema('course')).toBe(CourseTraceExportSchema)
    expect(traceExportSchema('record')).toBe(RecordTraceExportSchema)
  })
})

// ---------------------------------------------------------------------------------------------
// FR-170: no weight, mapping or points in the record form, at any depth
// ---------------------------------------------------------------------------------------------

describe('the record form refuses a course-form key', () => {
  it('rejects `weight` and `mapping` in the header policy', () => {
    const document = recordExample()
    const policy = document.header.policy as Record<string, unknown>
    policy.weight = 5
    expect(RecordTraceExportSchema.safeParse(document).success).toBe(false)

    const second = recordExample()
    ;(second.header.policy as Record<string, unknown>).mapping = MAPPING
    expect(RecordTraceExportSchema.safeParse(second).success).toBe(false)
  })

  it('rejects `weight` and `mapping` in the `policy_displayed` payload', () => {
    const document = recordExample()
    ;(document.events[0]!.payload as Record<string, unknown>).weight = 5
    expect(RecordTraceExportSchema.safeParse(document).success).toBe(false)

    const second = recordExample()
    ;(second.events[0]!.payload as Record<string, unknown>).mapping = MAPPING
    expect(RecordTraceExportSchema.safeParse(second).success).toBe(false)
  })

  it('rejects `points` in the computed block', () => {
    const document = recordExample()
    ;(document.computed as Record<string, unknown>).points = 2.286
    expect(RecordTraceExportSchema.safeParse(document).success).toBe(false)
  })

  it('rejects the whole course-form document', () => {
    expect(RecordTraceExportSchema.safeParse(courseExample()).success).toBe(false)
  })

  it('is the only difference the course form refuses in the other direction', () => {
    // The course form needs `points` and the full policy, so a record-form document is not a course
    // one either: the two are separate documents, not one with optional fields.
    expect(CourseTraceExportSchema.safeParse(recordExample()).success).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------
// D-370: the record form is a student view (12 §8.1)
// ---------------------------------------------------------------------------------------------

/** Every field `owner-view.ts` withholds from the run's own student in every state. */
function reviewerOnlyKeys(type: RunEventTypeValue): string[] {
  return Object.entries(fieldPolicyFor(type) ?? {})
    .filter(([, visibility]) => visibility === 'reviewer_only')
    .map(([key]) => key)
}

describe('the record form carries nothing a student may never see', () => {
  it('refuses every reviewer-only payload field, for every event type', () => {
    const refused: string[] = []
    for (const type of RUN_EVENT_TYPES) {
      for (const key of reviewerOnlyKeys(type)) {
        const document = recordExample()
        document.events = [
          {
            seq: 1,
            type,
            occurred_at: '2026-09-02T09:00:00.000Z',
            clock_remaining_ms: null,
            payload: { [key]: 'anything' },
          },
        ] as typeof document.events
        if (RecordTraceExportSchema.safeParse(document).success) refused.push(`${type}.${key}`)
      }
    }
    expect(refused).toEqual([])
  })

  it('names the five fields that difference actually removes', () => {
    // Transcribed from 12 §8.1 rather than read from the table: these are the payload fields the
    // security spec forbids a student in any state, and they are what D-370 keeps out of the record.
    const removed = RUN_EVENT_TYPES.flatMap((type) =>
      reviewerOnlyKeys(type).map((key) => `${type}.${key}`),
    )
    for (const field of [
      'delegation.flags',
      'decision_locked.speed_outlier',
      'defense_question.question_id',
      'defense_question.selecting_event_seq',
      'turn_delivered.window_claim_ids',
    ]) {
      expect(removed).toContain(field)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// FR-241: the build's additions to PRD §12's event list
// ---------------------------------------------------------------------------------------------

describe('x_tassl_extensions', () => {
  it('is exactly the five event types PRD §12 does not list', () => {
    expect([...X_TASSL_EXTENSIONS].sort()).toEqual([
      'lifecycle',
      'policy_displayed',
      'probe_fired',
      'readiness_skipped',
      'run_reoffered',
    ])
  })

  it('names only types the trace can actually hold', () => {
    for (const type of X_TASSL_EXTENSIONS) expect(RUN_EVENT_TYPES).toContain(type)
  })
})
