// Module `debrief` (docs/tech/10-backend-spec-modules.md §13) — repository. Query bodies only: the
// stored pieces the debrief assembles in one call, the authored standard the run is walked against,
// and the two-question answer row (DATA-043).
//
// `findDebriefData` reads the tenant-scoped run row and takes tenantId first (D-006); the children
// (locked artifacts, claims, actions, bands, score, record, answer) are scoped through that run.
// The three package reads below are scoped by the version and the variant the run row names, which
// the service has already resolved inside the tenant — the same shape `review/repository.ts` uses
// for `listVersionClaimIds` and for the same reason: a package version is reached through the run
// that points at it, and the run is what the tenancy check was made on.
import { and, asc, eq, sql } from 'drizzle-orm'
import { AppError } from '@/lib/errors'
import { db } from '@/server/db/client'
import {
  type NewRunDebriefAnswer,
  type Run,
  type RunAction,
  type RunAddendum,
  type RunBand,
  type RunBrief,
  type RunClaim,
  type RunDebriefAnswer,
  type RunEscalation,
  type RunEvent,
  type RunFrame,
  type RunRecord,
  type RunScore,
  type RunTurnResponse,
  assignments,
  courses,
  runActions,
  runAddenda,
  runBands,
  runBriefs,
  runClaims,
  runDebriefAnswers,
  runEscalations,
  runEvents,
  runFrames,
  runRecords,
  runScores,
  runTurnResponses,
  runs,
  scenarioClaims,
  scenarioDocuments,
  scenarioPackageVersions,
  scenarioTurns,
  scenarioVariants,
  sections,
  variantClaimStates,
} from '@/server/db/schema'
import type { BandMapping, VerificationPaths } from '@/server/db/schema'
import type { DbOrTx } from '@/server/db/tx'

export type { DbOrTx, Tx } from '@/server/db/tx'
export { withTransaction } from '@/server/db/tx'

/** Everything the debrief reads from the run's own tables; package elements come from below. */
export type DebriefData = {
  run: Run
  frame: RunFrame | null
  brief: RunBrief | null
  addendum: RunAddendum | null
  turnResponse: RunTurnResponse | null
  /** In surfacing order. */
  claims: RunClaim[]
  /** In completion order. */
  actions: RunAction[]
  /** In escalation order. */
  escalations: RunEscalation[]
  /** In rubric (enum) order. */
  bands: RunBand[]
  score: RunScore | null
  /** The Judgment Record snapshot once confirmed; null before. */
  record: RunRecord | null
  debriefAnswer: RunDebriefAnswer | null
}

function one<T>(row: T | undefined): T {
  if (row === undefined) throw new AppError('INTERNAL_ERROR', 'Insert returned no row.')
  return row
}

/** The debrief's stored pieces for one run of the tenant, or null when it is not there. */
export async function findDebriefData(
  tenantId: string,
  runId: string,
  dbx: DbOrTx = db,
): Promise<DebriefData | null> {
  const [run] = await dbx
    .select()
    .from(runs)
    .where(and(eq(runs.organizationId, tenantId), eq(runs.id, runId)))
    .limit(1)
  if (!run) return null

  const [frame] = await dbx.select().from(runFrames).where(eq(runFrames.runId, runId)).limit(1)
  const [brief] = await dbx.select().from(runBriefs).where(eq(runBriefs.runId, runId)).limit(1)
  const [addendum] = await dbx.select().from(runAddenda).where(eq(runAddenda.runId, runId)).limit(1)
  const [turnResponse] = await dbx
    .select()
    .from(runTurnResponses)
    .where(eq(runTurnResponses.runId, runId))
    .limit(1)
  const claims = await dbx
    .select()
    .from(runClaims)
    .where(eq(runClaims.runId, runId))
    .orderBy(asc(runClaims.surfacedAt), asc(runClaims.id))
  const actions = await dbx
    .select()
    .from(runActions)
    .where(eq(runActions.runId, runId))
    .orderBy(asc(runActions.completedAt), asc(runActions.id))
  const escalations = await dbx
    .select()
    .from(runEscalations)
    .where(eq(runEscalations.runId, runId))
    .orderBy(asc(runEscalations.createdAt), asc(runEscalations.id))
  const bands = await dbx
    .select()
    .from(runBands)
    .where(eq(runBands.runId, runId))
    .orderBy(asc(runBands.dimension))
  const [score] = await dbx.select().from(runScores).where(eq(runScores.runId, runId)).limit(1)
  const [record] = await dbx.select().from(runRecords).where(eq(runRecords.runId, runId)).limit(1)
  const [debriefAnswer] = await dbx
    .select()
    .from(runDebriefAnswers)
    .where(eq(runDebriefAnswers.runId, runId))
    .limit(1)

  return {
    run,
    frame: frame ?? null,
    brief: brief ?? null,
    addendum: addendum ?? null,
    turnResponse: turnResponse ?? null,
    claims,
    actions,
    escalations,
    bands,
    score: score ?? null,
    record: record ?? null,
    debriefAnswer: debriefAnswer ?? null,
  }
}

/**
 * The run's two answers, or null before they are filed (FR-152).
 *
 * Its own read rather than a field of `findDebriefData`, because `answerDebrief` asks one question
 * — has this already been answered — and loading the whole debrief inside the write transaction to
 * find out would be ten statements for a row that either exists or does not.
 */
export async function findDebriefAnswer(
  runId: string,
  dbx: DbOrTx = db,
): Promise<RunDebriefAnswer | null> {
  const [answer] = await dbx
    .select()
    .from(runDebriefAnswers)
    .where(eq(runDebriefAnswers.runId, runId))
    .limit(1)
  return answer ?? null
}

/** Inserts the one debrief answer row; the primary key on `run_id` refuses a second one. */
export async function insertDebriefAnswer(
  row: NewRunDebriefAnswer,
  dbx: DbOrTx = db,
): Promise<RunDebriefAnswer> {
  const [answer] = await dbx.insert(runDebriefAnswers).values(row).returning()
  return one(answer)
}

// ---------------------------------------------------------------------------------------------
// The run's context: which package, which variant, and what the course does with the bands
// ---------------------------------------------------------------------------------------------

/**
 * The columns the debrief needs from outside the run's own tables (FR-151, FR-202, D-091).
 *
 * The weight is resolved here rather than in the service, because "the assignment's weight, or the
 * course default" is a fact about two columns and reading both into the service only to pick one
 * would be a second place the fallback is written (10 §3's `getPolicyDisplay` picks it the same
 * way). `numeric` reaches here as a string, so the service converts once.
 */
export type DebriefContext = {
  studentId: string
  sectionId: string
  assignmentId: string
  packageVersionId: string
  variantId: string
  variantKey: 'defective' | 'sound'
  mode: 'guided' | 'standard' | 'open'
  isWalkthrough: boolean
  mapping: BandMapping
  /** `assignments.weight` where the assignment sets one, else `courses.default_run_weight`. */
  weight: string
  counterfactual: string
}

export async function findDebriefContext(
  tenantId: string,
  runId: string,
  dbx: DbOrTx = db,
): Promise<DebriefContext | undefined> {
  const [row] = await dbx
    .select({
      studentId: runs.studentId,
      sectionId: assignments.sectionId,
      assignmentId: runs.assignmentId,
      packageVersionId: runs.packageVersionId,
      variantId: runs.variantId,
      variantKey: scenarioVariants.key,
      mode: runs.mode,
      isWalkthrough: runs.isWalkthrough,
      mapping: courses.mapping,
      weight: sql<string>`coalesce(${assignments.weight}, ${courses.defaultRunWeight})`,
      counterfactual: scenarioPackageVersions.debriefCounterfactual,
    })
    .from(runs)
    .innerJoin(assignments, eq(assignments.id, runs.assignmentId))
    .innerJoin(sections, eq(sections.id, assignments.sectionId))
    .innerJoin(courses, eq(courses.id, sections.courseId))
    .innerJoin(scenarioVariants, eq(scenarioVariants.id, runs.variantId))
    .innerJoin(scenarioPackageVersions, eq(scenarioPackageVersions.id, runs.packageVersionId))
    .where(and(eq(runs.organizationId, tenantId), eq(runs.id, runId)))
    .limit(1)
  return row
}

/**
 * The run's variant as a key, for the `variant` property of the `R` analytics group (17 §3).
 *
 * `findDebriefContext` above already answers it for the read, and this exists for the *write*:
 * `answerDebrief` holds the locked run and nothing else, and the eleven-column join above would be
 * ten statements to learn one word. A copy of `runs/repository.ts`'s `findVariantKey` rather than an
 * import of it, for the reason `run-context.ts` gives — a module reaches another only through its
 * public index, and "a repository that needs it copies it".
 */
export async function findVariantKey(
  variantId: string,
  dbx: DbOrTx = db,
): Promise<'defective' | 'sound' | null> {
  const [row] = await dbx
    .select({ key: scenarioVariants.key })
    .from(scenarioVariants)
    .where(eq(scenarioVariants.id, variantId))
    .limit(1)
  return row?.key ?? null
}

// ---------------------------------------------------------------------------------------------
// The authored standard the run is walked against (FR-151)
// ---------------------------------------------------------------------------------------------

/**
 * One consequential claim of the package version, with what this variant says about it.
 *
 * Every field here is released to the student at scoring and to nobody before it (12 §8.2): the
 * warranted stance, the evidence status, the defect kind, the authored "what it deserved and why",
 * and which interrogation action returns something. `planted` is on the row because the missed-defect
 * section is defined by it — "planted claims not kept from the decision" (10 §13) — and the service
 * uses it to select rather than emitting it.
 */
export type DebriefClaim = {
  claimId: string
  key: string
  text: string
  position: number
  importance: 'load_bearing' | 'supporting'
  rationale: string
  sourceDocumentId: string | null
  sourcePassage: string
  documentTitle: string | null
  documentAuthor: string | null
  documentDatedOn: string | null
  evidenceStatus: 'sound' | 'defective'
  failureFamily: string | null
  warrantedStance: 'accept' | 'verify' | 'challenge' | 'reject' | 'escalate'
  planted: boolean
  verificationPaths: VerificationPaths
}

export async function listDebriefClaims(
  packageVersionId: string,
  variantId: string,
  dbx: DbOrTx = db,
): Promise<DebriefClaim[]> {
  return dbx
    .select({
      claimId: scenarioClaims.id,
      key: scenarioClaims.key,
      text: scenarioClaims.text,
      position: scenarioClaims.position,
      importance: scenarioClaims.importance,
      rationale: scenarioClaims.rationale,
      sourceDocumentId: scenarioClaims.sourceDocumentId,
      sourcePassage: scenarioClaims.sourcePassage,
      documentTitle: scenarioDocuments.title,
      documentAuthor: scenarioDocuments.author,
      documentDatedOn: scenarioDocuments.datedOn,
      evidenceStatus: variantClaimStates.evidenceStatus,
      failureFamily: variantClaimStates.failureFamily,
      warrantedStance: variantClaimStates.warrantedStance,
      planted: variantClaimStates.planted,
      verificationPaths: variantClaimStates.verificationPaths,
    })
    .from(scenarioClaims)
    .innerJoin(
      variantClaimStates,
      and(
        eq(variantClaimStates.claimId, scenarioClaims.id),
        eq(variantClaimStates.variantId, variantId),
      ),
    )
    .leftJoin(scenarioDocuments, eq(scenarioDocuments.id, scenarioClaims.sourceDocumentId))
    .where(eq(scenarioClaims.packageVersionId, packageVersionId))
    .orderBy(asc(scenarioClaims.position), asc(scenarioClaims.key))
}

/** The one document a Source Trace reaches, when the path names one the claim itself does not. */
export type DebriefDocument = { id: string; title: string; author: string; datedOn: string }

export async function listDebriefDocuments(
  packageVersionId: string,
  dbx: DbOrTx = db,
): Promise<DebriefDocument[]> {
  return dbx
    .select({
      id: scenarioDocuments.id,
      title: scenarioDocuments.title,
      author: scenarioDocuments.author,
      datedOn: scenarioDocuments.datedOn,
    })
    .from(scenarioDocuments)
    .where(eq(scenarioDocuments.packageVersionId, packageVersionId))
    .orderBy(asc(scenarioDocuments.title))
}

/**
 * What the Turn warranted, for §13.1's third "done well" rule.
 *
 * Two columns of the authored Turn and nothing else. `proportionate_response` is `warrantsChange`'s
 * companion and is 12 §8.1's "Turn internals" — which is why the service compares it with the filed
 * response here and emits the *comparison*, never the field.
 */
export type DebriefTurnStandard = {
  warrantsChange: boolean
  proportionateResponse: 'hold' | 'revise' | 'reverse'
}

export async function findTurnStandard(
  packageVersionId: string,
  dbx: DbOrTx = db,
): Promise<DebriefTurnStandard | undefined> {
  const [row] = await dbx
    .select({
      warrantsChange: scenarioTurns.warrantsChange,
      proportionateResponse: scenarioTurns.proportionateResponse,
    })
    .from(scenarioTurns)
    .where(eq(scenarioTurns.packageVersionId, packageVersionId))
    .limit(1)
  return row
}

// ---------------------------------------------------------------------------------------------
// The trace events the debrief reads directly (FR-053, FR-152)
// ---------------------------------------------------------------------------------------------

/**
 * Every event of one type on the run, in sequence order.
 *
 * Read here rather than through `trace.listEvents` because the two types this module needs are the
 * two that endpoint cannot serve: `probe_fired` is hidden from the owner's view in every state, and
 * 10 §13 makes the debrief the one projection that shows it after the run is scored (FR-053, D-088);
 * and `debrief_opened` is a read of this module's own bookkeeping rather than of the run's story.
 */
export async function listEventsOfType(
  runId: string,
  type: RunEvent['type'],
  dbx: DbOrTx = db,
): Promise<RunEvent[]> {
  return dbx
    .select()
    .from(runEvents)
    .where(and(eq(runEvents.runId, runId), eq(runEvents.type, type)))
    .orderBy(asc(runEvents.seq))
}

/**
 * Whether `debrief_opened` has already been written for this version of the bands (10 §13).
 *
 * Draft and confirmed are two versions, so the question is asked of the payload rather than of the
 * type: a student who read the draft and comes back after the confirmation is opening a debrief
 * they have not seen, and the trace says so.
 */
export async function hasDebriefOpened(
  runId: string,
  version: 'draft' | 'confirmed',
  dbx: DbOrTx = db,
): Promise<boolean> {
  const [row] = await dbx
    .select({ seq: runEvents.seq })
    .from(runEvents)
    .where(
      and(
        eq(runEvents.runId, runId),
        eq(runEvents.type, 'debrief_opened'),
        sql`${runEvents.payload}->>'version' = ${version}`,
      ),
    )
    .limit(1)
  return row !== undefined
}
