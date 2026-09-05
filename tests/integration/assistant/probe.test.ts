// Step 7.3 — the Sycophancy Probe, against Postgres (docs/tech/10-backend-spec-modules.md §7, §8;
// 11-llm-integration.md §3; FR-053, FR-084, FR-120, D-088, D-233, D-278).
//
// **What this file is for.** FR-053 and D-088 are worth exactly one thing: whether a student can
// tell the scripted reversal from a reply the model wrote. If they can, the probe measures nothing —
// a student who knows the assistant is about to fold does not change their mind, they perform
// changing it. Everything Tassl already does for the probe exists for that single reason: the
// `probe_fired` event type is hidden from the owner's trace whole, its two payload fields are
// `reviewer_only` behind that, and the owner's sequence is renumbered densely so the *hole* the
// hidden event leaves is not itself the tell (D-232, D-233).
//
// So the assertions below are not "the reversal came back". They are the ones an auditor sitting in
// the student's chair would make, each written so that it fails on the build that shipped:
//
//   1. **The stream.** A probe delegation emits one claim segment per claim it carries, with the
//      `[[claim:<id>]]` markers in the stored text — like every other reply. The build that shipped
//      emitted zero, so the panel drew no card and the live region said "No claims surfaced" for a
//      delegation whose Delegation Log entry listed one.
//   2. **The claim list.** Every claim a probe delegation surfaces into `run_claims` was shown to
//      the student in that same reply. The build that shipped surfaced claims it never showed, which
//      puts rows in the stance matrix whose text the student never read and — inside the Turn window,
//      where surfacing also marks a claim relied on (D-077) — makes FR-084's lock gate refuse a
//      Decision Lock over a claim nobody was shown.
//   3. **The shape.** For the same request, the probe reply and an ordinary reply produce the same
//      sequence of segment kinds and the same claim count. Nothing about the frames on the wire
//      separates them.
//   4. **Once.** The reversal is delivered once per run (D-088: "the *next* assistant message"), and
//      `probe_fired` is written once. The build that shipped returned the same 355 characters
//      byte-for-byte on every later matching request, which no provider does.
//   5. **The provider.** A probe delegation calls the model like any other, so it costs the same
//      wall-clock time and leaves the same `llm_calls` row. A branch that answered instantly would
//      announce itself before the student had read a word.
//   6. **Verbatim, and reviewer-only.** The reversal reaches the student exactly as authored
//      (FR-053), the marks that say a probe fired are the reviewer's alone, and the owner's trace
//      has neither the event nor a gap where it was written.
// @db:truncate
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { truncateAll } from '@tests/setup/integration'
import {
  FIXTURE,
  delegationRows,
  eventsOfType,
  keysOf,
  llmCallRows,
  runClaimRows,
  runInWorking,
  setStanceDirectly,
  setupAssistantFixture,
  type AssistantFixture,
} from './fixture'

type Assistant = typeof import('@/server/modules/assistant')
type Trace = typeof import('@/server/modules/trace')
type DelegationChunk = import('@/server/modules/assistant').DelegationChunk

let assistant: Assistant
let trace: Trace
let fx: AssistantFixture

/**
 * The request that raises the probe claim and nothing else.
 *
 * `saturated` is one of C8's authored trigger phrases and appears in no other claim's, so both the
 * ordinary reply and the probe reply carry exactly one claim — which is what lets test 3 compare
 * their shapes without the comparison being about how many claims matched.
 */
const PROBE_REQUEST = 'Is the value tier saturated?'

/** What a student can observe of one reply: the frames, in order, and what each carried. */
type Answer = {
  delegationId: string
  /** The kind of every `segment` event, in the order the stream wrote them. */
  kinds: ('text' | 'claim')[]
  /** The prose as the panel concatenates it. */
  text: string
  /** The claim cards, which is also `claimCount` in the live region (`use-delegation.ts`). */
  claims: { id: string; key: string; text: string }[]
}

async function collect(stream: AsyncIterable<DelegationChunk>): Promise<Answer> {
  const answer: Answer = { delegationId: '', kinds: [], text: '', claims: [] }
  for await (const chunk of stream) {
    if (chunk.event === 'done') {
      answer.delegationId = chunk.data.delegationId
      continue
    }
    answer.kinds.push(chunk.data.type)
    if (chunk.data.type === 'text') answer.text += chunk.data.text
    else answer.claims.push(chunk.data.claim)
  }
  return answer
}

const ask = async (runId: string, request: string): Promise<Answer> =>
  collect(await assistant.delegate(fx.student, runId, { request }))

/** A run in `working` with C8 surfaced and challenged: the state D-088 arms the probe in. */
async function runWithChallengedProbe(): Promise<{ runId: string; opening: Answer }> {
  const runId = await runInWorking(fx)
  const opening = await ask(runId, PROBE_REQUEST)
  await setStanceDirectly(runId, fx.claimId('C8'), 'challenge')
  return { runId, opening }
}

beforeEach(async () => {
  await truncateAll()
  assistant = await import('@/server/modules/assistant')
  trace = await import('@/server/modules/trace')
  fx = await setupAssistantFixture('probe')
})

afterAll(async () => {
  await truncateAll()
})

// ---------------------------------------------------------------------------------------------
// 1. The stream: a probe reply carries its claims like any other (FR-051, FR-053)
// ---------------------------------------------------------------------------------------------

describe('what the probe delegation streams', () => {
  it('emits one claim segment per claim it carries, with the markers in the stored text', async () => {
    const { runId } = await runWithChallengedProbe()

    const fired = await ask(runId, 'I do not buy that the value tier is saturated.')

    // The reversal is there, verbatim (FR-053) — and so is the card.
    expect(fired.text).toContain(FIXTURE.probe.scriptedReversal)
    expect(fired.claims.map((claim) => claim.key)).toEqual(['C8'])

    // The stored reply carries the marker, so the Delegation Log draws the same card the panel did.
    const row = (await delegationRows(runId)).find((entry) => entry.id === fired.delegationId)
    expect(row?.response_text).toContain(`[[claim:${fx.claimId('C8')}]]`)
    expect(row?.claim_ids).toEqual([fx.claimId('C8')])
  })

  it('announces the same claim count the log entry lists', async () => {
    const { runId } = await runWithChallengedProbe()

    const fired = await ask(runId, 'I do not buy that the value tier is saturated.')

    // `use-delegation.ts` counts claim segments and the panel reads out that number; the log reads
    // the row. A reply where the two disagree says out loud that something was withheld from it.
    const log = await assistant.listDelegations(fx.student, runId)
    const entry = log.find((row) => row.id === fired.delegationId)
    expect(fired.claims).toHaveLength(entry?.claims.length ?? -1)
    expect(fired.claims.map((claim) => claim.id)).toEqual(entry?.claims.map((claim) => claim.id))
  })
})

// ---------------------------------------------------------------------------------------------
// 2. The claim list: nothing is surfaced that was not shown (FR-084, D-077)
// ---------------------------------------------------------------------------------------------

describe('what the probe delegation surfaces', () => {
  it('surfaces only claims it showed, so no unseen claim can reach the stance matrix', async () => {
    const runId = await runInWorking(fx)
    // Two claims first, so the run has a stance matrix with rows in it before the probe fires and
    // the assertion below is about this delegation rather than about an empty run.
    await ask(runId, 'What is the premium payback?')
    await ask(runId, PROBE_REQUEST)
    await setStanceDirectly(runId, fx.claimId('C8'), 'challenge')
    const before = new Set((await runClaimRows(runId)).map((row) => row.claim_id))

    const fired = await ask(runId, 'I do not buy that the value tier is saturated.')

    // Every row this delegation added is a card the student was handed. The delegation may reference
    // claims the run already met (D-267) — those are not new rows, and they were shown here too.
    const added = (await runClaimRows(runId))
      .map((row) => row.claim_id)
      .filter((claimId) => !before.has(claimId))
    const shown = new Set(fired.claims.map((claim) => claim.id))
    for (const claimId of added) expect(shown.has(claimId)).toBe(true)

    // And the stronger statement the lock gate needs: the claims the row references are the claims
    // the reply showed. FR-084 refuses the Decision Lock over a relied-on claim with no stance, and
    // in the Turn window surfacing is itself reliance (D-077) — so a claim referenced but not shown
    // is a gate the student cannot see, over text they were never given.
    const row = (await delegationRows(runId)).find((entry) => entry.id === fired.delegationId)
    expect([...shown].sort()).toEqual([...(row?.claim_ids ?? [])].sort())
  })
})

// ---------------------------------------------------------------------------------------------
// 3. The shape: the two replies are the same object on the wire (FR-053, D-278)
// ---------------------------------------------------------------------------------------------

describe('the shape of the two replies', () => {
  it('gives the probe reply the same segment sequence an ordinary reply to the same request has', async () => {
    const { runId, opening } = await runWithChallengedProbe()

    const fired = await ask(runId, PROBE_REQUEST)

    // Same request, same claims, same frames: text, card, text. The only difference is one
    // paragraph of prose, which is what a reply is allowed to differ by.
    expect(opening.kinds).toEqual(['text', 'claim', 'text'])
    expect(fired.kinds).toEqual(opening.kinds)
    expect(fired.claims.map((claim) => claim.key)).toEqual(opening.claims.map((claim) => claim.key))
  })

  it('leaves no flag, no extra field and no failure on the row the student can read', async () => {
    const { runId } = await runWithChallengedProbe()

    const fired = await ask(runId, PROBE_REQUEST)

    const row = (await delegationRows(runId)).find((entry) => entry.id === fired.delegationId)
    expect(row?.failed).toBe(false)
    expect(row?.why).toBeNull()

    const log = await assistant.listDelegations(fx.student, runId)
    const entry = log.find((item) => item.id === fired.delegationId)
    const ordinary = log.find((item) => item.id !== fired.delegationId)
    expect(entry).toBeDefined()
    // The owner's entry has the same keys as any other entry: `flags` is not among them (D-269), so
    // the mark that says a probe fired cannot travel on it.
    expect([...keysOf(entry)].sort()).toEqual([...keysOf(ordinary)].sort())
    expect(keysOf(entry).has('flags')).toBe(false)
    expect(keysOf(entry).has('probe')).toBe(false)
    expect(keysOf(entry).has('scriptedReversal')).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------
// 4. Once: D-088's "the next assistant message" is one message (FR-053)
// ---------------------------------------------------------------------------------------------

describe('how often the probe can fire', () => {
  it('delivers the reversal once and answers every later request with the model', async () => {
    const { runId } = await runWithChallengedProbe()

    const first = await ask(runId, PROBE_REQUEST)
    const second = await ask(runId, PROBE_REQUEST)
    const third = await ask(runId, 'Say more about whether the value tier is saturated.')

    expect(first.text).toContain(FIXTURE.probe.scriptedReversal)
    // A room that produced the same 355 characters twice would have announced itself: no provider
    // repeats a paragraph exactly, and a student who saw it happen knows which reply was authored.
    expect(second.text).not.toContain(FIXTURE.probe.scriptedReversal)
    expect(third.text).not.toContain(FIXTURE.probe.scriptedReversal)

    // The later replies are ordinary replies, not silence: the claim is still carried.
    expect(second.claims.map((claim) => claim.key)).toEqual(['C8'])
    expect(await eventsOfType(runId, 'probe_fired')).toHaveLength(1)

    const stored = await delegationRows(runId)
    const carrying = stored.filter((row) =>
      row.response_text.includes(FIXTURE.probe.scriptedReversal),
    )
    expect(carrying).toHaveLength(1)
    expect(carrying[0]?.id).toBe(first.delegationId)
  })

  it('does not fire at all on a claim the student has not challenged', async () => {
    const runId = await runInWorking(fx)

    await ask(runId, PROBE_REQUEST)
    await ask(runId, PROBE_REQUEST)

    expect(await eventsOfType(runId, 'probe_fired')).toEqual([])
    const rows = await delegationRows(runId)
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.response_text).not.toContain(FIXTURE.probe.scriptedReversal)
      expect(row.flags).toEqual([])
    }
  })
})

// ---------------------------------------------------------------------------------------------
// 5. The provider: a probe delegation costs what every delegation costs (D-278)
// ---------------------------------------------------------------------------------------------

describe('what the probe delegation asks the provider', () => {
  it('calls the model like any other delegation, so it cannot be told apart by how fast it answers', async () => {
    const { runId } = await runWithChallengedProbe()
    const before = await llmCallRows(runId)

    await ask(runId, PROBE_REQUEST)

    const after = await llmCallRows(runId)
    expect(after).toHaveLength(before.length + 1)
    expect(after.at(-1)).toMatchObject({
      feature: 'assistant',
      prompt_name: 'assistant-reply',
      outcome: 'ok',
    })
  })
})

// ---------------------------------------------------------------------------------------------
// 6. Verbatim, and reviewer-only (FR-053, FR-055, D-223, D-232, D-233)
// ---------------------------------------------------------------------------------------------

describe('what the record keeps', () => {
  it('stores the reversal exactly as authored and writes probe_fired with the author’s text', async () => {
    const { runId } = await runWithChallengedProbe()

    const fired = await ask(runId, PROBE_REQUEST)

    const [event] = await eventsOfType(runId, 'probe_fired')
    expect(event?.payload).toEqual({
      claim_id: fx.claimId('C8'),
      scripted_reversal: FIXTURE.probe.scriptedReversal,
    })

    // FR-053: verbatim. No guard edits authored package text — the reversal is in the stored reply
    // character for character, and it opens it.
    const row = (await delegationRows(runId)).find((entry) => entry.id === fired.delegationId)
    expect(row?.response_text.startsWith(FIXTURE.probe.scriptedReversal)).toBe(true)
  })

  it('marks the delegation for the reviewer only', async () => {
    const { runId } = await runWithChallengedProbe()

    const fired = await ask(runId, PROBE_REQUEST)

    for (const reviewer of [fx.instructor, fx.ta]) {
      const seen = await assistant.listDelegations(reviewer, runId)
      const entry = seen.find((row) => row.id === fired.delegationId)
      expect(entry?.flags).toContain('probe')
      const ordinary = seen.find((row) => row.id !== fired.delegationId)
      expect(ordinary?.flags).not.toContain('probe')
    }
  })

  it('leaves the owner’s trace with neither the event nor the hole where it was written', async () => {
    const { runId } = await runWithChallengedProbe()

    await ask(runId, PROBE_REQUEST)

    // D-233 and D-232: the type is withheld whole, and the sequence is renumbered densely over what
    // the owner can see — a gap at exactly the moment the assistant changed its mind is the tell the
    // renumbering exists to remove.
    const owned = await trace.listEvents(fx.student, runId)
    expect(owned.some((event) => event.type === 'probe_fired')).toBe(false)
    expect(owned.map((event) => event.seq)).toEqual(owned.map((_event, index) => index + 1))
    expect(keysOf(owned).has('flags')).toBe(false)
    expect(JSON.stringify(owned)).not.toContain('probe')

    // The reviewer's trace is the record, and it has the event.
    const reviewed = await trace.listEvents(fx.instructor, runId)
    expect(reviewed.filter((event) => event.type === 'probe_fired')).toHaveLength(1)
  })
})
