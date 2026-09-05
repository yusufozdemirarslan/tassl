// Step 8.1 — escalations (FR-090 to FR-093, D-089, D-116, D-244), against a real database.
//
// The escalation is the one move in the run where the *package* decides something about the
// student's budget, and the whole design of it is that they are never told which way it decided.
//
//   * A claim the author wrote a colleague reply for answers with that reply and **counts** against
//     the run's two (FR-090, FR-092). The third such escalation is refused.
//   * Every other claim answers with the version's general reply, costs the same five minutes, and
//     **does not count** (FR-091).
//   * The student's result carries the reply, the cost and the escalations left, and neither
//     `responseId` nor `countsAgainstLimit` (D-116) — because "this claim had an authored reply" is
//     "the author thought this claim worth arguing with", which is the map the run asks them to draw.
//
// The fixture package has exactly one claim with an authored reply (C7, the willingness-to-pay
// survey), which is what makes the counting assertions below real rather than arranged.
// @db:truncate
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { truncateAll } from '@tests/setup/integration'
import {
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

    // D-116: exactly these three keys. `responseId` would say which reply answered and
    // `countsAgainstLimit` would say the same thing a second way.
    expect(Object.keys(result).sort()).toEqual([
      'clockCostMs',
      'remainingEscalations',
      'responseText',
    ])
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
  it('returns the version’s general reply, costs the same, and does not count', async () => {
    const result = await reliance.escalate(fx.student, runId, fx.claimId('C1'), {
      statement: STATEMENT,
    })

    expect(result.responseText).toBe(await generalEscalationReply(runId))
    expect(result.clockCostMs).toBe(ESCALATION_MS)
    expect(result.remainingEscalations).toBe(2)

    const [row] = await escalationRows(runId)
    expect(row).toMatchObject({ response_id: 'general', counts_against_limit: false })
  })

  it('is still available after both counted escalations are spent', async () => {
    await reliance.escalate(fx.student, runId, fx.claimId('C7'), { statement: STATEMENT })
    await reliance.escalate(fx.student, runId, fx.claimId('C7'), { statement: STATEMENT })

    const general = await reliance.escalate(fx.student, runId, fx.claimId('C1'), {
      statement: STATEMENT,
    })
    expect(general.remainingEscalations).toBe(0)
    expect((await escalationRows(runId))[2]).toMatchObject({ counts_against_limit: false })
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
    await setClockRemaining(runId, 0)
    expect(
      await codeOf(
        reliance.escalate(fx.student, runId, fx.claimId('C7'), { statement: STATEMENT }),
      ),
    ).toBe('CLOCK_EXPIRED')
  })

  it('charges only what was left when the clock runs out mid-escalation (FR-072)', async () => {
    await setClockRemaining(runId, 45_000)
    const result = await reliance.escalate(fx.student, runId, fx.claimId('C7'), {
      statement: STATEMENT,
    })
    expect(result.responseText).toBe(await authoredReply())
    expect(result.clockCostMs).toBeLessThanOrEqual(45_000)
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

  it('refuses everyone but the run’s own student', async () => {
    for (const seat of [fx.classmate, fx.instructor, fx.ta] as const) {
      expect(
        await codeOf(reliance.escalate(seat, runId, fx.claimId('C7'), { statement: STATEMENT })),
      ).toBe('NOT_FOUND')
    }
  })
})
