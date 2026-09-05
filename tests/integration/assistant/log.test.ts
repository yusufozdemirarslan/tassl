// Step 7.3 — the Delegation Log, the used marks, and the outside-tool declaration
// (docs/tech/10-backend-spec-modules.md §7; FR-055, FR-060 to FR-062, FR-084).
//
// **The claims this file exists to make.**
//
//   1. The log is a unit of work (FR-060): what was asked, what came back, which claims resulted,
//      which the student marked used, and the stance each carries now.
//   2. A why line is the student's own sentence and is stored as written.
//   3. A used mark is a statement of reliance: it writes `claim_used { via: 'log_mark' }`, sets
//      `relied_on_via`, and is what will put the claim in front of the Decision Lock's gate
//      (FR-084). Pressing it twice records one act.
//   4. The declaration writes one event and has no other effect (FR-061, FR-062, FR-006).
//   5. A student's log carries no reviewer flags and no unverified numbers; a reviewer's carries
//      both (12 §8.1, §8.2).
//
// The Sycophancy Probe used to be tested here as one `describe`, and it earned a file of its own:
// FR-053 and D-088 are worth exactly one thing — whether a student can tell the scripted reversal
// from a real one — and that question is asked of the stream, the claim list, the shape of the
// frames, the provider call and the number of times it can happen. See `probe.test.ts`.
// @db:truncate
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { truncateAll } from '@tests/setup/integration'
import {
  codeOf,
  delegationRows,
  eventsOfType,
  keysOf,
  runClaimRows,
  runInWorking,
  setStanceDirectly,
  setupAssistantFixture,
  type AssistantFixture,
} from './fixture'

type Assistant = typeof import('@/server/modules/assistant')
type Runs = typeof import('@/server/modules/runs')

let assistant: Assistant
let runs: Runs
let fx: AssistantFixture

/** Makes one delegation and answers its id. */
async function ask(runId: string, request: string): Promise<string> {
  const stream = await assistant.delegate(fx.student, runId, { request })
  let delegationId = ''
  for await (const chunk of stream)
    if (chunk.event === 'done') delegationId = chunk.data.delegationId
  return delegationId
}

beforeEach(async () => {
  await truncateAll()
  assistant = await import('@/server/modules/assistant')
  runs = await import('@/server/modules/runs')
  fx = await setupAssistantFixture('log')
})

afterAll(async () => {
  await truncateAll()
})

// ---------------------------------------------------------------------------------------------
// The log (FR-060)
// ---------------------------------------------------------------------------------------------

describe('listDelegations', () => {
  it('lists each delegation with its claims and their current stances', async () => {
    const runId = await runInWorking(fx)
    await ask(runId, 'What is the premium payback?')
    await ask(runId, 'What does the willingness to pay survey say?')

    const log = await assistant.listDelegations(fx.student, runId)
    expect(log.map((entry) => entry.seq)).toEqual([1, 2])
    expect(log[0]?.claims.map((claim) => claim.key)).toEqual(['C3'])
    expect(log[1]?.claims.map((claim) => claim.key)).toEqual(['C7'])
    expect(log[0]?.claims[0]).toMatchObject({ stance: null, usedMarked: false })

    // A stance set on the claim shows up in the log beside the delegation that surfaced it.
    await setStanceDirectly(runId, fx.claimId('C3'), 'verify')
    const again = await assistant.listDelegations(fx.student, runId)
    expect(again[0]?.claims[0]?.stance).toBe('verify')
  })

  it('is readable by a reviewer of the section, and carries their flags only for them', async () => {
    const runId = await runInWorking(fx)
    const delegationId = await ask(runId, 'What is the premium payback?')

    const owner = await assistant.listDelegations(fx.student, runId)
    expect(keysOf(owner).has('flags')).toBe(false)
    expect(keysOf(owner).has('unverifiedNumbers')).toBe(false)

    for (const reviewer of [fx.instructor, fx.ta]) {
      const seen = await assistant.listDelegations(reviewer, runId)
      expect(seen).toHaveLength(1)
      expect(seen[0]?.flags).toEqual([])
      expect(seen[0]?.unverifiedNumbers).toEqual([])
    }

    // FR-055: the reviewer's flag is theirs, and the student's view never grows it.
    await assistant.flagDelegation(fx.instructor, runId, delegationId, 'out_of_scenario')
    expect((await assistant.listDelegations(fx.ta, runId))[0]?.flags).toEqual(['out_of_scenario'])
    expect(keysOf(await assistant.listDelegations(fx.student, runId)).has('flags')).toBe(false)
  })

  it('answers NOT_FOUND to a classmate', async () => {
    const runId = await runInWorking(fx)
    await ask(runId, 'What is the premium payback?')
    expect(await codeOf(assistant.listDelegations(fx.classmate, runId))).toBe('NOT_FOUND')
  })
})

// ---------------------------------------------------------------------------------------------
// The why line and the used marks (FR-060, FR-084)
// ---------------------------------------------------------------------------------------------

describe('updateDelegation', () => {
  it('saves the why line as the student wrote it', async () => {
    const runId = await runInWorking(fx)
    const delegationId = await ask(runId, 'What is the premium payback?')
    const why = 'I wanted the payback figure before I wrote the recommendation.'

    const updated = await assistant.updateDelegation(fx.student, runId, delegationId, { why })
    expect(updated.why).toBe(why)
    expect((await delegationRows(runId))[0]?.why).toBe(why)

    // It is the student's own note about their own work: it moves no claim and writes no event.
    expect(await eventsOfType(runId, 'claim_used')).toEqual([])
  })

  it('marks a claim used, records the reliance, and writes claim_used once', async () => {
    const runId = await runInWorking(fx)
    const delegationId = await ask(runId, 'What is the premium payback?')
    const claimId = fx.claimId('C3')

    const updated = await assistant.updateDelegation(fx.student, runId, delegationId, {
      usedClaimIds: [claimId],
    })
    expect(updated.claims[0]).toMatchObject({ key: 'C3', usedMarked: true })

    const [row] = await runClaimRows(runId)
    expect(row).toMatchObject({ used_marked: true, relied_on: true, relied_on_via: ['log_mark'] })

    const events = await eventsOfType(runId, 'claim_used')
    expect(events).toHaveLength(1)
    expect(events[0]?.payload).toEqual({
      claim_id: claimId,
      via: 'log_mark',
      delegation_id: delegationId,
    })

    // Pressed twice, it records one act: the claim is relied on, and it was relied on once.
    await assistant.updateDelegation(fx.student, runId, delegationId, { usedClaimIds: [claimId] })
    expect(await eventsOfType(runId, 'claim_used')).toHaveLength(1)
    expect((await runClaimRows(runId))[0]?.relied_on_via).toEqual(['log_mark'])
  })

  it('refuses a used mark naming a claim the delegation did not carry', async () => {
    const runId = await runInWorking(fx)
    const delegationId = await ask(runId, 'What is the premium payback?')

    expect(
      await codeOf(
        assistant.updateDelegation(fx.student, runId, delegationId, {
          usedClaimIds: [fx.claimId('C7')],
        }),
      ),
    ).toBe('VALIDATION_ERROR')
    expect((await runClaimRows(runId)).map((row) => row.relied_on)).toEqual([false])
  })

  it('refuses a delegation id that is not on this run', async () => {
    const runId = await runInWorking(fx)
    await ask(runId, 'What is the premium payback?')
    expect(
      await codeOf(
        assistant.updateDelegation(fx.student, runId, '00000000-0000-4000-8000-000000000000', {
          why: 'nothing',
        }),
      ),
    ).toBe('DELEGATION_NOT_FOUND')
  })
})

// ---------------------------------------------------------------------------------------------
// The outside-tool declaration (FR-061, FR-062, FR-006)
// ---------------------------------------------------------------------------------------------

describe('declareOutsideTool', () => {
  it('writes one event and changes nothing else about the run', async () => {
    const runId = await runInWorking(fx)
    const before = await runs.getRun(fx.student, runId)
    const purpose = 'Used a spreadsheet to recompute the payback from the cohort table.'

    await assistant.declareOutsideTool(fx.student, runId, { purpose })

    const events = await eventsOfType(runId, 'outside_tool_declared')
    expect(events).toHaveLength(1)
    expect(events[0]?.payload).toEqual({ purpose })

    const after = await runs.getRun(fx.student, runId)
    expect(after.state).toBe(before.state)
    expect(after.clock?.chargedMs).toBe(before.clock?.chargedMs)
    expect(after.clock?.creditedMs).toBe(before.clock?.creditedMs)
    expect(after.scoringStatus).toBe(before.scoringStatus)
    // Declaring is not a delegation and not a claim: the log and the stance matrix are untouched.
    expect(await delegationRows(runId)).toEqual([])
    expect(await runClaimRows(runId)).toEqual([])
  })

  it('is available while the run is paused, because it is a standing control (FR-061)', async () => {
    const runId = await runInWorking(fx)
    const { armForcedFailure } = await import('./fixture')
    await armForcedFailure(runId)
    await codeOf(assistant.delegate(fx.student, runId, { request: 'What is the premium payback?' }))
    expect((await runs.getRun(fx.student, runId)).state).toBe('paused')

    await assistant.declareOutsideTool(fx.student, runId, { purpose: 'Checked a currency rate.' })
    expect(await eventsOfType(runId, 'outside_tool_declared')).toHaveLength(1)
  })

  it('is refused before the frame is locked, and to anyone but the run owner', async () => {
    // FR-061 makes it a standing control of the *working period*: in `framing` the student has not
    // started working yet, and there is nothing outside the room to have used.
    const started = await runs.startRun(fx.student, fx.assignment.id)
    await runs.acknowledgePolicy(fx.student, started.id)
    await runs.submitReadiness(fx.student, started.id)
    expect(
      await codeOf(assistant.declareOutsideTool(fx.student, started.id, { purpose: 'A tool.' })),
    ).toBe('ASSISTANT_LOCKED')

    expect(
      await codeOf(assistant.declareOutsideTool(fx.classmate, started.id, { purpose: 'A tool.' })),
    ).toBe('NOT_FOUND')
    expect(await eventsOfType(started.id, 'outside_tool_declared')).toEqual([])
  })
})
