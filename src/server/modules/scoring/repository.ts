// Module `scoring` (docs/tech/10-backend-spec-modules.md §11) — repository. Query bodies only: the
// per-dimension bands and the score row (DATA-041, DATA-042), both children scoped through the
// runId the service resolved, plus the run row's `scoring_status`, which is tenant-scoped and so
// takes tenantId first (D-006). `updated_at` is maintained by the set_updated_at() trigger.
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import { AppError } from '@/lib/errors'
import { db } from '@/server/db/client'
import {
  type NewRunBand,
  type NewRunScore,
  type Run,
  type RunBand,
  type RunScore,
  answerSpacePositions,
  assignments,
  courses,
  defenseQuestions,
  namedFields,
  runBands,
  runDefenseAnswers,
  runDefenseQuestions,
  runScores,
  runs,
  scenarioClaims,
  scenarioDocuments,
  scenarioPackageVersions,
  scenarioTurns,
  sectionMemberships,
  sections,
  variantClaimStates,
} from '@/server/db/schema'
import type { DbOrTx } from '@/server/db/tx'

export type ScoringStatus = Run['scoringStatus']

// The service may not import `@/server/db` (04 §2), so the transaction boundary it opens is
// re-exported by the layer that owns database access — the same seam `assistant` and `defense` use.
export { withTransaction } from '@/server/db/tx'

function one<T>(row: T | undefined): T {
  if (row === undefined) throw new AppError('INTERNAL_ERROR', 'Insert returned no row.')
  return row
}

/** `excluded.<column>` for an upsert's SET clause: the value the conflicting insert carried. */
const excluded = (column: PgColumn) => sql`excluded.${sql.identifier(column.name)}`

/**
 * Inserts or replaces bands keyed by (run, dimension): the draft fields, the decision fields, and
 * the correction fields all come from the given rows, so callers pass complete rows (drafts from
 * the pipeline, decided rows from review, corrected rows from a neutralization recompute).
 */
export async function upsertBands(
  runId: string,
  rows: Omit<NewRunBand, 'runId'>[],
  dbx: DbOrTx = db,
): Promise<RunBand[]> {
  if (rows.length === 0) return []
  return dbx
    .insert(runBands)
    .values(rows.map((row) => ({ ...row, runId })))
    .onConflictDoUpdate({
      target: [runBands.runId, runBands.dimension],
      set: {
        draftBand: excluded(runBands.draftBand),
        draftStatus: excluded(runBands.draftStatus),
        draftReason: excluded(runBands.draftReason),
        basis: excluded(runBands.basis),
        provisional: excluded(runBands.provisional),
        graphKeys: excluded(runBands.graphKeys),
        evidenceEventSeqs: excluded(runBands.evidenceEventSeqs),
        quotes: excluded(runBands.quotes),
        rationale: excluded(runBands.rationale),
        decision: excluded(runBands.decision),
        decidedBand: excluded(runBands.decidedBand),
        decidedBy: excluded(runBands.decidedBy),
        decidedAt: excluded(runBands.decidedAt),
        note: excluded(runBands.note),
        bandBeforeCorrection: excluded(runBands.bandBeforeCorrection),
        bandAfterCorrection: excluded(runBands.bandAfterCorrection),
      },
    })
    .returning()
}

/** Inserts or replaces the one score row of a run (graphs, FCR, matched share, points, flags). */
export async function upsertScore(
  runId: string,
  row: Omit<NewRunScore, 'runId'>,
  dbx: DbOrTx = db,
): Promise<RunScore> {
  const [score] = await dbx
    .insert(runScores)
    .values({ ...row, runId })
    .onConflictDoUpdate({
      target: runScores.runId,
      set: {
        rubricVersion: excluded(runScores.rubricVersion),
        graphs: excluded(runScores.graphs),
        falseChallengeRate: excluded(runScores.falseChallengeRate),
        matchedStanceShare: excluded(runScores.matchedStanceShare),
        pointsDraft: excluded(runScores.pointsDraft),
        pointsConfirmed: excluded(runScores.pointsConfirmed),
        pointsBeforeCorrection: excluded(runScores.pointsBeforeCorrection),
        pointsAfterCorrection: excluded(runScores.pointsAfterCorrection),
        pointsEffective: excluded(runScores.pointsEffective),
        flags: excluded(runScores.flags),
        scoredAt: excluded(runScores.scoredAt),
      },
    })
    .returning()
  return one(score)
}

/** The score row of a run, or null before the pipeline has written one. */
export async function findScore(runId: string, dbx: DbOrTx = db): Promise<RunScore | null> {
  const [score] = await dbx.select().from(runScores).where(eq(runScores.runId, runId)).limit(1)
  return score ?? null
}

/** Every band of a run, in the order the rubric and the debrief present them (10 §11.3). */
export async function listBands(runId: string, dbx: DbOrTx = db): Promise<RunBand[]> {
  return dbx.select().from(runBands).where(eq(runBands.runId, runId))
}

// ---------------------------------------------------------------------------------------------
// What the pipeline reads (10 §11)
//
// `scoreRun` is reached by a run id from a job payload and nothing else, so these are the queries
// that turn that id into the run, the authored standard it is read against, and the interview it
// finished with. Each is a row shape of its own rather than a Drizzle row: a module-internal file
// may not import `src/server/db` (04 §2), so what the service and the graph builders read is
// declared here and mapped there.
// ---------------------------------------------------------------------------------------------

/** The run row the pipeline needs, with the section it belongs to and the course's band mapping. */
export type ScoringRunRow = {
  id: string
  organizationId: string
  studentId: string
  assignmentId: string
  sectionId: string
  courseId: string
  packageVersionId: string
  variantId: string
  state: Run['state']
  scoringStatus: ScoringStatus
  workingClockSeconds: number
  defenseCompletedAt: Date | null
  /** `courses.mapping` (FR-202): what each band is worth in this course's gradebook. */
  mapping: { novice: number; developing: number; proficient: number; professional: number }
}

/**
 * The run, its assignment's section, and the course's band mapping (FR-202).
 *
 * `tenantId` first, like every other read of a tenant table (D-006). The job payload carries only a
 * run id, so the service resolves the run's tenant through `auth/queries.findRunContext` — the same
 * seam every permission guard resolves a run id through — and passes it here. Without that the
 * pipeline would be the one place in the codebase that reads a run without naming the tenant it
 * belongs to.
 */
export async function findRunForScoring(
  tenantId: string,
  runId: string,
  dbx: DbOrTx = db,
): Promise<ScoringRunRow | null> {
  const [row] = await dbx
    .select({
      id: runs.id,
      organizationId: runs.organizationId,
      studentId: runs.studentId,
      assignmentId: runs.assignmentId,
      sectionId: assignments.sectionId,
      courseId: sections.courseId,
      packageVersionId: runs.packageVersionId,
      variantId: runs.variantId,
      state: runs.state,
      scoringStatus: runs.scoringStatus,
      workingClockSeconds: runs.workingClockSeconds,
      defenseCompletedAt: runs.defenseCompletedAt,
      mapping: courses.mapping,
    })
    .from(runs)
    .innerJoin(assignments, eq(assignments.id, runs.assignmentId))
    .innerJoin(sections, eq(sections.id, assignments.sectionId))
    .innerJoin(courses, eq(courses.id, sections.courseId))
    .where(and(eq(runs.organizationId, tenantId), eq(runs.id, runId)))
    .limit(1)
  return row ?? null
}

/** The instructors and TAs of a section: who a `run_scored` or `run_held` notice goes to (SYS-010). */
export async function listSectionReviewerIds(
  tenantId: string,
  sectionId: string,
  dbx: DbOrTx = db,
): Promise<string[]> {
  const rows = await dbx
    .select({ userId: sectionMemberships.userId })
    .from(sectionMemberships)
    .where(
      and(
        eq(sectionMemberships.organizationId, tenantId),
        eq(sectionMemberships.sectionId, sectionId),
        inArray(sectionMemberships.role, ['instructor', 'ta']),
      ),
    )
  return [...new Set(rows.map((row) => row.userId))]
}

export type ScoringClaimRow = {
  id: string
  key: string
  text: string
  sourceKind: 'assistant' | 'document'
  sourceDocumentId: string | null
  importance: 'load_bearing' | 'supporting'
  consequenceLevel: 'low' | 'medium' | 'high'
  conceptKey: string
  weaklySourced: boolean
  position: number
}

export type ScoringDocumentRow = {
  id: string
  key: string
  title: string
  role: string
  supersededByDocumentId: string | null
}

export type ScoringPositionRow = {
  key: string
  kind: 'defensible' | 'evidence_inconsistent'
  summary: string
  ignoredEvidence: string | null
  isMinimumCommitment: boolean
}

export type ScoringPackageRow = {
  workingClockSeconds: number
  claims: ScoringClaimRow[]
  documents: ScoringDocumentRow[]
  namedFields: {
    key: string
    label: string
    unit: 'percent' | 'ratio' | 'months' | 'usd' | 'count' | 'other'
  }[]
  positions: ScoringPositionRow[]
  turn: {
    text: string
    warrantsChange: boolean
    proportionateResponse: 'hold' | 'revise' | 'reverse'
    disruptedAssumptionKeys: string[]
  } | null
}

/** The authored standard a run is read against: claims, documents, fields, answer space, Turn. */
export async function findPackageForScoring(
  tenantId: string,
  packageVersionId: string,
  dbx: DbOrTx = db,
): Promise<ScoringPackageRow | null> {
  const [version] = await dbx
    .select({ workingClockSeconds: scenarioPackageVersions.workingClockSeconds })
    .from(scenarioPackageVersions)
    .where(
      and(
        eq(scenarioPackageVersions.organizationId, tenantId),
        eq(scenarioPackageVersions.id, packageVersionId),
      ),
    )
    .limit(1)
  if (!version) return null

  const [claims, documents, fields, positions, turns] = await Promise.all([
    dbx
      .select({
        id: scenarioClaims.id,
        key: scenarioClaims.key,
        text: scenarioClaims.text,
        sourceKind: scenarioClaims.sourceKind,
        sourceDocumentId: scenarioClaims.sourceDocumentId,
        importance: scenarioClaims.importance,
        consequenceLevel: scenarioClaims.consequenceLevel,
        conceptKey: scenarioClaims.conceptKey,
        weaklySourced: scenarioClaims.weaklySourced,
        position: scenarioClaims.position,
      })
      .from(scenarioClaims)
      .where(eq(scenarioClaims.packageVersionId, packageVersionId))
      .orderBy(asc(scenarioClaims.position)),
    dbx
      .select({
        id: scenarioDocuments.id,
        key: scenarioDocuments.key,
        title: scenarioDocuments.title,
        role: scenarioDocuments.role,
        supersededByDocumentId: scenarioDocuments.supersededByDocumentId,
      })
      .from(scenarioDocuments)
      .where(eq(scenarioDocuments.packageVersionId, packageVersionId))
      .orderBy(asc(scenarioDocuments.position)),
    dbx
      .select({ key: namedFields.key, label: namedFields.label, unit: namedFields.unit })
      .from(namedFields)
      .where(eq(namedFields.packageVersionId, packageVersionId))
      .orderBy(asc(namedFields.position)),
    dbx
      .select({
        key: answerSpacePositions.key,
        kind: answerSpacePositions.kind,
        summary: answerSpacePositions.summary,
        ignoredEvidence: answerSpacePositions.ignoredEvidence,
        isMinimumCommitment: answerSpacePositions.isMinimumCommitment,
      })
      .from(answerSpacePositions)
      .where(eq(answerSpacePositions.packageVersionId, packageVersionId))
      .orderBy(asc(answerSpacePositions.position)),
    dbx
      .select({
        text: scenarioTurns.text,
        warrantsChange: scenarioTurns.warrantsChange,
        proportionateResponse: scenarioTurns.proportionateResponse,
        disruptedAssumptionKeys: scenarioTurns.disruptedAssumptionKeys,
      })
      .from(scenarioTurns)
      .where(eq(scenarioTurns.packageVersionId, packageVersionId))
      .limit(1),
  ])

  return {
    workingClockSeconds: version.workingClockSeconds,
    claims,
    documents,
    namedFields: fields,
    positions,
    turn: turns[0] ?? null,
  }
}

export type ScoringVariantStateRow = {
  claimId: string
  evidenceStatus: 'sound' | 'defective'
  failureFamily: string | null
  warrantedStance: 'accept' | 'verify' | 'challenge' | 'reject' | 'escalate'
  planted: boolean
}

/** The variant's answer key (DATA-021): what each claim deserved in the variant this run drew. */
export async function listVariantStates(
  variantId: string,
  dbx: DbOrTx = db,
): Promise<ScoringVariantStateRow[]> {
  return dbx
    .select({
      claimId: variantClaimStates.claimId,
      evidenceStatus: variantClaimStates.evidenceStatus,
      failureFamily: variantClaimStates.failureFamily,
      warrantedStance: variantClaimStates.warrantedStance,
      planted: variantClaimStates.planted,
    })
    .from(variantClaimStates)
    .where(eq(variantClaimStates.variantId, variantId))
}

export type ScoringDefenseRow = {
  runQuestionId: string
  seq: number
  question: string
  expectedAnswerNotes: string
  followUp: string
  answer: string | null
}

/**
 * The interview as it was conducted: the questions in order, each with the notes its author wrote
 * and the answer the student gave. Follow-ups are rows of their own (`follow_up_of`), and the
 * service pairs them with their parents — the join here reads the bank once per question, which is
 * what carries `expected_answer_notes` and the authored follow-up prompt into the Ownership read.
 */
export async function listDefenseForScoring(
  runId: string,
  dbx: DbOrTx = db,
): Promise<(ScoringDefenseRow & { followUpOf: string | null })[]> {
  return dbx
    .select({
      runQuestionId: runDefenseQuestions.id,
      seq: runDefenseQuestions.seq,
      followUpOf: runDefenseQuestions.followUpOf,
      question: runDefenseQuestions.renderedText,
      expectedAnswerNotes: defenseQuestions.expectedAnswerNotes,
      followUp: defenseQuestions.followUp,
      answer: runDefenseAnswers.text,
    })
    .from(runDefenseQuestions)
    .innerJoin(defenseQuestions, eq(defenseQuestions.id, runDefenseQuestions.questionId))
    .leftJoin(runDefenseAnswers, eq(runDefenseAnswers.runDefenseQuestionId, runDefenseQuestions.id))
    .where(eq(runDefenseQuestions.runId, runId))
    .orderBy(asc(runDefenseQuestions.seq))
}

/** Sets `scoring_status` on the run row inside the tenant; null when no such run exists there. */
export async function updateScoringStatus(
  tenantId: string,
  runId: string,
  status: ScoringStatus,
  dbx: DbOrTx = db,
): Promise<Run | null> {
  const [run] = await dbx
    .update(runs)
    .set({ scoringStatus: status })
    .where(and(eq(runs.organizationId, tenantId), eq(runs.id, runId)))
    .returning()
  return run ?? null
}
