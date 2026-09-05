// Step 6.1 — `trace.append` against Postgres (docs/tech/10-backend-spec-modules.md §10;
// 10-backend-spec.md §6; FR-007, NFR-005, DATA-029).
//
// The step exists for one property: the trace of a run is sequences 1..N with no hole and no
// repeat, whatever order the writers arrive in. So the first test is a real race — four workers,
// each opening its own transaction, locking the run row and appending, twenty times over — and not
// a loop that would pass with no locking at all. The rest is what makes that property true and what
// it is worth: the compare-and-set that refuses an appender which skipped the lock, the clock
// reading every event carries, the refusal of a payload that does not match its type, and the grant
// that makes the log append-only for the application role (migration 0009, D-085).
//
// `listEvents` is the other half, and three of its tests are about what the *owner* of the run may
// read of it: the dense renumbering that keeps a hidden `probe_fired` from leaving a hole a student
// can see (FR-053, D-088), the seal on the trace through the defense (UI-026), and the fields that
// open only once the run is scored (D-117). `tests/unit/trace/owner-view.test.ts` checks the two
// tables those rules are written in; this file checks what a reader actually receives.
// @db:truncate
import postgres from 'postgres'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { TEST_DATABASE_URL, truncateAll } from '@tests/setup/integration'
import { isAppError } from '@/lib/errors'
import type { SessionUser } from '@/server/auth/types'

type Trace = typeof import('@/server/modules/trace')
type TraceRepo = typeof import('@/server/modules/trace/repository')
type RunsRepo = typeof import('@/server/modules/runs/repository')
type TxModule = typeof import('@/server/db/tx')
type Factories = typeof import('@tests/factories')
type UserRow = Awaited<ReturnType<Factories['createUser']>>

let trace: Trace
let traceRepo: TraceRepo
let runsRepo: RunsRepo
let withTransaction: TxModule['withTransaction']
let f: Factories

/** The application role as preview and production run it (D-085, D-110); the password is local. */
const appSql = postgres(
  (() => {
    const url = new URL(TEST_DATABASE_URL)
    url.username = 'tassl_app'
    url.password = 'test'
    return url.toString()
  })(),
  { max: 1, prepare: false },
)

const actorFor = (user: UserRow, orgId: string): SessionUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
  emailVerified: true,
  activeOrganizationId: orgId,
  platformRole: 'none',
})

/** Fixed instants, so every clock assertion is an exact number rather than a window. */
const FRAME_LOCKED_AT = new Date('2026-09-05T10:00:00.000Z')
const FIVE_MINUTES_IN = new Date('2026-09-05T10:05:00.000Z')
const WINDOW_ENDS_AT = new Date('2026-09-05T10:12:00.000Z')

type Fixture = Awaited<ReturnType<typeof setup>>

async function setup() {
  const w = await f.buildWalkthroughFixture()
  const run = await runsRepo.insertRun(w.organization.id, {
    assignmentId: w.assignment.id,
    studentId: w.student1.id,
    packageVersionId: w.pkg.version.id,
    variantId: w.pkg.defective.id,
    workingClockSeconds: 1500,
    turnDelaySeconds: 90,
  })
  return {
    orgId: w.organization.id,
    run,
    student: w.student1,
    owner: actorFor(w.student1, w.organization.id),
    reviewer: actorFor(w.instructor, w.organization.id),
    // A classmate: in the same section, so the reviewer guard can see them, and entitled to nothing.
    classmate: actorFor(w.student2, w.organization.id),
  }
}

let fx: Fixture

// The hook truncates every table and rebuilds the walkthrough chain, and on its first pass it also
// transforms the server modules it imports; the project's 10 s hook default is not enough for that
// on a cold cache, so it is given the same 30 s the tests have.
beforeEach(async () => {
  await truncateAll()
  trace ??= await import('@/server/modules/trace')
  traceRepo ??= await import('@/server/modules/trace/repository')
  runsRepo ??= await import('@/server/modules/runs/repository')
  withTransaction ??= (await import('@/server/db/tx')).withTransaction
  f ??= await import('@tests/factories')
  fx = await setup()
}, 30_000)

afterAll(async () => {
  await appSql.end({ timeout: 5 })
  await truncateAll()
})

/**
 * One mutation as every run mutation is written: lock the run row, then append inside it.
 * `marker` rides in the payload so the race below can tell which worker wrote which sequence.
 */
async function appendInMutation(marker = 0): Promise<void> {
  await withTransaction(async (tx) => {
    const locked = await runsRepo.findRunForUpdate(fx.orgId, fx.run.id, tx)
    if (!locked) throw new Error('the run vanished')
    await trace.append(
      tx,
      locked,
      'brief_closed',
      { duration_ms: marker },
      { actorId: fx.student.id },
    )
  })
}

const markerOf = (payload: Record<string, unknown>): number => Number(payload.duration_ms)

describe('sequencing under concurrent appenders (NFR-005)', () => {
  it('gives four parallel appenders 1..N with no gap and no duplicate', async () => {
    const WORKERS = 4
    const PER_WORKER = 5
    const total = WORKERS * PER_WORKER

    // Every worker opens its own transaction per append and they all start in the same tick, so
    // four transactions are contending on the run row before any of them commits. The only thing
    // serializing them is that lock.
    await Promise.all(
      Array.from({ length: WORKERS }, async (_, worker) => {
        for (let i = 0; i < PER_WORKER; i += 1) await appendInMutation(worker + 1)
      }),
    )

    const events = await traceRepo.listEventsForRun(fx.run.id)
    expect(events).toHaveLength(total)
    expect(events.map((event) => event.seq)).toEqual(
      Array.from({ length: total }, (_, index) => index + 1),
    )
    expect(new Set(events.map((event) => event.seq)).size).toBe(total)

    // And it really was a race: every worker wrote, and the sequence changes hands far more often
    // than the three times a run of four contiguous blocks would. A loop dressed up as
    // `Promise.all` would produce exactly three.
    const markers = events.map((event) => markerOf(event.payload))
    expect(new Set(markers).size).toBe(WORKERS)
    const handovers = markers.filter((marker, index) => index > 0 && marker !== markers[index - 1])
    expect(handovers.length).toBeGreaterThan(WORKERS - 1)

    // The allocator ends where the trace ends: the next event of this run is N+1.
    const after = await runsRepo.findRunFull(fx.orgId, fx.run.id)
    expect(after?.run.nextEventSeq).toBe(total + 1)
  })

  it('refuses an appender that did not lock the run row', async () => {
    // Two mutations that each read the run without `for update` and then append. The first takes
    // sequence 1; the second is still holding the allocator value it read before that, so its
    // compare-and-set matches nothing. Without the guard it would have raced for the same number.
    const first = { ...fx.run }
    const second = { ...fx.run }

    await withTransaction((tx) => trace.append(tx, first, 'brief_opened', {}))

    const failed = await withTransaction((tx) =>
      trace.append(tx, second, 'brief_opened', {}).then(
        () => null,
        (error: unknown) => error,
      ),
    )
    expect(isAppError(failed) && failed.code).toBe('SEQUENCE_CONFLICT')
    expect(isAppError(failed) && failed.status).toBe(500)

    const events = await traceRepo.listEventsForRun(fx.run.id)
    expect(events.map((event) => event.seq)).toEqual([1])
  })

  it('moves the caller’s copy of the allocator on, so one transaction can append twice', async () => {
    await withTransaction(async (tx) => {
      const locked = await runsRepo.findRunForUpdate(fx.orgId, fx.run.id, tx)
      if (!locked) throw new Error('the run vanished')
      await trace.append(tx, locked, 'brief_opened', {}, { actorId: fx.student.id })
      await trace.append(tx, locked, 'brief_closed', { duration_ms: 4000 })
      expect(locked.nextEventSeq).toBe(3)
    })

    const events = await traceRepo.listEventsForRun(fx.run.id)
    expect(events.map((event) => [event.seq, event.type])).toEqual([
      [1, 'brief_opened'],
      [2, 'brief_closed'],
    ])
  })

  it('leaves no event and no allocation behind when the transaction rolls back', async () => {
    await expect(
      withTransaction(async (tx) => {
        const locked = await runsRepo.findRunForUpdate(fx.orgId, fx.run.id, tx)
        if (!locked) throw new Error('the run vanished')
        await trace.append(tx, locked, 'brief_opened', {})
        throw new Error('the mutation failed after the append')
      }),
    ).rejects.toThrow('the mutation failed after the append')

    expect(await traceRepo.listEventsForRun(fx.run.id)).toEqual([])
    const after = await runsRepo.findRunFull(fx.orgId, fx.run.id)
    expect(after?.run.nextEventSeq).toBe(1)
  })
})

describe('what an event records', () => {
  /** Puts the run into a state, then appends one event at a fixed instant and returns the row. */
  async function appendAt(patch: Parameters<RunsRepo['updateRun']>[2], occurredAt: Date) {
    await runsRepo.updateRun(fx.orgId, fx.run.id, patch)
    return withTransaction(async (tx) => {
      const locked = await runsRepo.findRunForUpdate(fx.orgId, fx.run.id, tx)
      if (!locked) throw new Error('the run vanished')
      return trace.append(tx, locked, 'brief_opened', {}, { actorId: fx.student.id, occurredAt })
    })
  }

  it('stores the working clock remaining at the instant the event happened (D-042)', async () => {
    const event = await appendAt(
      { state: 'working', workingStartedAt: FRAME_LOCKED_AT },
      FIVE_MINUTES_IN,
    )
    // 1500 s of clock, five minutes spent: 1,500,000 − 300,000.
    expect(event.clockRemainingMs).toBe(1_200_000)
    expect(event.occurredAt.toISOString()).toBe(FIVE_MINUTES_IN.toISOString())
    expect(event.actorId).toBe(fx.student.id)
  })

  it('stores the Turn window remaining, not the working clock, inside the window (D-132)', async () => {
    const event = await appendAt(
      {
        state: 'turn_open',
        workingStartedAt: FRAME_LOCKED_AT,
        turnDeliveredAt: FIVE_MINUTES_IN,
        turnWindowEndsAt: WINDOW_ENDS_AT,
      },
      FIVE_MINUTES_IN,
    )
    expect(event.clockRemainingMs).toBe(7 * 60_000)
  })

  it('freezes the window while the run is paused inside it (D-133)', async () => {
    const pausedAt = new Date('2026-09-05T10:04:00.000Z')
    const event = await appendAt(
      {
        state: 'paused',
        workingStartedAt: FRAME_LOCKED_AT,
        pausedAt,
        turnDeliveredAt: new Date('2026-09-05T10:02:00.000Z'),
        turnWindowEndsAt: WINDOW_ENDS_AT,
      },
      FIVE_MINUTES_IN,
    )
    // Frozen at what was left when the pause began: the window ends at 10:12 and the run paused at
    // 10:04, so eight minutes, and the minute spent waiting costs nothing (D-133, D-223).
    expect(event.clockRemainingMs).toBe(8 * 60_000)
  })

  it('stores no clock reading outside the working period and the window', async () => {
    const event = await appendAt({ state: 'framing' }, FIVE_MINUTES_IN)
    expect(event.clockRemainingMs).toBeNull()
  })

  it('bounds how far past zero a clock is recorded, so an abandoned run can still be written to', async () => {
    // Nothing moves a run out of `working` until Phase 9's auto-lock applier, so a run left open
    // keeps counting down. The column is an `integer`: unbounded, twenty-six days of overrun makes
    // every append fail on a 22003 and the run can no longer be locked, closed or voided (D-253).
    const twentySixDaysLater = new Date(FRAME_LOCKED_AT.getTime() + 26 * 24 * 60 * 60 * 1000)
    const event = await appendAt(
      { state: 'working', workingStartedAt: FRAME_LOCKED_AT },
      twentySixDaysLater,
    )
    expect(event.clockRemainingMs).toBe(-86_400_000)
  })

  it('records an overrun inside the bound exactly', async () => {
    const oneHourPastZero = new Date(FRAME_LOCKED_AT.getTime() + 1_500_000 + 3_600_000)
    const event = await appendAt(
      { state: 'working', workingStartedAt: FRAME_LOCKED_AT },
      oneHourPastZero,
    )
    expect(event.clockRemainingMs).toBe(-3_600_000)
  })

  it('stamps the clock as the transaction has it, not as the caller read it (D-042)', async () => {
    await runsRepo.updateRun(fx.orgId, fx.run.id, {
      state: 'working',
      workingStartedAt: FRAME_LOCKED_AT,
    })

    const event = await withTransaction(async (tx) => {
      const locked = await runsRepo.findRunForUpdate(fx.orgId, fx.run.id, tx)
      if (!locked) throw new Error('the run vanished')
      // A Decomposition Check, charged before the result is returned (FR-070, 10 §10). The mutation
      // writes the clock column first and appends afterwards, which is the order the charge has to
      // happen in — and the order that used to stamp the event from the caller's pre-charge copy of
      // the row, silently, with no type and no check to catch it. `clock_remaining_ms` is what
      // Phase 10's clock timeline is drawn from, so a stale reading is a wrong record.
      await runsRepo.updateRun(fx.orgId, fx.run.id, { chargedMs: 240_000 }, tx)
      return trace.append(tx, locked, 'brief_opened', {}, { occurredAt: FIVE_MINUTES_IN })
    })

    // 1500 s of clock, five minutes spent, four minutes charged: 1,500,000 − 300,000 − 240,000.
    expect(event.clockRemainingMs).toBe(960_000)
  })

  it('stamps a state change made earlier in the same transaction', async () => {
    await runsRepo.updateRun(fx.orgId, fx.run.id, {
      state: 'working',
      workingStartedAt: FRAME_LOCKED_AT,
    })

    const event = await withTransaction(async (tx) => {
      const locked = await runsRepo.findRunForUpdate(fx.orgId, fx.run.id, tx)
      if (!locked) throw new Error('the run vanished')
      // The lock ends the working clock (D-042). An event appended after the transition carries no
      // reading, because by then there is no clock running — and the caller's copy still saying
      // `working` does not change that.
      await runsRepo.updateRun(fx.orgId, fx.run.id, { state: 'decision_locked' }, tx)
      return trace.append(tx, locked, 'brief_opened', {}, { occurredAt: FIVE_MINUTES_IN })
    })

    expect(event.clockRemainingMs).toBeNull()
  })

  it('refuses a payload that does not match its type, and writes nothing', async () => {
    const failed = await withTransaction(async (tx) => {
      const locked = await runsRepo.findRunForUpdate(fx.orgId, fx.run.id, tx)
      if (!locked) throw new Error('the run vanished')
      return trace
        .append(tx, locked, 'readiness_skipped', {
          // `unanswered_count` is required and `reason` is not a free string.
          reason: 'because',
        } as never)
        .then(
          () => null,
          (error: unknown) => error,
        )
    })
    expect(isAppError(failed) && failed.code).toBe('INTERNAL_ERROR')

    expect(await traceRepo.listEventsForRun(fx.run.id)).toEqual([])
    const after = await runsRepo.findRunFull(fx.orgId, fx.run.id)
    expect(after?.run.nextEventSeq).toBe(1)
  })
})

describe('the log is append-only for the application role (NFR-005, D-085)', () => {
  it('refuses an UPDATE and a DELETE of run_events as tassl_app', async () => {
    await appendInMutation(4000)
    const [row] = await appSql<{ id: number }[]>`
      select id from run_events where run_id = ${fx.run.id} order by seq limit 1`
    expect(row).toBeDefined()

    await expect(
      appSql`update run_events set payload = '{"tampered":true}'::jsonb where id = ${row!.id}`,
    ).rejects.toThrow(/permission denied/)
    await expect(appSql`delete from run_events where id = ${row!.id}`).rejects.toThrow(
      /permission denied/,
    )

    // And the row is still exactly what was written.
    const [after] = await appSql<{ payload: unknown; seq: number }[]>`
      select payload, seq from run_events where id = ${row!.id}`
    expect(after).toMatchObject({ seq: 1, payload: { duration_ms: 4000 } })
  })

  it('still lets the role insert, which is the half the trace needs', async () => {
    const [inserted] = await appSql<{ seq: number }[]>`
      insert into run_events (run_id, seq, type, occurred_at, payload)
      values (${fx.run.id}, 99, 'brief_opened', now(), '{}'::jsonb)
      returning seq`
    expect(inserted?.seq).toBe(99)
  })
})

describe('listEvents (FR-007)', () => {
  /**
   * Three events, with the probe **in the middle** — which is where a probe actually fires: FR-053
   * scripts the reversal onto the delegation before it, so the hidden row always has a written row
   * on each side. A seed that appends the probe last cannot produce the hole this describe is about.
   */
  async function seedThreeEvents(): Promise<void> {
    await withTransaction(async (tx) => {
      const locked = await runsRepo.findRunForUpdate(fx.orgId, fx.run.id, tx)
      if (!locked) throw new Error('the run vanished')
      await trace.append(
        tx,
        locked,
        'readiness_item',
        {
          item_id: '11111111-1111-4111-8111-111111111111',
          item_key: 'R7',
          category: 'defect_concept',
          concept_key: 'retention_cohorts',
          answer_key: 'c',
          correct: false,
        },
        { actorId: fx.student.id },
      )
      await trace.append(tx, locked, 'probe_fired', {
        claim_id: '22222222-2222-4222-8222-222222222222',
        scripted_reversal: 'You are right to push back — I overstated that.',
      })
      await trace.append(tx, locked, 'brief_closed', { duration_ms: 9000 })
    })
  }

  /** Puts the run into a state and returns the owner's view of the trace from there. */
  async function ownerTraceIn(state: Parameters<RunsRepo['updateRun']>[2]['state']) {
    await runsRepo.updateRun(fx.orgId, fx.run.id, { state })
    return trace.listEvents(fx.owner, fx.run.id)
  }

  const failureOf = (promise: Promise<unknown>): Promise<unknown> =>
    promise.then(
      () => null,
      (error: unknown) => error,
    )

  it('gives a reviewer the events exactly as they were written, sequence included', async () => {
    await seedThreeEvents()
    const events = await trace.listEvents(fx.reviewer, fx.run.id)
    expect(events.map((event) => [event.seq, event.type])).toEqual([
      [1, 'readiness_item'],
      [2, 'probe_fired'],
      [3, 'brief_closed'],
    ])
    expect(events[0]?.payload).toMatchObject({ answer_key: 'c', correct: false })
    expect(events[1]?.payload).toHaveProperty('scripted_reversal')
  })

  it('withholds server-side correctness and the probe from the run owner (FR-012, FR-053)', async () => {
    await seedThreeEvents()
    const events = await trace.listEvents(fx.owner, fx.run.id)
    expect(events.map((event) => event.type)).toEqual(['readiness_item', 'brief_closed'])
    // Their own answer stays; whether it was right does not.
    expect(events[0]?.payload).toMatchObject({ item_key: 'R7', answer_key: 'c' })
    expect(events[0]?.payload).not.toHaveProperty('correct')
  })

  it('renumbers the owner’s view densely, so the hidden probe leaves no hole (FR-053, D-088)', async () => {
    await seedThreeEvents()
    const events = await trace.listEvents(fx.owner, fx.run.id)
    // The stored sequence is 1, 2, 3 and the probe is number 2. Passing the stored number through
    // would answer 1 and 3, and the missing 2 would sit exactly where the probe fired — which is
    // immediately after the delegation whose reversal was scripted. That is the tell FR-053 and
    // D-088 exist to prevent, so the owner's sequence is 1..N over what they can see.
    expect(events.map((event) => event.seq)).toEqual([1, 2])
    expect(events.map((event) => [event.seq, event.type])).toEqual([
      [1, 'readiness_item'],
      [2, 'brief_closed'],
    ])
    // And it is a renumbering, not a reordering: the instants are still ascending.
    const instants = events.map((event) => Date.parse(event.occurredAt))
    expect([...instants].sort((a, b) => a - b)).toEqual(instants)
  })

  it('carries no stored trace sequence in an owner payload either', async () => {
    await withTransaction(async (tx) => {
      const locked = await runsRepo.findRunForUpdate(fx.orgId, fx.run.id, tx)
      if (!locked) throw new Error('the run vanished')
      await trace.append(tx, locked, 'defense_question', {
        run_question_id: '44444444-4444-4444-8444-444444444444',
        question_id: '55555555-5555-4555-8555-555555555555',
        kind: 'provenance',
        seq: 1,
        rendered_text: 'Where did the eleven-month payback come from?',
        follow_up_of: null,
        selecting_event_seq: 2,
      })
    })
    // `defense_question` is written during the defense, where the owner reads nothing at all; the
    // scored view is where they could meet it, and the stored sequence is withheld there too.
    const events = await ownerTraceIn('scored')
    expect(events).toHaveLength(1)
    expect(events[0]?.payload).toMatchObject({ kind: 'provenance', seq: 1 })
    // The question's own ordinal stays; the trace sequence that selected it does not, and neither
    // does the id of the bank question behind it (FR-123, 12 §8.1).
    expect(events[0]?.payload).not.toHaveProperty('selecting_event_seq')
    expect(events[0]?.payload).not.toHaveProperty('question_id')
  })

  it('seals the owner’s read through the defense, and answers the reviewer as always (UI-026)', async () => {
    await seedThreeEvents()
    for (const state of ['turn_locked', 'defense_pending', 'defense_complete'] as const) {
      await runsRepo.updateRun(fx.orgId, fx.run.id, { state })
      const failed = await failureOf(trace.listEvents(fx.owner, fx.run.id))
      // The defense is what the student can say with nothing in front of them but their own frame,
      // brief, addendum and Turn response. The trace is the room: every delegation with its request
      // and response text, every action result, every document open, every stance.
      expect(isAppError(failed) && failed.code).toBe('FORBIDDEN')
      expect(isAppError(failed) && failed.status).toBe(403)
      // The reviewer's read is the record and is never sealed.
      expect(await trace.listEvents(fx.reviewer, fx.run.id)).toHaveLength(3)
    }
  })

  it('seals a voided run, which is never scored and is re-offered (FR-183)', async () => {
    await seedThreeEvents()
    await runsRepo.updateRun(fx.orgId, fx.run.id, { state: 'voided' })
    const failed = await failureOf(trace.listEvents(fx.owner, fx.run.id))
    expect(isAppError(failed) && failed.code).toBe('FORBIDDEN')
  })

  it('opens the after-scored fields only once the run is scored (D-117, D-116)', async () => {
    await withTransaction(async (tx) => {
      const locked = await runsRepo.findRunForUpdate(fx.orgId, fx.run.id, tx)
      if (!locked) throw new Error('the run vanished')
      await trace.append(tx, locked, 'escalation', {
        escalation_id: '66666666-6666-4666-8666-666666666666',
        claim_id: '77777777-7777-4777-8777-777777777777',
        statement: 'I cannot tell whether this cohort comparison was actually computed.',
        response_id: 'claim',
        response_text: 'That figure came from the Q3 memo.',
        clock_cost_ms: 300_000,
        counts_against_limit: true,
        in_turn_window: false,
      })
    })

    const working = await ownerTraceIn('working')
    expect(working[0]?.payload).toMatchObject({
      response_text: 'That figure came from the Q3 memo.',
    })
    // 12 §8.2: which authored reply answered, and whether it counted, are the clock timeline's
    // after scoring and nothing's before it.
    expect(working[0]?.payload).not.toHaveProperty('response_id')
    expect(working[0]?.payload).not.toHaveProperty('counts_against_limit')

    const scored = await ownerTraceIn('scored')
    expect(scored[0]?.payload).toMatchObject({ response_id: 'claim', counts_against_limit: true })

    // The reviewer had both all along.
    const reviewed = await trace.listEvents(fx.reviewer, fx.run.id)
    expect(reviewed[0]?.payload).toMatchObject({ response_id: 'claim', counts_against_limit: true })
  })

  it('answers NOT_FOUND to a classmate, which never says the run exists', async () => {
    await seedThreeEvents()
    const failed = await failureOf(trace.listEvents(fx.classmate, fx.run.id))
    expect(isAppError(failed) && failed.code).toBe('NOT_FOUND')
  })
})
