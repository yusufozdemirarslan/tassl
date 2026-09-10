// Step 8.2 — the forced-failure test control and the Paused state it exists to demonstrate
// (docs/tech/10-backend-spec-modules.md §6; 10-backend-spec.md §10; 12-security.md §4 A04;
// FR-001, FR-118, DATA-040, D-133).
//
// FR-001 is a standing rule of the product rather than a feature: when a component fails, the run
// pauses, the clock stops, and the cost of the failed action is credited back on resume. FR-118 is
// how a class is shown it — an instructor arms one assistant failure from the faculty seat, and the
// next thing the student asks the assistant produces the outage.
//
// Three things are asserted here that only a database can settle.
//
//   * **Who may arm it, and when.** The section's instructor, and only where the installation has
//     test controls on. A student on the same section is refused, and the order of the two gates is
//     what keeps the refusal from telling them anything (12 §4).
//   * **What the student sees.** A paused run, a stopped clock, and one sentence about a component
//     that did not answer. Nothing anywhere says a control did it — the run's own record carries the
//     cause and the delegation, and the flag lives in `runs.flags`, which no student view reads.
//   * **What the resume gives back.** The wall-clock span the outage took, plus the failed action's
//     cost: zero for a delegation, which charges no clock, and the action's own cost for one that
//     did (10 §10).
// @db:truncate
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { testSql, truncateAll } from '@tests/setup/integration'
import {
  codeOf,
  eventsOfType,
  forcePaused,
  forceState,
  inLockedRun,
  runInWorking,
  setupAssistantFixture,
  type AssistantFixture,
} from '../reliance/fixture'

type Runs = typeof import('@/server/modules/runs')
type Assistant = typeof import('@/server/modules/assistant')
type Config = typeof import('@/server/config')

let runs: Runs
let assistant: Assistant
let config: Config
let fx: AssistantFixture

/** What a Replication Check costs, so a credit can be asserted against the number 10 §10 names. */
const REPLICATION_CHECK_MS = 180_000

async function runRow(runId: string) {
  const [row] = await testSql<
    {
      state: string
      credited_ms: string
      total_paused_ms: string
      flags: Record<string, unknown>
    }[]
  >`select state, credited_ms, total_paused_ms, flags from runs where id = ${runId}`
  if (!row) throw new Error(`no run ${runId}`)
  return {
    state: row.state,
    creditedMs: Number(row.credited_ms),
    totalPausedMs: Number(row.total_paused_ms),
    flags: row.flags,
  }
}

async function pauseRows(runId: string) {
  return testSql<
    {
      id: string
      cause: string
      resumed_at: Date | null
      credited_ms: number
      related_delegation_id: string | null
    }[]
  >`select id, cause, resumed_at, credited_ms, related_delegation_id
      from run_pauses where run_id = ${runId} order by paused_at`
}

/**
 * The test-control rows of the audit log, and only those.
 *
 * The fixture confirms a package version on the way in, which writes its own `package.confirm` row
 * (08 §4's audit list); filtering by action is what keeps this assertion about FR-118 rather than
 * about everything the setup happened to do.
 */
async function auditRows() {
  return testSql<
    { action: string; target_type: string; target_id: string; metadata: Record<string, unknown> }[]
  >`select action, target_type, target_id, metadata from audit_logs
      where action = 'test_control.force_failure' order by created_at`
}

/**
 * Runs `fn` with `FEATURE_TEST_CONTROLS` off.
 *
 * The flag is read from the parsed environment on every call (`flagsFromEnv(env)`), so the
 * installation's answer can be changed for one assertion without a second module graph — and put
 * back, so no other test in this file inherits it.
 */
async function withTestControlsOff<T>(fn: () => Promise<T>): Promise<T> {
  const mutable = config.env as { FEATURE_TEST_CONTROLS: boolean }
  const previous = mutable.FEATURE_TEST_CONTROLS
  mutable.FEATURE_TEST_CONTROLS = false
  try {
    return await fn()
  } finally {
    mutable.FEATURE_TEST_CONTROLS = previous
  }
}

/** Sends one delegation and drains the stream; answers the error code when it refuses. */
async function delegateExpectingFailure(runId: string): Promise<string> {
  return codeOf(
    (async () => {
      const stream = await assistant.delegate(fx.student, runId, {
        request: 'What is the premium payback?',
      })
      // Drained rather than ignored: a refusal that reached the stream instead of the promise
      // would surface here (D-271).
      for await (const chunk of stream) void chunk
    })(),
  )
}

beforeEach(async () => {
  await truncateAll()
  runs = await import('@/server/modules/runs')
  assistant = await import('@/server/modules/assistant')
  config = await import('@/server/config')
  fx = await setupAssistantFixture('pause')
})

afterAll(async () => {
  await truncateAll()
})

// ---------------------------------------------------------------------------------------------
// Arming the control (FR-118, 08 §4, 12 §4 A04)
// ---------------------------------------------------------------------------------------------

describe('forceAssistantFailure', () => {
  it('arms the flag for the section’s instructor and writes the audit row', async () => {
    const runId = await runInWorking(fx)

    expect(await runs.forceAssistantFailure(fx.instructor, runId)).toEqual({ armed: true })

    expect((await runRow(runId)).flags).toMatchObject({ forced_failure_armed: true })
    // 08 §4's "Audit: … test-control use with the request id" and 12 §4's A04.
    expect(await auditRows()).toEqual([
      {
        action: 'test_control.force_failure',
        target_type: 'run',
        target_id: runId,
        metadata: { armed: true },
      },
    ])
    // Nothing has happened *in the run* yet, so the trace says nothing: the record of a test
    // control is the audit log, and what the run records is the outage it causes.
    expect(await eventsOfType(runId, 'pause')).toEqual([])
  })

  it('is refused to the student whose run it is, and to the TA', async () => {
    const runId = await runInWorking(fx)

    // The run's own student and the TA are told they may not (FORBIDDEN); a classmate is told the
    // run does not exist for them (NOT_FOUND, D-703) — and none of them can arm it (08 §4).
    expect(await codeOf(runs.forceAssistantFailure(fx.student, runId))).toBe('FORBIDDEN')
    expect(await codeOf(runs.forceAssistantFailure(fx.ta, runId))).toBe('FORBIDDEN')
    expect(await codeOf(runs.forceAssistantFailure(fx.classmate, runId))).toBe('NOT_FOUND')

    expect((await runRow(runId)).flags.forced_failure_armed).toBeUndefined()
    expect(await auditRows()).toEqual([])
  })

  it('is refused when the installation has test controls off', async () => {
    const runId = await runInWorking(fx)

    await withTestControlsOff(async () => {
      expect(await codeOf(runs.forceAssistantFailure(fx.instructor, runId))).toBe(
        'TEST_CONTROLS_DISABLED',
      )
      // And the seat check still comes first, so a student learns nothing about the deployment.
      expect(await codeOf(runs.forceAssistantFailure(fx.student, runId))).toBe('FORBIDDEN')
    })

    expect((await runRow(runId)).flags.forced_failure_armed).toBeUndefined()
    expect(await auditRows()).toEqual([])
  })

  // The third gate (D-332). The control had two — the seat and the environment — and neither asked
  // whether the run had an assistant left to fail, so an instructor could arm an outage on a run
  // whose decision was filed, or on a voided one, and the only trace of it was a flag nothing would
  // ever read and an audit row against a finished run.
  it('is refused on a run whose decision is already filed', async () => {
    const runId = await runInWorking(fx)
    await forceState(runId, 'decision_locked')

    expect(await codeOf(runs.forceAssistantFailure(fx.instructor, runId))).toBe('RUN_LOCKED')
    expect((await runRow(runId)).flags.forced_failure_armed).toBeUndefined()
    expect(await auditRows()).toEqual([])
  })

  it('is refused before the assistant is unlocked, and on a voided run', async () => {
    // One run through three states, because a section holds one live run per assignment. The two
    // refusals differ on purpose: a run past the lock has nothing coming and says `RUN_LOCKED`, and
    // a run that has not got there — or that counts for nothing — is the transition table's.
    const runId = await runInWorking(fx)

    for (const [state, expected] of [
      ['framing', 'ILLEGAL_TRANSITION'],
      ['recorded', 'RUN_LOCKED'],
      ['voided', 'ILLEGAL_TRANSITION'],
    ] as const) {
      await forceState(runId, state)
      expect([state, await codeOf(runs.forceAssistantFailure(fx.instructor, runId))]).toEqual([
        state,
        expected,
      ])
      expect((await runRow(runId)).flags.forced_failure_armed).toBeUndefined()
    }
    expect(await auditRows()).toEqual([])
  })

  it('is allowed on a paused run, whose next delegation is still ahead of it', async () => {
    const runId = await runInWorking(fx)
    await forcePaused(runId)

    expect(await runs.forceAssistantFailure(fx.instructor, runId)).toEqual({ armed: true })
    expect((await runRow(runId)).flags).toMatchObject({ forced_failure_armed: true })
  })
})

// ---------------------------------------------------------------------------------------------
// The outage it causes, and the resume (FR-001)
// ---------------------------------------------------------------------------------------------

describe('the next delegation pauses the run', () => {
  it('fails once, pauses the run, and stops the clock', async () => {
    const runId = await runInWorking(fx)
    await runs.forceAssistantFailure(fx.instructor, runId)

    expect(await delegateExpectingFailure(runId)).toBe('ASSISTANT_UNAVAILABLE')

    const row = await runRow(runId)
    expect(row.state).toBe('paused')
    // One arming, one outage: the flag is consumed rather than read, so the class sees a pause and
    // a resume rather than an assistant that never works again (FR-118).
    expect(row.flags.forced_failure_armed).toBeUndefined()

    const [pause] = await pauseRows(runId)
    expect(pause).toMatchObject({ cause: 'assistant_failure', resumed_at: null, credited_ms: 0 })
    expect(pause?.related_delegation_id).not.toBeNull()

    const [event] = await eventsOfType(runId, 'pause')
    expect(event?.payload).toEqual({
      pause_id: pause?.id,
      cause: 'assistant_failure',
      related_delegation_id: pause?.related_delegation_id,
    })
  })

  it('credits nothing for a delegation, because a delegation charges nothing (10 §10)', async () => {
    const runId = await runInWorking(fx)
    await runs.forceAssistantFailure(fx.instructor, runId)
    await delegateExpectingFailure(runId)

    const summary = await runs.resumeRun(fx.student, runId)

    expect(summary.state).toBe('working')
    const [event] = await eventsOfType(runId, 'resume')
    const [pause] = await pauseRows(runId)
    expect(event?.payload).toMatchObject({ pause_id: pause?.id, clock_credited_ms: 0 })
    expect(Number(event?.payload.paused_ms)).toBeGreaterThanOrEqual(0)

    const row = await runRow(runId)
    // What the student gets back is the wall-clock span the outage took, in `total_paused_ms`.
    expect(row.creditedMs).toBe(0)
    expect(row.totalPausedMs).toBeGreaterThanOrEqual(0)
    expect((await pauseRows(runId))[0]?.resumed_at).not.toBeNull()
  })

  it('credits the failed action’s cost when there was one (FR-001)', async () => {
    const runId = await runInWorking(fx)

    // A Replication Check charged its three minutes and then did not return. `pauseRun` is the seam
    // every failing component reaches FR-001 through, and the cost it records is what the resume
    // gives back — the number is known where it was charged, not guessed at the resume.
    await inLockedRun(fx, runId, async (tx, run) => {
      await runs.pauseRun(tx, run, 'action_failure', { creditMs: REPLICATION_CHECK_MS })
    })
    expect((await runRow(runId)).state).toBe('paused')

    await runs.resumeRun(fx.student, runId)

    expect((await runRow(runId)).creditedMs).toBe(REPLICATION_CHECK_MS)
    const [event] = await eventsOfType(runId, 'resume')
    expect(event?.payload).toMatchObject({ clock_credited_ms: REPLICATION_CHECK_MS })
  })

  it('refuses every write of the working period while it is paused, and offers the resume', async () => {
    const runId = await runInWorking(fx)
    await runs.forceAssistantFailure(fx.instructor, runId)
    await delegateExpectingFailure(runId)

    expect(await codeOf(runs.saveBriefDraft(fx.student, runId, { rationale: 'later' }))).toBe(
      'RUN_PAUSED',
    )
    expect(await codeOf(runs.briefSignal(fx.student, runId, { opened: true }))).toBe('RUN_PAUSED')

    // What the student is shown is the cause in plain language and nothing about a control (UI-023).
    const workspace = await runs.getRunWorkspace(fx.student, runId)
    expect(workspace.pause?.cause).toBe('assistant_failure')
    expect(Object.keys(workspace.pause ?? {}).sort()).toEqual(['cause', 'pausedAt'])
    expect(JSON.stringify(workspace)).not.toContain('forced_failure_armed')
    expect(workspace.capabilities.canWriteBrief).toBe(false)
  })

  it('lets the run carry on once resumed, with the assistant working again', async () => {
    const runId = await runInWorking(fx)
    await runs.forceAssistantFailure(fx.instructor, runId)
    await delegateExpectingFailure(runId)
    await runs.resumeRun(fx.student, runId)

    const stream = await assistant.delegate(fx.student, runId, {
      request: 'What is the premium payback?',
    })
    let done = false
    for await (const chunk of stream) if (chunk.event === 'done') done = true
    expect(done).toBe(true)
    expect((await runRow(runId)).state).toBe('working')
  })
})
