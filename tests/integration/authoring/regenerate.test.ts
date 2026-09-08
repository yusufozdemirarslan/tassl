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

// ---------------------------------------------------------------------------------------------
// A confirmed claim state whose claim the next pass does not name (D-552)
// ---------------------------------------------------------------------------------------------
//
// A claim state is a confirmable element in its own right — the workspace addresses it as
// `defective:C3` — so an author can confirm a state while the claim it hangs on is still
// unconfirmed. `writeClaims` deleted the states of every dropped claim, and their confirmation
// rows, without consulting `ctx.confirmedIds`: the one write path in the file that did not. That
// destroyed reviewed work silently *and* erased the rejection history `rejectedShare` counts, which
// is exactly the loss D-532 was written to prevent.
//
// The precondition is built rather than provoked, because the mock's keys are a function of the
// seed and so a second claims pass reproduces them. A real provider is under no such obligation:
// nothing in the step's output schema pins a key across passes, and a retry carrying
// `restatedRules` is asked for the whole step again. So the claim the pass drops is planted here.

/**
 * Copies a row of `table`, overriding the given columns; the copy is a row of the same version.
 *
 * Through a temp table rather than a column list, so a column added to either table later is
 * carried across rather than silently dropped to its default — and rather than through
 * `jsonb_populate_record`, which refuses a row carrying an array column.
 */
const copyRow = async (
  table: 'scenario_claims' | 'variant_claim_states',
  id: string,
  overrides: Record<string, string | number>,
): Promise<void> => {
  const literal = (value: string | number) =>
    typeof value === 'number' ? String(value) : `'${value.replace(/'/g, "''")}'`
  const assignments = Object.entries(overrides)
    .map(([column, value]) => `${column} = ${literal(value)}`)
    .join(', ')
  // One `unsafe` call so every statement runs on one connection: a temp table is the session's.
  await testSql
    .unsafe(
      `create temp table _row_copy as select * from ${table} where id = ${literal(id)};
       update _row_copy set ${assignments};
       insert into ${table} select * from _row_copy;
       drop table _row_copy;`,
    )
    .simple()
}

/** A claim nothing is planted on, so a copy of it does not make a second plant. */
const soundClaim = async (): Promise<{ id: string; key: string } | undefined> => {
  const rows = await testSql<{ id: string; key: string }[]>`
    select c.id, c.key from scenario_claims c
     where c.package_version_id = ${fx.versionId}
       and not exists (select 1 from variant_claim_states s where s.claim_id = c.id and s.planted)
     order by c.position limit 1`
  return rows[0]
}

describe('regenerating the claims of a version', () => {
  it(
    'keeps a claim whose state the author confirmed, and keeps the confirmation',
    async () => {
      const claims = await testSql<{ id: string; key: string }[]>`
        select id, key from scenario_claims where package_version_id = ${fx.versionId}
         order by position`
      const model = await soundClaim()
      if (!model) throw new Error('the generated package has no unplanted claim')
      const unconfirmed = claims.find((claim) => claim.id !== model.id)
      if (!unconfirmed) throw new Error('the generated package has too few claims')

      // A claim the next pass will not name, copied whole — both variants' states — so the package
      // it is added to still satisfies every rule step 4 is held to. What is being proved is what
      // the pass does to a confirmed state, not what it does to a broken package.
      const orphanId = crypto.randomUUID()
      await copyRow('scenario_claims', model.id, { id: orphanId, key: 'C99', position: 99 })
      const modelStates = await testSql<{ id: string; key: string }[]>`
        select s.id, v.key from variant_claim_states s
          join scenario_variants v on v.id = s.variant_id
         where v.package_version_id = ${fx.versionId} and s.claim_id = ${model.id}
         order by v.key`
      let orphanStateId = ''
      for (const state of modelStates) {
        const copyId = crypto.randomUUID()
        await copyRow('variant_claim_states', state.id, { id: copyId, claim_id: orphanId })
        if (state.key === 'defective') orphanStateId = copyId
      }
      if (orphanStateId === '') throw new Error('the model claim has no defective state')

      // The author confirms the *state*, and leaves the claim itself undecided.
      await scenarios.decideElement(fx.author, fx.versionId, 'variant_claim_state', orphanStateId, {
        decision: 'confirmed',
        note: '',
        openedAt: OPENED_AT,
      })

      await authoring.regenerateElement(fx.author, fx.versionId, 'claim', unconfirmed.id, {})
      await drain()

      // The state, its claim and the confirmation are all still there. Before the fix the pass
      // dropped `C99` as stale and took all three with it, silently.
      const survivingState = await testSql<{ id: string }[]>`
        select id from variant_claim_states where id = ${orphanStateId}`
      expect(survivingState, 'the confirmed claim state survived').toHaveLength(1)
      const survivingClaim = await testSql<{ id: string }[]>`
        select id from scenario_claims where id = ${orphanId}`
      expect(survivingClaim, 'the claim its state hangs on survived').toHaveLength(1)
      const confirmations = await testSql<{ decision: string }[]>`
        select decision from element_confirmations
         where package_version_id = ${fx.versionId} and element_id = ${orphanStateId}`
      expect(confirmations.map((row) => row.decision)).toEqual(['confirmed'])

      // And the claims the pass did name were rewritten as usual: this is not a step that stopped.
      const runs = await testSql<{ step: string; status: string }[]>`
        select step, status from generation_runs
         where package_version_id = ${fx.versionId} and step = 'claims_and_states'
         order by created_at, id`
      expect(runs[runs.length - 1]).toEqual({ step: 'claims_and_states', status: 'succeeded' })
    },
    TEST_MS,
  )

  it(
    'still drops a claim nobody decided anything about, with its states and their rows',
    async () => {
      // The other half: without this the fix above could be "never delete anything", which would
      // leave every superseded draft in the package for ever (10 §5).
      const model = await soundClaim()
      if (!model) throw new Error('the generated package has no unplanted claim')

      const orphanId = crypto.randomUUID()
      await copyRow('scenario_claims', model.id, { id: orphanId, key: 'C98', position: 98 })
      const modelStates = await testSql<{ id: string }[]>`
        select s.id from variant_claim_states s
          join scenario_variants v on v.id = s.variant_id
         where v.package_version_id = ${fx.versionId} and s.claim_id = ${model.id}`
      for (const state of modelStates) {
        await copyRow('variant_claim_states', state.id, {
          id: crypto.randomUUID(),
          claim_id: orphanId,
        })
      }

      await authoring.regenerateElement(fx.author, fx.versionId, 'claim', model.id, {})
      await drain()

      expect(
        await testSql<{ id: string }[]>`select id from scenario_claims where id = ${orphanId}`,
      ).toHaveLength(0)
      expect(
        await testSql<{ id: string }[]>`
          select id from variant_claim_states where claim_id = ${orphanId}`,
      ).toHaveLength(0)
    },
    TEST_MS,
  )
})
