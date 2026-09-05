// Step 7.3 — one delegation, against Postgres (docs/tech/10-backend-spec-modules.md §7;
// 07-api-spec.md §7; FR-050 to FR-053, FR-056, DATA-033, DATA-034, D-267).
//
// **The claims this file exists to make.**
//
//   1. A request that matches an authored trigger phrase surfaces that claim, once. The reply
//      carries the claim's text verbatim behind its marker, and the run gains one `run_claims` row
//      whose `surfaced_by_id` is the delegation that produced it (FR-051, FR-063).
//   2. Asking again does not surface it again. The assistant answers a repeated question the second
//      time — the one behaviour a student would read as the room hiding something — and the second
//      delegation *references* the row the first one wrote (10 §7, D-267).
//   3. A request the author anticipated in no wording surfaces nothing, and the assistant says so
//      rather than improvising a substitute (FR-052).
//   4. The `delegation` event carries exactly what 10 §10's payload table says, and the row and the
//      event agree.
//   5. The assistant is not in the room outside `working` and `turn_open` (FR-050), and a request
//      over 2,000 characters is refused before a provider is asked anything (11 §3).
//   6. The `llm` bucket holds at ten calls a minute (D-026), proven through the route.
// @db:truncate
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { asUser, truncateAll } from '@tests/setup/integration'
import {
  claimByKey,
  codeOf,
  delegationRows,
  eventsOfType,
  llmCallRows,
  runClaimRows,
  runInWorking,
  setupAssistantFixture,
  type AssistantFixture,
} from './fixture'

type Assistant = typeof import('@/server/modules/assistant')
type Runs = typeof import('@/server/modules/runs')
type Reliance = typeof import('@/server/modules/reliance')
type DelegationsRoute = typeof import('@/app/api/v1/runs/[runId]/delegations/route')

let assistant: Assistant
let runs: Runs
let reliance: Reliance
let delegationsRoute: DelegationsRoute
let fx: AssistantFixture

type DelegationChunk = import('@/server/modules/assistant').DelegationChunk

/** Drains the iterable `delegate` answers into the two things a caller reads: text and claims. */
async function collect(stream: AsyncIterable<DelegationChunk>) {
  const text: string[] = []
  const claims: { id: string; key: string; text: string; stance: string | null }[] = []
  let delegationId = ''
  for await (const chunk of stream) {
    if (chunk.event === 'done') delegationId = chunk.data.delegationId
    else if (chunk.data.type === 'text') text.push(chunk.data.text)
    else claims.push(chunk.data.claim)
  }
  return { text: text.join(''), claims, delegationId }
}

const ask = async (runId: string, request: string) =>
  collect(await assistant.delegate(fx.student, runId, { request }))

beforeEach(async () => {
  await truncateAll()
  assistant = await import('@/server/modules/assistant')
  runs = await import('@/server/modules/runs')
  reliance = await import('@/server/modules/reliance')
  delegationsRoute = await import('@/app/api/v1/runs/[runId]/delegations/route')
  fx = await setupAssistantFixture('delegate')
})

afterAll(async () => {
  await truncateAll()
})

// ---------------------------------------------------------------------------------------------
// Matching and surfacing (FR-051, DATA-033, DATA-034)
// ---------------------------------------------------------------------------------------------

describe('delegate', () => {
  it('surfaces the matched claim once, carrying its text verbatim', async () => {
    const runId = await runInWorking(fx)
    const c3 = claimByKey('C3')

    const answer = await ask(runId, 'What is the premium payback?')

    // The claim is in the reply as a discrete item, with the author's own words (FR-051).
    expect(answer.claims).toHaveLength(1)
    expect(answer.claims[0]).toMatchObject({ key: 'C3', text: c3.text, stance: null })

    const rows = await runClaimRows(runId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      key: 'C3',
      surfaced_by: 'delegation',
      surfaced_by_id: answer.delegationId,
      stance: null,
      used_marked: false,
      relied_on: false,
    })

    // FR-051 again, from the other side: the connective prose is the model's and the claim's text
    // is the author's, and the marker is what tells them apart on the way to the screen.
    const [delegation] = await delegationRows(runId)
    expect(delegation?.response_text).toContain(`[[claim:${fx.claimId('C3')}]]`)
    expect(delegation?.response_text).toContain(c3.text)
    expect(delegation?.claim_ids).toEqual([fx.claimId('C3')])
    expect(delegation?.failed).toBe(false)
  })

  it('answers a repeated question again without surfacing the claim twice (D-267)', async () => {
    const runId = await runInWorking(fx)
    const first = await ask(runId, 'What is the premium payback?')
    const surfacedAt = (await runClaimRows(runId))[0]?.surfaced_at

    const second = await ask(runId, 'Remind me: how long until premium pays back?')

    // The assistant answers, and carries the claim again — a student who asks twice is answered
    // twice, which is what keeps a repeated question from reading as the room going quiet.
    expect(second.claims.map((claim) => claim.key)).toEqual(['C3'])
    expect(second.delegationId).not.toBe(first.delegationId)

    // And the stance matrix has one row for it, still stamped when the student first met it.
    const rows = await runClaimRows(runId)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.surfaced_at).toEqual(surfacedAt)
    expect(rows[0]?.surfaced_by_id).toBe(first.delegationId)

    // Both delegations record that they carried it (FR-060, FR-063).
    const delegations = await delegationRows(runId)
    expect(delegations).toHaveLength(2)
    expect(delegations[1]?.claim_ids).toEqual([fx.claimId('C3')])
  })

  it('surfaces two claims when one request matches two', async () => {
    const runId = await runInWorking(fx)
    const answer = await ask(
      runId,
      'What does the premium retention look like, and what is the cohort comparison?',
    )

    expect(answer.claims.map((claim) => claim.key)).toEqual(['C2', 'C4'])
    expect((await runClaimRows(runId)).map((row) => row.key)).toEqual(['C2', 'C4'])
    // One marker per surfaced claim, in the order the reply presents them (11 §3).
    const [delegation] = await delegationRows(runId)
    const markers = [...(delegation?.response_text ?? '').matchAll(/\[\[claim:([^\]]+)\]\]/g)]
    expect(markers.map((match) => match[1])).toEqual([fx.claimId('C2'), fx.claimId('C4')])
  })

  it('surfaces nothing when the request matches no authored phrase, and invents nothing', async () => {
    const runId = await runInWorking(fx)
    const answer = await ask(runId, 'What is the weather in Lisbon this week?')

    expect(answer.claims).toEqual([])
    expect(await runClaimRows(runId)).toEqual([])
    expect(answer.text.trim().length).toBeGreaterThan(0)
    // 11 §1.4: the mock never emits a digit that is not in the claims or the request, and there are
    // no claims here — so an assistant that answered with a figure would be inventing one (FR-052).
    expect(answer.text).not.toMatch(/\d/)

    const [delegation] = await delegationRows(runId)
    expect(delegation?.claim_ids).toEqual([])
    expect(delegation?.unverified_numbers).toEqual([])
  })

  it('does not match a trigger phrase that sits inside a longer word (D-260)', async () => {
    const runId = await runInWorking(fx)
    // C7's phrase is "survey"; "surveyors" is a different word about different people.
    await ask(runId, 'Who are the surveyors on this account?')
    expect(await runClaimRows(runId)).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------
// The record (10 §10, FR-060, FR-063)
// ---------------------------------------------------------------------------------------------

describe('the delegation event', () => {
  it('carries the payload 10 §10 names, and agrees with the row', async () => {
    const runId = await runInWorking(fx)
    const answer = await ask(runId, 'What is the premium payback?')

    const [event] = await eventsOfType(runId, 'delegation')
    const [row] = await delegationRows(runId)
    expect(event?.payload).toEqual({
      delegation_id: answer.delegationId,
      seq: 1,
      request_text: 'What is the premium payback?',
      response_text: row?.response_text,
      claim_ids: [fx.claimId('C3')],
      why: null,
      in_turn_window: false,
      flags: [],
      unverified_numbers: [],
      failed: false,
    })
  })

  it('stamps the delegation with the clock it was made against, and charges nothing', async () => {
    const runId = await runInWorking(fx)
    const before = await runs.getRun(fx.student, runId)
    await ask(runId, 'What is the premium payback?')
    const after = await runs.getRun(fx.student, runId)

    const [row] = await delegationRows(runId)
    expect(row?.clock_remaining_ms).not.toBeNull()
    expect(row?.in_turn_window).toBe(false)

    // A delegation charges no clock (10 §7): what moved is wall-clock time, not a cost.
    expect(after.clock?.chargedMs).toBe(before.clock?.chargedMs)
    expect(after.clock?.creditedMs).toBe(before.clock?.creditedMs)
  })

  it('writes one llm_calls row per delegation (DATA-049)', async () => {
    const runId = await runInWorking(fx)
    await ask(runId, 'What is the premium payback?')

    const calls = await llmCallRows(runId)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      feature: 'assistant',
      prompt_name: 'assistant-reply',
      outcome: 'ok',
    })
  })

  it('sets first_delegation_at, so a later document open records that it came second (FR-022)', async () => {
    const runId = await runInWorking(fx)
    const deck = fx.documentId('D1')

    await runs.openDocument(fx.student, runId, deck)
    await ask(runId, 'What is the premium payback?')
    await runs.openDocument(fx.student, runId, deck)

    const opens = await eventsOfType(runId, 'document_open')
    expect(opens.map((event) => event.payload.before_first_delegation)).toEqual([true, false])
  })
})

// ---------------------------------------------------------------------------------------------
// The refusals (FR-050, 11 §3, D-026)
// ---------------------------------------------------------------------------------------------

describe('refusals', () => {
  it('answers ASSISTANT_LOCKED while the run is still framing (FR-050)', async () => {
    const started = await runs.startRun(fx.student, fx.assignment.id)
    await runs.acknowledgePolicy(fx.student, started.id)
    await runs.submitReadiness(fx.student, started.id)

    expect(
      await codeOf(assistant.delegate(fx.student, started.id, { request: 'Premium payback?' })),
    ).toBe('ASSISTANT_LOCKED')
    expect(await delegationRows(started.id)).toEqual([])
    expect(await eventsOfType(started.id, 'delegation')).toEqual([])

    // And the moment the frame is locked, the same call works (FR-041).
    await runs.lockFrame(fx.student, started.id, {
      decision: 'Whether to move spend to the premium tier',
      assumptions: ['Retention holds', 'Payback is near four months', 'Supplier cost is stable'],
      position: 'Lean toward holding spend',
      confidence: 40,
    })
    const answer = await ask(started.id, 'What is the premium payback?')
    expect(answer.claims).toHaveLength(1)
  })

  it('refuses a request over 2,000 characters before asking a provider anything', async () => {
    const runId = await runInWorking(fx)
    const long = `What is the premium payback? ${'x'.repeat(2100)}`

    expect(await codeOf(assistant.delegate(fx.student, runId, { request: long }))).toBe(
      'ASSISTANT_REQUEST_TOO_LONG',
    )
    expect(await delegationRows(runId)).toEqual([])
    expect(await llmCallRows(runId)).toEqual([])
  })

  it('refuses an empty request as a malformed one', async () => {
    const runId = await runInWorking(fx)
    expect(await codeOf(assistant.delegate(fx.student, runId, { request: '   ' }))).toBe(
      'VALIDATION_ERROR',
    )
  })

  it('answers NOT_FOUND to a classmate and to an instructor of the section', async () => {
    const runId = await runInWorking(fx)
    expect(
      await codeOf(assistant.delegate(fx.classmate, runId, { request: 'Premium payback?' })),
    ).toBe('NOT_FOUND')
    expect(
      await codeOf(assistant.delegate(fx.instructor, runId, { request: 'Premium payback?' })),
    ).toBe('NOT_FOUND')
  })
})

// ---------------------------------------------------------------------------------------------
// The route (07 §7): the stream's shape, and the bucket in front of it
// ---------------------------------------------------------------------------------------------

describe('POST /runs/{runId}/delegations', () => {
  const post = async (runId: string, request: string) => {
    const headers = new Headers(await asUser(fx.student.id, { activeOrganizationId: fx.orgId }))
    headers.set('x-requested-with', 'tassl')
    headers.set('content-type', 'application/json')
    return delegationsRoute.POST(
      new Request(`http://localhost:3000/api/v1/runs/${runId}/delegations`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ request }),
      }),
      { params: Promise.resolve({ runId }) },
    )
  }

  it('answers text/event-stream with segment events and one done event', async () => {
    const runId = await runInWorking(fx)
    const response = await post(runId, 'What is the premium payback?')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store')

    const body = await response.text()
    const frames = body
      .split('\n\n')
      .filter(Boolean)
      .map((frame) => {
        const [eventLine = '', dataLine = ''] = frame.split('\n')
        return {
          event: eventLine.replace('event: ', ''),
          data: JSON.parse(dataLine.replace('data: ', '')) as Record<string, unknown>,
        }
      })

    expect(frames.at(-1)?.event).toBe('done')
    expect(frames.filter((frame) => frame.event === 'segment').length).toBeGreaterThan(1)

    const claimFrames = frames.filter(
      (frame) => frame.event === 'segment' && frame.data.type === 'claim',
    )
    expect(claimFrames).toHaveLength(1)
    const claim = claimFrames[0]?.data.claim as { key: string; text: string }
    expect(claim.key).toBe('C3')
    expect(claim.text).toBe(claimByKey('C3').text)

    const done = frames.at(-1)?.data as { delegationId: string }
    expect((await delegationRows(runId))[0]?.id).toBe(done.delegationId)
  })

  it('holds at ten calls a minute on the llm bucket (D-026)', async () => {
    const runId = await runInWorking(fx)
    const statuses: number[] = []
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await post(runId, `What is the premium payback? attempt ${attempt}`)
      statuses.push(response.status)
      await response.text()
    }

    expect(statuses.slice(0, 10)).toEqual(Array.from({ length: 10 }, () => 200))
    expect(statuses[10]).toBe(429)

    // The refused request never became a delegation, so the log records ten (FR-060).
    expect(await delegationRows(runId)).toHaveLength(10)
  })

  it('refuses a cookie-authenticated request with no X-Requested-With header (08 §2.7)', async () => {
    const runId = await runInWorking(fx)
    const headers = new Headers(await asUser(fx.student.id, { activeOrganizationId: fx.orgId }))
    headers.set('content-type', 'application/json')
    const response = await delegationsRoute.POST(
      new Request(`http://localhost:3000/api/v1/runs/${runId}/delegations`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ request: 'What is the premium payback?' }),
      }),
      { params: Promise.resolve({ runId }) },
    )
    expect(response.status).toBe(403)
  })

  it('lists the claims the run has surfaced through the reliance read', async () => {
    const runId = await runInWorking(fx)
    await ask(runId, 'What is the premium payback?')

    const claims = await reliance.listRunClaims(fx.student, runId)
    expect(claims.map((claim) => claim.key)).toEqual(['C3'])
    expect(claims[0]).toMatchObject({ surfacedBy: 'delegation', stance: null, reliedOn: false })
  })
})
