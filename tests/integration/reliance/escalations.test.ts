// Step 8.1 — escalations (FR-090 to FR-093, D-089, D-116, D-244, D-328), against a real database.
//
// The escalation is the one move in the run where the *package* decides something about the reply
// the student gets, and the whole design of it is that they are never told which way it decided.
//
//   * A claim the author wrote a colleague reply for answers with that reply
//     (`response_id = 'claim'`, `counts_against_limit = true`).
//   * Every other claim answers with the version's general reply (`response_id = 'general'`,
//     `counts_against_limit = false`).
//   * **Both cost one of the run's two** (D-328). FR-091 originally exempted the general reply from
//     the limit, and that exemption was the leak: the counter moved on exactly the claims carrying
//     an authored reply, and once the budget was spent the refusal landed on exactly those claims
//     and no others. `counts_against_limit` is still written and still travels on the trace — it
//     records which reply answered — and it no longer governs anything the student can observe.
//   * The student's result carries the reply, their own sentence, the cost and the escalations
//     left, and neither `responseId` nor `countsAgainstLimit` (D-116, D-318).
//
// The fixture package has exactly one claim with an authored reply (C7, the willingness-to-pay
// survey), which is what makes the counting assertions below real rather than arranged — and, as
// the D-328 test at the foot of this file reads back from the database, C7 is also the only claim
// whose warranted stance is `escalate`. That coincidence is the reason the old rule leaked.
// @db:truncate
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { truncateAll } from '@tests/setup/integration'
import {
  CLOCK_SKEW_MS,
  codeOf,
  escalationRows,
  eventsOfType,
  forcePaused,
  forceState,
  generalEscalationReply,
  keysOf,
  openDocument,
  runInWorking,
  runRow,
  setClockRemaining,
  setupAssistantFixture,
  type AssistantFixture,
} from './fixture'

type Reliance = typeof import('@/server/modules/reliance')

let reliance: Reliance
let fx: AssistantFixture
let runId: string

const ESCALATION_MS = 300_000
const STATEMENT = 'I cannot tell whether this figure holds for the tier subgroups.'

/** The authored colleague reply on C7, read from the package rather than repeated here. */
async function authoredReply(): Promise<string> {
  const { testSql } = await import('@tests/setup/integration')
  const [row] = await testSql<{ escalation_reply: string | null }[]>`
    select escalation_reply from scenario_claims where id = ${fx.claimId('C7')}`
  const reply = row?.escalation_reply
  if (!reply) throw new Error('the fixture claim C7 has no authored escalation reply')
  return reply
}

beforeEach(async () => {
  await truncateAll()
  reliance = await import('@/server/modules/reliance')
  fx = await setupAssistantFixture('reliance-escalations')
  runId = await runInWorking(fx)
  // D8 carries C7, the one claim with an authored reply; D5 carries C1, which has none.
  await openDocument(fx, runId, 'D8')
  await openDocument(fx, runId, 'D5')
})

afterAll(async () => {
  await truncateAll()
})

describe('an escalation on a claim the author answered (FR-090)', () => {
  it('returns the authored reply verbatim, charges five minutes, and counts', async () => {
    const result = await reliance.escalate(fx.student, runId, fx.claimId('C7'), {
      statement: STATEMENT,
    })

    expect(result.responseText).toBe(await authoredReply())
    expect(result.clockCostMs).toBe(ESCALATION_MS)
    expect(result.remainingEscalations).toBe(1)
    expect((await runRow(runId)).charged_ms).toBe(ESCALATION_MS)

    const rows = await escalationRows(runId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      claim_id: fx.claimId('C7'),
      statement: STATEMENT,
      response_id: 'claim',
      counts_against_limit: true,
      clock_cost_ms: ESCALATION_MS,
      in_turn_window: false,
    })
  })

  it('tells the student the reply, the cost and the budget, and nothing about the package', async () => {
    const result = await reliance.escalate(fx.student, runId, fx.claimId('C7'), {
      statement: STATEMENT,
    })

    // D-116: exactly these four keys. `responseId` would say which reply answered and
    // `countsAgainstLimit` would say the same thing a second way.
    //
    // `statement` is the fourth, added by D-318, and it is the only kind of field this closed set
    // will ever widen for: the student's own sentence, handed back verbatim because the card that
    // showed only the answer left them, after a reload, with a reply and no question. It says
    // nothing about the package — they wrote it — so no invariant reaches it. The set stays closed
    // so that the next field of `run_escalations` to cross to a student has to be argued for here.
    expect(Object.keys(result).sort()).toEqual([
      'clockCostMs',
      'remainingEscalations',
      'responseText',
      'statement',
    ])
    expect(result.statement).toBe(STATEMENT)
    expect(keysOf(result).has('responseId')).toBe(false)
    expect(keysOf(result).has('countsAgainstLimit')).toBe(false)
  })

  it('writes one escalation event carrying what the replay needs and the student is not told', async () => {
    const result = await reliance.escalate(fx.student, runId, fx.claimId('C7'), {
      statement: STATEMENT,
    })
    const [row] = await escalationRows(runId)
    const events = await eventsOfType(runId, 'escalation')

    expect(events).toHaveLength(1)
    expect(events[0]?.payload).toEqual({
      escalation_id: row?.id,
      claim_id: fx.claimId('C7'),
      statement: STATEMENT,
      response_id: 'claim',
      response_text: result.responseText,
      clock_cost_ms: ESCALATION_MS,
      counts_against_limit: true,
      in_turn_window: false,
    })
  })

  it('sets the stance to escalate, with its own stance_set event', async () => {
    await reliance.escalate(fx.student, runId, fx.claimId('C7'), { statement: STATEMENT })

    const claims = await reliance.listRunClaims(fx.student, runId)
    const claim = claims.find((entry) => entry.key === 'C7')
    expect(claim?.stance).toBe('escalate')
    expect(claim?.escalation?.responseText).toBe(await authoredReply())

    const stances = await eventsOfType(runId, 'stance_set')
    expect(stances).toHaveLength(1)
    expect(stances[0]?.payload).toMatchObject({
      claim_id: fx.claimId('C7'),
      stance: 'escalate',
      previous_stance: null,
    })
  })

  it('keeps the stance the student already took, and writes no second stance_set', async () => {
    await reliance.setStance(fx.student, runId, fx.claimId('C7'), 'escalate')
    await reliance.escalate(fx.student, runId, fx.claimId('C7'), { statement: STATEMENT })
    expect(await eventsOfType(runId, 'stance_set')).toHaveLength(1)
  })

  it('refuses the third counted escalation, and charges nothing for the refusal (FR-092)', async () => {
    const claimId = fx.claimId('C7')
    const first = await reliance.escalate(fx.student, runId, claimId, { statement: STATEMENT })
    const second = await reliance.escalate(fx.student, runId, claimId, {
      statement: 'The subgroup base sizes are not something I can check from here.',
    })
    expect(first.remainingEscalations).toBe(1)
    expect(second.remainingEscalations).toBe(0)

    expect(
      await codeOf(reliance.escalate(fx.student, runId, claimId, { statement: STATEMENT })),
    ).toBe('ESCALATION_LIMIT_REACHED')

    expect(await escalationRows(runId)).toHaveLength(2)
    expect((await runRow(runId)).charged_ms).toBe(2 * ESCALATION_MS)
  })
})

describe('an escalation on a claim the author did not answer (FR-091)', () => {
  it('returns the version’s general reply, costs the same, and costs one of the two', async () => {
    const result = await reliance.escalate(fx.student, runId, fx.claimId('C1'), {
      statement: STATEMENT,
    })

    expect(result.responseText).toBe(await generalEscalationReply(runId))
    expect(result.clockCostMs).toBe(ESCALATION_MS)
    // One, not two: D-328 spends the budget on every escalation. The row still records that the
    // general reply answered, which is what the reviewer reads and the student never does.
    expect(result.remainingEscalations).toBe(1)

    const [row] = await escalationRows(runId)
    expect(row).toMatchObject({ response_id: 'general', counts_against_limit: false })
  })

  it('is refused once both escalations are spent, exactly as an authored one is', async () => {
    await reliance.escalate(fx.student, runId, fx.claimId('C7'), { statement: STATEMENT })
    await reliance.escalate(fx.student, runId, fx.claimId('C7'), { statement: STATEMENT })

    expect(
      await codeOf(
        reliance.escalate(fx.student, runId, fx.claimId('C1'), { statement: STATEMENT }),
      ),
    ).toBe('ESCALATION_LIMIT_REACHED')
    // Nothing was written and nothing was charged: the refusal is the whole of it.
    expect(await escalationRows(runId)).toHaveLength(2)
    expect((await runRow(runId)).charged_ms).toBe(2 * ESCALATION_MS)
  })
})

// ---------------------------------------------------------------------------------------------
// D-328 — the budget says nothing about the package
//
// The regression test for the oracle the old rule published. Two things had to be true for it to
// be an oracle, and the first two assertions read both of them out of the database rather than
// asserting them from memory: C7 is the only claim in this version carrying an authored reply, and
// C7 is the claim whose warranted stance is `escalate` — in both variants. An author writes a
// prepared answer for the claim worth escalating, so the two sets coincide structurally rather
// than by accident, and a counter that moved on one set announced the other.
// ---------------------------------------------------------------------------------------------

describe('the budget is one rule (D-328)', () => {
  it('is spent identically whether or not the claim carries an authored reply', async () => {
    const { testSql } = await import('@tests/setup/integration')

    // The answer key, read for this test's own reasoning. The student never sees either column.
    const authored = await testSql<{ key: string }[]>`
      select c.key
        from scenario_claims c
        join runs r on r.package_version_id = c.package_version_id
       where r.id = ${runId} and coalesce(btrim(c.escalation_reply), '') <> ''
       order by c.key`
    expect(authored.map((row) => row.key)).toEqual(['C7'])

    const warranted = await testSql<{ key: string; variant: string }[]>`
      select c.key, v.key as variant
        from scenario_claims c
        join variant_claim_states s on s.claim_id = c.id
        join scenario_variants v on v.id = s.variant_id
        join runs r on r.package_version_id = c.package_version_id
       where r.id = ${runId} and s.warranted_stance = 'escalate'
       order by c.key, v.key`
    expect(warranted).toEqual([
      { key: 'C7', variant: 'defective' },
      { key: 'C7', variant: 'sound' },
    ])

    // C7 carries the authored reply; C1 carries none. The counter must not tell them apart.
    const onC1 = await reliance.escalate(fx.student, runId, fx.claimId('C1'), {
      statement: STATEMENT,
    })
    const onC7 = await reliance.escalate(fx.student, runId, fx.claimId('C7'), {
      statement: STATEMENT,
    })
    expect([onC1.remainingEscalations, onC7.remainingEscalations]).toEqual([1, 0])
    expect(onC1.clockCostMs).toBe(onC7.clockCostMs)

    // And the rows still record which reply answered, for the reviewer and the debrief.
    expect((await escalationRows(runId)).map((row) => row.counts_against_limit).sort()).toEqual([
      false,
      true,
    ])
  })

  it('refuses the third escalation on the same terms whichever claim it lands on', async () => {
    await openDocument(fx, runId, 'D7') // C6, which carries no authored reply
    await reliance.escalate(fx.student, runId, fx.claimId('C7'), { statement: STATEMENT })
    await reliance.escalate(fx.student, runId, fx.claimId('C7'), { statement: STATEMENT })

    // Three surfaced claims, one of them the authored-reply claim. All three refuse alike; before
    // D-328 the two on the left succeeded and the one on the right did not, and the difference was
    // the answer key.
    const codes = await Promise.all(
      ['C1', 'C6', 'C7'].map(async (key) =>
        codeOf(reliance.escalate(fx.student, runId, fx.claimId(key), { statement: STATEMENT })),
      ),
    )
    expect(codes).toEqual([
      'ESCALATION_LIMIT_REACHED',
      'ESCALATION_LIMIT_REACHED',
      'ESCALATION_LIMIT_REACHED',
    ])
  })

  it('reads the same remaining count on every claim card, spent or not', async () => {
    await reliance.escalate(fx.student, runId, fx.claimId('C1'), { statement: STATEMENT })
    const claims = await reliance.listRunClaims(fx.student, runId)
    expect(new Set(claims.map((claim) => claim.remainingEscalations))).toEqual(new Set([1]))
    expect(new Set(claims.map((claim) => claim.canEscalate))).toEqual(new Set([true]))
  })
})

describe('what the claim view says about escalating (D-244)', () => {
  it('answers from the run’s budget, the same on every claim', async () => {
    const before = await reliance.listRunClaims(fx.student, runId)
    expect(before.map((claim) => claim.canEscalate)).toEqual(before.map(() => true))
    expect(before.map((claim) => claim.remainingEscalations)).toEqual(before.map(() => 2))
    // Not the claim's authored `escalatable`: C7 carries a reply and C1 does not, and the view says
    // the same thing about both.
    expect(new Set(before.map((claim) => claim.canEscalate)).size).toBe(1)

    await reliance.escalate(fx.student, runId, fx.claimId('C7'), { statement: STATEMENT })
    await reliance.escalate(fx.student, runId, fx.claimId('C7'), { statement: STATEMENT })

    const after = await reliance.listRunClaims(fx.student, runId)
    expect(after.every((claim) => claim.canEscalate)).toBe(false)
    expect(after.every((claim) => claim.remainingEscalations === 0)).toBe(true)
  })

  it('carries the reply only on the claim the student escalated', async () => {
    await reliance.escalate(fx.student, runId, fx.claimId('C7'), { statement: STATEMENT })
    const claims = await reliance.listRunClaims(fx.student, runId)
    const withReply = claims.filter((claim) => claim.escalation !== null)
    expect(withReply.map((claim) => claim.key)).toEqual(['C7'])
  })
})

describe('the statement (D-089)', () => {
  it('refuses fewer than three words', async () => {
    expect(
      await codeOf(
        reliance.escalate(fx.student, runId, fx.claimId('C7'), { statement: 'Not sure' }),
      ),
    ).toBe('ESCALATION_STATEMENT_INVALID')
    expect(await escalationRows(runId)).toHaveLength(0)
    expect((await runRow(runId)).charged_ms).toBe(0)
  })

  it('refuses more than 280 characters', async () => {
    const long = `${'word '.repeat(60)}end`
    expect(long.length).toBeGreaterThan(280)
    expect(
      await codeOf(reliance.escalate(fx.student, runId, fx.claimId('C7'), { statement: long })),
    ).toBe('ESCALATION_STATEMENT_INVALID')
  })

  it('counts the words of the stripped text, and stores what it counted (10 §5)', async () => {
    await reliance.escalate(fx.student, runId, fx.claimId('C7'), {
      statement: '<b>Three</b> words here',
    })
    expect((await escalationRows(runId))[0]?.statement).toBe('Three words here')
  })

  it('refuses markup that is three words only before it is stripped', async () => {
    expect(
      await codeOf(
        reliance.escalate(fx.student, runId, fx.claimId('C7'), {
          statement: '<em>a</em> <i>b</i>',
        }),
      ),
    ).toBe('ESCALATION_STATEMENT_INVALID')
  })
})

describe('who and when', () => {
  it('refuses a claim this run has not surfaced', async () => {
    expect(
      await codeOf(
        reliance.escalate(fx.student, runId, fx.claimId('C6'), { statement: STATEMENT }),
      ),
    ).toBe('CLAIM_NOT_SURFACED')
  })

  it('refuses an escalation that arrives with nothing left on the clock', async () => {
    // A second past zero, not exactly on it: at the boundary the auto-lock and `chargeCost` are
    // both true and either may answer first (D-300).
    await setClockRemaining(runId, -1_000)
    // `RUN_LOCKED` rather than `CLOCK_EXPIRED`: a working clock past zero has already auto-locked
    // the decision by the time this module sees the run (10 §8 branch 2). The escalation does not
    // run, which is the rule FR-072 states.
    expect(
      await codeOf(
        reliance.escalate(fx.student, runId, fx.claimId('C7'), { statement: STATEMENT }),
      ),
    ).toBe('RUN_LOCKED')
    expect(await escalationRows(runId)).toHaveLength(0)
    expect((await runRow(runId)).charged_ms).toBe(0)
  })

  it('charges only what was left when the clock runs out mid-escalation (FR-072)', async () => {
    await setClockRemaining(runId, 45_000)
    const result = await reliance.escalate(fx.student, runId, fx.claimId('C7'), {
      statement: STATEMENT,
    })
    expect(result.responseText).toBe(await authoredReply())
    // The same two-clock tolerance the action cap needs, and for the same reason: uncapped this
    // would be 300,000, so the bound proves the cap either way (`CLOCK_SKEW_MS`, ./fixture.ts).
    expect(result.clockCostMs).toBeLessThanOrEqual(45_000 + CLOCK_SKEW_MS)
    expect(result.clockCostMs).toBeGreaterThan(40_000)
  })

  it('refuses while paused and once the decision is locked', async () => {
    await forcePaused(runId)
    expect(
      await codeOf(
        reliance.escalate(fx.student, runId, fx.claimId('C7'), { statement: STATEMENT }),
      ),
    ).toBe('RUN_PAUSED')

    await forceState(runId, 'decision_locked')
    expect(
      await codeOf(
        reliance.escalate(fx.student, runId, fx.claimId('C7'), { statement: STATEMENT }),
      ),
    ).toBe('RUN_LOCKED')
  })

  it('answers for the room’s state before it answers for the sentence (D-331)', async () => {
    // The statement rule used to run before `lockRunForMutation`, so a student on a closed room was
    // told to write a longer sentence — asked to fix a form that no longer accepts anything. Every
    // other refusal in this module sits behind the gate; this one does now too.
    const tooShort = { statement: 'too short' }

    // On an open room the sentence is the thing that is wrong, and that has not changed.
    expect(await codeOf(reliance.escalate(fx.student, runId, fx.claimId('C7'), tooShort))).toBe(
      'ESCALATION_STATEMENT_INVALID',
    )

    await forceState(runId, 'decision_locked')
    expect(await codeOf(reliance.escalate(fx.student, runId, fx.claimId('C7'), tooShort))).toBe(
      'RUN_LOCKED',
    )

    await forcePaused(runId)
    expect(await codeOf(reliance.escalate(fx.student, runId, fx.claimId('C7'), tooShort))).toBe(
      'RUN_PAUSED',
    )
  })

  it('refuses everyone but the run’s own student', async () => {
    for (const seat of [fx.classmate, fx.instructor, fx.ta] as const) {
      expect(
        await codeOf(reliance.escalate(seat, runId, fx.claimId('C7'), { statement: STATEMENT })),
      ).toBe('NOT_FOUND')
    }
  })
})
