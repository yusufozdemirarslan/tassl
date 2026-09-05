// The rules of the Readiness Check (FR-010 to FR-018; PRD §7.1; docs/tech/10-backend-spec-modules.md
// §6; 10-backend-spec.md §8 branch 1). Sixteen items in eight minutes, answered in any order, closed
// by a submit, by the clock, or by a skip after a submission has failed — and the result is a map of
// named concepts, never a score.
//
// **Where the four service functions are.** The phase file lists `getReadiness`,
// `answerReadinessItem`, `submitReadiness` and `skipReadiness` in this file. They are in
// `./service.ts` instead: all four are transactions over the repository, and a module-internal file
// may not reach the repository (04 §2, enforced by the `boundaries` rule — internal files may import
// only `src/lib`, `src/server` outside the modules, and other internal or schema files). So this
// file holds what *decides* and `./service.ts` holds what *writes*, which is the shape `clock.ts`,
// `state-machine.ts` and `timers.ts` already have: each answers what to write, and one file commits
// it beside the trace event that explains it.
//
// **The invariant of the step lives here, in one place.** `correctnessOf` is the only function in
// the codebase that compares a student's answer to an item's key. No shape this file builds for a
// student carries either as a field: `toReadinessItemViews` builds each item by naming the five
// fields they may read, and `toConceptViews` reduces the stored result to `{ conceptKey, status }`.
// The per-concept counts stay in `run_readiness_results.concepts` for the reviewer's replay and the
// export header (06 §3.4, FR-014); they are not in the student's shape, because a count is a score
// and CLAUDE.md allows none anywhere.
//
// **What the concept map does tell them, said plainly.** It is not that a student learns nothing
// about their answers. The map is a reading of correctness — that is what PRD §7.1 asks the check
// to produce and FR-012 to return — aggregated by concept and returned when the check closes,
// before the run is scored. `held` means every item on the concept was answered correctly, so on
// any concept it names the answers were right; `not_held` means at least one was wrong, and *which*
// one it does not say — unless the concept is carried by a single item, where the aggregate and the
// item are the same thing and the status is that item's own marking. How much a package discloses
// this way is therefore an authoring property, not a property of this file: `scenarios/validate.ts`
// states the floor of two items per concept and the package warning `READINESS_CONCEPT_SINGLE_ITEM`
// carries it to the author (D-251). None of it is a count, a total, a threshold or a rank.
//
// Everything here is pure and total: give it rows and it answers. That is what lets
// `tests/unit/runs/readiness-map.test.ts` state the concept rule without a database.

// ---------------------------------------------------------------------------------------------
// The rows this file reasons over, declared structurally
//
// A `readiness_items` row and a `run_readiness_answers` row each satisfy the matching type, and so
// does a test's literal. They are restated rather than imported for the reason `./clock.ts` gives:
// an internal file may not import `src/server/db`, and a rule about sixteen items has no business
// asking for the whole schema.
// ---------------------------------------------------------------------------------------------

/** `readiness_items.category` (06 §3.4): the 6 / 4 / 6 split FR-010 fixes. */
export type ReadinessCategory = 'foundation' | 'defect_concept' | 'ai_behavior'

/** One of an item's four options (`readiness_items.options`). */
export type ReadinessOption = { key: string; text: string }

/** One authored item, key included. This shape never leaves the server. */
export type ReadinessItemRow = {
  id: string
  key: string
  category: ReadinessCategory
  conceptKey: string
  stem: string
  options: readonly ReadinessOption[]
  /** The key that is right. `correctnessOf` is the only reader. */
  answerKey: string
  position: number
}

/** One recorded answer (`run_readiness_answers`); `answerKey` is the key the *student* chose. */
export type ReadinessAnswerRow = {
  itemId: string
  answerKey: string | null
  correct: boolean | null
}

// ---------------------------------------------------------------------------------------------
// The student's view of an item (07 §7 `ReadinessView`)
// ---------------------------------------------------------------------------------------------

/**
 * One item as the check screen renders it (UI-022).
 *
 * `answerKey` is the key **the student chose**, null until they choose one — which is what makes
 * FR-017 work: a check reopened after the browser closed comes back with its answers, so the screen
 * can resume at the first unanswered item. The item's own key has no field here and never will, and
 * neither does its correctness: while the check is open a student is told nothing about how they
 * are doing (FR-012, 12 §8.1). What they are told at the close is the concept map, and `conceptMap`
 * below says exactly how much of an answer that is.
 */
export type ReadinessItemView = {
  id: string
  position: number
  category: ReadinessCategory
  stem: string
  options: ReadinessOption[]
  answerKey: string | null
}

/** Answers by item id, for the two functions that need to look one up. */
function answersByItem(
  answers: readonly ReadinessAnswerRow[],
): ReadonlyMap<string, ReadinessAnswerRow> {
  return new Map(answers.map((answer) => [answer.itemId, answer]))
}

/** Items in the order the check is taken (`readiness_items.position`). */
function inPositionOrder(items: readonly ReadinessItemRow[]): ReadinessItemRow[] {
  return [...items].sort((a, b) => a.position - b.position || a.key.localeCompare(b.key))
}

/**
 * The sixteen items as the student receives them: built by naming the fields they may read, never
 * by deleting the ones they may not (12 §8). A field added to `readiness_items` tomorrow — a
 * rationale, a difficulty, a second key — does not appear here by default.
 */
export function toReadinessItemViews(
  items: readonly ReadinessItemRow[],
  answers: readonly ReadinessAnswerRow[],
): ReadinessItemView[] {
  const byItem = answersByItem(answers)
  return inPositionOrder(items).map((item) => ({
    id: item.id,
    position: item.position,
    category: item.category,
    stem: item.stem,
    options: item.options.map((option) => ({ key: option.key, text: option.text })),
    answerKey: byItem.get(item.id)?.answerKey ?? null,
  }))
}

// ---------------------------------------------------------------------------------------------
// Correctness (FR-012)
// ---------------------------------------------------------------------------------------------

/** Whether the key is one of the four the item offers; anything else is a malformed answer. */
export function isOfferedOption(item: ReadinessItemRow, answerKey: string): boolean {
  return item.options.some((option) => option.key === answerKey)
}

/**
 * Whether the student's answer is the item's key, or null when they did not answer.
 *
 * The one comparison. It is computed when the answer is recorded, stored on
 * `run_readiness_answers.correct`, written to the `readiness_item` trace event at close — where the
 * owner's own view withholds it (D-223) — and read by the concept map. It is never a field in a
 * response: no endpoint hands a student an item and says whether they got it right. The concept map
 * is the one thing built out of it that they see, and it reports by concept rather than by item —
 * which is a weaker statement than "correctness is never returned", and the true one (D-251).
 */
export function correctnessOf(item: ReadinessItemRow, answerKey: string | null): boolean | null {
  if (answerKey === null) return null
  return answerKey === item.answerKey
}

// ---------------------------------------------------------------------------------------------
// The concept map (FR-012, FR-014, 10 §6)
// ---------------------------------------------------------------------------------------------

export const READINESS_CONCEPT_STATUSES = ['held', 'not_held', 'unknown'] as const
export type ReadinessConceptStatus = (typeof READINESS_CONCEPT_STATUSES)[number]

/**
 * One row of `run_readiness_results.concepts` (06 §3.4), in the snake case the column stores.
 *
 * `correct` and `total` are counts over the concept's own items. They are the reviewer's context in
 * the replay and the export header, and they are the reason this shape is not the one the student
 * receives: `toConceptViews` drops them, because sixteen items produce no total anywhere (FR-012).
 */
export type ReadinessConceptResult = {
  concept_key: string
  status: ReadinessConceptStatus
  correct: number
  total: number
}

/** The student's row: a named concept and how it stands, in plain language on UI-022. */
export type ReadinessConceptView = { conceptKey: string; status: ReadinessConceptStatus }

/**
 * The result of a check: one row per concept its items map to, in the order the concepts first
 * appear in the check.
 *
 * The rule of 10 §6, with its one ambiguity resolved. `held` when every item on the concept is
 * correct; `not_held` when any item on it was answered wrongly; `unknown` when any item on it is
 * unanswered. A concept that has both a wrong answer and an unanswered item is `not_held`, not
 * `unknown`: the two clauses both fire, and a wrong answer is something the check found out, while
 * `unknown` means it could not tell. FR-018 agrees — it is *unanswered* concepts that are unknown.
 *
 * No total, no percentage, no threshold and no rank is computed here or anywhere else (FR-012,
 * PRD §7.1: the thresholds are a future-state pilot parameter and the concept map is the only
 * result the build relies on).
 *
 * **This is the one place a student is told anything about their answers, and it is worth being
 * exact about how much (D-251).** A status is an aggregate over the concept's items, so it is as
 * specific as the concept is small. `held` always implies every item on the concept was correct,
 * whatever the size. `not_held` over several items says a wrong answer is somewhere among them;
 * over one item it says *that* item was wrong, which is per-item marking handed back before the run
 * is scored. Nothing here can fix that — the map is what PRD §7.1 requires, and a package that
 * carries a concept on one item has made that choice in its readiness items. The floor
 * (`READINESS_ITEMS_PER_CONCEPT_MIN`) and the warning that carries it to an author live with the
 * authoring rules in `scenarios/validate.ts`, which is where a package can still be changed.
 */
export function conceptMap(
  items: readonly ReadinessItemRow[],
  answers: readonly ReadinessAnswerRow[],
): ReadinessConceptResult[] {
  const byItem = answersByItem(answers)
  const order: string[] = []
  const tally = new Map<string, { correct: number; wrong: number; unanswered: number }>()

  for (const item of inPositionOrder(items)) {
    let counts = tally.get(item.conceptKey)
    if (!counts) {
      counts = { correct: 0, wrong: 0, unanswered: 0 }
      tally.set(item.conceptKey, counts)
      order.push(item.conceptKey)
    }
    const correct = byItem.get(item.id)?.correct ?? null
    if (correct === null) counts.unanswered += 1
    else if (correct) counts.correct += 1
    else counts.wrong += 1
  }

  return order.map((conceptKey) => {
    const counts = tally.get(conceptKey) ?? { correct: 0, wrong: 0, unanswered: 0 }
    const status: ReadinessConceptStatus =
      counts.wrong > 0 ? 'not_held' : counts.unanswered > 0 ? 'unknown' : 'held'
    return {
      concept_key: conceptKey,
      status,
      correct: counts.correct,
      total: counts.correct + counts.wrong + counts.unanswered,
    }
  })
}

/**
 * Every concept `unknown`, which is what a check that could not be completed leaves behind
 * (10 §6 `skipReadiness`; PRD §7.1 edge case "Cannot complete: Standard Mode, competence marked
 * unknown"). The counts are zeroed with it: a skipped check found nothing out, so reporting the
 * answers it happened to hold would say more than it knows.
 */
export function unknownConceptMap(items: readonly ReadinessItemRow[]): ReadinessConceptResult[] {
  const seen = new Set<string>()
  const out: ReadinessConceptResult[] = []
  for (const item of inPositionOrder(items)) {
    if (seen.has(item.conceptKey)) continue
    seen.add(item.conceptKey)
    out.push({ concept_key: item.conceptKey, status: 'unknown', correct: 0, total: 0 })
  }
  return out
}

/** The stored map reduced to what the student is shown: the concept and how it stands (FR-012). */
export function toConceptViews(
  concepts: readonly ReadinessConceptResult[],
): ReadinessConceptView[] {
  return concepts.map((concept) => ({ conceptKey: concept.concept_key, status: concept.status }))
}

// ---------------------------------------------------------------------------------------------
// Closing the check
// ---------------------------------------------------------------------------------------------

/**
 * The `readiness_item` payload (10 §10), one per item, written when the check closes rather than
 * when an item is answered: an answer is a scratchpad row until then, because FR-017 lets the
 * student change it, and sixteen events per keystroke would make the trace a record of typing.
 * Declared here so the shape a plan carries is checked at the `trace.append` call site.
 */
export type ReadinessItemEventPayload = {
  item_id: string
  item_key: string
  category: ReadinessCategory
  concept_key: string
  /** The key the student chose, null when they did not answer (FR-012). */
  answer_key: string | null
  correct: boolean | null
}

/** The `readiness_skipped` payload (10 §10). */
export type ReadinessSkippedEventPayload = {
  reason: 'expired' | 'student_skip'
  unanswered_count: number
}

/**
 * How a check ended.
 *
 *   `submitted`    — the student pressed Submit (FR-012).
 *   `expired`      — the eight minutes ran out and the check auto-submitted what exists
 *                    (10 §8 branch 1, FR-010).
 *   `student_skip` — the student skipped after a submission failed (FR-018).
 */
export type ReadinessCloseMode = 'submitted' | 'expired' | 'student_skip'

/** What closing a check writes: events, the result row, and the cause the lifecycle records. */
export type ReadinessClosePlan = {
  /** One per item in position order; empty for a skip, which records no answers (10 §6). */
  readonly itemEvents: readonly ReadinessItemEventPayload[]
  /** Written when the check closed incomplete; null when it closed complete (FR-018). */
  readonly skippedEvent: ReadinessSkippedEventPayload | null
  readonly concepts: readonly ReadinessConceptResult[]
  /** `run_readiness_results.submitted_at`; null when the check was skipped rather than submitted. */
  readonly submittedAt: Date | null
  /** `run_readiness_results.skipped`: true exactly when a `readiness_skipped` event was written. */
  readonly skipped: boolean
  /** The `lifecycle` cause for `readiness → framing` (10 §9). */
  readonly cause: 'readiness_submitted' | 'readiness_skipped'
}

/** How many of the check's items have no answer. */
export function unansweredCount(
  items: readonly ReadinessItemRow[],
  answers: readonly ReadinessAnswerRow[],
): number {
  const byItem = answersByItem(answers)
  return items.filter((item) => (byItem.get(item.id)?.answerKey ?? null) === null).length
}

/**
 * Everything closing the check writes, decided before anything is written.
 *
 * The three modes differ in exactly the ways the specification distinguishes them:
 *
 *   * **submitted** — sixteen `readiness_item` events, unanswered items carrying
 *     `answer_key: null, correct: null`; the concept map computed from the answers; `submitted_at`
 *     set; cause `readiness_submitted` (10 §6).
 *   * **expired** — the same auto-submit at the expiry instant (10 §8 branch 1: "auto-submit
 *     unanswered as `unknown`"), *plus* a `readiness_skipped { reason: 'expired' }` event when any
 *     item was left unanswered, which is FR-018's "timer expiry with unanswered items … a
 *     `readiness_skipped` event is written". A check that was fully answered when the clock ran out
 *     is simply a submit that nobody pressed, and writes no skip.
 *   * **student_skip** — no item events and every concept `unknown` (10 §6, PRD §7.1 "Cannot
 *     complete: … competence marked unknown"). `submitted_at` stays null: nothing was submitted.
 *
 * `skipped` on the result row mirrors the event, so the row and the trace cannot disagree about
 * whether the check was completed.
 */
export function planReadinessClose(
  items: readonly ReadinessItemRow[],
  answers: readonly ReadinessAnswerRow[],
  mode: ReadinessCloseMode,
  at: Date,
): ReadinessClosePlan {
  const unanswered = unansweredCount(items, answers)

  if (mode === 'student_skip') {
    return {
      itemEvents: [],
      skippedEvent: { reason: 'student_skip', unanswered_count: unanswered },
      concepts: unknownConceptMap(items),
      submittedAt: null,
      skipped: true,
      cause: 'readiness_skipped',
    }
  }

  const byItem = answersByItem(answers)
  const itemEvents = inPositionOrder(items).map((item) => {
    const answer = byItem.get(item.id)
    return {
      item_id: item.id,
      item_key: item.key,
      category: item.category,
      concept_key: item.conceptKey,
      answer_key: answer?.answerKey ?? null,
      correct: answer?.correct ?? null,
    }
  })

  const incomplete = mode === 'expired' && unanswered > 0
  return {
    itemEvents,
    skippedEvent: incomplete ? { reason: 'expired', unanswered_count: unanswered } : null,
    concepts: conceptMap(items, answers),
    submittedAt: at,
    skipped: incomplete,
    cause: incomplete ? 'readiness_skipped' : 'readiness_submitted',
  }
}

// ---------------------------------------------------------------------------------------------
// Skipping (FR-018)
// ---------------------------------------------------------------------------------------------

/**
 * Whether the student may skip the check.
 *
 * Only after a submission has failed (`runs.flags.readiness_submit_failed`, 06 §3.4, 10 §6). It is
 * not a way out of the check: the result never blocks entry (FR-013), so there is nothing to gain by
 * refusing to take it, and offering a skip up front would turn eight minutes of warm-up into a
 * button. FR-018's acceptance note also reads "or after expiry", which cannot be reached: expiry
 * auto-submits and moves the run to `framing` (10 §8), so by the time a student could press Skip
 * the check has already closed. UI-022 words it the same way — "Skip the check" appears in the
 * *submit failed* state alone.
 */
export function skipAllowed(flags: { readiness_submit_failed?: boolean }): boolean {
  return flags.readiness_submit_failed === true
}
