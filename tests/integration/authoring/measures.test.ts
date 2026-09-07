// Step 12.2 — FR-198's operating measures against Postgres
// (docs/tech/10-backend-spec-modules.md §5 `computeAuthoringMeasures`; 17-analytics-events.md §3.2).
//
// The five numbers PRD §11 watches an authoring pilot by, each read off a package that really was
// generated and really was reviewed:
//
//   * **edit rate** — elements whose decision that stands is `edited`, over every element. An
//     author's edit *is* their confirmation (10 §4), so this is the share they changed rather than
//     the share they touched; PRD §11 reads a rate near zero as approving rather than reviewing.
//   * **rejected share** — elements with at least one `rejected` revision, over every element. It
//     counts history, not the standing decision, which is why a regeneration must not delete the
//     rejection it answered.
//   * **generation passes** — every `generation_runs` row, and the deepest retry any step needed.
//   * **review time** — the mean of `decided_at − opened_at`, the span the browser reports.
//   * **seed to confirmed** — the version's `confirmed_at` minus the seed record's `created_at`.
//
// Every element of the package is decided here, because that is what `confirmVersion` requires and
// because a measure divided by the wrong denominator is the failure mode: the counts below are
// computed from the element list rather than written down, so a package that grows an element type
// does not quietly change what the test is asserting.
// @db:truncate
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testSql, truncateAll } from '@tests/setup/integration'
import { stopBoss } from '@/server/jobs/boss'
import { drain, setupAuthoringFixture, type AuthoringFixture } from './fixture'

type Authoring = typeof import('@/server/modules/authoring')
type Scenarios = typeof import('@/server/modules/scenarios')

let authoring: Authoring
let scenarios: Scenarios
let fx: AuthoringFixture

/** The span the browser reports for every element the author confirmed rather than edited. */
const REVIEW_MS = 30_000
const EDITED_KEYS = ['brief', 'counterfactual', 'general_escalation_reply'] as const

let elementCount = 0
let confirmedCount = 0

beforeAll(async () => {
  await truncateAll()
  authoring = await import('@/server/modules/authoring')
  scenarios = await import('@/server/modules/scenarios')
  fx = await setupAuthoringFixture('measures')

  // One forced retry, so `generationPasses` and `generationMaxPass` have something to report.
  process.env.MOCK_GEN_FAIL_ONCE = 'documents'
  await authoring.startGeneration(fx.author, fx.versionId)
  await drain()
  delete process.env.MOCK_GEN_FAIL_ONCE

  const elements = await scenarios.listVersionElements(fx.author, fx.versionId)
  elementCount = elements.length
  const openedAt = new Date(Date.now() - REVIEW_MS).toISOString()

  // One element is sent back and then accepted: `rejectedShare` counts the history, `editRate` the
  // decision that stands, so this one element separates the two measures.
  const [rejected] = elements.filter((element) => element.elementType === 'document')
  if (!rejected?.elementId) throw new Error('the generated package has no documents')
  await scenarios.decideElement(fx.author, fx.versionId, 'document', rejected.elementId, {
    decision: 'rejected',
    note: 'The attribution is wrong.',
    openedAt,
  })

  for (const element of elements) {
    const elementId = element.elementId ?? '00000000-0000-0000-0000-000000000000'
    if ((EDITED_KEYS as readonly string[]).includes(element.elementType)) continue
    await scenarios.decideElement(fx.author, fx.versionId, element.elementType, elementId, {
      decision: 'confirmed',
      note: '',
      openedAt,
    })
    confirmedCount += 1
  }

  // The three the author rewrote themselves; an edit records its own confirmation (10 §4).
  await scenarios.updateElement(fx.author, fx.versionId, 'brief', rejected.elementId, {
    brief: 'You run growth at Halden Roastworks and the board wants a number by Monday.',
  })
  await scenarios.updateElement(fx.author, fx.versionId, 'counterfactual', rejected.elementId, {
    debriefCounterfactual:
      'A twenty percent worse retention would have pushed the payback past eighteen months. ' +
      'The premium shift would then have failed its own test. ' +
      'Holding the value tier was the defensible answer under that evidence.',
  })
  await scenarios.updateElement(
    fx.author,
    fx.versionId,
    'general_escalation_reply',
    rejected.elementId,
    {
      generalEscalationReply: 'A colleague reviews the claim and reports what the record supports.',
    },
  )
}, 180_000)

afterAll(async () => {
  await stopBoss()
  await truncateAll()
})

describe('computeAuthoringMeasures', () => {
  it('reports the edit rate, the rejected share, the passes and the review time', async () => {
    const measures = await authoring.computeAuthoringMeasures(fx.orgId, fx.versionId)

    expect(measures.elementsCount).toBe(elementCount)
    // Three elements carry a standing `edited` decision; every other one is `confirmed`.
    expect(measures.editRate).toBeCloseTo(EDITED_KEYS.length / elementCount, 6)
    expect(measures.rejectedShare).toBeCloseTo(1 / elementCount, 6)

    // Eight runs across the seven steps, because the documents step needed a second pass.
    expect(measures.generationPasses).toBe(8)
    expect(measures.generationMaxPass).toBe(2)

    // The review time is the span the browser reported, averaged. The three edits record a span of
    // zero — an edit is the instant it was made (07 §6 has no `openedAt` on a PATCH) — so the mean
    // is the confirmed elements' 30 s spread over all of them.
    const expected = Math.round((REVIEW_MS * confirmedCount) / elementCount)
    expect(measures.reviewMsPerElement ?? 0).toBeGreaterThan(expected - 2_000)
    expect(measures.reviewMsPerElement ?? 0).toBeLessThan(expected + 2_000)
    expect(measures.reviewMsTotal).toBeGreaterThanOrEqual(REVIEW_MS * confirmedCount)

    // Not confirmed yet, so there is no span from the seed to answer with.
    expect(measures.seedToConfirmedMs).toBeNull()
  })

  it('reports the seed-to-confirmed span once the version is frozen, and the package view agrees', async () => {
    const before = await testSql<{ created_at: Date }[]>`
      select created_at from seed_records where package_version_id = ${fx.versionId}`
    const seedAt = before[0]?.created_at
    expect(seedAt).toBeDefined()

    const confirmed = await scenarios.confirmVersion(fx.author, fx.versionId, {
      teachingNoteChecked: true,
    })
    expect(confirmed.status).toBe('confirmed')

    const measures = await authoring.computeAuthoringMeasures(fx.orgId, fx.versionId)
    expect(measures.seedToConfirmedMs).not.toBeNull()
    expect(measures.seedToConfirmedMs ?? -1).toBeGreaterThanOrEqual(0)

    // The package view (10 §4) publishes the same five numbers, computed from the same element list
    // and the same generation rows — one answer, not two that can drift.
    expect(confirmed.measures).toEqual({
      seedToConfirmedMs: measures.seedToConfirmedMs,
      editRate: measures.editRate,
      rejectedShare: measures.rejectedShare,
      generationPasses: measures.generationPasses,
      reviewMsPerElement: measures.reviewMsPerElement,
    })
    expect(confirmed.authoringRecord.runs).toHaveLength(8)
    expect(confirmed.authoringRecord.runs.filter((run) => run.status === 'failed')).toHaveLength(1)
  }, 60_000)
})
