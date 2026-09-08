// Step 7.3 — the invariant, in running code (FR-056; CLAUDE.md "the assistant never reveals defect
// status"; 11-llm-integration.md §3, §5; 12-security.md §8.3).
//
// The evals check the *reply* a provider produced. This file checks the *delegation*: every eval
// case is asked of a real run through `assistant.delegate`, and what the student is handed, what the
// log stores and what the trace records are all read back and scanned. The two are different
// questions. A prompt can be clean and a service still leak — through a flag it puts on the row, a
// field it adds to a view, a number it lets past the guard, or an error it phrases badly — and this
// is where that shows up.
//
// **What is asserted, over all sixteen cases.**
//
//   1. No reply contains a word from the answer key's vocabulary, and no reply contains a band name.
//      `containsDefectWord` is the same predicate the filter fires on, so the assertion and the
//      guarantee are one implementation (D-261). The four band names are checked by name as well,
//      because two of them are only *contextually* filtered and this test wants none of them at all.
//   2. Nothing a student can read carries a key 12 §8 forbids — not the claim cards the stream
//      yields, not the Delegation Log, not their own claim list, not their own trace.
//   3. Every claim's text arrives exactly as the author wrote it. A guard that redacted a package's
//      own words would be the same defect wearing the other face (D-264): the assistant would look
//      broken, and the student would learn to route around it.
//   4. On the mock nothing is flagged and no number is unverified. A `filtered` flag here would mean
//      the second line fired, which is a regression in the first (11 §3).
// @db:truncate
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { truncateAll } from '@tests/setup/integration'
import { findForbiddenKeys } from '@/server/auth/student-view'
import { containsDefectWord, defectWordsIn } from '@/server/llm/guardrails/defect-words'
import {
  FIXTURE,
  delegationRows,
  eventsOfType,
  runInWorking,
  setupAssistantFixture,
  type AssistantFixture,
} from './fixture'

type Assistant = typeof import('@/server/modules/assistant')
type Reliance = typeof import('@/server/modules/reliance')
type Trace = typeof import('@/server/modules/trace')

let assistant: Assistant
let reliance: Reliance
let trace: Trace
let fx: AssistantFixture

/** The four band names of the rubric (10 §11), checked by name whatever the filter's rules are. */
const BAND_NAMES = ['novice', 'developing', 'proficient', 'professional']

type EvalCase = { id: string; request: string; openedDocumentKeys?: string[] }

/**
 * Every delegation request in the eval suite — 11 §5's twelve, plus step 14.3's four injection
 * cases — read from the suite rather than restated here.
 *
 * Restating them would let this file and the evals drift, and the point of the pairing is that a
 * case added to the suite is asked of a real run too — a new injection attempt should have to pass
 * both the property checks and this one.
 */
const CASES: EvalCase[] = readdirSync(join(process.cwd(), 'evals', 'assistant', 'cases'))
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map(
    (name) =>
      JSON.parse(
        readFileSync(join(process.cwd(), 'evals', 'assistant', 'cases', name), 'utf8'),
      ) as EvalCase,
  )

beforeEach(async () => {
  await truncateAll()
  assistant = await import('@/server/modules/assistant')
  reliance = await import('@/server/modules/reliance')
  trace = await import('@/server/modules/trace')
  fx = await setupAssistantFixture('leak')
})

afterAll(async () => {
  await truncateAll()
})

describe('no delegation reveals defect status (FR-056)', () => {
  // Twelve from 11 §5, four added by step 14.3. The number is asserted rather than the file list so
  // that a case added to the evals and *not* asked of a real run fails here — which is the pairing
  // the comment above describes, and the reason this count is not simply `CASES.length`.
  it('has every eval case of 11 §5 and step 14.3 to ask', () => {
    expect(CASES).toHaveLength(16)
    expect(CASES.filter((evalCase) => evalCase.id.startsWith('injection-'))).toHaveLength(7)
  })

  it('answers every eval case without a defect word or a band name anywhere', async () => {
    const runId = await runInWorking(fx)
    const seen: { id: string; text: string }[] = []

    for (const evalCase of CASES) {
      // The eval case's own opened documents, so the reply is built from the same room.
      for (const key of evalCase.openedDocumentKeys ?? []) {
        const runs = await import('@/server/modules/runs')
        await runs.openDocument(fx.student, runId, fx.documentId(key))
      }

      const stream = await assistant.delegate(fx.student, runId, { request: evalCase.request })
      const parts: string[] = []
      for await (const chunk of stream) {
        if (chunk.event !== 'segment') continue
        parts.push(chunk.data.type === 'text' ? chunk.data.text : chunk.data.claim.text)
      }
      seen.push({ id: evalCase.id, text: parts.join('\n') })
    }

    // 1. What reached the student.
    const leaking = seen.filter((reply) => containsDefectWord(reply.text))
    expect(
      leaking.map((reply) => `${reply.id}: ${defectWordsIn(reply.text).map((w) => w.term)}`),
    ).toEqual([])

    for (const reply of seen) {
      const lowered = reply.text.toLowerCase()
      for (const band of BAND_NAMES) {
        expect(lowered.includes(band), `${reply.id} named the band "${band}"`).toBe(false)
      }
    }

    // 2. What was stored. The row is what the log renders and what the replay reads, so a reply
    //    that was clean on the wire and dirty in the table would leak on the second read.
    const rows = await delegationRows(runId)
    expect(rows).toHaveLength(CASES.length)
    for (const row of rows) {
      expect(containsDefectWord(row.response_text)).toBe(false)
      expect(row.flags, `${row.request_text} was flagged ${row.flags.join(', ')}`).toEqual([])
      expect(row.unverified_numbers).toEqual([])
      expect(row.failed).toBe(false)
    }

    // 3. And what the trace recorded of it.
    for (const event of await eventsOfType(runId, 'delegation')) {
      expect(containsDefectWord(String(event.payload.response_text))).toBe(false)
    }
  })

  it('carries every claim text exactly as the author wrote it', async () => {
    const runId = await runInWorking(fx)
    for (const evalCase of CASES) {
      await drain(await assistant.delegate(fx.student, runId, { request: evalCase.request }))
    }

    const surfaced = await reliance.listRunClaims(fx.student, runId)
    expect(surfaced.length).toBeGreaterThan(0)
    for (const claim of surfaced) {
      const authored = FIXTURE.claims.find((entry) => entry.key === claim.key)
      expect(claim.text).toBe(authored?.text)
    }

    const responses = (await delegationRows(runId)).map((row) => row.response_text).join('\n')
    for (const claim of surfaced) {
      expect(responses).toContain(claim.text)
    }
  })

  it('hands the student no key 12 §8 forbids, in any of the four reads', async () => {
    const runId = await runInWorking(fx)
    const cards: unknown[] = []
    for (const evalCase of CASES) {
      const stream = await assistant.delegate(fx.student, runId, { request: evalCase.request })
      for await (const chunk of stream) {
        if (chunk.event === 'segment' && chunk.data.type === 'claim') cards.push(chunk.data.claim)
      }
    }

    // The trace is scanned over the events this step writes. `readiness_item` carries `answer_key`
    // and `concept_key`, and both are owner fields there rather than leaks — the key is the option
    // *the student chose*, and the concept is the one their own result names (D-251) — so a scan of
    // the whole trace by key name would fail on Phase 6's own view. The invariant those two belong
    // to is proven in `tests/integration/security/student-view-invariants.test.ts`.
    const owned = await trace.listEvents(fx.student, runId)
    const written = owned.filter((event) =>
      ['delegation', 'claim_used', 'outside_tool_declared', 'pause', 'resume'].includes(event.type),
    )
    expect(written.length).toBeGreaterThan(0)

    const reads: [string, unknown][] = [
      ['the claim cards the stream yielded', cards],
      ['the Delegation Log', await assistant.listDelegations(fx.student, runId)],
      ['the claim list', await reliance.listRunClaims(fx.student, runId)],
      ['the owner’s trace', written],
    ]
    for (const [what, payload] of reads) {
      const findings = findForbiddenKeys(payload, { scored: false })
      expect(findings.map((finding) => `${what}: ${finding.path}`)).toEqual([])
    }
  })
})

/**
 * Reads a delegation stream to the end and throws the reply away.
 *
 * The delegation is finished by the time the promise resolves (D-271), so this only has to consume
 * the iterable; the assertions read the rows, the claim list and the trace.
 */
async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  const seen: unknown[] = []
  for await (const chunk of stream) seen.push(chunk)
}
