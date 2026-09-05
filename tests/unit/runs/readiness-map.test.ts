// The concept map, and everything else the Readiness Check decides without a database
// (docs/tech/10-backend-spec-modules.md §6; FR-010 to FR-018; PRD §7.1).
//
// Two properties are worth more than the rest and are asserted over every shape this file can
// build:
//
//   1. **The result names concepts and nothing else.** `held`, `not_held`, `unknown` — no total, no
//      percentage, no threshold, no rank, anywhere the student can reach (FR-012, CLAUDE.md).
//   2. **The item's key never travels.** `toReadinessItemViews` is the student's read of the check,
//      and the only `answerKey` in it is the one the student themselves chose (FR-017), null until
//      they choose one.
import { describe, expect, it } from 'vitest'
import {
  conceptMap,
  correctnessOf,
  isOfferedOption,
  planReadinessClose,
  skipAllowed,
  toConceptViews,
  toReadinessItemViews,
  unansweredCount,
  unknownConceptMap,
  type ReadinessAnswerRow,
  type ReadinessItemRow,
} from '@/server/modules/runs/readiness'

const AT = new Date('2026-09-05T10:08:00.000Z')

const OPTIONS = [
  { key: 'a', text: 'First' },
  { key: 'b', text: 'Second' },
  { key: 'c', text: 'Third' },
  { key: 'd', text: 'Fourth' },
]

/** One item; the key that is right is always `b`, so a case says only what the student chose. */
function item(
  key: string,
  conceptKey: string,
  position: number,
  overrides: Partial<ReadinessItemRow> = {},
): ReadinessItemRow {
  return {
    id: `00000000-0000-4000-8000-${position.toString().padStart(12, '0')}`,
    key,
    category: 'foundation',
    conceptKey,
    stem: `Stem for ${key}`,
    options: OPTIONS,
    answerKey: 'b',
    position,
    ...overrides,
  }
}

/** An answer as `run_readiness_answers` stores it, with correctness already computed. */
const answered = (row: ReadinessItemRow, answerKey: string): ReadinessAnswerRow => ({
  itemId: row.id,
  answerKey,
  correct: correctnessOf(row, answerKey),
})

const statusOf = (
  concepts: readonly { concept_key: string; status: string }[],
  conceptKey: string,
): string | undefined => concepts.find((c) => c.concept_key === conceptKey)?.status

// ---------------------------------------------------------------------------------------------
// Correctness (FR-012)
// ---------------------------------------------------------------------------------------------

describe('correctnessOf', () => {
  const one = item('R01', 'payback', 0)

  it('is true only for the item’s own key', () => {
    expect(correctnessOf(one, 'b')).toBe(true)
    expect(correctnessOf(one, 'a')).toBe(false)
    expect(correctnessOf(one, 'd')).toBe(false)
  })

  it('is null — not false — when the item was not answered', () => {
    // The distinction is the whole of the concept map: a wrong answer is a finding, no answer is
    // not (FR-018).
    expect(correctnessOf(one, null)).toBeNull()
  })
})

describe('isOfferedOption', () => {
  const one = item('R01', 'payback', 0)

  it('accepts the four keys the item offers and refuses anything else', () => {
    for (const option of OPTIONS) expect(isOfferedOption(one, option.key)).toBe(true)
    expect(isOfferedOption(one, 'e')).toBe(false)
    expect(isOfferedOption(one, 'B')).toBe(false)
    expect(isOfferedOption(one, '')).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------
// The concept map (10 §6: held / not_held / unknown)
// ---------------------------------------------------------------------------------------------

describe('conceptMap (FR-012)', () => {
  it('held: every item on the concept is correct', () => {
    const items = [item('R01', 'payback', 0), item('R02', 'payback', 1)]
    const map = conceptMap(items, [answered(items[0]!, 'b'), answered(items[1]!, 'b')])
    expect(map).toEqual([{ concept_key: 'payback', status: 'held', correct: 2, total: 2 }])
  })

  it('not_held: one wrong answer is enough, however many were right', () => {
    const items = [item('R01', 'payback', 0), item('R02', 'payback', 1), item('R03', 'payback', 2)]
    const map = conceptMap(items, [
      answered(items[0]!, 'b'),
      answered(items[1]!, 'b'),
      answered(items[2]!, 'a'),
    ])
    expect(map).toEqual([{ concept_key: 'payback', status: 'not_held', correct: 2, total: 3 }])
  })

  it('unknown: an unanswered item, with nothing answered wrongly', () => {
    const items = [item('R01', 'retention', 0), item('R02', 'retention', 1)]
    const map = conceptMap(items, [answered(items[0]!, 'b')])
    expect(map).toEqual([{ concept_key: 'retention', status: 'unknown', correct: 1, total: 2 }])
  })

  it('unknown: nothing on the concept was answered at all', () => {
    const items = [item('R01', 'retention', 0)]
    expect(conceptMap(items, [])).toEqual([
      { concept_key: 'retention', status: 'unknown', correct: 0, total: 1 },
    ])
  })

  it('a wrong answer beats an unanswered item: the check found something out', () => {
    // Both clauses of 10 §6 fire on this concept. `unknown` means the check could not tell, and it
    // told: FR-018 makes *unanswered* concepts unknown, not concepts with a wrong answer in them.
    const items = [
      item('R01', 'survey_error', 0),
      item('R02', 'survey_error', 1),
      item('R03', 'survey_error', 2),
    ]
    const map = conceptMap(items, [answered(items[0]!, 'a')])
    expect(map).toEqual([{ concept_key: 'survey_error', status: 'not_held', correct: 0, total: 3 }])
  })

  it('mixed: each concept is judged on its own items, in the order they first appear', () => {
    const items = [
      item('R01', 'payback', 0),
      item('R02', 'retention', 1),
      item('R03', 'payback', 2),
      item('R04', 'survey_error', 3),
      item('R05', 'ai_reliance', 4),
      item('R06', 'retention', 5),
    ]
    const map = conceptMap(items, [
      answered(items[0]!, 'b'), // payback, right
      answered(items[1]!, 'c'), // retention, wrong
      answered(items[2]!, 'b'), // payback, right
      answered(items[3]!, 'b'), // survey_error, right
      // R05 (ai_reliance) and R06 (retention) unanswered
    ])

    expect(map.map((row) => row.concept_key)).toEqual([
      'payback',
      'retention',
      'survey_error',
      'ai_reliance',
    ])
    expect(statusOf(map, 'payback')).toBe('held')
    expect(statusOf(map, 'retention')).toBe('not_held')
    expect(statusOf(map, 'survey_error')).toBe('held')
    expect(statusOf(map, 'ai_reliance')).toBe('unknown')
  })

  it('reads items in position order, whatever order the rows arrive in', () => {
    const first = item('R01', 'payback', 0)
    const second = item('R02', 'retention', 1)
    expect(conceptMap([second, first], []).map((row) => row.concept_key)).toEqual([
      'payback',
      'retention',
    ])
  })

  it('an answer for an item that is not on the check changes nothing', () => {
    const items = [item('R01', 'payback', 0)]
    const stray: ReadinessAnswerRow = {
      itemId: 'not-on-this-check',
      answerKey: 'a',
      correct: false,
    }
    expect(conceptMap(items, [stray])).toEqual([
      { concept_key: 'payback', status: 'unknown', correct: 0, total: 1 },
    ])
  })
})

describe('unknownConceptMap (a check that could not be completed)', () => {
  it('marks every concept unknown once, with no counts', () => {
    const items = [
      item('R01', 'payback', 0),
      item('R02', 'payback', 1),
      item('R03', 'retention', 2),
    ]
    expect(unknownConceptMap(items)).toEqual([
      { concept_key: 'payback', status: 'unknown', correct: 0, total: 0 },
      { concept_key: 'retention', status: 'unknown', correct: 0, total: 0 },
    ])
  })
})

describe('toConceptViews (what the student receives)', () => {
  it('is the concept and its status, and carries no count', () => {
    const items = [item('R01', 'payback', 0), item('R02', 'retention', 1)]
    const views = toConceptViews(conceptMap(items, [answered(items[0]!, 'b')]))

    expect(views).toEqual([
      { conceptKey: 'payback', status: 'held' },
      { conceptKey: 'retention', status: 'unknown' },
    ])
    // No total, no percentage, no rank: FR-012 and CLAUDE.md allow no composite anywhere.
    for (const view of views) expect(Object.keys(view).sort()).toEqual(['conceptKey', 'status'])
  })
})

// ---------------------------------------------------------------------------------------------
// The student's view of the items (FR-012, FR-017)
// ---------------------------------------------------------------------------------------------

describe('toReadinessItemViews', () => {
  const items = [
    item('R01', 'payback', 1, { category: 'defect_concept' }),
    item('R02', 'retention', 0),
  ]

  it('never carries the item’s key, its concept, or anything about correctness', () => {
    const views = toReadinessItemViews(items, [answered(items[0]!, 'a')])
    for (const view of views) {
      expect(Object.keys(view).sort()).toEqual([
        'answerKey',
        'category',
        'id',
        'options',
        'position',
        'stem',
      ])
      expect(JSON.stringify(view)).not.toContain('conceptKey')
      expect(JSON.stringify(view)).not.toContain('correct')
    }
  })

  it('answerKey is the student’s own answer, null until they give one (FR-017)', () => {
    const views = toReadinessItemViews(items, [answered(items[0]!, 'a')])
    // Sorted by position, so R02 comes first.
    expect(views.map((view) => [view.id, view.answerKey])).toEqual([
      [items[1]!.id, null],
      [items[0]!.id, 'a'],
    ])
  })

  it('the wrong answer is returned as the student left it, not corrected', () => {
    // 'a' is wrong on every item here, and the view says 'a'. Correctness is stored, never returned.
    const [, second] = toReadinessItemViews(items, [answered(items[0]!, 'a')])
    expect(second?.answerKey).toBe('a')
  })
})

// ---------------------------------------------------------------------------------------------
// Closing the check (10 §6, 10 §8 branch 1, FR-018)
// ---------------------------------------------------------------------------------------------

describe('planReadinessClose', () => {
  const items = [item('R01', 'payback', 0), item('R02', 'payback', 1), item('R03', 'retention', 2)]
  const partly = [answered(items[0]!, 'b'), answered(items[1]!, 'a')]

  it('counts what is unanswered', () => {
    expect(unansweredCount(items, partly)).toBe(1)
    expect(unansweredCount(items, [])).toBe(3)
  })

  it('submitted: one event per item, the computed map, no skip', () => {
    const plan = planReadinessClose(items, partly, 'submitted', AT)

    expect(plan.itemEvents).toHaveLength(3)
    expect(plan.itemEvents.map((event) => event.item_key)).toEqual(['R01', 'R02', 'R03'])
    expect(plan.itemEvents[0]).toEqual({
      item_id: items[0]!.id,
      item_key: 'R01',
      category: 'foundation',
      concept_key: 'payback',
      answer_key: 'b',
      correct: true,
    })
    // Unanswered items travel with both fields null (10 §6).
    expect(plan.itemEvents[2]).toMatchObject({ answer_key: null, correct: null })
    expect(plan.skippedEvent).toBeNull()
    expect(plan.skipped).toBe(false)
    expect(plan.submittedAt).toBe(AT)
    expect(plan.cause).toBe('readiness_submitted')
    expect(statusOf(plan.concepts, 'payback')).toBe('not_held')
    expect(statusOf(plan.concepts, 'retention')).toBe('unknown')
  })

  it('expired with unanswered items: the auto-submit, plus the skip event FR-018 asks for', () => {
    const plan = planReadinessClose(items, partly, 'expired', AT)

    expect(plan.itemEvents).toHaveLength(3)
    expect(plan.skippedEvent).toEqual({ reason: 'expired', unanswered_count: 1 })
    expect(plan.skipped).toBe(true)
    expect(plan.cause).toBe('readiness_skipped')
    // The answers that exist are still read: expiry submits what exists (FR-010).
    expect(statusOf(plan.concepts, 'payback')).toBe('not_held')
  })

  it('expired with everything answered: a submit nobody pressed, and no skip event', () => {
    const all = items.map((row) => answered(row, 'b'))
    const plan = planReadinessClose(items, all, 'expired', AT)

    expect(plan.skippedEvent).toBeNull()
    expect(plan.skipped).toBe(false)
    expect(plan.cause).toBe('readiness_submitted')
    expect(plan.concepts.every((concept) => concept.status === 'held')).toBe(true)
  })

  it('student_skip: no item events, every concept unknown, nothing submitted', () => {
    // PRD §7.1 edge case: a check that cannot be completed marks competence unknown. The answers
    // that exist are not reported, because a skipped check found nothing out.
    const plan = planReadinessClose(items, partly, 'student_skip', AT)

    expect(plan.itemEvents).toEqual([])
    expect(plan.skippedEvent).toEqual({ reason: 'student_skip', unanswered_count: 1 })
    expect(plan.skipped).toBe(true)
    expect(plan.submittedAt).toBeNull()
    expect(plan.cause).toBe('readiness_skipped')
    expect(plan.concepts).toEqual([
      { concept_key: 'payback', status: 'unknown', correct: 0, total: 0 },
      { concept_key: 'retention', status: 'unknown', correct: 0, total: 0 },
    ])
  })

  it('the result row and the trace cannot disagree about whether the check was completed', () => {
    for (const mode of ['submitted', 'expired', 'student_skip'] as const) {
      for (const answers of [[], partly, items.map((row) => answered(row, 'b'))]) {
        const plan = planReadinessClose(items, answers, mode, AT)
        expect(plan.skipped).toBe(plan.skippedEvent !== null)
        expect(plan.cause).toBe(plan.skipped ? 'readiness_skipped' : 'readiness_submitted')
      }
    }
  })
})

describe('skipAllowed (FR-018)', () => {
  it('only after a submission has failed', () => {
    expect(skipAllowed({})).toBe(false)
    expect(skipAllowed({ readiness_submit_failed: false })).toBe(false)
    expect(skipAllowed({ readiness_submit_failed: true })).toBe(true)
  })
})
