// Step 8.1 — stances (FR-080, FR-081, FR-085), the named-field route into reliance (FR-101,
// D-076), and the query the Decision Lock's gate asks (FR-084), against a real database.
//
// What this file is protecting, in the order the run meets it:
//
//   * **A stance is a record, not a replacement.** FR-085 keeps both when a student changes their
//     mind after running a check, and `action_ids` on the event is what makes "traced it, then
//     accepted it" a different row in the debrief from "accepted it". A `previous_stance` dropped
//     on the second write would lose the thing the run is measuring, silently.
//   * **A stance is only available while the room is.** `working` and `turn_open` and nowhere else:
//     a paused run has a stopped clock and a locked one has moved on, and both refuse in the
//     reader's own terms rather than with one generic conflict.
//   * **Reliance accumulates and is never taken back.** A figure typed into a named field marks the
//     claim it belongs to, and that mark is what the lock gate reads.
// @db:truncate
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { truncateAll } from '@tests/setup/integration'
import {
  codeOf,
  delegate,
  eventsOfType,
  forcePaused,
  forceState,
  inLockedRun,
  openDocument,
  runInWorking,
  runClaimRows,
  runRow,
  setupAssistantFixture,
  type AssistantFixture,
} from './fixture'

type Reliance = typeof import('@/server/modules/reliance')

let reliance: Reliance
let fx: AssistantFixture
let runId: string

/** The uuid of a claim that is real but has never been surfaced on this run. */
const unsurfaced = (): string => fx.claimId('C6')

beforeEach(async () => {
  await truncateAll()
  reliance = await import('@/server/modules/reliance')
  fx = await setupAssistantFixture('reliance-stances')
  runId = await runInWorking(fx)
  // D5 carries C1, the value-tier payback claim: a Source Trace, a Decomposition Check and a
  // carried figure of 4.2 months with no field key of its own.
  await openDocument(fx, runId, 'D5')
})

afterAll(async () => {
  await truncateAll()
})

describe('setStance', () => {
  it('records the stance, the claim view, and one stance_set event', async () => {
    const claimId = fx.claimId('C1')
    const view = await reliance.setStance(fx.student, runId, claimId, 'verify')

    expect(view.id).toBe(claimId)
    expect(view.stance).toBe('verify')
    expect(view.previousStance).toBeNull()
    expect(view.stanceSetAt).not.toBeNull()

    const [row] = await runClaimRows(runId)
    expect(row?.stance).toBe('verify')

    const events = await eventsOfType(runId, 'stance_set')
    expect(events).toHaveLength(1)
    expect(events[0]?.payload).toEqual({
      claim_id: claimId,
      stance: 'verify',
      previous_stance: null,
      action_ids: [],
      in_turn_window: false,
    })
  })

  it('costs the clock nothing: taking a position is not a check (FR-070)', async () => {
    const before = await runRow(runId)
    await reliance.setStance(fx.student, runId, fx.claimId('C1'), 'accept')
    const after = await runRow(runId)
    expect(after.charged_ms).toBe(before.charged_ms)
  })

  it('keeps the stance it replaces, and names the actions run before it (FR-085)', async () => {
    const claimId = fx.claimId('C1')
    await reliance.setStance(fx.student, runId, claimId, 'accept')
    const action = await reliance.runAction(fx.student, runId, claimId, 'source_trace')
    const view = await reliance.setStance(fx.student, runId, claimId, 'challenge')

    expect(view.stance).toBe('challenge')
    expect(view.previousStance).toBe('accept')

    const events = await eventsOfType(runId, 'stance_set')
    expect(events).toHaveLength(2)
    // The first stance had no action behind it; the second was taken after the trace.
    expect(events[0]?.payload.action_ids).toEqual([])
    expect(events[1]?.payload).toMatchObject({
      stance: 'challenge',
      previous_stance: 'accept',
      action_ids: [action.actionId],
    })
  })

  it('allows the escalate stance with no escalation call, and charges nothing for it', async () => {
    // 10 §8: the stance is the record; the reply requires `escalate`. A student may say they want a
    // colleague's read and never spend the five minutes on one.
    const view = await reliance.setStance(fx.student, runId, fx.claimId('C1'), 'escalate')
    expect(view.stance).toBe('escalate')
    expect(view.escalation).toBeNull()
    expect((await runRow(runId)).charged_ms).toBe(0)
  })

  it('refuses a claim this run has never surfaced', async () => {
    expect(await codeOf(reliance.setStance(fx.student, runId, unsurfaced(), 'accept'))).toBe(
      'CLAIM_NOT_SURFACED',
    )
    expect(await eventsOfType(runId, 'stance_set')).toHaveLength(0)
  })

  it('refuses a stance that is not one of the five (FR-080)', async () => {
    const bogus = 'agree' as Parameters<Reliance['setStance']>[3]
    expect(await codeOf(reliance.setStance(fx.student, runId, fx.claimId('C1'), bogus))).toBe(
      'STANCE_INVALID',
    )
  })

  it('refuses while the run is paused, and says so rather than saying "conflict"', async () => {
    await forcePaused(runId)
    expect(await codeOf(reliance.setStance(fx.student, runId, fx.claimId('C1'), 'accept'))).toBe(
      'RUN_PAUSED',
    )
  })

  it('refuses once the decision is locked', async () => {
    await forceState(runId, 'decision_locked')
    expect(await codeOf(reliance.setStance(fx.student, runId, fx.claimId('C1'), 'accept'))).toBe(
      'RUN_LOCKED',
    )
  })

  it('refuses another student’s run as NOT_FOUND, not FORBIDDEN (08 §4)', async () => {
    expect(await codeOf(reliance.setStance(fx.classmate, runId, fx.claimId('C1'), 'accept'))).toBe(
      'NOT_FOUND',
    )
    expect(await codeOf(reliance.setStance(fx.instructor, runId, fx.claimId('C1'), 'accept'))).toBe(
      'NOT_FOUND',
    )
  })
})

describe('markReliedOnFromNamedFields (FR-101, D-076)', () => {
  it('marks the claim whose figure the student named, and writes claim_used once', async () => {
    // C1 carries 4.2 months with no field key, so any months field can name it; the student types
    // the rounded figure the decomposition would have shown them.
    const marks = await inLockedRun(fx, runId, (tx, run) =>
      reliance.markReliedOnFromNamedFields(tx, run, { premium_payback_months: 4.19 }),
    )

    expect(marks).toEqual([
      { claimId: fx.claimId('C1'), fieldKey: 'premium_payback_months', recorded: true },
    ])

    const [row] = await runClaimRows(runId)
    expect(row?.relied_on).toBe(true)
    expect(row?.relied_on_via).toEqual(['named_field'])

    const used = await eventsOfType(runId, 'claim_used')
    expect(used).toHaveLength(1)
    expect(used[0]?.payload).toEqual({
      claim_id: fx.claimId('C1'),
      via: 'named_field',
      field_key: 'premium_payback_months',
    })
  })

  it('is idempotent: a second lock attempt records no second claim_used', async () => {
    const values = { premium_payback_months: 4.2 }
    await inLockedRun(fx, runId, (tx, run) => reliance.markReliedOnFromNamedFields(tx, run, values))
    const again = await inLockedRun(fx, runId, (tx, run) =>
      reliance.markReliedOnFromNamedFields(tx, run, values),
    )

    expect(again).toEqual([
      { claimId: fx.claimId('C1'), fieldKey: 'premium_payback_months', recorded: false },
    ])
    expect(await eventsOfType(runId, 'claim_used')).toHaveLength(1)
  })

  it('marks nothing for a figure outside D-076’s band, or in the wrong unit', async () => {
    const marks = await inLockedRun(fx, runId, (tx, run) =>
      reliance.markReliedOnFromNamedFields(tx, run, {
        // 5.6 months is well outside 4.2's band, and the budget share is a percentage.
        premium_payback_months: 5.6,
        budget_share_to_premium: 4.2,
      }),
    )
    expect(marks).toEqual([])
    expect((await runClaimRows(runId))[0]?.relied_on).toBe(false)
  })

  it('honours a carried value’s field key: the same number in another field is not reliance', async () => {
    // C3 carries 11 months *bound to* `premium_payback_months` (the author said which box it goes
    // in), so a months figure typed into any other field is not reliance on it.
    await delegate(fx, runId, 'What is the premium payback?')

    const wrongField = await inLockedRun(fx, runId, (tx, run) =>
      reliance.markReliedOnFromNamedFields(tx, run, { budget_share_to_premium: 11 }),
    )
    expect(wrongField).toEqual([])

    const rightField = await inLockedRun(fx, runId, (tx, run) =>
      reliance.markReliedOnFromNamedFields(tx, run, { premium_payback_months: 11 }),
    )
    expect(rightField).toEqual([
      { claimId: fx.claimId('C3'), fieldKey: 'premium_payback_months', recorded: true },
    ])
  })

  it('marks nothing for a claim the student has never been shown', async () => {
    // C3's figure is 11 months and C3 has not been surfaced on this run: a claim nobody read is not
    // one anybody can have relied on.
    const marks = await inLockedRun(fx, runId, (tx, run) =>
      reliance.markReliedOnFromNamedFields(tx, run, { premium_payback_months: 11 }),
    )
    expect(marks).toEqual([])
    expect(await eventsOfType(runId, 'claim_used')).toHaveLength(0)
  })
})

describe('findUnstancedReliedOn (FR-084)', () => {
  it('lists relied-on claims with no stance, oldest surfacing first', async () => {
    // C1 from D5 in `beforeEach`, then C5 from D3: two claims, met in that order.
    await openDocument(fx, runId, 'D3')
    await inLockedRun(fx, runId, (tx, run) =>
      reliance.markReliedOnFromNamedFields(tx, run, {
        premium_payback_months: 4.2, // C1
        budget_share_to_premium: 40, // C5
      }),
    )

    const unstanced = await inLockedRun(fx, runId, (tx, run) =>
      reliance.findUnstancedReliedOn(tx, run),
    )
    expect(unstanced.map((claim) => claim.claimKey)).toEqual(['C1', 'C5'])
    // The refusal names the claim in the author's words (07 §7 `details.claimText`).
    expect(unstanced[0]?.claimText).toContain('4.2')
  })

  it('drops a claim once the student takes a position on it', async () => {
    await inLockedRun(fx, runId, (tx, run) =>
      reliance.markReliedOnFromNamedFields(tx, run, { premium_payback_months: 4.2 }),
    )
    await reliance.setStance(fx.student, runId, fx.claimId('C1'), 'accept')

    const unstanced = await inLockedRun(fx, runId, (tx, run) =>
      reliance.findUnstancedReliedOn(tx, run),
    )
    expect(unstanced).toEqual([])
  })

  it('ignores a surfaced claim nobody leaned on: reading commits to nothing', async () => {
    await openDocument(fx, runId, 'D3')
    const unstanced = await inLockedRun(fx, runId, (tx, run) =>
      reliance.findUnstancedReliedOn(tx, run),
    )
    expect(unstanced).toEqual([])
    expect((await runClaimRows(runId)).length).toBeGreaterThan(1)
  })
})
