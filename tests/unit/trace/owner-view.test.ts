// Step 6.1 fix — what the run's *owner* may read of their own trace
// (docs/tech/12-security.md §8; D-117; FR-007, FR-012, FR-053, FR-055, FR-106, FR-114, FR-123).
//
// `src/server/modules/trace/owner-view.ts` answers two questions with two total tables: whether the
// owner may read at all (by run state) and which fields they get (by event type). Both are checked
// by the compiler, which is the point of writing them that way — but a compiler check and a test
// that transcribes the specification are two derivations of the same rule, and 12 §8.3 asks for
// both so they meet rather than agree by construction. So the state list below is transcribed from
// 10 §9's transition table and the key sets are read from `student-view.ts`, not from the module
// under test.
//
// The three tests that matter most:
//
//   * the field table classifies exactly the fields each payload schema declares — a renamed field
//     is caught here even where the compiler is satisfied;
//   * no field a student may read is named in 12 §8.1's never-in-any-state set, and no field they
//     may read *before scoring* is named in 12 §8.2's set, with exactly three exemptions, each of
//     which is a word the two documents use for opposite things;
//   * `ownerPayload` picks rather than deletes, so a field in the stored jsonb that nobody
//     classified never reaches a student.
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  STUDENT_FORBIDDEN_KEYS_ALWAYS,
  STUDENT_FORBIDDEN_KEYS_BEFORE_SCORED,
} from '@/server/auth/student-view'
import {
  fieldPolicyFor,
  ownerAccessFor,
  ownerPayload,
  type FieldVisibility,
  type OwnerAccess,
} from '@/server/modules/trace/owner-view'
import {
  EVENT_PAYLOAD_SCHEMAS,
  RUN_EVENT_TYPES,
  type RunEventTypeValue,
} from '@/server/modules/trace/schema'

/** The fields a payload schema declares, read from the schema rather than from the table. */
function schemaFields(type: RunEventTypeValue): string[] {
  return Object.keys((EVENT_PAYLOAD_SCHEMAS[type] as z.ZodObject).shape).sort()
}

function policyOf(type: RunEventTypeValue): Record<string, FieldVisibility> {
  const policy = fieldPolicyFor(type)
  if (!policy) throw new Error(`no owner-view policy for ${type}`)
  return policy
}

/** Every (type, field, visibility) triple in the table. */
const ENTRIES = RUN_EVENT_TYPES.flatMap((type) =>
  Object.entries(policyOf(type)).map(([field, visibility]) => ({ type, field, visibility })),
)

// ---------------------------------------------------------------------------------------------
// Access by run state (10 §9)
// ---------------------------------------------------------------------------------------------

/**
 * The eighteen `run_state` values of 10 §9, transcribed, each with what the owner may read there
 * and why. `sealed` for `turn_locked` through `defense_complete` is the finding this fix is for:
 * the defense is what a student can say with nothing in front of them but their own frame, brief,
 * addendum and Turn response (UI-026), and the trace served in a second tab is the room back.
 */
const EXPECTED_ACCESS: Record<string, OwnerAccess> = {
  // In the run: the Evidence Room, the Delegation Log and the claim table are on their screen.
  assigned: 'open',
  readiness: 'open',
  framing: 'open',
  working: 'open',
  paused: 'open',
  decision_locked: 'open',
  turn_open: 'open',
  // The defense (UI-026, FR-120): no assistant, no room.
  turn_locked: 'sealed',
  defense_pending: 'sealed',
  defense_complete: 'sealed',
  // Scored: D-117's "never before the run is scored" is satisfied and the debrief exists.
  scored: 'scored',
  confirmed: 'scored',
  recorded: 'scored',
  // A run that will never be scored never earns the reveal; a voided run is re-offered (FR-183).
  voided: 'sealed',
  abandoned: 'sealed',
  defense_missed: 'sealed',
  under_appeal: 'sealed',
  expired: 'sealed',
}

describe('who may read the trace, by run state', () => {
  it('answers every run state of 10 §9, as the table above transcribes it', () => {
    for (const [state, expected] of Object.entries(EXPECTED_ACCESS)) {
      expect(`${state}: ${ownerAccessFor(state)}`).toBe(`${state}: ${expected}`)
    }
  })

  it('seals the trace through the defense, which is the whole of UI-026', () => {
    for (const state of ['turn_locked', 'defense_pending', 'defense_complete']) {
      expect(ownerAccessFor(state)).toBe('sealed')
    }
  })

  it('seals a state it does not recognise, so a later migration cannot open the trace by default', () => {
    expect(ownerAccessFor('under_review_by_a_future_build')).toBe('sealed')
    expect(ownerAccessFor('')).toBe('sealed')
  })
})

// ---------------------------------------------------------------------------------------------
// The field table (12 §8.1, §8.2)
// ---------------------------------------------------------------------------------------------

describe('the owner field table', () => {
  it('classifies exactly the fields each payload schema declares', () => {
    for (const type of RUN_EVENT_TYPES) {
      expect(`${type}: ${Object.keys(policyOf(type)).sort().join(',')}`).toBe(
        `${type}: ${schemaFields(type).join(',')}`,
      )
    }
  })

  it('uses only the three visibilities', () => {
    const allowed = new Set<FieldVisibility>(['owner', 'after_scored', 'reviewer_only'])
    for (const entry of ENTRIES) expect(allowed.has(entry.visibility)).toBe(true)
  })

  /**
   * The three words 12 §8 and the trace use for opposite things. `readiness_item.answer_key` is the
   * option the *student* chose, not the item's key; `readiness_item.concept_key` is the concept map
   * FR-012 hands them at submit, not a claim's authored concept; `decision_locked.rationale` is the
   * student's own brief, not a claim's authored rationale. Anything else colliding is a leak.
   */
  const EXEMPT = new Set([
    'readiness_item.answer_key',
    'readiness_item.concept_key',
    'decision_locked.rationale',
  ])

  it('never shows a student a key 12 §8.1 forbids in every state', () => {
    const always = new Set(STUDENT_FORBIDDEN_KEYS_ALWAYS)
    const leaks = ENTRIES.filter(
      (entry) =>
        entry.visibility !== 'reviewer_only' &&
        always.has(entry.field) &&
        !EXEMPT.has(`${entry.type}.${entry.field}`),
    ).map((entry) => `${entry.type}.${entry.field}`)
    expect(leaks).toEqual([])
  })

  it('never shows a student a key 12 §8.2 forbids before the run is scored', () => {
    const beforeScored = new Set(STUDENT_FORBIDDEN_KEYS_BEFORE_SCORED)
    const leaks = ENTRIES.filter(
      (entry) =>
        entry.visibility === 'owner' &&
        beforeScored.has(entry.field) &&
        !EXEMPT.has(`${entry.type}.${entry.field}`),
    ).map((entry) => `${entry.type}.${entry.field}`)
    expect(leaks).toEqual([])
  })

  it('exempts exactly the three documented collisions, and each really is exempt', () => {
    for (const name of EXEMPT) {
      const [type, field] = name.split('.') as [RunEventTypeValue, string]
      expect(`${name}: ${policyOf(type)[field]}`).toBe(`${name}: owner`)
    }
  })

  /**
   * Finding 1's second half. The owner's `seq` is renumbered densely so a hidden `probe_fired`
   * leaves no hole; a payload field carrying a *stored* trace sequence would carry the real
   * numbering straight past that (FR-053, D-088).
   */
  it('keeps every field that carries a stored trace sequence away from the owner', () => {
    expect(policyOf('defense_question').selecting_event_seq).toBe('reviewer_only')
    expect(policyOf('draft_band').evidence_event_seqs).toBe('reviewer_only')
    // Each quote is `{ event_seq, text }`; the debrief projects the quotes without the sequence.
    expect(policyOf('draft_band').quotes).toBe('reviewer_only')
  })

  it('keeps the whole probe payload away from the owner, under the type filter as well', () => {
    expect(policyOf('probe_fired')).toEqual({
      claim_id: 'reviewer_only',
      scripted_reversal: 'reviewer_only',
    })
  })

  it('withholds the instructor observations 12 §8.1 names', () => {
    expect(policyOf('decision_locked').speed_outlier).toBe('reviewer_only')
    expect(policyOf('delegation').flags).toBe('reviewer_only')
    expect(policyOf('turn_delivered').window_claim_ids).toBe('reviewer_only')
    expect(policyOf('defense_question').question_id).toBe('reviewer_only')
    expect(policyOf('band_decision').note).toBe('reviewer_only')
    expect(policyOf('claim_neutralized').note).toBe('reviewer_only')
    expect(policyOf('run_voided').note).toBe('reviewer_only')
  })
})

// ---------------------------------------------------------------------------------------------
// The projection itself
// ---------------------------------------------------------------------------------------------

describe('ownerPayload', () => {
  const escalation = {
    escalation_id: '11111111-1111-4111-8111-111111111111',
    claim_id: '22222222-2222-4222-8222-222222222222',
    statement: 'I cannot tell whether this cohort comparison was computed.',
    response_id: 'claim',
    response_text: 'That figure came from the Q3 memo.',
    clock_cost_ms: 300_000,
    counts_against_limit: true,
    in_turn_window: false,
  }

  it('withholds the after-scored fields while the run is open (D-117, D-116)', () => {
    const view = ownerPayload('escalation', escalation, 'open')
    expect(view).not.toHaveProperty('response_id')
    expect(view).not.toHaveProperty('counts_against_limit')
    // Their own statement and the reply they were given stay.
    expect(view).toMatchObject({
      statement: escalation.statement,
      response_text: escalation.response_text,
    })
  })

  it('gives them back once the run is scored, which is the half D-117 makes state-dependent', () => {
    const view = ownerPayload('escalation', escalation, 'scored')
    expect(view).toMatchObject({ response_id: 'claim', counts_against_limit: true })
  })

  it('never gives a reviewer-only field, scored or not', () => {
    const locked = { speed_outlier: true, recommendation: 'Hold the spend' }
    for (const access of ['open', 'scored'] as const) {
      const view = ownerPayload('decision_locked', locked, access)
      expect(view).not.toHaveProperty('speed_outlier')
      expect(view).toMatchObject({ recommendation: 'Hold the spend' })
    }
  })

  /**
   * The property the whole file is for: this is a pick, not a deletion (12 §8). A row written by a
   * build that knows a field this one does not must not carry it to a student — nobody would have
   * had to name it.
   */
  it('drops a field nobody classified, rather than passing it through', () => {
    const view = ownerPayload(
      'brief_closed',
      { duration_ms: 4000, warranted_stance: 'challenge' },
      'scored',
    )
    expect(view).toEqual({ duration_ms: 4000 })
  })

  it('does not invent an absent optional field', () => {
    const view = ownerPayload(
      'claim_used',
      { claim_id: '33333333-3333-4333-8333-333333333333', via: 'log_mark' },
      'open',
    )
    expect(view).toEqual({ claim_id: '33333333-3333-4333-8333-333333333333', via: 'log_mark' })
    expect(Object.hasOwn(view, 'field_key')).toBe(false)
  })

  it('gives an event type it cannot name an empty body rather than the stored one', () => {
    expect(ownerPayload('an_event_type_from_a_later_build', { anything: 1 }, 'scored')).toEqual({})
  })
})
