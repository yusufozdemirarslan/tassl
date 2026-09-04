// The companion test docs/tech/12-security.md §8 names by path: "a unit test asserts the two
// constants cover every key listed above" (12 §8.2, closing paragraph; D-117).
//
// The one way a test like this proves nothing is by deriving what it expects from the thing it is
// checking. So the tables below are transcribed from 12 §8.1 and §8.2 by hand, in the spelling the
// specification uses — the snake_case of the Postgres column — and the camelCase form is derived
// here rather than imported, because `student-view.ts` derives it there and a shared helper would
// make the two agree by construction instead of by agreement.
//
// Both directions are asserted, and the second is the one that catches drift: every key the
// specification lists is in the set (a forgotten row is a leak), and every key in the set is either
// in the specification or in the short list of deliberate additions recorded below with its reason
// (an unexplained key is a rule nobody can find the source of, and the first thing deleted by
// someone tidying up).
import { describe, expect, it } from 'vitest'
import {
  STUDENT_FORBIDDEN_KEYS_ALWAYS,
  STUDENT_FORBIDDEN_KEYS_BEFORE_SCORED,
  STUDENT_FORBIDDEN_KEYS_RECORD_FORM,
} from '@/server/auth/student-view'

// ---------------------------------------------------------------------------------------------
// 12 §8.1 — "Never, in any state"
// ---------------------------------------------------------------------------------------------

/** One row of the table, as the specification writes it: the source, the reason, and the columns. */
type Row = { source: string; why: string; keys: readonly string[] }

const ALWAYS_ROWS: readonly Row[] = [
  {
    source: 'seed_records',
    why: 'FR-028',
    keys: [
      'seed_text',
      'case_title',
      'publisher',
      'license_terms',
      'license_permits_adaptation',
      'reskin_log',
    ],
  },
  {
    source: 'defense_questions, run_defense_questions',
    why: 'FR-123',
    keys: [
      'defense_questions',
      'condition',
      'follow_up',
      'expected_answer_notes',
      'is_default',
      'selecting_event_seq',
    ],
  },
  {
    source: 'scenario_package_versions, scenario_claims',
    why: 'FR-093 (the reply text is delivered only as an escalation response)',
    keys: ['general_escalation_reply', 'escalatable', 'escalation_reply'],
  },
  {
    source: 'scenario_claims',
    why: 'Would let a student enumerate or map claims',
    keys: [
      'trigger_phrases',
      'trigger_description',
      'carried_values',
      'weakly_sourced',
      'volatile',
    ],
  },
  {
    source: 'stakeholders',
    why: 'FR-030 (they reach the student only as documents)',
    keys: ['incentives', 'blind_spots', 'contradicts_stakeholder_id', 'contradiction_point'],
  },
  {
    source: 'scenario_turns',
    why: 'FR-114',
    keys: [
      'warrants_change',
      'proportionate_response',
      'evidence',
      'disrupted_assumption_keys',
      'window_claim_ids',
    ],
  },
  {
    source: 'sycophancy_probes',
    why: 'FR-053',
    keys: ['original_position', 'scripted_reversal'],
  },
  { source: 'readiness_items', why: 'FR-012', keys: ['answer_key'] },
  {
    source: 'runs.flags, run_briefs',
    why: 'FR-106, FR-118, FR-141',
    keys: [
      'forced_failure_armed',
      'speed_outlier',
      'all_novice',
      'all_professional',
      'nothing_answered',
    ],
  },
  // The table's tenth row — "Any other student's run, debrief, record, or list row" (FR-154) — names
  // no column, because it is a row-level rule: `requireRunOwner` answers a foreign run NOT_FOUND and
  // no student query loads another student's row. It is recorded here so that a reader comparing
  // this file with the table finds it accounted for rather than missing.
  { source: 'runs', why: 'FR-154 — enforced by requireRunOwner, not by a key', keys: [] },
]

/**
 * The eleventh row of §8.1: `weight`, `mapping`, `points` *inside the record export form*. They are
 * a set of their own rather than part of the always-set, and §8.3 is why — the debrief does show a
 * student their weight, the band mapping and the points their bands map to (FR-170); it is the
 * record, the artifact that leaves Tassl for the course, that carries bands without the course's
 * arithmetic. An always-set that held them would forbid the debrief the PRD requires.
 */
const RECORD_FORM_ROW: readonly string[] = ['weight', 'mapping', 'points']

// ---------------------------------------------------------------------------------------------
// 12 §8.2 — "Never before the run is `scored`"
// ---------------------------------------------------------------------------------------------

const BEFORE_SCORED_ROWS: readonly Row[] = [
  { source: 'variant_claim_states', why: 'FR-134', keys: ['warranted_stance'] },
  { source: 'variant_claim_states', why: 'Stance matrix rows', keys: ['evidence_status'] },
  { source: 'variant_claim_states', why: 'FR-151, FR-240', keys: ['failure_family'] },
  { source: 'variant_claim_states', why: 'Missed-defect section', keys: ['planted'] },
  { source: 'variant_claim_states', why: 'FR-151', keys: ['verification_paths'] },
  { source: 'scenario_claims', why: 'FR-151', keys: ['rationale'] },
  { source: 'scenario_claims', why: 'FR-015', keys: ['concept_key'] },
  {
    source: 'scenario_documents',
    why: 'Missed-defect section naming the superseding document',
    keys: ['role', 'superseded_by_document_id', 'stakeholder_id'],
  },
  {
    source: 'answer_space_positions',
    why: 'FR-109',
    keys: ['answer_space_positions', 'ignored_evidence', 'is_minimum_commitment'],
  },
  {
    source: 'run_escalations',
    why: 'Clock timeline segments',
    keys: ['response_id', 'counts_against_limit'],
  },
  {
    source: 'scenario_package_versions',
    why: 'The counterfactual section',
    keys: ['debrief_counterfactual'],
  },
]

// ---------------------------------------------------------------------------------------------
// The keys the sets add on purpose, and why
//
// Each is a name the specification's table does not spell because the table names Postgres columns
// and these are not columns: a JSON container, or the element-key form the portable export uses in
// place of an id (SYS-026). They are listed here so "nothing in the sets is unexplained" can be
// asserted without the assertion becoming a copy of the sets.
// ---------------------------------------------------------------------------------------------

const ALWAYS_ADDITIONS: readonly Row[] = [
  {
    source: 'the version view',
    why: 'the seed record container: `seedRecord: null` on a student payload leaks its shape',
    keys: ['seed_record'],
  },
  {
    source: 'the package export (SYS-026)',
    why: 'the export names references by element key, so both forms are forbidden',
    keys: ['contradicts_stakeholder_key', 'window_claim_keys'],
  },
  {
    source: 'runs.flags',
    why: 'the container, so a flag added to the column later is caught without editing this list',
    keys: ['flags'],
  },
]

const BEFORE_SCORED_ADDITIONS: readonly Row[] = [
  {
    source: 'the package export (SYS-026)',
    why: 'the key form of the two document references §8.2 names by id',
    keys: ['superseded_by_key', 'stakeholder_key'],
  },
  {
    source: 'a document view',
    why: '`role` under the name a payload would give it to avoid the bare word',
    keys: ['document_role'],
  },
]

// ---------------------------------------------------------------------------------------------
// The comparison
// ---------------------------------------------------------------------------------------------

/**
 * The camelCase this codebase names a column with. Written here rather than imported: the source
 * derives its snake_case from its camelCase, and reusing that function would make the two sides
 * agree by construction. Two independent derivations that meet is the assertion.
 */
const camel = (snake: string): string =>
  snake.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase())

const bothSpellings = (rows: readonly Row[]): string[] =>
  rows.flatMap((row) => row.keys).flatMap((key) => [key, camel(key)])

const named = (rows: readonly Row[]): string[] => rows.flatMap((row) => row.keys)

describe('the student-view key sets cover the tables of 12-security.md §8', () => {
  it('spells every key of §8.1 in both forms', () => {
    const set = new Set(STUDENT_FORBIDDEN_KEYS_ALWAYS)
    for (const row of ALWAYS_ROWS) {
      for (const key of row.keys) {
        expect(set.has(key), `§8.1 (${row.source}, ${row.why}) lists ${key}`).toBe(true)
        expect(set.has(camel(key)), `§8.1 lists ${key}; ${camel(key)} is how we spell it`).toBe(
          true,
        )
      }
    }
    // The control: the transcription is not empty and not a handful of rows.
    expect(named(ALWAYS_ROWS)).toHaveLength(37)
  })

  it('spells every key of §8.2 in both forms', () => {
    const set = new Set(STUDENT_FORBIDDEN_KEYS_BEFORE_SCORED)
    for (const row of BEFORE_SCORED_ROWS) {
      for (const key of row.keys) {
        expect(set.has(key), `§8.2 (${row.source}, ${row.why}) lists ${key}`).toBe(true)
        expect(set.has(camel(key)), `§8.2 lists ${key}; ${camel(key)} is how we spell it`).toBe(
          true,
        )
      }
    }
    expect(named(BEFORE_SCORED_ROWS)).toHaveLength(16)
  })

  it('keeps weight, mapping and points for the record export form (§8.1 last row, FR-170)', () => {
    expect([...STUDENT_FORBIDDEN_KEYS_RECORD_FORM].sort()).toEqual([...RECORD_FORM_ROW].sort())
    // And deliberately not in the always-set: the debrief shows a student all three (§8.3).
    const always = new Set(STUDENT_FORBIDDEN_KEYS_ALWAYS)
    for (const key of RECORD_FORM_ROW) expect(always.has(key)).toBe(false)
  })

  it('holds nothing beyond those tables that is not written down here', () => {
    expect(new Set(STUDENT_FORBIDDEN_KEYS_ALWAYS)).toEqual(
      new Set([...bothSpellings(ALWAYS_ROWS), ...bothSpellings(ALWAYS_ADDITIONS)]),
    )
    expect(new Set(STUDENT_FORBIDDEN_KEYS_BEFORE_SCORED)).toEqual(
      new Set([...bothSpellings(BEFORE_SCORED_ROWS), ...bothSpellings(BEFORE_SCORED_ADDITIONS)]),
    )
  })

  it('keeps the two sets disjoint, so a finding names one rule', () => {
    const before = new Set(STUDENT_FORBIDDEN_KEYS_BEFORE_SCORED)
    const shared = STUDENT_FORBIDDEN_KEYS_ALWAYS.filter((key) => before.has(key))
    expect(shared).toEqual([])
  })
})
