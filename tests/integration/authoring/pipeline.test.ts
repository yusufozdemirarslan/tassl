// Step 12.2 — the generation pipeline against Postgres (docs/tech/10-backend-spec-modules.md §5;
// 11-llm-integration.md §2.1; AI-001, AI-005, FR-191, DATA-027).
//
// Five claims, and each is one of the things 10 §5 says the pipeline does.
//
//   * **Seven steps, then a package.** "Create and generate" on a seed produces a draft that passes
//     every rule of `validatePackage` on the mock provider, and the author is told so.
//   * **The record is real.** One `generation_runs` row per pass, each carrying its provider, its
//     model, its token counts and its pass number (DATA-027).
//   * **A failed step retries once, and the retry is told what broke.** `MOCK_GEN_FAIL_ONCE`
//     makes the documents step's first pass return a room no stakeholder owns a document in, which
//     the output schema accepts and `STAKEHOLDER_NO_DOCUMENT` refuses. Pass 2 must exist, and the
//     prompt it was sent must contain the rule's own sentence — a blind retry is not what §5 asks
//     for, and the assertion is on the rendered prompt, not on the payload.
//   * **A second failure stops.** Forced to fail both passes, the step is `failed`, the pipeline
//     goes no further, and `generation_failed` reaches the author.
//   * **A second start is refused, and the refusal is the row lock.** Two `startGeneration` calls
//     raced against each other produce one pipeline — and the same test shows the queue's singleton
//     key does *not* deduplicate under the `standard` policy (D-400), so the lock is doing it.
//   * **A start after a stopped pipeline resumes it.** A pipeline that stopped partway is the
//     ordinary case in production, not the exceptional one: the drain cannot outlive its invocation
//     and seven model calls do not fit in one. Starting again has to continue from the first step
//     that has not succeeded, because re-running step 1 deletes stakeholders that step 2's documents
//     reference `on delete no action` — a foreign key violation that leaves the version with no way
//     forward and no way back (D-683).
// @db:truncate
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { testSql, truncateAll } from '@tests/setup/integration'
import { isAppError } from '@/lib/errors'
import { stopBoss } from '@/server/jobs/boss'
import { enqueue } from '@/server/jobs/enqueue'
import { drain, setupAuthoringFixture, type AuthoringFixture } from './fixture'

/**
 * Every structured call the pipeline makes, as it goes on the wire.
 *
 * `llm_calls` records that a call happened and what it cost (DATA-049) but not the text — by
 * design, because a rendered generation prompt carries the whole seed case. So the restated-rule
 * assertion is made where the messages exist: around the registry, wrapping the real mock provider
 * rather than replacing it, so the pipeline still runs against the same answers.
 */
const calls = vi.hoisted(() => [] as { promptName: string; messages: string }[])

vi.mock('@/server/llm/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/llm/registry')>()
  return {
    ...actual,
    getProvider: () => {
      const provider = actual.getProvider()
      return {
        ...provider,
        structured: async (request: Parameters<typeof provider.structured>[0]) => {
          calls.push({
            promptName: request.promptName,
            messages: request.messages.map((message) => message.content).join('\n'),
          })
          return provider.structured(request)
        },
      }
    },
  }
})

type Authoring = typeof import('@/server/modules/authoring')
type Scenarios = typeof import('@/server/modules/scenarios')

let authoring: Authoring
let scenarios: Scenarios
let fx: AuthoringFixture

beforeEach(async () => {
  await truncateAll()
  calls.length = 0
  delete process.env.MOCK_GEN_FAIL_ONCE
  authoring = await import('@/server/modules/authoring')
  scenarios = await import('@/server/modules/scenarios')
  fx = await setupAuthoringFixture('pipeline')
})

afterEach(() => {
  delete process.env.MOCK_GEN_FAIL_ONCE
})

afterAll(async () => {
  await stopBoss()
  await truncateAll()
})

type RunRow = {
  step: string
  pass_number: number
  status: string
  provider: string | null
  model: string | null
  input_tokens: number | null
  output_tokens: number | null
  failed_rules: string[]
  error: string | null
}

const runRows = async (versionId: string): Promise<RunRow[]> =>
  testSql<RunRow[]>`
    select step, pass_number, status, provider, model, input_tokens, output_tokens,
           failed_rules, error
      from generation_runs where package_version_id = ${versionId}
     order by created_at, id`

const notificationRows = async (userId: string) =>
  testSql<{ type: string; payload: Record<string, unknown> }[]>`
    select type, payload from notifications where user_id = ${userId} order by created_at, id`

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise
    return 'no error'
  } catch (error) {
    return isAppError(error) ? error.code : String(error)
  }
}

// ---------------------------------------------------------------------------------------------
// The happy path
// ---------------------------------------------------------------------------------------------

describe('startGeneration on the mock provider', () => {
  it('runs the seven steps, passes validation, and tells the author', async () => {
    expect(await authoring.startGeneration(fx.author, fx.versionId)).toEqual({ started: true })
    await drain()

    const rows = await runRows(fx.versionId)
    expect(rows.map((row) => `${row.step}:${row.pass_number}:${row.status}`)).toEqual([
      'reskin_brief_stakeholders:1:succeeded',
      'documents:1:succeeded',
      'answer_space_fields:1:succeeded',
      'claims_and_states:1:succeeded',
      'turn_and_probe:1:succeeded',
      'question_bank_and_counterfactual:1:succeeded',
      'readiness_items:1:succeeded',
    ])

    // DATA-027: every row carries what the pass cost and who answered it.
    for (const row of rows) {
      expect(row.provider, row.step).toBe('mock')
      expect(row.model, row.step).not.toBeNull()
      expect(row.input_tokens ?? 0, row.step).toBeGreaterThan(0)
      expect(row.output_tokens ?? 0, row.step).toBeGreaterThan(0)
      expect(row.failed_rules, row.step).toEqual([])
      expect(row.error, row.step).toBeNull()
    }

    const status = await authoring.getGenerationStatus(fx.author, fx.versionId)
    expect(status.state).toBe('complete')
    expect(status.validation).toEqual({ ok: true, failures: [] })
    expect(status.steps).toHaveLength(7)

    // The package the pipeline produced is a package (10 §4's whole rule table).
    const view = await scenarios.getPackageVersion(fx.author, fx.versionId)
    expect(view.validation.ok, JSON.stringify(view.validation.failures)).toBe(true)
    expect(view.counts.documents).toBeGreaterThanOrEqual(6)
    expect(view.counts.claims).toBeGreaterThanOrEqual(6)
    expect(view.counts.readinessItems).toBe(16)
    expect(view.authoringRecord.runs).toHaveLength(7)
    expect(view.authoringRecord.generationModel).not.toBeNull()
    expect(view.measures.generationPasses).toBe(7)

    const notices = await notificationRows(fx.authorId)
    expect(notices.map((row) => row.type)).toEqual(['generation_complete'])
    expect(notices[0]?.payload).toMatchObject({ ok: true, packageVersionId: fx.versionId })
  })

  it('refuses a version with no seed record, and a confirmed one', async () => {
    const bare = await import('@tests/factories').then((factories) =>
      factories.createPackageVersion(fx.orgId, 'authoring-no-seed', { createdBy: fx.authorId }),
    )
    expect(await codeOf(authoring.startGeneration(fx.author, bare.version.id))).toBe('SEED_MISSING')

    // A confirmed version is frozen, and the refusal is on the write (10 §4, NFR-004).
    await testSql`
      update scenario_package_versions
         set status = 'confirmed', confirmed_at = now(), confirmed_by = ${fx.authorId}
       where id = ${fx.versionId}`
    expect(await codeOf(authoring.startGeneration(fx.author, fx.versionId))).toBe('VERSION_FROZEN')
    expect(await runRows(fx.versionId)).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------
// Resuming a pipeline that stopped partway (D-683)
// ---------------------------------------------------------------------------------------------

describe('startGeneration after a pipeline stopped partway', () => {
  it('resumes at the first step that has not succeeded rather than rewriting step 1', async () => {
    await authoring.startGeneration(fx.author, fx.versionId)
    await drain()

    // Rewind to the state a killed invocation leaves: steps 1 and 2 done, the rest never run. This
    // is what production produces on a real seed case, where the drain's budget runs out mid-run.
    await testSql`
      delete from generation_runs
       where package_version_id = ${fx.versionId}
         and step not in ('reskin_brief_stakeholders', 'documents')`

    const stakeholdersBefore = await testSql<{ id: string }[]>`
      select id from stakeholders where package_version_id = ${fx.versionId} order by id`
    expect(stakeholdersBefore.length).toBeGreaterThan(0)

    expect(await authoring.startGeneration(fx.author, fx.versionId)).toEqual({ started: true })
    await drain()

    // It picked up at step 3. Step 1 was not re-run, so nothing tried to delete a stakeholder a
    // document points at — the delete this used to attempt is what raised the foreign key error.
    const steps = (await runRows(fx.versionId)).map((row) => `${row.step}:${row.status}`)
    expect(steps.filter((row) => row.startsWith('reskin_brief_stakeholders'))).toEqual([
      'reskin_brief_stakeholders:succeeded',
    ])
    expect(steps).toContain('answer_space_fields:succeeded')
    expect(steps).toContain('readiness_items:succeeded')
    for (const row of await runRows(fx.versionId)) expect(row.error, row.step).toBeNull()

    // The stakeholders the documents were attributed to are the same rows, not replacements.
    const stakeholdersAfter = await testSql<{ id: string }[]>`
      select id from stakeholders where package_version_id = ${fx.versionId} order by id`
    expect(stakeholdersAfter.map((row) => row.id)).toEqual(stakeholdersBefore.map((row) => row.id))

    const status = await authoring.getGenerationStatus(fx.author, fx.versionId)
    expect(status.state).toBe('complete')
    expect(status.validation).toEqual({ ok: true, failures: [] })
  })
})

// ---------------------------------------------------------------------------------------------
// The retry (10 §5: "re-enqueues the same step with the failed rules in the prompt input")
// ---------------------------------------------------------------------------------------------

describe('a step that breaks its validation subset', () => {
  it('re-runs as pass 2 with the failed rule restated in the prompt', async () => {
    process.env.MOCK_GEN_FAIL_ONCE = 'documents'
    await authoring.startGeneration(fx.author, fx.versionId)
    await drain()

    const rows = await runRows(fx.versionId)
    const documents = rows.filter((row) => row.step === 'documents')
    expect(documents.map((row) => `${row.pass_number}:${row.status}`)).toEqual([
      '1:failed',
      '2:succeeded',
    ])
    expect(documents[0]?.failed_rules).toEqual(['STAKEHOLDER_NO_DOCUMENT'])

    // The channel, not the intention: the second rendered prompt has to carry the validator's own
    // sentence. `gen.ts` renders it under this heading and nothing else in the library does, and
    // the first prompt must not carry it — a step that always restated something would pass this
    // without the retry ever having been told anything.
    const documentPrompts = calls.filter((call) => call.promptName === 'gen-documents')
    expect(documentPrompts).toHaveLength(2)
    expect(documentPrompts[0]?.messages).not.toContain('RULES A PREVIOUS ATTEMPT BROKE')
    expect(documentPrompts[1]?.messages).toContain('RULES A PREVIOUS ATTEMPT BROKE')
    expect(documentPrompts[1]?.messages).toContain('no document in the Evidence Room')

    // The pipeline carried on afterwards, and the package is whole.
    expect(rows[rows.length - 1]).toMatchObject({ step: 'readiness_items', status: 'succeeded' })
    const status = await authoring.getGenerationStatus(fx.author, fx.versionId)
    expect(status.state).toBe('complete')
    expect(status.validation.ok).toBe(true)
    // 17 §3.2 counts every pass; the deepest retry is what `generation_max_pass` reports.
    const measures = await authoring.computeAuthoringMeasures(fx.orgId, fx.versionId)
    expect(measures.generationPasses).toBe(8)
    expect(measures.generationMaxPass).toBe(2)
  })

  it('is marked failed after the second pass, and the author is told', async () => {
    // Forced on both passes: the mock only stands down when `restatedRules` is empty, so keeping
    // the switch on through the retry is what makes the second pass fail too.
    process.env.MOCK_GEN_FAIL_ONCE = 'documents:always'
    await authoring.startGeneration(fx.author, fx.versionId)
    await drain()

    const rows = await runRows(fx.versionId)
    const documents = rows.filter((row) => row.step === 'documents')
    expect(documents.map((row) => `${row.pass_number}:${row.status}`)).toEqual([
      '1:failed',
      '2:failed',
    ])
    expect(documents[1]?.failed_rules).toEqual(['STAKEHOLDER_NO_DOCUMENT'])
    // The pipeline stops where it broke: nothing downstream of documents ever ran.
    expect(rows.some((row) => row.step === 'answer_space_fields')).toBe(false)

    const status = await authoring.getGenerationStatus(fx.author, fx.versionId)
    expect(status.state).toBe('failed')
    expect(status.steps.find((step) => step.step === 'documents')?.failedRules).toEqual([
      'STAKEHOLDER_NO_DOCUMENT',
    ])

    const notices = await notificationRows(fx.authorId)
    expect(notices.map((row) => row.type)).toEqual(['generation_failed'])
    expect(notices[0]?.payload).toMatchObject({ step: 'documents' })

    // The elements the failing pass wrote are still there: the author finishes it by hand (FR-194).
    const documentCount = await testSql<{ count: number }[]>`
      select count(*)::int as count from scenario_documents
       where package_version_id = ${fx.versionId}`
    expect(documentCount[0]?.count ?? 0).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------------------------
// Two starts at once (D-400: the row lock, not the singleton key)
// ---------------------------------------------------------------------------------------------

describe('a second concurrent start', () => {
  it('is refused by the version row lock, not by the queue', async () => {
    const [first, second] = await Promise.allSettled([
      authoring.startGeneration(fx.author, fx.versionId),
      authoring.startGeneration(fx.author, fx.versionId),
    ])
    const outcomes = [first, second].map((result) =>
      result.status === 'fulfilled'
        ? 'started'
        : isAppError(result.reason)
          ? result.reason.code
          : String(result.reason),
    )
    expect(outcomes.filter((outcome) => outcome === 'started')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome === 'GENERATION_ALREADY_RUNNING')).toHaveLength(1)

    await drain()
    const rows = await runRows(fx.versionId)
    // One pipeline: seven rows, one per step, and not a single step run twice.
    expect(rows).toHaveLength(7)
    expect(new Set(rows.map((row) => row.step)).size).toBe(7)

    // And a start once the pipeline has finished is admitted again — nothing is left latched.
    expect(await authoring.startGeneration(fx.author, fx.versionId)).toEqual({ started: true })
  })

  it('cannot have been the singleton key: the key does not deduplicate under this policy', async () => {
    // D-400, asserted rather than assumed. `singletonKeyFor.generate_package_step` gives both sends
    // the same key, and both come back with a job id, because the queues are created with the
    // default `standard` policy. If this ever starts returning null the guarantee moved and the
    // service's lock can be reconsidered — until then it is the only thing holding.
    const payload = {
      packageVersionId: fx.versionId,
      organizationId: fx.orgId,
      step: 'documents',
      passNumber: 1,
      restatedRules: [],
    }
    const a = await enqueue('generate_package_step', payload, { drain: false })
    const b = await enqueue('generate_package_step', payload, { drain: false })
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(a).not.toBe(b)

    // Both jobs run; the second finds the step's row already claimed and writes nothing more.
    await drain()
    const rows = await runRows(fx.versionId)
    expect(rows.filter((row) => row.step === 'documents' && row.pass_number === 1)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------------------------
// A duplicate job on a step that already stopped (D-551: "a duplicate job is a no-op", all four)
// ---------------------------------------------------------------------------------------------

describe('a redelivered job whose step has already finished', () => {
  it('does not re-run a failed step, so the retry stays one retry', async () => {
    // `claimStep` skipped `running` and `succeeded` and claimed the other two, so a redelivery of a
    // pass whose row said `failed` re-ran it: a third `documents` pass, another provider call,
    // another element set over the author's, a second `generation_failed`, and a breach of
    // `MAX_GENERATION_PASSES`. D-531 stated the guarantee for four statuses and kept it for two
    // (D-551).
    process.env.MOCK_GEN_FAIL_ONCE = 'documents:always'
    await authoring.startGeneration(fx.author, fx.versionId)
    await drain()

    const before = await runRows(fx.versionId)
    expect(
      before
        .filter((row) => row.step === 'documents')
        .map((row) => `${row.pass_number}:${row.status}`),
    ).toEqual(['1:failed', '2:failed'])
    const callsBefore = calls.length
    const noticesBefore = (await notificationRows(fx.authorId)).length
    expect(noticesBefore).toBe(1)

    // The redelivery pg-boss would make: the same payload, for the pass that failed.
    for (const passNumber of [1, 2]) {
      await enqueue(
        'generate_package_step',
        {
          packageVersionId: fx.versionId,
          organizationId: fx.orgId,
          step: 'documents',
          passNumber,
          restatedRules: [],
        },
        { drain: false },
      )
    }
    await drain()

    // Nothing moved: no new run row, no new pass, no provider call, no second notice.
    expect(await runRows(fx.versionId)).toEqual(before)
    expect(calls.length).toBe(callsBefore)
    expect((await notificationRows(fx.authorId)).length).toBe(noticesBefore)
  })

  it('does not re-run a succeeded step either', async () => {
    await authoring.startGeneration(fx.author, fx.versionId)
    await drain()
    const before = await runRows(fx.versionId)
    const callsBefore = calls.length

    await enqueue(
      'generate_package_step',
      {
        packageVersionId: fx.versionId,
        organizationId: fx.orgId,
        step: 'claims_and_states',
        passNumber: 1,
        restatedRules: [],
      },
      { drain: false },
    )
    await drain()

    expect(await runRows(fx.versionId)).toEqual(before)
    expect(calls.length).toBe(callsBefore)
  })
})

// ---------------------------------------------------------------------------------------------
// A step that died after claiming (D-550: the wedge, and both doors into it)
// ---------------------------------------------------------------------------------------------

/** The state a killed invocation leaves: one row, claimed, with nothing behind it any more. */
const wedge = async (
  versionId: string,
  values: { step: string; status: 'queued' | 'running'; agoMs: number },
): Promise<void> => {
  const at = new Date(Date.now() - values.agoMs)
  await testSql`
    insert into generation_runs (package_version_id, step, pass_number, status, started_at, created_at)
    values (${versionId}, ${values.step}::generation_step, 1, ${values.status}::job_status,
            ${values.status === 'running' ? at : null}, ${at})`
}

describe('a generation run whose worker no longer exists', () => {
  it('does not shut every door on the version for ever', async () => {
    // Door one: the process died between `claimStep` and `recordOutcome`. Nothing redelivers past
    // the retry limit, `claimStep` skipped a `running` row, and `scheduleDailyMaintenance` sweeps
    // nothing — so the row stood for ever and with it `GENERATION_ALREADY_RUNNING` on every start,
    // `running` on every status read, and a retry button the screen kept disabled.
    await wedge(fx.versionId, {
      step: 'claims_and_states',
      status: 'running',
      agoMs: 3 * 86_400_000,
    })
    expect(await codeOf(authoring.startGeneration(fx.author, fx.versionId))).toBe('no error')
    await drain()

    const status = await authoring.getGenerationStatus(fx.author, fx.versionId)
    expect(status.state).toBe('complete')
    const abandoned = (await runRows(fx.versionId)).filter(
      (row) => row.error === 'GENERATION_ABANDONED',
    )
    expect(abandoned).toHaveLength(1)
    expect(abandoned[0]).toMatchObject({ step: 'claims_and_states', status: 'failed' })
    // It is closed out as a failure with no rules, not as a rule the package broke (DATA-027).
    expect(abandoned[0]?.failed_rules).toEqual([])
  })

  it('is cleared by the status screen the author is already looking at', async () => {
    // The screen polls this read every few seconds, so it is the reading that is certainly made
    // about a wedged version — and it must not keep saying `running` about a step nobody is running.
    await wedge(fx.versionId, { step: 'documents', status: 'running', agoMs: 3 * 86_400_000 })
    expect(await authoring.getGenerationStatus(fx.author, fx.versionId)).toMatchObject({
      state: 'failed',
    })
    const rows = await runRows(fx.versionId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'failed', error: 'GENERATION_ABANDONED' })
  })

  it('clears a queued row whose enqueue never happened', async () => {
    // Door two: `enqueueAfterCommit` is not transactional with the row it follows, so a crash
    // between COMMIT and `boss.send` commits a `queued` row with no job behind it. No redelivery
    // will ever arrive for it, so a reclaim on redelivery alone would not have reached this one.
    await wedge(fx.versionId, { step: 'turn_and_probe', status: 'queued', agoMs: 3 * 86_400_000 })
    expect(
      await codeOf(authoring.regenerateElement(fx.author, fx.versionId, 'brief', '', {})),
    ).toBe('no error')
    const rows = await runRows(fx.versionId)
    expect(rows.find((row) => row.step === 'turn_and_probe')).toMatchObject({
      status: 'failed',
      error: 'GENERATION_ABANDONED',
    })
  })

  it('leaves a run that is merely young alone', async () => {
    // The other half of the property: a step claimed a minute ago has a worker and is not swept, so
    // the window can never make two workers race for one step.
    await wedge(fx.versionId, { step: 'documents', status: 'running', agoMs: 60_000 })
    expect(await codeOf(authoring.startGeneration(fx.author, fx.versionId))).toBe(
      'GENERATION_ALREADY_RUNNING',
    )
    expect(await authoring.getGenerationStatus(fx.author, fx.versionId)).toMatchObject({
      state: 'running',
    })
  })

  it('lets a late redelivery re-take an abandoned claim rather than skipping it', async () => {
    await wedge(fx.versionId, {
      step: 'reskin_brief_stakeholders',
      status: 'running',
      agoMs: 3 * 86_400_000,
    })
    await enqueue(
      'generate_package_step',
      {
        packageVersionId: fx.versionId,
        organizationId: fx.orgId,
        step: 'reskin_brief_stakeholders',
        passNumber: 1,
        restatedRules: [],
      },
      { drain: false },
    )
    await drain()

    const rows = await runRows(fx.versionId)
    const reskin = rows.filter((row) => row.step === 'reskin_brief_stakeholders')
    expect(reskin).toHaveLength(1)
    expect(reskin[0]).toMatchObject({ status: 'succeeded', pass_number: 1 })
    // And it carried the pipeline on, because it really did claim the step.
    expect(rows.some((row) => row.step === 'documents')).toBe(true)
  })
})

// ---------------------------------------------------------------------------------------------
// What "complete" means (D-553: the latest run of each step, not any run ever)
// ---------------------------------------------------------------------------------------------

describe('the pipeline state after a rewrite that stopped', () => {
  it('does not report complete when the last thing that ran failed', async () => {
    await authoring.startGeneration(fx.author, fx.versionId)
    await drain()
    expect((await authoring.getGenerationStatus(fx.author, fx.versionId)).state).toBe('complete')

    // A standalone document rewrite that fails both passes, on a version whose step 7 succeeded
    // once. `pipelineState` answered on "did the last step ever succeed", so the screen printed
    // "your draft is ready" over a row saying the rewrite stopped.
    process.env.MOCK_GEN_FAIL_ONCE = 'documents:always'
    const document = await testSql<{ id: string }[]>`
      select id from scenario_documents where package_version_id = ${fx.versionId}
       order by position limit 1`
    const documentId = document[0]?.id
    if (documentId === undefined) throw new Error('the generated package has no documents')
    await authoring.regenerateElement(fx.author, fx.versionId, 'document', documentId, {})
    await drain()

    const status = await authoring.getGenerationStatus(fx.author, fx.versionId)
    expect(status.steps.find((step) => step.step === 'documents')?.status).toBe('failed')
    expect(status.state).toBe('failed')
    // The last step's own row still says it succeeded — the state is about the pipeline, not it.
    expect(status.steps.find((step) => step.step === 'readiness_items')?.status).toBe('succeeded')
  })
})
