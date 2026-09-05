// Step 7.3 — the standing rule, when the assistant does not answer (FR-001, FR-118, D-133;
// 10-backend-spec-modules.md §7; 10-backend-spec.md §10).
//
// "When the assistant, a document, or an interrogation action fails to return, the run enters
// Paused, the working clock (or Turn window) stops, and the cost charged for the failed action is
// credited back on resume." The whole of that rule is one promise to a student: **our outage is not
// your problem.** This file is where that promise is proven rather than asserted.
//
//   1. A failed delegation leaves a row that says what was asked and that no answer came. A
//      delegation that vanished would leave a gap in the log exactly where the student's memory says
//      something happened.
//   2. The run pauses with cause `assistant_failure`, and the `pause` event names the delegation —
//      which is what ties the outage to the request on the clock timeline (FR-063).
//   3. The clock stops. Read before, during and after, it does not move while the run is paused.
//   4. The resume credits **nothing** for a delegation, and says so with `clock_credited_ms: 0`
//      (10 §10). That is not a gap: a delegation charges no clock, so there is no cost to give back
//      — what the student gets back is the wall-clock time the outage took, which the pause's own
//      arithmetic returns in full.
//   5. The test control fires once. One arming produces one outage, not an assistant that fails
//      until somebody notices (FR-118).
// @db:truncate
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { truncateAll } from '@tests/setup/integration'
import {
  armForcedFailure,
  codeOf,
  delegationRows,
  eventsOfType,
  pauseRows,
  runInWorking,
  setupAssistantFixture,
  type AssistantFixture,
} from './fixture'

type Assistant = typeof import('@/server/modules/assistant')
type Runs = typeof import('@/server/modules/runs')

let assistant: Assistant
let runs: Runs
let fx: AssistantFixture

const REQUEST = 'What is the premium payback?'

/** Arms FR-118's control and asks; answers the refusal's code. */
async function failOnce(runId: string): Promise<string> {
  await armForcedFailure(runId)
  return codeOf(assistant.delegate(fx.student, runId, { request: REQUEST }))
}

beforeEach(async () => {
  await truncateAll()
  assistant = await import('@/server/modules/assistant')
  runs = await import('@/server/modules/runs')
  fx = await setupAssistantFixture('failure')
})

afterAll(async () => {
  await truncateAll()
})

describe('a delegation that fails', () => {
  it('marks the delegation failed and records it in the trace (FR-001)', async () => {
    const runId = await runInWorking(fx)
    expect(await failOnce(runId)).toBe('ASSISTANT_UNAVAILABLE')

    const [row] = await delegationRows(runId)
    expect(row).toMatchObject({
      request_text: REQUEST,
      response_text: '',
      claim_ids: [],
      failed: true,
      why: null,
    })

    const [event] = await eventsOfType(runId, 'delegation')
    expect(event?.payload).toEqual({
      delegation_id: row?.id,
      seq: 1,
      request_text: REQUEST,
      response_text: '',
      claim_ids: [],
      why: null,
      in_turn_window: false,
      flags: [],
      unverified_numbers: [],
      failed: true,
    })

    // Nothing was surfaced: a claim the student never saw must not join their stance matrix.
    expect(await eventsOfType(runId, 'claim_used')).toEqual([])
  })

  it('pauses the run, naming the delegation that met the outage', async () => {
    const runId = await runInWorking(fx)
    await failOnce(runId)

    const summary = await runs.getRun(fx.student, runId)
    expect(summary.state).toBe('paused')
    expect(summary.clock?.paused).toBe(true)

    const [row] = await delegationRows(runId)
    const [pause] = await pauseRows(runId)
    expect(pause).toMatchObject({
      cause: 'assistant_failure',
      resumed_at: null,
      credited_ms: 0,
      related_delegation_id: row?.id,
    })

    const [pauseEvent] = await eventsOfType(runId, 'pause')
    expect(pauseEvent?.payload).toEqual({
      pause_id: pause?.id,
      cause: 'assistant_failure',
      related_delegation_id: row?.id,
    })

    // The transition table's own row (10 §9): working → paused, cause `component_failure`.
    const lifecycle = await eventsOfType(runId, 'lifecycle')
    expect(lifecycle.at(-1)?.payload).toEqual({
      from: 'working',
      to: 'paused',
      cause: 'component_failure',
    })
  })

  it('shows the pause on the workspace so the overlay can name it (UI-023)', async () => {
    const runId = await runInWorking(fx)
    await failOnce(runId)

    const workspace = await runs.getRunWorkspace(fx.student, runId)
    expect(workspace.pause).toMatchObject({ cause: 'assistant_failure' })
    expect(workspace.capabilities.assistantUnlocked).toBe(false)
    expect(workspace.capabilities.canOpenDocuments).toBe(false)
  })

  it('stops the clock, and the assistant refuses until the student resumes', async () => {
    const runId = await runInWorking(fx)
    await failOnce(runId)

    const first = await runs.getRun(fx.student, runId)
    await new Promise((resolve) => setTimeout(resolve, 60))
    const second = await runs.getRun(fx.student, runId)
    expect(second.clock?.remainingMs).toBe(first.clock?.remainingMs)

    expect(await codeOf(assistant.delegate(fx.student, runId, { request: REQUEST }))).toBe(
      'ASSISTANT_LOCKED',
    )
    // And nothing was written for the refused attempt: the log has the one failed entry.
    expect(await delegationRows(runId)).toHaveLength(1)
  })
})

describe('resume', () => {
  it('credits nothing for a delegation and writes the resume event (10 §10)', async () => {
    const runId = await runInWorking(fx)
    await failOnce(runId)
    const paused = await runs.getRun(fx.student, runId)

    await new Promise((resolve) => setTimeout(resolve, 30))
    const resumed = await runs.resumeRun(fx.student, runId)

    expect(resumed.state).toBe('working')
    expect(resumed.clock?.paused).toBe(false)
    // FR-001: the outage cost the student nothing. The wall-clock span is repaid into the clock, so
    // the reading is where it was when the run paused, and no credit was needed to get it there.
    expect(resumed.clock?.creditedMs).toBe(0)
    // Within the milliseconds the resume itself takes: the pause is repaid into `total_paused_ms`
    // at the instant it ends, and the reading is taken a few statements later. What matters is that
    // the thirty milliseconds spent paused are not among them.
    const paidBack = (paused.clock?.remainingMs ?? 0) - (resumed.clock?.remainingMs ?? 0)
    expect(paidBack).toBeGreaterThanOrEqual(0)
    expect(paidBack).toBeLessThan(250)

    const [pause] = await pauseRows(runId)
    expect(pause?.resumed_at).not.toBeNull()
    expect(pause?.credited_ms).toBe(0)

    const [event] = await eventsOfType(runId, 'resume')
    expect(event?.payload).toMatchObject({ pause_id: pause?.id, clock_credited_ms: 0 })
    expect(Number(event?.payload.paused_ms)).toBeGreaterThanOrEqual(0)

    const lifecycle = await eventsOfType(runId, 'lifecycle')
    expect(lifecycle.at(-1)?.payload).toEqual({ from: 'paused', to: 'working', cause: 'resumed' })
  })

  it('leaves the run working, so the next delegation is answered (FR-118 fires once)', async () => {
    const runId = await runInWorking(fx)
    await failOnce(runId)
    await runs.resumeRun(fx.student, runId)

    // The flag was consumed by the delegation that met it: one arming, one outage.
    const stream = await assistant.delegate(fx.student, runId, { request: REQUEST })
    let claims = 0
    for await (const chunk of stream) {
      if (chunk.event === 'segment' && chunk.data.type === 'claim') claims += 1
    }
    expect(claims).toBe(1)

    const rows = await delegationRows(runId)
    expect(rows.map((row) => row.failed)).toEqual([true, false])
    expect((await runs.getRun(fx.student, runId)).state).toBe('working')
  })

  it('refuses a resume on a run that is not paused', async () => {
    const runId = await runInWorking(fx)
    expect(await codeOf(runs.resumeRun(fx.student, runId))).toBe('ILLEGAL_TRANSITION')
    expect(await eventsOfType(runId, 'resume')).toEqual([])
  })

  it('is the run owner’s alone', async () => {
    const runId = await runInWorking(fx)
    await failOnce(runId)

    expect(await codeOf(runs.resumeRun(fx.classmate, runId))).toBe('NOT_FOUND')
    expect(await codeOf(runs.resumeRun(fx.instructor, runId))).toBe('NOT_FOUND')
    expect((await runs.getRun(fx.student, runId)).state).toBe('paused')
  })
})
