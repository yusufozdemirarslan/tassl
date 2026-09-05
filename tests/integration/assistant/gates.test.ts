// The two gates the room has, and the two ways Step 7.3 left them open (D-279, D-280;
// 10-backend-spec-modules.md §7, §8; 12-security.md §8; FR-084, FR-120, UI-026, D-233).
//
// Both gates answer the same question — *may this run be read or written right now?* — and both were
// asked in one place and skipped in another. This file is where each is asked in every place.
//
// **The read gate (D-279).** `trace.listEvents` refuses the run's own student through the defense,
// because the trace holds every delegation with its request and response text, every claim and every
// stance: served in a second tab it is the room UI-026 takes away, and FR-120's "unaided" means
// nothing. `GET /runs/{id}/delegations` and `GET /runs/{id}/claims` are that same room in two other
// shapes, and neither had a state gate at all — the audit read both back in `defense_pending` with
// the full request text, the reply and the claims. Three reads, one table (`trace/owner-view.ts`),
// one answer.
//
// **The write gate (D-280).** The state gate on a delegation was held in phase 1, under the run's
// lock, and never asked again in phase 3, where the writes happen. Everything between the two is a
// network call. So a delegation begun in `working` completed into a run that had been locked,
// paused or sent to the defense while the provider was answering: the assistant answered a student
// in the defense, a claim entered the stance matrix after FR-084's lock gate had been evaluated, and
// an event was written carrying a reading of a clock the run's own record says has stopped.
//
// Both suites work on a real run over the Meridian Roast fixture, and both assert on the rows and
// the trace as written rather than on a projection of them.
// @db:truncate
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { testSql, truncateAll } from '@tests/setup/integration'
import {
  claimByKey,
  codeOf,
  delegationRows,
  eventsOfType,
  pauseRows,
  runClaimRows,
  runInWorking,
  setupAssistantFixture,
  type AssistantFixture,
} from './fixture'

/**
 * The seam every delegation reaches a model through, and the only place a test can stand between
 * phase 1 and phase 3 (11 §1.1). The wrapper runs `hooks.moveRun` when the stream is first pulled —
 * which is inside phase 2, after the row is committed and before any write phase 3 makes — so the
 * run moves on exactly where a Decision Lock in a second tab, an auto-lock or another component's
 * failure would move it, and with a real reply still on its way back.
 */
const hooks = vi.hoisted(() => ({ moveRun: null as null | (() => Promise<void>) }))

vi.mock('@/server/llm/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/llm/registry')>()
  return {
    ...actual,
    getProvider: () => {
      const provider = actual.getProvider()
      return {
        ...provider,
        stream: (request: Parameters<typeof provider.stream>[0]) => {
          const inner = provider.stream(request)
          return (async function* () {
            const move = hooks.moveRun
            if (move) await move()
            yield* inner
          })()
        },
      }
    },
  }
})

type Assistant = typeof import('@/server/modules/assistant')
type Reliance = typeof import('@/server/modules/reliance')
type Trace = typeof import('@/server/modules/trace')

let assistant: Assistant
let reliance: Reliance
let trace: Trace
let fx: AssistantFixture

/** The request the fixture answers with claim C3, so every probe below has something to leak. */
const REQUEST = 'What is the premium payback?'

/**
 * Moves the run to a state by writing the column, because the transitions these tests need are
 * Phase 8's and Phase 9's: there is no `lockDecision` to call yet. What is under test is what the
 * reads and the write phase do when they meet a state, not how the run got there.
 */
async function forceState(runId: string, state: string): Promise<void> {
  await testSql`update runs set state = ${state}::run_state where id = ${runId}`
}

const stateOf = async (runId: string): Promise<string> => {
  const [row] = await testSql<{ state: string }[]>`select state from runs where id = ${runId}`
  return row?.state ?? 'gone'
}

const eventCount = async (runId: string): Promise<number> => {
  const [row] = await testSql<{ n: number }[]>`
    select count(*)::int as n from run_events where run_id = ${runId}`
  return row?.n ?? 0
}

beforeEach(async () => {
  await truncateAll()
  hooks.moveRun = null
  assistant = await import('@/server/modules/assistant')
  reliance = await import('@/server/modules/reliance')
  trace = await import('@/server/modules/trace')
  fx = await setupAssistantFixture('gates')
})

afterAll(async () => {
  hooks.moveRun = null
  await truncateAll()
})

// ---------------------------------------------------------------------------------------------
// The read gate (D-279, D-233): three reads of one room
// ---------------------------------------------------------------------------------------------

/** Reads the stream to its end; the reply is stored before the first chunk, so this only ends it. */
async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const chunk of stream) void chunk
}

/** A run in `working` with one answered delegation behind it — a room with something in it. */
async function roomWithOneDelegation(): Promise<string> {
  const runId = await runInWorking(fx)
  await drain(await assistant.delegate(fx.student, runId, { request: REQUEST }))
  return runId
}

/** What each of the three reads answers the run's own student, as an error code or `'no error'`. */
async function ownerReads(runId: string): Promise<Record<string, string>> {
  return {
    trace: await codeOf(trace.listEvents(fx.student, runId)),
    delegations: await codeOf(assistant.listDelegations(fx.student, runId)),
    claims: await codeOf(reliance.listRunClaims(fx.student, runId)),
  }
}

describe('what the run’s own student may read of their room', () => {
  it('serves all three reads while the room is on their screen', async () => {
    const runId = await roomWithOneDelegation()

    expect(await ownerReads(runId)).toEqual({
      trace: 'no error',
      delegations: 'no error',
      claims: 'no error',
    })

    // And what they get is the room, which is the reason the states below matter.
    const [entry] = await assistant.listDelegations(fx.student, runId)
    expect(entry?.requestText).toBe(REQUEST)
    expect(entry?.responseText.length).toBeGreaterThan(0)
    expect(entry?.claims.map((claim) => claim.key)).toEqual(['C3'])
    expect((await reliance.listRunClaims(fx.student, runId)).map((claim) => claim.key)).toEqual([
      'C3',
    ])
  })

  // The defense is what a student can say with nothing in front of them but their own frame, brief,
  // addendum and Turn response (UI-026, FR-120). A run that will never be scored is sealed for the
  // same reason: `voided` is re-offered (FR-183), so its room is a live exam's until the replacement
  // run is finished.
  it.each(['turn_locked', 'defense_pending', 'defense_complete', 'voided'])(
    'refuses all three in %s, not one of them',
    async (state) => {
      const runId = await roomWithOneDelegation()
      await forceState(runId, state)

      expect(await ownerReads(runId)).toEqual({
        trace: 'FORBIDDEN',
        delegations: 'FORBIDDEN',
        claims: 'FORBIDDEN',
      })
    },
  )

  it('opens all three again once the run is scored (D-117)', async () => {
    const runId = await roomWithOneDelegation()
    await forceState(runId, 'defense_pending')
    expect(await ownerReads(runId)).toEqual({
      trace: 'FORBIDDEN',
      delegations: 'FORBIDDEN',
      claims: 'FORBIDDEN',
    })

    await forceState(runId, 'scored')
    expect(await ownerReads(runId)).toEqual({
      trace: 'no error',
      delegations: 'no error',
      claims: 'no error',
    })
  })

  it('keeps the log open to the reviewer in every state — it is the record (FR-180)', async () => {
    const runId = await roomWithOneDelegation()
    await forceState(runId, 'defense_pending')

    const asInstructor = await assistant.listDelegations(fx.instructor, runId)
    expect(asInstructor[0]?.requestText).toBe(REQUEST)
    // The reviewer's shape, so the refusal above is about the reader and not about the row.
    expect(asInstructor[0]).toHaveProperty('flags')

    // A classmate is still told nothing, in this state as in every other (08 §4).
    expect(await codeOf(assistant.listDelegations(fx.classmate, runId))).toBe('NOT_FOUND')
    expect(await codeOf(reliance.listRunClaims(fx.classmate, runId))).toBe('NOT_FOUND')
  })
})

// ---------------------------------------------------------------------------------------------
// The write gate (D-280): a reply that arrives after the run has moved on
// ---------------------------------------------------------------------------------------------

describe('a delegation whose run moves on while the provider is answering', () => {
  // `decision_locked` is the auto-lock and the second tab; `paused` is another component's failure
  // landing mid-reply; `defense_pending` is the far end, where an answer on the screen would be the
  // assistant in the room during the defense.
  it.each(['decision_locked', 'paused', 'defense_pending'])(
    'writes nothing to a run that reached %s, and says so on the row',
    async (state) => {
      const runId = await runInWorking(fx)
      const before = await eventCount(runId)
      hooks.moveRun = async () => {
        await forceState(runId, state)
      }

      expect(await codeOf(assistant.delegate(fx.student, runId, { request: REQUEST }))).toBe(
        'ASSISTANT_LOCKED',
      )

      // Nothing was written to the run: no `delegation` event, no `claim_used`, no claim in the
      // stance matrix after FR-084's gate, no pause, and the trace is the length it was.
      expect(await eventsOfType(runId, 'delegation')).toEqual([])
      expect(await eventsOfType(runId, 'claim_used')).toEqual([])
      expect(await runClaimRows(runId)).toEqual([])
      expect(await pauseRows(runId)).toEqual([])
      expect(await eventCount(runId)).toBe(before)
      expect(await stateOf(runId)).toBe(state)

      // What is left is the student's own act, and one sentence saying why no answer is under it.
      const [row] = await delegationRows(runId)
      expect(row).toMatchObject({
        seq: 1,
        request_text: REQUEST,
        claim_ids: [],
        failed: false,
        why: null,
      })
      expect(row?.flags).toContain('discarded_late')
      expect(row?.response_text).toBe(
        'No answer reached you. The run had moved on by the time the assistant replied, so the reply was discarded and nothing from it was recorded against your run.',
      )
      // The reply itself is gone: none of the claim the request matched reached the row.
      expect(row?.response_text).not.toContain(claimByKey('C3').text)
    },
  )

  it('does not hand the discarded reply back through the log or the claim table', async () => {
    const runId = await runInWorking(fx)
    hooks.moveRun = async () => {
      await forceState(runId, 'decision_locked')
    }
    await codeOf(assistant.delegate(fx.student, runId, { request: REQUEST }))

    // `decision_locked` is not sealed — the student is on their way to the Turn — so both reads
    // answer, and what they answer is a request with no reply and no claims.
    const [entry] = await assistant.listDelegations(fx.student, runId)
    expect(entry?.claims).toEqual([])
    expect(entry?.responseText).not.toContain(claimByKey('C3').text)
    expect(await reliance.listRunClaims(fx.student, runId)).toEqual([])
  })

  it('leaves the ordinary delegation untouched when the run stays where it was', async () => {
    const runId = await runInWorking(fx)
    // The same stub, moving nothing: the seam is in the path for both cases, so a pass above is
    // about the state and not about the wrapper.
    hooks.moveRun = async () => {}

    await drain(await assistant.delegate(fx.student, runId, { request: REQUEST }))

    const [row] = await delegationRows(runId)
    expect(row?.failed).toBe(false)
    expect(row?.flags).not.toContain('discarded_late')
    expect(row?.response_text).toContain(claimByKey('C3').text)
    expect((await eventsOfType(runId, 'delegation')).length).toBe(1)
    expect((await runClaimRows(runId)).map((claim) => claim.key)).toEqual(['C3'])
  })

  it('refuses in phase 1, with no row at all, when the run had already moved on', async () => {
    const runId = await runInWorking(fx)
    await forceState(runId, 'decision_locked')

    expect(await codeOf(assistant.delegate(fx.student, runId, { request: REQUEST }))).toBe(
      'ASSISTANT_LOCKED',
    )
    expect(await delegationRows(runId)).toEqual([])
  })
})
