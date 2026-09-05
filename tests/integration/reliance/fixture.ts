// The room every reliance test works in (Step 8.1), built on the fixture package the seed imports:
// Meridian Roast, nine documents, eight claims, two variants (`tests/integration/assistant/fixture`).
//
// It reuses the assistant suite's fixture rather than standing up a second one, and that is the
// point rather than a shortcut: the claims a student takes a stance on are the claims the assistant
// surfaced, the actions are the paths the author confirmed on the *same* variant, and a hand-built
// package would let this file decide what "a claim with a Source Trace" is — which is exactly the
// thing under test.
//
// What the fixture package gives these suites, read from the author's own data:
//
//   C1  document D5, source_trace + decomposition_check, carries 4.2 months with no field key
//   C3  assistant (delegation "premium payback"), source_trace + decomposition_check,
//       carries 11 months bound to the named field `premium_payback_months`
//   C4  assistant (delegation "compare the cohorts"), replication_check only
//   C5  document D3, source_trace only
//   C6  document D7, source_trace only
//   C7  document D8, source_trace only, and **the one claim with an authored escalation reply**
import { testSql } from '@tests/setup/integration'

export {
  FIXTURE,
  FRAME,
  actorFor,
  claimByKey,
  codeOf,
  eventsOfType,
  keysOf,
  runClaimRows,
  runInWorking,
  setupAssistantFixture,
  setStanceDirectly,
} from '../assistant/fixture'
export type { AssistantFixture } from '../assistant/fixture'

import type { Tx } from '@/server/db/tx'
import type { lockRunForMutation } from '@/server/modules/runs'
import type { AssistantFixture } from '../assistant/fixture'

/** The locked, timer-materialized run row `lockRunForMutation` hands over. */
type LockedRun = Awaited<ReturnType<typeof lockRunForMutation>>

/** Opens a document, which surfaces the claims sourced from it (FR-031). */
export async function openDocument(fx: AssistantFixture, runId: string, key: string) {
  const runs = await import('@/server/modules/runs')
  return runs.openDocument(fx.student, runId, fx.documentId(key))
}

/** Sends one delegation and drains the stream, so the claims it matched are surfaced. */
export async function delegate(
  fx: AssistantFixture,
  runId: string,
  request: string,
): Promise<string> {
  const assistant = await import('@/server/modules/assistant')
  const stream = await assistant.delegate(fx.student, runId, { request })
  let id = ''
  for await (const chunk of stream) if (chunk.event === 'done') id = chunk.data.delegationId
  return id
}

/**
 * Runs `fn` with the run's row locked, the way another module's mutation reaches this one.
 *
 * `markReliedOnFromNamedFields` and `findUnstancedReliedOn` take a transaction and a locked run
 * rather than an actor (10 §8), because the Decision Lock calls them from inside its own mutation.
 * This is that call, and nothing more: Step 8.2 makes it from `lockDecision`.
 */
export async function inLockedRun<T>(
  fx: AssistantFixture,
  runId: string,
  fn: (tx: Tx, run: LockedRun) => Promise<T>,
): Promise<T> {
  const { withTransaction } = await import('@/server/db/tx')
  const runs = await import('@/server/modules/runs')
  return withTransaction(async (tx) => {
    const run = await runs.lockRunForMutation(tx, fx.orgId, runId)
    return fn(tx, run)
  })
}

// ---------------------------------------------------------------------------------------------
// Reading the record back — the tables and the trace as written, not a projection of them
// ---------------------------------------------------------------------------------------------

export async function actionRows(runId: string) {
  return testSql<
    {
      id: string
      claim_id: string
      type: string
      clock_cost_ms: number
      result: Record<string, unknown>
      started_at: Date
      completed_at: Date
      in_turn_window: boolean
      clock_remaining_ms: number | null
    }[]
  >`select id, claim_id, type, clock_cost_ms, result, started_at, completed_at, in_turn_window,
           clock_remaining_ms
      from run_actions where run_id = ${runId} order by started_at, id`
}

export async function escalationRows(runId: string) {
  return testSql<
    {
      id: string
      claim_id: string
      statement: string
      response_id: string
      response_text: string
      clock_cost_ms: number
      counts_against_limit: boolean
      in_turn_window: boolean
    }[]
  >`select id, claim_id, statement, response_id, response_text, clock_cost_ms,
           counts_against_limit, in_turn_window
      from run_escalations where run_id = ${runId} order by created_at, id`
}

/**
 * The run's clock columns as numbers.
 *
 * `charged_ms`, `credited_ms` and `total_paused_ms` are `bigint` (06 §3.4), and postgres-js hands a
 * bigint back as a string so no precision is lost on the way. Drizzle's `{ mode: 'number' }` does
 * this coercion for the application; a raw `testSql` read has to do it itself, and a test that
 * forgot would compare `'0'` with `0` and fail for the wrong reason.
 */
export async function runRow(runId: string) {
  const [row] = await testSql<
    {
      state: string
      charged_ms: string
      credited_ms: string
      total_paused_ms: string
      working_clock_seconds: number
      working_started_at: Date | null
      turn_window_ends_at: Date | null
    }[]
  >`select state, charged_ms, credited_ms, total_paused_ms, working_clock_seconds,
           working_started_at, turn_window_ends_at
      from runs where id = ${runId}`
  if (!row) throw new Error(`no run ${runId}`)
  return {
    ...row,
    charged_ms: Number(row.charged_ms),
    credited_ms: Number(row.credited_ms),
    total_paused_ms: Number(row.total_paused_ms),
  }
}

/** The authored verification paths of the run's variant, so a test asserts the author's own words. */
export async function verificationPaths(
  runId: string,
  claimId: string,
): Promise<Record<string, unknown>> {
  const [row] = await testSql<{ verification_paths: Record<string, unknown> }[]>`
    select vcs.verification_paths
      from variant_claim_states vcs
      join runs r on r.variant_id = vcs.variant_id
     where r.id = ${runId} and vcs.claim_id = ${claimId}`
  if (!row) throw new Error('the run has no claim state for that claim')
  return row.verification_paths
}

/** The version's general escalation reply (FR-091), which a student never sees as a package field. */
export async function generalEscalationReply(runId: string): Promise<string> {
  const [row] = await testSql<{ general_escalation_reply: string }[]>`
    select v.general_escalation_reply
      from scenario_package_versions v
      join runs r on r.package_version_id = v.id
     where r.id = ${runId}`
  if (!row) throw new Error('the run has no package version')
  return row.general_escalation_reply
}

// ---------------------------------------------------------------------------------------------
// Moving the clock and the state, which the product does not let a test do through a service
// ---------------------------------------------------------------------------------------------

/**
 * Rewinds `working_started_at` so the working clock reads `ms`.
 *
 * The clock is arithmetic over the run's own columns (D-042), so moving its origin is the honest way
 * to put a run near expiry: nothing is faked, and `remainingMs` answers what the student's screen
 * would answer. Step 8.2's `advance-clock` test route does the same thing through a route.
 */
export async function setClockRemaining(runId: string, ms: number): Promise<void> {
  await testSql`
    update runs
       set working_started_at = now() - make_interval(secs =>
             (working_clock_seconds * 1000 + total_paused_ms + credited_ms - charged_ms - ${ms})
             / 1000.0)
     where id = ${runId}`
}

/** Puts the run in a state this step cannot reach yet (`paused` and the lock are Step 8.2's). */
export async function forceState(runId: string, state: string): Promise<void> {
  await testSql`update runs set state = ${state}::run_state where id = ${runId}`
}

/** Stops the clock the way a component failure does, without needing one (FR-001). */
export async function forcePaused(runId: string): Promise<void> {
  await testSql`update runs set state = 'paused', paused_at = now() where id = ${runId}`
}
