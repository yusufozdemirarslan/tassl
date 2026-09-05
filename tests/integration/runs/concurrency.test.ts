// Step 6.2 — what the run module's locking is actually worth, against Postgres
// (docs/tech/10-backend-spec.md §6, §8, §9; 10-backend-spec-modules.md §6; NFR-005, NFR-008,
// D-041, D-042, D-123).
//
// `tests/integration/runs/start.test.ts` asserts the rules; this file asserts the mechanism. Both
// double-press claims there are `await` followed by `await`, which would pass with the unique index
// dropped and the row lock removed, so the races are written here the way
// `tests/integration/trace/append.test.ts` writes them: every worker starts in the same tick and
// contends for real.
//
// The other half is the opposite property — that a *read* takes no writer's lock. `GET /runs/{id}`
// is the five-second poll behind every run screen and is what a reviewer watches a run with, so a
// read that opened `SELECT … FOR UPDATE` would queue every watcher behind the run's own writer
// while holding one of the five pooled connections (D-229). That is measured, not assumed: the
// lock is held by a second connection and the poll has to come back anyway.
// @db:truncate
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { testSql, truncateAll } from '@tests/setup/integration'
import { isAppError } from '@/lib/errors'
import type { SessionUser } from '@/server/auth/types'

type Runs = typeof import('@/server/modules/runs')
type Trace = typeof import('@/server/modules/trace')
type Factories = typeof import('@tests/factories')
type UserRow = Awaited<ReturnType<Factories['createUser']>>

let runs: Runs
let trace: Trace
let f: Factories

const actorFor = (user: UserRow, orgId: string): SessionUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
  emailVerified: true,
  activeOrganizationId: orgId,
  platformRole: 'none',
})

/** Six presses of one button: more than the five pooled connections, so the pool is contended too. */
const WORKERS = 6

type Settled<T> = { ok: T[]; codes: string[] }

/** Runs every worker in the same tick and separates what came back from what was refused. */
async function race<T>(work: (index: number) => Promise<T>): Promise<Settled<T>> {
  const results = await Promise.allSettled(Array.from({ length: WORKERS }, (_, i) => work(i)))
  const ok: T[] = []
  const codes: string[] = []
  for (const result of results) {
    if (result.status === 'fulfilled') ok.push(result.value)
    else codes.push(isAppError(result.reason) ? result.reason.code : String(result.reason))
  }
  return { ok, codes }
}

type Fixture = Awaited<ReturnType<typeof setup>>

async function setup() {
  const w = await f.buildWalkthroughFixture()
  const orgId = w.organization.id
  await testSql`
    update scenario_package_versions set status = 'confirmed', confirmed_at = now(),
      confirmed_by = ${w.instructor.id}, teaching_note_checked = true
    where id = ${w.pkg.version.id}`
  return {
    orgId,
    assignment: w.assignment,
    student: actorFor(w.student1, orgId),
    instructor: actorFor(w.instructor, orgId),
  }
}

let fx: Fixture

beforeEach(async () => {
  await truncateAll()
  runs ??= await import('@/server/modules/runs')
  trace ??= await import('@/server/modules/trace')
  f ??= await import('@tests/factories')
  fx = await setup()
}, 30_000)

afterAll(async () => {
  await truncateAll()
})

const runRows = (): Promise<{ id: string; state: string; next_event_seq: number }[]> =>
  testSql`select id, state, next_event_seq from runs order by created_at`

describe('startRun under a double press (D-041)', () => {
  it('gives six simultaneous presses exactly one run', async () => {
    const { ok, codes } = await race(() => runs.startRun(fx.student, fx.assignment.id))

    expect(ok).toHaveLength(1)
    expect(codes).toEqual(Array.from({ length: WORKERS - 1 }, () => 'RUN_ACTIVE_EXISTS'))

    // The refusal is the domain's, not a leaked constraint violation: the unique index on
    // `(assignment_id, student_id, attempt_no)` is what settles the true race, and `asSecondStart`
    // maps it rather than letting it surface as a 500.
    const rows = await runRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe(ok[0]?.id)
    expect(rows[0]?.state).toBe('assigned')
    // Nothing has happened to the run yet, so the trace allocator is untouched.
    expect(rows[0]?.next_event_seq).toBe(1)
  })
})

describe('acknowledgePolicy under a double press (FR-201, 10 §9)', () => {
  it('gives six simultaneous acknowledgements one state change and exactly two events', async () => {
    const started = await runs.startRun(fx.student, fx.assignment.id)
    const { ok, codes } = await race(() => runs.acknowledgePolicy(fx.student, started.id))

    expect(ok).toHaveLength(1)
    expect(ok[0]?.state).toBe('readiness')
    // The transition table refuses the losers. A SEQUENCE_CONFLICT here would mean two writers got
    // past the row lock and raced for the same trace sequence instead (NFR-005).
    expect(codes).toEqual(Array.from({ length: WORKERS - 1 }, () => 'ILLEGAL_TRANSITION'))

    const events = await trace.listEvents(fx.instructor, started.id)
    expect(events.map((event) => [event.seq, event.type])).toEqual([
      [1, 'policy_displayed'],
      [2, 'lifecycle'],
    ])
    // One acknowledgement, one policy display: a second would be a second record of the same act.
    const rows = await runRows()
    expect(rows[0]?.state).toBe('readiness')
    expect(rows[0]?.next_event_seq).toBe(3)
    expect(ok[0]?.version).toBe(2)
  })
})

describe('a read does not take the writer’s lock (D-229, NFR-008)', () => {
  /**
   * Holds `SELECT … FOR UPDATE` on the run row on a second connection for `holdMs`, and resolves
   * `locked` once the lock is actually held so the reader below cannot win by starting first.
   */
  function holdRunLock(
    runId: string,
    holdMs: number,
  ): { locked: Promise<void>; done: Promise<void> } {
    let acquired: () => void = () => {}
    const locked = new Promise<void>((resolve) => {
      acquired = resolve
    })
    const done = testSql
      .begin(async (tx) => {
        await tx`select id from runs where id = ${runId} for update`
        acquired()
        await tx`select pg_sleep(${holdMs / 1000})`
      })
      .then(() => undefined)
    return { locked, done }
  }

  it('answers the poll while a writer holds the run row', async () => {
    const started = await runs.startRun(fx.student, fx.assignment.id)
    const { locked, done } = holdRunLock(started.id, 2000)
    await locked

    const at = Date.now()
    const summary = await runs.getRun(fx.student, started.id)
    const elapsedMs = Date.now() - at

    expect(summary.id).toBe(started.id)
    expect(summary.state).toBe('assigned')
    // The auditor measured a poll blocking 1,346 ms behind a held lock. A read that still opened a
    // transaction and locked the row would sit here for the whole 2,000 ms.
    expect(elapsedMs).toBeLessThan(750)
    await done
  })

  it('answers a reviewer’s poll the same way', async () => {
    const started = await runs.startRun(fx.student, fx.assignment.id)
    const { locked, done } = holdRunLock(started.id, 2000)
    await locked

    const at = Date.now()
    await runs.getRunStatus(fx.instructor, started.id)
    expect(Date.now() - at).toBeLessThan(750)
    await done
  })
})

describe('the module’s public surface (08 §5, D-230)', () => {
  it('does not export materializeTimers', () => {
    // It is a mutation reached by a tenant id and a run id rather than by an actor: exported, it
    // would be a writing entry point in front of no permission helper. Every way into it is a
    // function below that names its actor first.
    expect(Object.keys(runs)).not.toContain('materializeTimers')
    expect(Object.keys(runs).every((name) => typeof name === 'string')).toBe(true)
  })
})
