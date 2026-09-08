// Service of the `authoring` module (docs/tech/10-backend-spec-modules.md §5; 07-api-spec.md §6;
// 08-auth-authz.md §4; 11-llm-integration.md §2.1). AI-001's generation pipeline as seven jobs, the
// retry that restates the rule a pass broke, element regeneration, and FR-198's measures.
//
// Five rules this file is built on, and each of them is a thing that would otherwise go wrong.
//
//   1. **A confirmed version is never generated into.** The check is on the *write* — taken under
//      the version row's lock, inside the transaction that would do the writing — not only where
//      the button is. `startGeneration`, `regenerateElement` and every step of the job all take it.
//   2. **A step replaces only the *unconfirmed* elements of its type** (10 §5). An author who has
//      confirmed three documents and asks for the rest again keeps those three, with their
//      confirmation rows and their ids: the elements are reconciled by key through
//      `upsertElement`, so a regenerated element that already existed keeps the id every claim,
//      question and probe points at, and a confirmed one is not written at all.
//   3. **The retry restates the rule.** A failed pass records the rule *codes* on its
//      `generation_runs` row, and re-enqueues itself carrying the validator's own *sentences* — the
//      ones naming the elements at fault — which `gen.ts`'s `restatedRulesSection` renders at the
//      top of the second prompt. A blind retry would ask the same question again.
//   4. **A second concurrent start is harmless because of the row lock, not the queue's key.**
//      pg-boss applies a singleton key as a dedupe only under a `singleton`-family policy, and
//      every queue here is `standard`, so a second `send` makes a second job (D-400). What refuses
//      it is `lockVersionForGeneration` plus the unfinished-run check taken under it, and the same
//      lock is what makes a duplicate *job* a no-op.
//   5. **The seed case stays wrapped.** Nothing here interpolates a seed, a document body or a
//      claim text into a string. Every one of them reaches the model through a prompt's own input
//      schema, which wraps it in an `untrusted()` block (11 §2, §3, D-522).
//   6. **No package is wedged for ever by an instance that recycled.** A step that dies after
//      claiming leaves a `running` row, and a crash between a transaction's COMMIT and its
//      `boss.send` leaves a `queued` row with no job: either refuses every later start with
//      `GENERATION_ALREADY_RUNNING` and leaves the progress screen polling for ever. A row whose
//      worker cannot still exist — older than `GENERATION_RUN_STALE_AFTER_MS`, which is three
//      invocation lifetimes — is closed out as `failed` under the version lock by whichever of the
//      three doors an author next opens: `startGeneration`, `regenerateElement` or the status read
//      UI-042 polls. `claimStep` reads the same window, so a late redelivery re-takes an abandoned
//      step instead of skipping it, and the close-out is fenced on the claim's own timestamp so no
//      two workers can both finish one step (D-550).
//
// The module depends on `scenarios` through its `repository`, `validate`, `units` and `schema` and
// never through its `index.ts` or `service.ts`, because `scenarios.getPackageVersion` reads this
// module's public index for the generation record: one of the two edges has to be the deep one or
// the pair is a cycle (D-530).
import type { ZodType } from 'zod'
import { AppError, isAppError } from '@/lib/errors'
import { t } from '@/lib/i18n/t'
import { countWords } from '@/lib/words'
import { track } from '@/server/analytics/track'
import { requireAuthorOnPackage } from '@/server/auth/permissions'
import type { SessionUser } from '@/server/auth/types'
import { enqueueAfterCommit } from '@/server/jobs/enqueue'
import { getProvider } from '@/server/llm/registry'
import { notify } from '@/server/modules/notifications'
import { listMyInstitutions } from '@/server/modules/tenancy'
import * as scenarioRepo from '@/server/modules/scenarios/repository'
import type {
  CarriedValue,
  DefenseQuestionCondition,
  ElementTypeValue,
  FailureFamilyValue,
  ReadinessOption,
  ReskinLogEntry,
  StanceValue,
  VerificationPaths,
} from '@/server/modules/scenarios/schema'
import { elementUnits, type ElementUnit } from '@/server/modules/scenarios/units'
import { validatePackage, type ValidationRuleCode } from '@/server/modules/scenarios/validate'
import {
  failedRulesOf,
  generationAlreadyRunning,
  generationStepFailed,
  seedMissing,
} from './errors'
import { computeMeasures, type AuthoringMeasureValues } from './measures'
import * as repo from './repository'
import {
  GENERATION_RUN_ABANDONED,
  GENERATION_RUN_STALE_AFTER_MS,
  GENERATION_STEPS,
  GenerationStepSchema,
  MAX_GENERATION_PASSES,
  type AuthoringMeasures,
  type GenerationRunView,
  type GenerationStatusView,
  type GenerationStepValue,
  type RegenerateElementInput,
  type RegenerateElementView,
  type StartGenerationView,
} from './schema'
import {
  GENERATION_STEP_DEFINITIONS,
  GENERATION_STEP_ORDER,
  nextStep,
  stepOwningElement,
  type StepSource,
} from './steps'

export { noItemNamesAClaim } from './checks'
export {
  WARRANTED_STANCE_RULES,
  explainWarrantedStance,
  isStance,
  proposeWarrantedStance,
} from './warranted-stance'
export type { ClaimEcho, ClaimEchoCheck, CheckedClaim, CheckedReadinessItem } from './checks'
export type {
  StanceProposalClaim,
  StanceProposalState,
  WarrantedStanceProposal,
  WarrantedStanceRule,
} from './warranted-stance'

// ---------------------------------------------------------------------------------------------
// Failures that carry no module code of their own
// ---------------------------------------------------------------------------------------------

/** A version outside the actor's institutions answers NOT_FOUND, never FORBIDDEN (07 §1, 08 §4). */
function notFound(what: string): never {
  throw new AppError('NOT_FOUND', `That ${what} no longer exists.`)
}

/** The same code and the same sentence `scenarios` refuses a frozen version with (10 §4, NFR-004). */
function versionFrozen(): never {
  throw new AppError('VERSION_FROZEN')
}

// ---------------------------------------------------------------------------------------------
// Resolving a version to its tenant (the walk `scenarios` makes, for the same reason)
// ---------------------------------------------------------------------------------------------

type VersionScope = { tenantId: string; version: scenarioRepo.VersionFull }

async function tenantsOf(actor: SessionUser): Promise<string[]> {
  const institutions = await listMyInstitutions(actor)
  const ids = institutions.map((institution) => institution.id)
  const active = actor.activeOrganizationId
  if (active && ids.includes(active)) return [active, ...ids.filter((id) => id !== active)]
  return ids
}

async function resolveVersion(actor: SessionUser, versionId: string): Promise<VersionScope> {
  for (const tenantId of await tenantsOf(actor)) {
    const version = await scenarioRepo.findVersionFull(tenantId, versionId)
    if (version) return { tenantId, version }
  }
  notFound('package version')
}

/**
 * The seat 08 §4 gives "Create package from seed; run generation": an `instructor` or a
 * `scenario_author` of the package's institution, which is also the only way in for a platform
 * editor (08 §5). `requireAuthorOnPackage` resolves the institution itself, so an actor who is a
 * member of no institution never gets past `resolveVersion`.
 */
async function requireGenerationAuthor(
  actor: SessionUser,
  versionId: string,
): Promise<VersionScope> {
  const scope = await resolveVersion(actor, versionId)
  await requireAuthorOnPackage(actor, scope.version.packageId)
  return scope
}

// ---------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------

const isoOrNull = (value: Date | null): string | null =>
  value === null ? null : value.toISOString()

const numberOrNull = (value: string | null): number | null =>
  value === null ? null : Number(value)

function toRunView(row: repo.GenerationRun): GenerationRunView {
  return {
    id: row.id,
    step: row.step,
    passNumber: row.passNumber,
    status: row.status,
    provider: row.provider,
    model: row.model,
    promptVersion: row.promptVersion,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    costEstimateUsd: numberOrNull(row.costEstimateUsd),
    failedRules: row.failedRules,
    error: row.error,
    startedAt: isoOrNull(row.startedAt),
    finishedAt: isoOrNull(row.finishedAt),
  }
}

/**
 * Every run of every step of this version, newest first.
 *
 * The one function `scenarios` calls into this module (10 §4's package view carries the authoring
 * record and FR-198's generation counters). It takes no actor because its caller has already
 * resolved the version in the actor's institution and decided who may read it.
 */
export async function listGenerationRunsForVersion(
  versionId: string,
): Promise<GenerationRunView[]> {
  const rows = await repo.listGenerationRuns(versionId)
  return rows.map(toRunView)
}

// ---------------------------------------------------------------------------------------------
// Abandoned runs (D-550)
// ---------------------------------------------------------------------------------------------

/** The instant before which an unfinished run's worker cannot still exist (`schema.ts`). */
const staleBefore = (): Date => new Date(Date.now() - GENERATION_RUN_STALE_AFTER_MS)

/**
 * Closes out the version's abandoned runs, under the lock the caller already holds.
 *
 * Rule 6 of this file. Every door into the pipeline passes through here first — the two starts and
 * the status read — so a version whose step died mid-flight is unwedged by the next thing an author
 * does to it, rather than by a sweep that would have to be scheduled, given a queue and a handler,
 * and then trusted to have run. It is the same shape the run clock takes (PRD §7.11, and the
 * standing rule in CLAUDE.md): the state is a server timestamp materialised lazily on read.
 *
 * The row is closed as `failed`, never re-enqueued. A re-enqueue driven by a page refresh is an
 * unbounded retry of work that may be failing deterministically, and D-541 already shipped the
 * control an author presses next: the stopped row's "Run generation again".
 */
async function reclaimAbandonedRuns(
  versionId: string,
  tx: scenarioRepo.Tx,
): Promise<repo.GenerationRun[]> {
  return repo.failAbandonedGenerationRuns(versionId, staleBefore(), GENERATION_RUN_ABANDONED, tx)
}

// ---------------------------------------------------------------------------------------------
// startGeneration (AI-001, FR-191)
// ---------------------------------------------------------------------------------------------

/**
 * Starts the pipeline at step 1 (10 §5). The version must be a draft and must have a seed record —
 * step 1 is the only step given the seed text (11 §2.1), so without one there is nothing to
 * re-skin — and no step of it may already be queued or running.
 *
 * The refusal and the enqueue happen under the version row's write lock, which is what makes two
 * simultaneous starts one start: the second waits for the first to commit, finds the `queued` row
 * it wrote, and answers `GENERATION_ALREADY_RUNNING`. The queue's singleton key does not do this
 * (D-400), and the job's own claim takes the same lock so a duplicate job is a no-op as well.
 */
export async function startGeneration(
  actor: SessionUser,
  versionId: string,
): Promise<StartGenerationView> {
  const scope = await requireGenerationAuthor(actor, versionId)

  await repo.withTransaction(async (tx) => {
    const locked = await repo.lockVersionForGeneration(scope.tenantId, versionId, tx)
    if (!locked) notFound('package version')
    if (locked.status !== 'draft') versionFrozen()
    const seed = await scenarioRepo.findVersionFull(scope.tenantId, versionId, tx)
    if (!seed?.seedRecord) seedMissing()

    // Rule 6: a step whose worker died left a row that refuses this start for ever (D-550).
    await reclaimAbandonedRuns(versionId, tx)
    const unfinished = await repo.findUnfinishedGenerationRun(versionId, tx)
    if (unfinished) {
      generationAlreadyRunning({ step: unfinished.step, passNumber: unfinished.passNumber })
    }

    await repo.insertGenerationRun(
      {
        packageVersionId: versionId,
        step: GENERATION_STEP_ORDER[0],
        passNumber: 1,
        status: 'queued',
      },
      tx,
    )
    await enqueueAfterCommit(tx, 'generate_package_step', {
      packageVersionId: versionId,
      organizationId: scope.tenantId,
      step: GENERATION_STEP_ORDER[0],
      passNumber: 1,
      restatedRules: [],
    })
  })

  return { started: true }
}

// ---------------------------------------------------------------------------------------------
// regenerateElement (FR-194, UI-043)
// ---------------------------------------------------------------------------------------------

/**
 * Re-runs the step that owns one element (10 §5). Documents, claims, questions and items are
 * regenerated as a set — that is what their step writes — and a single element is replaced by key,
 * which the reconciliation below does for free.
 *
 * The element named here has to be *unconfirmed*. An author regenerates an element by rejecting it
 * first (UI-043), and a step that overwrote a confirmed element would destroy the review FR-192
 * exists to require; refusing is the same rule read from the other side, and it costs the author
 * one press.
 */
export async function regenerateElement(
  actor: SessionUser,
  versionId: string,
  elementType: ElementTypeValue,
  elementId: string,
  input: RegenerateElementInput,
): Promise<RegenerateElementView> {
  const scope = await requireGenerationAuthor(actor, versionId)
  if (scope.version.status !== 'draft') versionFrozen()

  const step = stepOwningElement(elementType)
  if (step === null) {
    throw new AppError(
      'VALIDATION_ERROR',
      'That element is not one a generation step writes; edit it in the workspace instead.',
      { details: { elementType } },
    )
  }

  const unit = findUnit(scope.version, elementType, elementId)
  if (!unit) notFound('element')
  const confirmations = await repo.listConfirmations(versionId)
  if (standingDecisions(confirmations).confirmed.has(unitKey(unit))) {
    throw new AppError(
      'CONFLICT',
      'That element is confirmed. Reject it first, and the regeneration will replace it.',
      { details: { elementType, elementId } },
    )
  }

  const run = await repo.withTransaction(async (tx) => {
    const locked = await repo.lockVersionForGeneration(scope.tenantId, versionId, tx)
    if (!locked) notFound('package version')
    if (locked.status !== 'draft') versionFrozen()

    await reclaimAbandonedRuns(versionId, tx)
    const unfinished = await repo.findUnfinishedGenerationRun(versionId, tx)
    if (unfinished) {
      generationAlreadyRunning({ step: unfinished.step, passNumber: unfinished.passNumber })
    }
    const queued = await repo.insertGenerationRun(
      { packageVersionId: versionId, step, passNumber: 1, status: 'queued' },
      tx,
    )
    // After the commit, never inside it. `enqueue` kicks a drain when JOBS_DRAIN_ON_ENQUEUE is on
    // (D-012), and a drain that started here would run the step's own job while this transaction
    // still held the version row's lock — the job takes that same lock to claim its step, so the
    // request would wait on a lock only the request can release. `enqueueAfterCommit` is the
    // enqueue every write in this module makes, for this reason (D-533).
    await enqueueAfterCommit(tx, 'generate_package_step', {
      packageVersionId: versionId,
      organizationId: scope.tenantId,
      step,
      passNumber: 1,
      // The author's own sentence about what is wrong travels the channel a failed rule travels:
      // from the model's side they are the same thing, a rule this answer has to satisfy that the
      // last one did not (`gen.ts` `restatedRulesSection`).
      restatedRules: input.restatedRule === undefined ? [] : [input.restatedRule],
      // The step is a *re*-run, so it must not carry the pipeline on to step 2 and rewrite
      // everything downstream of the element the author asked about.
      standalone: true,
    })
    return queued
  })

  // 07 §6 calls this `jobId`, and it is the `generation_runs` row rather than the pg-boss job: the
  // queue's id does not exist until after the transaction that has to guard the enqueue has
  // committed, and this is the id the status screen addresses the work by anyway (D-533).
  return { jobId: run.id, step }
}

// ---------------------------------------------------------------------------------------------
// getGenerationStatus (UI-042)
// ---------------------------------------------------------------------------------------------

/** The seven steps with what has happened to each, and the package's rule report (07 §6). */
export async function getGenerationStatus(
  actor: SessionUser,
  versionId: string,
): Promise<GenerationStatusView> {
  // 07 §6 gives this row to "Auth, Editor" and nobody else: it reports which package rules the
  // draft still breaks, which is where the defects are.
  const scope = await requireGenerationAuthor(actor, versionId)

  // Rule 6 (D-550). UI-042 polls this every few seconds while a pipeline runs, so it is the one
  // read that is certainly made about a wedged version — and the write is taken only when there is
  // something to close out, which keeps the poll a pure read on every ordinary pass.
  let rows = await repo.listGenerationRuns(versionId)
  if (rows.some(isAbandoned)) {
    await repo.withTransaction(async (tx) => {
      const locked = await repo.lockVersionForGeneration(scope.tenantId, versionId, tx)
      if (!locked) return
      await reclaimAbandonedRuns(versionId, tx)
    })
    rows = await repo.listGenerationRuns(versionId)
  }
  const runs = rows.map(toRunView)

  // Newest first from the repository, so the last row per step is the one to show.
  const latestByStep = new Map<GenerationStepValue, GenerationRunView>()
  for (const run of runs) if (!latestByStep.has(run.step)) latestByStep.set(run.step, run)

  const steps = GENERATION_STEP_ORDER.map((step) => {
    const run = latestByStep.get(step)
    return {
      step,
      status: run?.status ?? ('queued' as const),
      passNumber: run?.passNumber ?? 1,
      inputTokens: run?.inputTokens ?? null,
      outputTokens: run?.outputTokens ?? null,
      costEstimateUsd: run?.costEstimateUsd ?? null,
      failedRules: run?.failedRules ?? [],
      error: run?.error ?? null,
      startedAt: run?.startedAt ?? null,
      finishedAt: run?.finishedAt ?? null,
    }
  })

  const validation = validatePackage(scope.version)
  return {
    packageVersionId: versionId,
    packageId: scope.version.packageId,
    version: scope.version.version,
    state: pipelineState(runs),
    steps,
    runs,
    validation: { ok: validation.ok, failures: validation.failures.map((row) => row.code) },
  }
}

/** A `queued` or `running` row whose worker cannot still exist (D-550). */
function isAbandoned(run: repo.GenerationRun): boolean {
  if (run.status !== 'queued' && run.status !== 'running') return false
  return (run.startedAt ?? run.createdAt).getTime() < staleBefore().getTime()
}

/**
 * The pipeline's state, from the *latest* run of each step.
 *
 * "Any run of the last step ever succeeded" was the old reading, and it answered `complete` on a
 * version whose most recent work stopped: a full pipeline followed by a document rewrite that
 * failed both passes reported `complete` while the documents row said `failed` and the rule report
 * said `ok: false`, so UI-042 printed "your draft is ready" over a row saying it was not. A screen
 * that says a thing arrived when it did not is worse than one that says nothing (D-549, D-553).
 */
function pipelineState(runs: readonly GenerationRunView[]): GenerationStatusView['state'] {
  if (runs.length === 0) return 'not_started'
  if (runs.some((run) => run.status === 'queued' || run.status === 'running')) return 'running'

  // Newest first from the repository, so the first row seen per step is that step's latest.
  const latestByStep = new Map<GenerationStepValue, GenerationRunView>()
  for (const run of runs) if (!latestByStep.has(run.step)) latestByStep.set(run.step, run)

  const last = GENERATION_STEP_ORDER.at(-1)
  if (last === undefined || latestByStep.get(last)?.status !== 'succeeded') return 'failed'
  for (const run of latestByStep.values()) if (run.status !== 'succeeded') return 'failed'
  return 'complete'
}

// ---------------------------------------------------------------------------------------------
// computeAuthoringMeasures (FR-198)
// ---------------------------------------------------------------------------------------------

/**
 * 10 §5's five measures for one version. No actor: the package view and the `package_confirmed`
 * event both call it about a version their own caller has already resolved.
 */
export async function computeAuthoringMeasures(
  tenantId: string,
  versionId: string,
): Promise<AuthoringMeasures> {
  const version = await scenarioRepo.findVersionFull(tenantId, versionId)
  if (!version) notFound('package version')
  const [confirmations, runs] = await Promise.all([
    repo.listConfirmations(versionId),
    repo.listGenerationRuns(versionId),
  ])
  const measured: AuthoringMeasureValues = computeMeasures({
    units: elementUnits(version),
    decisions: confirmations,
    runs,
    seedCreatedAt: version.seedRecord?.createdAt ?? null,
    confirmedAt: version.confirmedAt,
  })
  return {
    seedToConfirmedMs: measured.seedToConfirmedMs,
    editRate: measured.editRate,
    rejectedShare: measured.rejectedShare,
    generationPasses: measured.generationPasses,
    generationMaxPass: measured.generationMaxPass,
    reviewMsPerElement: measured.reviewMsPerElement,
    elementsCount: measured.elementsCount,
    reviewMsTotal: measured.reviewMsTotal,
  }
}

// ---------------------------------------------------------------------------------------------
// The decisions that stand on an element (10 §4: an author's edit is their confirmation)
// ---------------------------------------------------------------------------------------------

const unitKey = (unit: ElementUnit): string => `${unit.elementType}:${unit.elementId ?? ''}`

type StandingDecisions = {
  /** Addresses (`document:<id>`, `brief:`) whose latest decision confirms the element. */
  confirmed: ReadonlySet<string>
  /** The element ids among them: what a step's key plan sets aside. */
  confirmedIds: ReadonlySet<string>
  /** The singleton types among them; their confirmation rows carry a null element id (06 §3.3). */
  confirmedSingletons: ReadonlySet<ElementTypeValue>
}

function standingDecisions(rows: readonly repo.ElementConfirmation[]): StandingDecisions {
  const latest = new Map<string, repo.ElementConfirmation>()
  for (const row of rows) {
    const key = `${row.elementType}:${row.elementId ?? ''}`
    const seen = latest.get(key)
    if (!seen || seen.revision < row.revision) latest.set(key, row)
  }
  const confirmed = new Set<string>()
  const confirmedIds = new Set<string>()
  const confirmedSingletons = new Set<ElementTypeValue>()
  for (const [key, row] of latest) {
    if (row.decision !== 'confirmed' && row.decision !== 'edited') continue
    confirmed.add(key)
    if (row.elementId === null) confirmedSingletons.add(row.elementType)
    else confirmedIds.add(row.elementId)
  }
  return { confirmed, confirmedIds, confirmedSingletons }
}

function findUnit(
  version: scenarioRepo.VersionFull,
  elementType: ElementTypeValue,
  elementId: string,
): ElementUnit | undefined {
  const units = elementUnits(version)
  const singleton = units.find(
    (unit) => unit.elementType === elementType && unit.elementId === null,
  )
  if (singleton) return singleton
  return units.find((unit) => unit.elementType === elementType && unit.elementId === elementId)
}

// ---------------------------------------------------------------------------------------------
// runGenerationStep: the job (10 §5)
// ---------------------------------------------------------------------------------------------

export type RunGenerationStepInput = {
  packageVersionId: string
  organizationId: string
  step: string
  passNumber: number
  restatedRules?: string[]
  /** A regeneration re-runs one step and stops; the pipeline carries on to the next (10 §5). */
  standalone?: boolean
}

export type GenerationStepOutcome = {
  versionId: string
  step: GenerationStepValue
  passNumber: number
  /** `skipped` is the duplicate-job case the version lock exists to make harmless (D-400). */
  outcome: 'succeeded' | 'retrying' | 'failed' | 'skipped'
  failedRules: string[]
  durationMs: number
}

/**
 * One step of the pipeline. Never throws for a domain outcome — a failed step is a state the
 * generation screen has a row for, and a queue retry would only reach it again — so a throw from
 * here is what it is in `score_run`: the version could not be read at all.
 */
export async function runGenerationStep(
  payload: RunGenerationStepInput,
): Promise<GenerationStepOutcome> {
  const startedAt = Date.now()
  const step = GenerationStepSchema.parse(payload.step)
  const { packageVersionId: versionId, organizationId: tenantId } = payload
  const restatedRules = payload.restatedRules ?? []
  const definition = GENERATION_STEP_DEFINITIONS[step]

  const claimed = await claimStep(tenantId, versionId, step, payload.passNumber)
  if (claimed.kind !== 'claimed') {
    return {
      versionId,
      step,
      passNumber: payload.passNumber,
      outcome: 'skipped',
      failedRules: [],
      durationMs: Date.now() - startedAt,
    }
  }
  const run = claimed.run
  const version = claimed.version
  const claimedAt = claimed.claimedAt

  let failedRules: string[] = []
  let failedMessages: string[] = []
  let error: string | null = null
  let retryable = true
  let usage = { inputTokens: 0, outputTokens: 0 }
  let provider = ''
  let model = ''

  try {
    const rendered = definition.prompt.render(
      definition.buildInput(sourceOf(version), restatedRules),
    )
    const result = await getProvider().structured<unknown>({
      feature: 'generation',
      promptName: definition.prompt.name,
      promptVersion: definition.prompt.version,
      messages: rendered.messages,
      // The validated input, not the object handed to `render`: the untrusted fields have been
      // normalised by then, so this is the text the model actually read (D-265).
      promptInput: rendered.input,
      temperature: 0.2,
      schema: definition.prompt.output as ZodType<unknown>,
      schemaName: `${definition.prompt.name}-output`,
      context: { packageVersionId: versionId, requestId: run.id },
    })
    usage = result.usage
    provider = result.provider
    model = result.model

    const failures = await writeAndValidate(tenantId, versionId, step, result.value)
    if (failures.length > 0) {
      failedRules = failures.map((failure) => failure.code)
      failedMessages = failures.map((failure) => failure.message)
      generationStepFailed(failedRules)
    }
  } catch (thrown) {
    failedRules = failedRules.length > 0 ? failedRules : failedRulesOf(thrown)
    error = messageOf(thrown)
    retryable = generationRetryable(thrown)
  }

  const durationMs = Date.now() - startedAt
  const outcome = await recordOutcome({
    tenantId,
    versionId,
    step,
    run,
    claimedAt,
    passNumber: payload.passNumber,
    standalone: payload.standalone === true,
    failedRules,
    failedMessages,
    error,
    retryable,
    usage,
    provider,
    model,
    durationMs,
  })

  track(
    'generation_step_completed',
    {
      package_id: version.packageId,
      package_version_id: versionId,
      version: version.version,
      generation_run_id: run.id,
      step,
      pass_number: payload.passNumber,
      status: outcome === 'succeeded' ? 'succeeded' : 'failed',
      duration_ms: durationMs,
      failed_rules: failedRules,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      provider: providerName(provider),
    },
    // A job has no session: the event is the institution's, and 17 §1 rule 4 hashes a person's id
    // rather than sending one, so there is nothing here a null loses.
    { userId: null, organizationId: tenantId },
  )

  return { versionId, step, passNumber: payload.passNumber, outcome, failedRules, durationMs }
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * Whether one more pass of this step could go differently (11 §3, step 14.2).
 *
 * 10 §5 gives every step exactly one retry, and it is a retry of the *model's answer*: the second
 * pass is told which rules the first one broke and asked to write the step again. Two failures are
 * not answers at all and a second pass cannot change either of them — an exhausted token budget will
 * still be exhausted, and a circuit that is open fails fast by design. Retrying them spends a second
 * job, a second minute of the author's wait and, for the budget case, puts the sentence "The
 * assistant budget for this period has been used up" into the next prompt as a rule the model is
 * asked to satisfy. So the step fails once, visibly, with the reason on the row that the generation
 * screen already renders — which is exactly what §3 asks generation to do (D-656).
 */
function generationRetryable(error: unknown): boolean {
  if (!isAppError(error)) return true
  return error.code !== 'LLM_BUDGET_EXCEEDED' && error.code !== 'LLM_CIRCUIT_OPEN'
}

/** `llm_calls.provider` is one of three names; anything else is the mock answering (11 §1.1). */
function providerName(value: string): 'mock' | 'openai-compatible' | 'anthropic' {
  if (value === 'openai-compatible' || value === 'anthropic') return value
  return 'mock'
}

type ClaimResult =
  | {
      kind: 'claimed'
      run: repo.GenerationRun
      version: scenarioRepo.VersionFull
      /** The fence this claim wrote; `recordOutcome` closes the row out only while it stands. */
      claimedAt: Date
    }
  | { kind: 'skipped' }

/**
 * Takes the step's `generation_runs` row under the version's write lock.
 *
 * This is the whole of what makes a second job for the same step harmless: the loser of the race
 * finds a row it may not claim and returns without calling the provider or writing an element.
 * `singletonKeyFor` does not do this — D-400 — and neither does the unique index on
 * `(package_version_id, step, pass_number)`, which is not unique.
 *
 * Exactly one status is claimable, and the reason each of the other three is not is different:
 *
 *   * `queued` — the work this job was sent for. Claim it.
 *   * `running` — another worker holds it, *unless* the row is abandoned: a claim older than
 *     `GENERATION_RUN_STALE_AFTER_MS` cannot have a worker behind it (D-550), so a redelivery that
 *     arrives after the window re-takes the step rather than skipping it for ever.
 *   * `succeeded` — done. A duplicate job must not run it again.
 *   * `failed` — **also done.** 10 §5 gives a step one automatic retry and no more, and the retry is
 *     its own row at `passNumber + 1`. Re-claiming a failed row gave a redelivered job a third pass:
 *     another provider call, another element set written over the author's, another
 *     `generation_failed` notice and e-mail, and `MAX_GENERATION_PASSES` breached. D-531's
 *     guarantee — "a duplicate job is a no-op" — held for two of the four statuses (D-551).
 */
async function claimStep(
  tenantId: string,
  versionId: string,
  step: GenerationStepValue,
  passNumber: number,
): Promise<ClaimResult> {
  return repo.withTransaction(async (tx): Promise<ClaimResult> => {
    const locked = await repo.lockVersionForGeneration(tenantId, versionId, tx)
    if (!locked) return { kind: 'skipped' }
    const version = await scenarioRepo.findVersionFull(tenantId, versionId, tx)
    if (!version) return { kind: 'skipped' }

    // Rule 1: a confirmed version is frozen. The queued row is closed out so the screen does not
    // sit on "running" for a pipeline that can never move again.
    if (version.status !== 'draft') {
      const queued = await repo.findGenerationRun(versionId, step, passNumber, tx)
      if (queued && (queued.status === 'queued' || queued.status === 'running')) {
        await repo.updateGenerationRun(
          queued.id,
          { status: 'failed', error: 'VERSION_FROZEN', finishedAt: new Date() },
          tx,
        )
      }
      return { kind: 'skipped' }
    }

    const existing = await repo.findGenerationRun(versionId, step, passNumber, tx)
    if (existing && existing.status !== 'queued' && !isAbandoned(existing)) {
      return { kind: 'skipped' }
    }
    const startedAt = new Date()
    const run = existing
      ? await repo.updateGenerationRun(
          existing.id,
          { status: 'running', startedAt, finishedAt: null, error: null, failedRules: [] },
          tx,
        )
      : await repo.insertGenerationRun(
          { packageVersionId: versionId, step, passNumber, status: 'running', startedAt },
          tx,
        )
    if (!run) return { kind: 'skipped' }
    return { kind: 'claimed', run, version, claimedAt: startedAt }
  })
}

type RecordOutcomeInput = {
  tenantId: string
  versionId: string
  step: GenerationStepValue
  run: repo.GenerationRun
  /** The fence `claimStep` wrote; the close-out is refused if the claim no longer stands (D-550). */
  claimedAt: Date
  passNumber: number
  standalone: boolean
  failedRules: string[]
  failedMessages: string[]
  error: string | null
  /** False when one more pass cannot go differently; see `generationRetryable` (D-656). */
  retryable: boolean
  usage: { inputTokens: number; outputTokens: number }
  provider: string
  model: string
  durationMs: number
}

/**
 * Closes the run out and decides what happens next (10 §5): the next step on success, one more pass
 * of this one on a first failure, and the `generation_failed` notice on a second.
 *
 * The next step's `generation_runs` row is written in the same transaction as its enqueue, which is
 * what keeps `findUnfinishedGenerationRun` true for the whole pipeline: without it there is a
 * window between two steps in which a second `startGeneration` would be admitted.
 */
async function recordOutcome(input: RecordOutcomeInput): Promise<GenerationStepOutcome['outcome']> {
  const { tenantId, versionId, step, run, passNumber } = input
  const finishedAt = new Date()
  const following = nextStep(step)

  return repo.withTransaction(async (tx) => {
    const locked = await repo.lockVersionForGeneration(tenantId, versionId, tx)

    // The version can be confirmed between the write and this close-out, and `markGenerated` writes
    // a column the `package_frozen` trigger family defends: the trigger would roll this whole
    // transaction back, leaving the row `running` for ever and feeding exactly the wedge rule 6
    // exists to prevent. So the freeze is read here, under the lock, and closes the row out as the
    // failure it is (D-550).
    const frozen = locked !== undefined && locked.status !== 'draft'
    const failed = frozen || input.failedRules.length > 0 || input.error !== null

    const closed = await repo.closeClaimedGenerationRun(
      run.id,
      input.claimedAt,
      {
        status: failed ? 'failed' : 'succeeded',
        provider: input.provider === '' ? null : input.provider,
        model: input.model === '' ? null : input.model,
        promptVersion: String(GENERATION_STEP_DEFINITIONS[step].prompt.version),
        inputTokens: input.usage.inputTokens,
        outputTokens: input.usage.outputTokens,
        failedRules: frozen ? [] : input.failedRules,
        // A rule failure is reported by its rules and nothing else, so the generation screen shows
        // the author what the package needs rather than the sentence the runner threw. `error` is
        // for the failures that have no rule to name: a provider that did not answer, an output the
        // schema refused, a version confirmed underneath the step (DATA-027).
        error: frozen ? 'VERSION_FROZEN' : input.failedRules.length > 0 ? null : input.error,
        finishedAt,
      },
      tx,
    )

    // The claim was reclaimed as abandoned while this worker was in the provider call, and another
    // one holds the step now. Closing it out from here would enqueue a step twice.
    if (!closed) return 'skipped'
    // A frozen version's pipeline stops where it is: no `markGenerated`, no next step, no notice.
    if (frozen) return 'failed'

    if (!failed) {
      // 10 §5: step 1 is where the version learns which model wrote it (07 §6 `authoringRecord`).
      if (input.model !== '') {
        await repo.markGenerated(
          tenantId,
          versionId,
          { generationModel: input.model, generatedAt: finishedAt },
          tx,
        )
      }
      // A regeneration re-runs one step and stops there: it must not carry the pipeline on and
      // rewrite everything downstream of the element the author asked about, and it is not a
      // generation completing, so it sends no notice — the author is on the screen watching it.
      if (input.standalone) return 'succeeded'
      if (following === null) {
        await notifyComplete(tenantId, versionId, tx)
        return 'succeeded'
      }
      await repo.insertGenerationRun(
        { packageVersionId: versionId, step: following, passNumber: 1, status: 'queued' },
        tx,
      )
      await enqueueAfterCommit(tx, 'generate_package_step', {
        packageVersionId: versionId,
        organizationId: tenantId,
        step: following,
        passNumber: 1,
        restatedRules: [],
      })
      return 'succeeded'
    }

    // 10 §5: exactly one more pass, and it is told what the last one broke. The messages rather
    // than the codes, because the validator's sentence names the elements at fault (D-522).
    if (input.retryable && passNumber < MAX_GENERATION_PASSES) {
      await repo.insertGenerationRun(
        { packageVersionId: versionId, step, passNumber: passNumber + 1, status: 'queued' },
        tx,
      )
      await enqueueAfterCommit(tx, 'generate_package_step', {
        packageVersionId: versionId,
        organizationId: tenantId,
        step,
        passNumber: passNumber + 1,
        restatedRules:
          input.failedMessages.length > 0
            ? input.failedMessages
            : input.error === null
              ? []
              : [input.error],
        ...(input.standalone ? { standalone: true } : {}),
      })
      return 'retrying'
    }

    await notifyFailed(tenantId, versionId, step, input.failedRules, tx)
    return 'failed'
  })
}

// ---------------------------------------------------------------------------------------------
// The two notices (10 §5, 10 §15, SYS-010)
// ---------------------------------------------------------------------------------------------

/**
 * The package's own author, and nobody else.
 *
 * `generation_complete` and `generation_failed` are both delivered by e-mail as well as in the app
 * (10 §15), so the recipient list is the one person who asked for the package to exist rather than
 * every instructor in the institution.
 */
async function notifyComplete(
  tenantId: string,
  versionId: string,
  tx: scenarioRepo.Tx,
): Promise<void> {
  const version = await scenarioRepo.findVersionFull(tenantId, versionId, tx)
  if (!version) return
  const report = validatePackage(version)
  await notify(tx, {
    userIds: [version.package.createdBy],
    type: 'generation_complete',
    title: t('notifications.generationComplete.title'),
    body: report.ok
      ? t('notifications.generationComplete.bodyValid')
      : t('notifications.generationComplete.bodyWithFailures', { count: report.failures.length }),
    link: `/packages/${version.packageId}/versions/${versionId}/generation`,
    payload: {
      packageId: version.packageId,
      packageVersionId: versionId,
      ok: report.ok,
      failures: report.failures.map((failure) => failure.code),
    },
    orgId: tenantId,
  })
}

async function notifyFailed(
  tenantId: string,
  versionId: string,
  step: GenerationStepValue,
  failedRules: readonly string[],
  tx: scenarioRepo.Tx,
): Promise<void> {
  const version = await scenarioRepo.findVersionFull(tenantId, versionId, tx)
  if (!version) return
  await notify(tx, {
    userIds: [version.package.createdBy],
    type: 'generation_failed',
    title: t('notifications.generationFailed.title'),
    body: t('notifications.generationFailed.body'),
    link: `/packages/${version.packageId}/versions/${versionId}/generation`,
    payload: {
      packageId: version.packageId,
      packageVersionId: versionId,
      step,
      failedRules: [...failedRules],
    },
    orgId: tenantId,
  })
}

// ---------------------------------------------------------------------------------------------
// What a step is given
// ---------------------------------------------------------------------------------------------

/** The version as the seven prompts read it (`steps.ts` `StepSource`). */
function sourceOf(version: scenarioRepo.VersionFull): StepSource {
  const failureFamiliesByClaimId = new Map<string, string[]>()
  for (const variant of version.variants) {
    for (const state of variant.claimStates) {
      if (state.failureFamily === null) continue
      const list = failureFamiliesByClaimId.get(state.claimId) ?? []
      if (!list.includes(state.failureFamily)) list.push(state.failureFamily)
      failureFamiliesByClaimId.set(state.claimId, list)
    }
  }

  return {
    conceptSet: version.conceptSet,
    brief: version.brief,
    seed: version.seedRecord
      ? { seedText: version.seedRecord.seedText, licenseTerms: version.seedRecord.licenseTerms }
      : null,
    reskinLog: version.seedRecord?.reskinLog ?? [],
    stakeholders: version.stakeholders.map((row) => ({
      key: row.key,
      name: row.name,
      roleTitle: row.roleTitle,
      positionStatement: row.positionStatement,
    })),
    documents: version.documents.map((row) => ({
      key: row.key,
      title: row.title,
      author: row.author,
      datedOn: row.datedOn,
      role: row.role,
      body: row.body,
    })),
    positions: version.answerSpacePositions.map((row) => ({
      key: row.key,
      kind: row.kind,
      summary: row.summary,
    })),
    namedFields: version.namedFields.map((row) => ({
      key: row.key,
      label: row.label,
      unit: row.unit,
    })),
    claims: version.claims.map((row) => ({
      key: row.key,
      text: row.text,
      importance: row.importance,
      consequenceLevel: row.consequenceLevel,
      conceptKey: row.conceptKey,
      failureFamilies: failureFamiliesByClaimId.get(row.id) ?? [],
    })),
  }
}

// ---------------------------------------------------------------------------------------------
// Writing a step's elements, and validating what was written
// ---------------------------------------------------------------------------------------------

type WriteContext = {
  tenantId: string
  versionId: string
  version: scenarioRepo.VersionFull
  tx: scenarioRepo.Tx
  /** Element ids whose latest decision confirms them; a step never writes over one (rule 2). */
  confirmedIds: ReadonlySet<string>
  /** Singleton element types whose latest decision confirms them (their rows carry a null id). */
  confirmedSingletons: ReadonlySet<ElementTypeValue>
}

/**
 * Writes the step's output and answers with the rules it broke, in one transaction.
 *
 * The elements are committed whether or not the subset passes: the retry builds its prompt input
 * from the version as it now stands, and an author whose second pass also failed needs to see what
 * was produced in order to finish it by hand (10 §5, FR-194).
 */
async function writeAndValidate(
  tenantId: string,
  versionId: string,
  step: GenerationStepValue,
  output: unknown,
): Promise<{ code: ValidationRuleCode; message: string }[]> {
  return repo.withTransaction(async (tx) => {
    const locked = await repo.lockVersionForGeneration(tenantId, versionId, tx)
    if (!locked) notFound('package version')
    if (locked.status !== 'draft') versionFrozen()

    const version = await scenarioRepo.findVersionFull(tenantId, versionId, tx)
    if (!version) notFound('package version')

    const standing = standingDecisions(await repo.listConfirmations(versionId, tx))
    const ctx: WriteContext = {
      tenantId,
      versionId,
      version,
      tx,
      confirmedIds: standing.confirmedIds,
      confirmedSingletons: standing.confirmedSingletons,
    }
    await applyStep(ctx, step, output)

    const written = await scenarioRepo.findVersionFull(tenantId, versionId, tx)
    if (!written) notFound('package version')
    const rules = GENERATION_STEP_DEFINITIONS[step].rules
    return validatePackage(written).failures.filter((failure) => rules.includes(failure.code))
  })
}

type KeyedRow = { id: string; key: string }

type KeyPlan = {
  /** Every key the version will hold, mapped to the id it holds it under. */
  idByKey: Map<string, string>
  /** Keys whose element is confirmed: the author's work, which the step does not write over. */
  confirmedKeys: Set<string>
  /** Ids of unconfirmed rows the regenerated set no longer names. */
  staleIds: string[]
}

/**
 * The heart of rule 2. Ids are allocated for new keys before anything is written so a reference
 * between two elements of the same step resolves in one pass, existing keys keep the id every other
 * element points at, confirmed keys are set aside, and only unconfirmed rows the new set dropped
 * are removed.
 */
function planKeys(
  ctx: WriteContext,
  existing: readonly KeyedRow[],
  generatedKeys: readonly string[],
  /**
   * Ids to protect as though they were confirmed themselves. Step 4 passes the claims whose *state*
   * an author confirmed: a claim state is its own confirmable element (`defective:C3`) and it
   * cannot outlive its claim, so a claim carrying a confirmed state is confirmed work too (D-552).
   */
  alsoProtected: ReadonlySet<string> = new Set(),
): KeyPlan {
  const idByKey = new Map<string, string>()
  const confirmedKeys = new Set<string>()
  for (const row of existing) {
    idByKey.set(row.key, row.id)
    if (ctx.confirmedIds.has(row.id) || alsoProtected.has(row.id)) confirmedKeys.add(row.key)
  }
  for (const key of generatedKeys) {
    if (!idByKey.has(key)) idByKey.set(key, crypto.randomUUID())
  }
  const generated = new Set(generatedKeys)
  const staleIds = existing
    .filter((row) => !confirmedKeys.has(row.key) && !generated.has(row.key))
    .map((row) => row.id)
  return { idByKey, confirmedKeys, staleIds }
}

/** The id a key resolves to; every key a plan was built for has one. */
function idOf(plan: KeyPlan, key: string): string {
  const id = plan.idByKey.get(key)
  if (id === undefined) {
    throw new AppError('INTERNAL_ERROR', `Generation referenced the unknown key ${key}.`)
  }
  return id
}

/** Removes the rows a regenerated set dropped, and the decisions filed against them. */
async function removeStale(
  ctx: WriteContext,
  type: repo.DeletableElementType,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return
  await repo.deleteConfirmationsForElements(ctx.versionId, ids, ctx.tx)
  await repo.deleteElements(ctx.versionId, type, ids, ctx.tx)
}

const write = async <T extends scenarioRepo.ElementType>(
  ctx: WriteContext,
  type: T,
  row: scenarioRepo.ElementInput[T],
): Promise<void> => {
  await scenarioRepo.upsertElement(ctx.tenantId, ctx.versionId, type, row, ctx.tx)
}

/**
 * The one cast in the pipeline. `structured()` has already validated the answer against the step's
 * own output schema, so what arrives is the shape that schema describes; the writer below restates
 * that shape as a TypeScript type, and `tests/unit/authoring/prompts.test.ts` holds every schema's
 * example output against it.
 */
async function applyStep(
  ctx: WriteContext,
  step: GenerationStepValue,
  output: unknown,
): Promise<void> {
  const value = output as never
  switch (step) {
    case 'reskin_brief_stakeholders':
      return writeReskin(ctx, value)
    case 'documents':
      return writeDocuments(ctx, value)
    case 'answer_space_fields':
      return writeAnswerSpace(ctx, value)
    case 'claims_and_states':
      return writeClaims(ctx, value)
    case 'turn_and_probe':
      return writeTurnAndProbe(ctx, value)
    case 'question_bank_and_counterfactual':
      return writeQuestionBank(ctx, value)
    case 'readiness_items':
      return writeReadinessItems(ctx, value)
  }
}

// --- Step 1 ------------------------------------------------------------------------------------

type GeneratedStakeholder = {
  key: string
  name: string
  roleTitle: string
  positionStatement: string
  incentives: string
  blindSpots: string
}

async function writeReskin(
  ctx: WriteContext,
  output: {
    brief: string
    reskinLog: ReskinLogEntry[]
    stakeholders: GeneratedStakeholder[]
    contradictionPair: [string, string]
    contradictionPoint: string
  },
): Promise<void> {
  if (!ctx.confirmedSingletons.has('brief')) {
    await write(ctx, 'brief', { brief: output.brief })
  }

  const plan = planKeys(
    ctx,
    ctx.version.stakeholders,
    output.stakeholders.map((row) => row.key),
  )
  const [left, right] = output.contradictionPair
  for (const row of output.stakeholders) {
    if (plan.confirmedKeys.has(row.key)) continue
    const contradicts = row.key === left && left !== right ? idOf(plan, right) : null
    await write(ctx, 'stakeholder', {
      id: idOf(plan, row.key),
      key: row.key,
      name: row.name,
      roleTitle: row.roleTitle,
      positionStatement: row.positionStatement,
      incentives: row.incentives,
      blindSpots: row.blindSpots,
      contradictsStakeholderId: contradicts,
      contradictionPoint: contradicts === null ? null : output.contradictionPoint,
    })
  }
  await removeStale(ctx, 'stakeholder', plan.staleIds)

  // The re-skin log is the licence trail (FR-028): the case title, publisher and licence the author
  // typed are theirs and are never rewritten here — only the log of what generation changed.
  const seed = ctx.version.seedRecord
  if (seed && !ctx.confirmedSingletons.has('seed_reskin')) {
    await write(ctx, 'seed_reskin', {
      caseTitle: seed.caseTitle,
      publisher: seed.publisher,
      licenseTerms: seed.licenseTerms,
      licensePermitsAdaptation: seed.licensePermitsAdaptation,
      seedText: seed.seedText,
      reskinLog: output.reskinLog.map((entry) => ({
        kind: entry.kind,
        from: entry.from,
        to: entry.to,
        note: entry.note,
      })),
    })
  }
}

// --- Step 2 ------------------------------------------------------------------------------------

type GeneratedDocument = {
  key: string
  title: string
  author: string
  datedOn: string
  role: 'supporting' | 'superseded' | 'interpretation_as_fact' | 'irrelevant'
  position: number
  supersededByKey: string | null
  stakeholderKey: string | null
  body: string
}

async function writeDocuments(
  ctx: WriteContext,
  output: { documents: GeneratedDocument[] },
): Promise<void> {
  const plan = planKeys(
    ctx,
    ctx.version.documents,
    output.documents.map((row) => row.key),
  )
  const stakeholderIdByKey = new Map(ctx.version.stakeholders.map((row) => [row.key, row.id]))

  // `superseded_by_document_id` points at another document of the same set, and two rules pull
  // against each other: the foreign key needs the successor row to exist, and the table's check
  // refuses a superseded document without one. So the set is written successor-first, in as many
  // passes as the chain is deep — the same walk `importPackage` makes, for the same reason.
  const done = new Set(ctx.version.documents.map((row) => row.key))
  let pending = output.documents.filter((row) => !plan.confirmedKeys.has(row.key))
  while (pending.length > 0) {
    const ready = pending.filter(
      (row) => row.supersededByKey === null || done.has(row.supersededByKey),
    )
    if (ready.length === 0) {
      throw new AppError(
        'INTERNAL_ERROR',
        'The generated documents supersede each other in a cycle.',
      )
    }
    for (const row of ready) {
      await write(ctx, 'document', {
        id: idOf(plan, row.key),
        key: row.key,
        title: row.title,
        author: row.author,
        datedOn: row.datedOn,
        body: row.body,
        wordCount: countWords(row.body),
        role: row.role,
        supersededByDocumentId:
          row.supersededByKey === null ? null : idOf(plan, row.supersededByKey),
        stakeholderId:
          row.stakeholderKey === null ? null : (stakeholderIdByKey.get(row.stakeholderKey) ?? null),
        position: row.position,
      })
      done.add(row.key)
    }
    const written = new Set(ready.map((row) => row.key))
    pending = pending.filter((row) => !written.has(row.key))
  }

  await removeStale(ctx, 'document', plan.staleIds)
}

// --- Step 3 ------------------------------------------------------------------------------------

type GeneratedPosition = {
  key: string
  kind: 'defensible' | 'evidence_inconsistent'
  summary: string
  supportingDocumentKeys: string[]
  ignoredEvidence: string | null
  isMinimumCommitment: boolean
  position: number
}

type GeneratedNamedField = {
  key: string
  label: string
  unit: 'percent' | 'ratio' | 'months' | 'usd' | 'count' | 'other'
  position: number
}

async function writeAnswerSpace(
  ctx: WriteContext,
  output: { positions: GeneratedPosition[]; namedFields: GeneratedNamedField[] },
): Promise<void> {
  const documentIdByKey = new Map(ctx.version.documents.map((row) => [row.key, row.id]))

  const positions = planKeys(
    ctx,
    ctx.version.answerSpacePositions,
    output.positions.map((row) => row.key),
  )
  for (const row of output.positions) {
    if (positions.confirmedKeys.has(row.key)) continue
    await write(ctx, 'answer_space_position', {
      id: idOf(positions, row.key),
      key: row.key,
      kind: row.kind,
      summary: row.summary,
      supportingDocumentIds: row.supportingDocumentKeys
        .map((key) => documentIdByKey.get(key))
        .filter((id): id is string => id !== undefined),
      ignoredEvidence: row.ignoredEvidence,
      isMinimumCommitment: row.isMinimumCommitment,
      position: row.position,
    })
  }
  await removeStale(ctx, 'answer_space_position', positions.staleIds)

  const fields = planKeys(
    ctx,
    ctx.version.namedFields,
    output.namedFields.map((row) => row.key),
  )
  for (const row of output.namedFields) {
    if (fields.confirmedKeys.has(row.key)) continue
    await write(ctx, 'named_field', {
      id: idOf(fields, row.key),
      key: row.key,
      label: row.label,
      unit: row.unit,
      position: row.position,
    })
  }
  await removeStale(ctx, 'named_field', fields.staleIds)
}

// --- Step 4 ------------------------------------------------------------------------------------

type GeneratedPaths = {
  source_trace?: { document_key: string; passage: string; dated_on: string; author: string }
  replication_check?: { result: string }
  decomposition_check?: { steps: { label: string; result: string }[] }
}

type GeneratedClaim = {
  key: string
  text: string
  sourceKind: 'assistant' | 'document'
  sourceDocumentKey: string | null
  sourcePassage: string
  importance: 'load_bearing' | 'supporting'
  consequenceLevel: 'low' | 'medium' | 'high'
  verificationCost: 'cheap' | 'moderate' | 'expensive'
  weaklySourced: boolean
  volatile: boolean
  conceptKey: string
  carriedValues: CarriedValue[]
  triggerPhrases: string[]
  triggerDescription: string
  escalatable: boolean
  escalationReply: string | null
  rationale: string
  position: number
  defective: {
    failureFamily: FailureFamilyValue | null
    plantedTrue: boolean
    warrantedStance: StanceValue
    verificationPaths: GeneratedPaths
  }
  sound: { warrantedStance: StanceValue; verificationPaths: GeneratedPaths }
}

/** Element keys become database ids here, exactly as they do on import (10 §4). */
function toVerificationPaths(
  paths: GeneratedPaths,
  documentIdByKey: ReadonlyMap<string, string>,
): VerificationPaths {
  const trace = paths.source_trace
  const documentId = trace ? documentIdByKey.get(trace.document_key) : undefined
  return {
    ...(trace && documentId !== undefined
      ? {
          source_trace: {
            document_id: documentId,
            passage: trace.passage,
            dated_on: trace.dated_on,
            author: trace.author,
          },
        }
      : {}),
    ...(paths.replication_check ? { replication_check: paths.replication_check } : {}),
    ...(paths.decomposition_check ? { decomposition_check: paths.decomposition_check } : {}),
  }
}

async function writeClaims(
  ctx: WriteContext,
  output: { claims: GeneratedClaim[]; generalEscalationReply: string },
): Promise<void> {
  const documentIdByKey = new Map(ctx.version.documents.map((row) => [row.key, row.id]))

  // A claim state is a confirmable element in its own right (`defective:C3`), so an author can
  // confirm a state while the claim it belongs to is still unconfirmed — and a state cannot outlive
  // its claim, because dropping the claim drops every state of it. Read against
  // `plan.staleIds` alone, that made a claims pass which happened not to reproduce a key delete a
  // confirmed state, its `element_confirmations` rows and the rejection history `rejectedShare`
  // counts: the exact loss D-532 was written to prevent, on the one write path in this file that
  // did not consult `ctx.confirmedIds`. A claim with a confirmed state is therefore protected the
  // way a confirmed claim is (D-552).
  const states = await repo.listClaimStates(ctx.versionId, ctx.tx)
  const claimsWithConfirmedState = new Set(
    states.filter((state) => ctx.confirmedIds.has(state.id)).map((state) => state.claimId),
  )
  const plan = planKeys(
    ctx,
    ctx.version.claims,
    output.claims.map((row) => row.key),
    claimsWithConfirmedState,
  )

  for (const row of output.claims) {
    if (plan.confirmedKeys.has(row.key)) continue
    // 06 §3.3: a claim with a Source Trace names the document the trace leads to, and the trace is
    // authored beside the claim's state — so the column is filled from whichever names one.
    const tracedKey =
      row.sourceDocumentKey ??
      row.defective.verificationPaths.source_trace?.document_key ??
      row.sound.verificationPaths.source_trace?.document_key ??
      null
    await write(ctx, 'claim', {
      id: idOf(plan, row.key),
      key: row.key,
      text: row.text,
      sourceKind: row.sourceKind,
      sourceDocumentId: tracedKey === null ? null : (documentIdByKey.get(tracedKey) ?? null),
      sourcePassage: row.sourcePassage,
      importance: row.importance,
      consequenceLevel: row.consequenceLevel,
      verificationCost: row.verificationCost,
      weaklySourced: row.weaklySourced,
      volatile: row.volatile,
      conceptKey: row.conceptKey,
      carriedValues: row.carriedValues,
      triggerPhrases: row.triggerPhrases,
      triggerDescription: row.triggerDescription,
      escalatable: row.escalatable,
      escalationReply: row.escalationReply,
      rationale: row.rationale,
      position: row.position,
    })
  }

  // The states of claims the new set dropped go with them; step 4 owns both tables (10 §5). Every
  // such state is unconfirmed by construction — a confirmed one protected its claim above — and the
  // filter says so locally rather than leaving it to be re-derived by a reader.
  const staleClaimIds = new Set(plan.staleIds)
  const orphanStates = states.filter(
    (state) => staleClaimIds.has(state.claimId) && !ctx.confirmedIds.has(state.id),
  )
  if (orphanStates.length > 0) {
    const orphanIds = orphanStates.map((state) => state.id)
    await repo.deleteConfirmationsForElements(ctx.versionId, orphanIds, ctx.tx)
    await repo.deleteClaimStates(ctx.versionId, orphanIds, ctx.tx)
  }
  await removeStale(ctx, 'claim', plan.staleIds)

  const stateIdByPair = new Map(
    states.map((state) => [`${state.variantKey}:${state.claimId}`, state.id] as const),
  )
  const variantIdByKey = new Map(ctx.version.variants.map((row) => [row.key, row.id]))
  for (const row of output.claims) {
    // A confirmed claim keeps the states the author confirmed it with: writing new ones would
    // change what the element they signed for means.
    if (plan.confirmedKeys.has(row.key)) continue
    const claimId = idOf(plan, row.key)
    for (const variantKey of ['defective', 'sound'] as const) {
      const variantId = variantIdByKey.get(variantKey)
      if (variantId === undefined) continue
      const stateId = stateIdByPair.get(`${variantKey}:${claimId}`)
      if (stateId !== undefined && ctx.confirmedIds.has(stateId)) continue
      const side = variantKey === 'defective' ? row.defective : row.sound
      const failureFamily = variantKey === 'defective' ? row.defective.failureFamily : null
      await write(ctx, 'variant_claim_state', {
        ...(stateId === undefined ? {} : { id: stateId }),
        variantId,
        claimId,
        evidenceStatus: failureFamily === null ? 'sound' : 'defective',
        failureFamily,
        warrantedStance: side.warrantedStance,
        verificationPaths: toVerificationPaths(side.verificationPaths, documentIdByKey),
        planted: variantKey === 'defective' && row.defective.plantedTrue,
      })
    }
  }

  if (!ctx.confirmedSingletons.has('general_escalation_reply')) {
    await write(ctx, 'general_escalation_reply', {
      generalEscalationReply: output.generalEscalationReply,
    })
  }
}

// --- Step 5 ------------------------------------------------------------------------------------

type GeneratedTurn = {
  text: string
  voice:
    | 'stakeholder_message'
    | 'corrected_number'
    | 'supplier_notice'
    | 'competitor_move'
    | 'retracted_source'
    | 'regulatory_note'
  stakeholderKey: string | null
  delaySeconds: number
  warrantsChange: boolean
  proportionateResponse: 'hold' | 'revise' | 'reverse'
  evidence: string
  disruptedAssumptionKeys: string[]
  windowClaimKeys: string[]
}

async function writeTurnAndProbe(
  ctx: WriteContext,
  output: {
    turn: GeneratedTurn
    probe: { claimKey: string; originalPosition: string; scriptedReversal: string } | null
  },
): Promise<void> {
  const stakeholderIdByKey = new Map(ctx.version.stakeholders.map((row) => [row.key, row.id]))
  const claimIdByKey = new Map(ctx.version.claims.map((row) => [row.key, row.id]))

  if (!ctx.confirmedSingletons.has('turn')) {
    await write(ctx, 'turn', {
      text: output.turn.text,
      voice: output.turn.voice,
      stakeholderId:
        output.turn.stakeholderKey === null
          ? null
          : (stakeholderIdByKey.get(output.turn.stakeholderKey) ?? null),
      warrantsChange: output.turn.warrantsChange,
      proportionateResponse: output.turn.proportionateResponse,
      evidence: output.turn.evidence,
      disruptedAssumptionKeys: output.turn.disruptedAssumptionKeys,
      windowClaimIds: output.turn.windowClaimKeys
        .map((key) => claimIdByKey.get(key))
        .filter((id): id is string => id !== undefined),
    })
  }

  // The delay is a column of the version, which is where `TURN_DELAY` reads it (06 §3.3), so it is
  // the `clock_and_difficulty` element that carries it and its confirmation that protects it.
  if (!ctx.confirmedSingletons.has('clock_and_difficulty')) {
    await write(ctx, 'clock_and_difficulty', { turnDelaySeconds: output.turn.delaySeconds })
  }

  if (ctx.confirmedSingletons.has('probe')) return
  const claimId = output.probe === null ? undefined : claimIdByKey.get(output.probe.claimKey)
  if (output.probe === null || claimId === undefined) {
    if (ctx.version.probe) await removeStale(ctx, 'probe', [ctx.version.probe.id])
    return
  }
  await write(ctx, 'probe', {
    claimId,
    originalPosition: output.probe.originalPosition,
    scriptedReversal: output.probe.scriptedReversal,
  })
}

// --- Step 6 ------------------------------------------------------------------------------------

type GeneratedQuestion = {
  key: string
  kind:
    | 'provenance'
    | 'figure_provenance'
    | 'verification'
    | 'assumption'
    | 'confidence'
    | 'frame_vs_response'
    | 'counterfactual'
    | 'default'
  claimKey: string | null
  assumptionIndex: number | null
  template: string
  condition: DefenseQuestionCondition
  followUp: string
  expectedAnswerNotes: string
  isDefault: boolean
  position: number
}

async function writeQuestionBank(
  ctx: WriteContext,
  output: { questions: GeneratedQuestion[]; counterfactual: string },
): Promise<void> {
  const claimIdByKey = new Map(ctx.version.claims.map((row) => [row.key, row.id]))
  const plan = planKeys(
    ctx,
    ctx.version.defenseQuestions,
    output.questions.map((row) => row.key),
  )

  for (const row of output.questions) {
    if (plan.confirmedKeys.has(row.key)) continue
    await write(ctx, 'defense_question', {
      id: idOf(plan, row.key),
      key: row.key,
      kind: row.kind,
      claimId: row.claimKey === null ? null : (claimIdByKey.get(row.claimKey) ?? null),
      assumptionIndex: row.assumptionIndex,
      template: row.template,
      condition: row.condition,
      followUp: row.followUp,
      expectedAnswerNotes: row.expectedAnswerNotes,
      isDefault: row.isDefault,
      position: row.position,
    })
  }
  await removeStale(ctx, 'defense_question', plan.staleIds)

  if (!ctx.confirmedSingletons.has('counterfactual')) {
    await write(ctx, 'counterfactual', { debriefCounterfactual: output.counterfactual })
  }
}

// --- Step 7 ------------------------------------------------------------------------------------

type GeneratedReadinessItem = {
  key: string
  category: 'foundation' | 'defect_concept' | 'ai_behavior'
  conceptKey: string
  stem: string
  options: ReadinessOption[]
  answerKey: string
  position: number
}

async function writeReadinessItems(
  ctx: WriteContext,
  output: { items: GeneratedReadinessItem[] },
): Promise<void> {
  const plan = planKeys(
    ctx,
    ctx.version.readinessItems,
    output.items.map((row) => row.key),
  )
  for (const row of output.items) {
    if (plan.confirmedKeys.has(row.key)) continue
    await write(ctx, 'readiness_item', {
      id: idOf(plan, row.key),
      key: row.key,
      category: row.category,
      conceptKey: row.conceptKey,
      stem: row.stem,
      options: row.options,
      answerKey: row.answerKey,
      position: row.position,
    })
  }
  await removeStale(ctx, 'readiness_item', plan.staleIds)
}

/** The seven steps, for anything that needs to name them in order (the status screen, the tests). */
export { GENERATION_STEPS }
