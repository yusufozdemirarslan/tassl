// Step 12.2 — element regeneration against Postgres (docs/tech/10-backend-spec-modules.md §5
// `regenerateElement`; FR-194, UI-043).
//
// One claim, and it is the one that matters most in this phase: **a step replaces only the
// unconfirmed elements of its type**. An author who has confirmed three documents and asks for the
// rest again keeps those three — the rows, their bodies, their ids and their confirmation record.
// Getting this wrong destroys human work silently, so the test proves it the hard way: every
// document's body is overwritten with a marker between the generation and the regeneration, and
// afterwards the confirmed three still carry the marker (nothing wrote over them) while the rest
// carry the generated text again (they really were replaced).
//
// The ids are asserted too. Regeneration reconciles by element key through `upsertElement`, so a
// replaced document keeps the id its claims, its Source Traces and its answer-space positions point
// at; a delete-and-insert would have left every one of those references dangling or repointed.
// @db:truncate
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { testSql, truncateAll } from '@tests/setup/integration'
import { isAppError } from '@/lib/errors'
import { stopBoss } from '@/server/jobs/boss'
import { drain, setupAuthoringFixture, type AuthoringFixture } from './fixture'

type Authoring = typeof import('@/server/modules/authoring')
type Scenarios = typeof import('@/server/modules/scenarios')

let authoring: Authoring
let scenarios: Scenarios
let fx: AuthoringFixture

const OPENED_AT = '2026-09-07T10:00:00.000Z'
const TAMPERED = 'TAMPERED BODY'

/** A whole generated package per test: seven model calls and about sixty element writes. */
const SETUP_MS = 120_000
const TEST_MS = 60_000

beforeEach(async () => {
  await truncateAll()
  authoring = await import('@/server/modules/authoring')
  scenarios = await import('@/server/modules/scenarios')
  fx = await setupAuthoringFixture('regenerate')
  await authoring.startGeneration(fx.author, fx.versionId)
  await drain()
}, SETUP_MS)

afterAll(async () => {
  await stopBoss()
  await truncateAll()
})

type DocumentRow = { id: string; key: string; body: string; stakeholder_id: string | null }

const documentRows = async (): Promise<DocumentRow[]> =>
  testSql<DocumentRow[]>`
    select id, key, body, stakeholder_id from scenario_documents
     where package_version_id = ${fx.versionId} order by position`

const confirmationRows = async () =>
  testSql<
    { element_type: string; element_id: string | null; decision: string; revision: number }[]
  >`
    select element_type, element_id, decision, revision from element_confirmations
     where package_version_id = ${fx.versionId} order by created_at, id`

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise
    return 'no error'
  } catch (error) {
    return isAppError(error) ? error.code : String(error)
  }
}

describe('regenerating a document', () => {
  it(
    'replaces the unconfirmed set and leaves every confirmed document exactly as it was',
    async () => {
      const before = await documentRows()
      expect(before.length).toBeGreaterThanOrEqual(6)
      const confirmed = before.slice(0, 3)
      const replaced = before.slice(3)

      for (const document of confirmed) {
        await scenarios.decideElement(fx.author, fx.versionId, 'document', document.id, {
          decision: 'confirmed',
          note: '',
          openedAt: OPENED_AT,
        })
      }
      // The one the author sends back is the one they then ask to be regenerated (UI-043).
      const rejected = replaced[0]
      if (!rejected) throw new Error('the fixture package has too few documents')
      await scenarios.decideElement(fx.author, fx.versionId, 'document', rejected.id, {
        decision: 'rejected',
        note: 'The dates do not line up.',
        openedAt: OPENED_AT,
      })

      // Every body is marked, so "untouched" and "replaced" are told apart by the rows themselves
      // rather than by whether the generator happens to be deterministic.
      await testSql`
      update scenario_documents set body = ${TAMPERED} where package_version_id = ${fx.versionId}`

      const queued = await authoring.regenerateElement(
        fx.author,
        fx.versionId,
        'document',
        rejected.id,
        { restatedRule: 'The superseded memo must be dated before the one that replaces it.' },
      )
      expect(queued.step).toBe('documents')
      await drain()

      const after = await documentRows()
      const afterById = new Map(after.map((row) => [row.id, row]))

      // 1. The author's three are untouched: same rows, same ids, and the marker still on them.
      for (const document of confirmed) {
        const row = afterById.get(document.id)
        expect(row, `confirmed document ${document.key} survived`).toBeDefined()
        expect(row?.key).toBe(document.key)
        expect(row?.body, `confirmed document ${document.key} was not written over`).toBe(TAMPERED)
      }

      // 2. The rest really were replaced, and kept the ids their claims point at.
      for (const document of replaced) {
        const row = afterById.get(document.id)
        expect(row, `regenerated document ${document.key} kept its id`).toBeDefined()
        expect(row?.key).toBe(document.key)
        expect(row?.body, `regenerated document ${document.key} was rewritten`).not.toBe(TAMPERED)
        expect(row?.body).toBe(document.body)
      }

      // 3. Nothing else in the package moved: the claims still resolve to documents of this version.
      const dangling = await testSql<{ count: number }[]>`
      select count(*)::int as count from scenario_claims c
       where c.package_version_id = ${fx.versionId}
         and c.source_document_id is not null
         and not exists (select 1 from scenario_documents d where d.id = c.source_document_id)`
      expect(dangling[0]?.count).toBe(0)

      // 4. The confirmation record: the three confirmations stand, and the rejection is still on the
      //    record — `rejectedShare` (FR-198) counts the elements an author sent back, so a
      //    regeneration that erased the rejection would erase the measure with it.
      const rows = await confirmationRows()
      const forDocuments = rows.filter((row) => row.element_type === 'document')
      expect(forDocuments.filter((row) => row.decision === 'confirmed')).toHaveLength(3)
      expect(forDocuments.filter((row) => row.decision === 'rejected')).toHaveLength(1)

      // 5. And the regenerated elements are unconfirmed again: nothing the pipeline wrote carries a
      //    decision that would let `confirmVersion` through without the author reading it (FR-192).
      const elements = await scenarios.listVersionElements(fx.author, fx.versionId)
      for (const document of replaced) {
        const element = elements.find((row) => row.elementId === document.id)
        expect(element?.confirmation?.decision ?? 'none').not.toBe('confirmed')
        expect(element?.confirmation?.decision ?? 'none').not.toBe('edited')
      }
    },
    TEST_MS,
  )

  it(
    'refuses to regenerate an element the author has already confirmed',
    async () => {
      const [document] = await documentRows()
      if (!document) throw new Error('the fixture package has no documents')
      await scenarios.decideElement(fx.author, fx.versionId, 'document', document.id, {
        decision: 'confirmed',
        note: '',
        openedAt: OPENED_AT,
      })
      expect(
        await codeOf(
          authoring.regenerateElement(fx.author, fx.versionId, 'document', document.id, {}),
        ),
      ).toBe('CONFLICT')
    },
    TEST_MS,
  )

  it(
    'refuses to regenerate anything once the version is confirmed',
    async () => {
      const [document] = await documentRows()
      if (!document) throw new Error('the fixture package has no documents')
      await testSql`
      update scenario_package_versions
         set status = 'confirmed', confirmed_at = now(), confirmed_by = ${fx.authorId}
       where id = ${fx.versionId}`
      expect(
        await codeOf(
          authoring.regenerateElement(fx.author, fx.versionId, 'document', document.id, {}),
        ),
      ).toBe('VERSION_FROZEN')
    },
    TEST_MS,
  )

  it(
    're-runs only the owning step, so the rest of the package is left alone',
    async () => {
      const claimsBefore = await testSql<{ id: string; key: string }[]>`
      select id, key from scenario_claims where package_version_id = ${fx.versionId} order by position`
      const [document] = await documentRows()
      if (!document) throw new Error('the fixture package has no documents')

      await authoring.regenerateElement(fx.author, fx.versionId, 'document', document.id, {})
      await drain()

      const runs = await testSql<{ step: string; status: string }[]>`
      select step, status from generation_runs
       where package_version_id = ${fx.versionId} order by created_at, id`
      // Seven from the pipeline plus exactly one more, and it is the documents step: a regeneration
      // that carried on to step 3 would rewrite the answer space the author may already have signed.
      expect(runs).toHaveLength(8)
      expect(runs[7]).toEqual({ step: 'documents', status: 'succeeded' })

      const claimsAfter = await testSql<{ id: string; key: string }[]>`
      select id, key from scenario_claims where package_version_id = ${fx.versionId} order by position`
      expect(claimsAfter).toEqual(claimsBefore)
    },
    TEST_MS,
  )
})
