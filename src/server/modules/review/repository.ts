// Module `review` (docs/tech/10-backend-spec-modules.md §12) — repository. Query bodies only: the
// stored pieces of the replay bundle read in one call, claim neutralizations (DATA-044), and the two
// run lists the faculty seat's queue and section table are built from.
//
// `findReplayData` reads the tenant-scoped run row and takes tenantId first (D-006); the children
// (events, bands, score, questions, neutralizations, claims, readiness) are scoped through that run.
// The run lists are tenant-scoped for the same reason and take the tenant first as well.
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { AppError } from '@/lib/errors'
import { db } from '@/server/db/client'
import {
  type ClaimNeutralization,
  type NewClaimNeutralization,
  type Run,
  type RunBand,
  type RunClaim,
  type RunDefenseAnswer,
  type RunDefenseQuestion,
  type RunEvent,
  type RunReadinessResult,
  type RunScore,
  assignments,
  claimNeutralizations,
  courseExports,
  courses,
  defenseQuestions,
  runBands,
  runClaims,
  runDefenseAnswers,
  runDefenseQuestions,
  runEvents,
  runReadinessResults,
  runScores,
  runs,
  scenarioClaims,
  scenarioVariants,
  sectionMemberships,
  sections,
  user,
} from '@/server/db/schema'
import type { DbOrTx } from '@/server/db/tx'

export type { DbOrTx, Tx } from '@/server/db/tx'
export { withTransaction } from '@/server/db/tx'

/** Everything the replay reads from the run's own tables; package elements come from `scenarios`. */
export type ReplayData = {
  run: Run
  /** In `seq` order. */
  events: RunEvent[]
  /** In rubric (enum) order. */
  bands: RunBand[]
  score: RunScore | null
  /** In `seq` order, each with its answer or null, and the notes its author wrote. */
  questions: {
    question: RunDefenseQuestion
    answer: RunDefenseAnswer | null
    expectedAnswerNotes: string
    kind: string
  }[]
  /** Newest first. */
  neutralizations: ClaimNeutralization[]
  /** In surfacing order. */
  claims: RunClaim[]
  /** The closed Readiness Check, or null when it never closed. */
  readiness: RunReadinessResult | null
}

function one<T>(row: T | undefined): T {
  if (row === undefined) throw new AppError('INTERNAL_ERROR', 'Insert returned no row.')
  return row
}

/** The replay bundle's stored pieces for one run of the tenant, or null when it is not there. */
export async function findReplayData(
  tenantId: string,
  runId: string,
  dbx: DbOrTx = db,
): Promise<ReplayData | null> {
  const [run] = await dbx
    .select()
    .from(runs)
    .where(and(eq(runs.organizationId, tenantId), eq(runs.id, runId)))
    .limit(1)
  if (!run) return null

  const events = await dbx
    .select()
    .from(runEvents)
    .where(eq(runEvents.runId, runId))
    .orderBy(asc(runEvents.seq))
  const bands = await dbx
    .select()
    .from(runBands)
    .where(eq(runBands.runId, runId))
    .orderBy(asc(runBands.dimension))
  const [score] = await dbx.select().from(runScores).where(eq(runScores.runId, runId)).limit(1)
  // The bank's `expected_answer_notes` travels with the question, which is what makes the replay the
  // reviewer's document: 12 §8.1 keeps that column out of every student payload in every state, and
  // this is the one read that carries it (08 §4, "see answer space, defect placement… (replay)").
  const questions = await dbx
    .select({
      question: runDefenseQuestions,
      answer: runDefenseAnswers,
      expectedAnswerNotes: defenseQuestions.expectedAnswerNotes,
      kind: defenseQuestions.kind,
    })
    .from(runDefenseQuestions)
    .innerJoin(defenseQuestions, eq(defenseQuestions.id, runDefenseQuestions.questionId))
    .leftJoin(runDefenseAnswers, eq(runDefenseAnswers.runDefenseQuestionId, runDefenseQuestions.id))
    .where(eq(runDefenseQuestions.runId, runId))
    .orderBy(asc(runDefenseQuestions.seq))
  const neutralizations = await listNeutralizations(runId, dbx)
  const claims = await dbx
    .select()
    .from(runClaims)
    .where(eq(runClaims.runId, runId))
    .orderBy(asc(runClaims.surfacedAt), asc(runClaims.id))
  const [readiness] = await dbx
    .select()
    .from(runReadinessResults)
    .where(eq(runReadinessResults.runId, runId))
    .limit(1)

  return {
    run,
    events,
    bands,
    score: score ?? null,
    questions,
    neutralizations,
    claims,
    readiness: readiness ?? null,
  }
}

/** One person who has decided a band on this run: their name, and their role on the section. */
export type Decider = { id: string; name: string; role: string | null }

/**
 * The deciders of a run's bands, resolved in one statement.
 *
 * Both halves are needed and neither is on `run_bands`. The **name** is what the replay promises
 * ("the replay names the colleague whose decision a reviewer is looking at", `scoring/schema.ts`),
 * and without it the screen prints a uuid at a colleague. The **role on this section** is 08 §4's
 * TA rule: a teaching assistant may re-decide a dimension another TA decided and may not touch one
 * an instructor decided, so "somebody decided this" is not the question — `assertNotInstructorLocked`
 * asks the same thing one row at a time when the decision is written, and the screen has to ask it
 * for all seven before offering a control that would refuse.
 *
 * `tenantId` first and joined through, like every other tenant-scoped read (D-006): the membership
 * is only a membership of *this* institution's section, and a role read across a tenant boundary is
 * the shape a permission bug takes.
 */
export async function findDeciders(
  tenantId: string,
  sectionId: string,
  userIds: readonly string[],
  dbx: DbOrTx = db,
): Promise<Decider[]> {
  if (userIds.length === 0) return []
  return dbx
    .select({ id: user.id, name: user.name, role: sectionMemberships.role })
    .from(user)
    .leftJoin(
      sectionMemberships,
      and(eq(sectionMemberships.userId, user.id), eq(sectionMemberships.sectionId, sectionId)),
    )
    .leftJoin(
      sections,
      and(eq(sections.id, sectionMemberships.sectionId), eq(sections.organizationId, tenantId)),
    )
    .where(inArray(user.id, [...userIds]))
}

/** Inserts one neutralization; the service checks for an existing one on the claim first. */
export async function insertNeutralization(
  row: NewClaimNeutralization,
  dbx: DbOrTx = db,
): Promise<ClaimNeutralization> {
  const [neutralization] = await dbx.insert(claimNeutralizations).values(row).returning()
  return one(neutralization)
}

/** The neutralizations entered on one run, newest first (`created_at desc, id desc`). */
export async function listNeutralizations(
  runId: string,
  dbx: DbOrTx = db,
): Promise<ClaimNeutralization[]> {
  return dbx
    .select()
    .from(claimNeutralizations)
    .where(eq(claimNeutralizations.runId, runId))
    .orderBy(desc(claimNeutralizations.createdAt), desc(claimNeutralizations.id))
}

/** The correction already entered on this claim of this run, if there is one (FR-003). */
export async function findNeutralizationForClaim(
  runId: string,
  claimId: string,
  dbx: DbOrTx = db,
): Promise<ClaimNeutralization | undefined> {
  const [row] = await dbx
    .select()
    .from(claimNeutralizations)
    .where(and(eq(claimNeutralizations.runId, runId), eq(claimNeutralizations.claimId, claimId)))
    .limit(1)
  return row
}

// ---------------------------------------------------------------------------------------------
// What the replay and the queue need beside the run's own tables
// ---------------------------------------------------------------------------------------------

/** The run's place in the course, and the two authored facts the replay reads beside it. */
export type ReviewRunContext = {
  runId: string
  organizationId: string
  assignmentId: string
  sectionId: string
  courseId: string
  packageVersionId: string
  variantId: string
  variantKey: 'defective' | 'sound'
  studentId: string
  studentName: string
  /** `courses.mapping` (FR-202): what each band is worth in this course's gradebook. */
  mapping: { novice: number; developing: number; proficient: number; professional: number }
  /** `courses.outside_ai_policy` — the sentence a declaration is read against (FR-061). */
  outsideAiPolicy: 'open' | 'declared' | 'in_environment_only'
}

/**
 * Everything about a run that lives in another module's tables and the replay needs by value.
 *
 * One statement rather than four service calls: the replay is a page load, the joins are all by
 * primary key, and the alternative is `courses`, `scenarios` and `identity` each answering a
 * question about a run they do not own. It reads and never writes.
 */
export async function findRunContext(
  tenantId: string,
  runId: string,
  dbx: DbOrTx = db,
): Promise<ReviewRunContext | undefined> {
  const [row] = await dbx
    .select({
      runId: runs.id,
      organizationId: runs.organizationId,
      assignmentId: runs.assignmentId,
      sectionId: assignments.sectionId,
      courseId: sections.courseId,
      packageVersionId: runs.packageVersionId,
      variantId: runs.variantId,
      variantKey: scenarioVariants.key,
      studentId: runs.studentId,
      studentName: user.name,
      mapping: courses.mapping,
      outsideAiPolicy: courses.outsideAiPolicy,
    })
    .from(runs)
    .innerJoin(assignments, eq(assignments.id, runs.assignmentId))
    .innerJoin(sections, eq(sections.id, assignments.sectionId))
    .innerJoin(courses, eq(courses.id, sections.courseId))
    .innerJoin(scenarioVariants, eq(scenarioVariants.id, runs.variantId))
    .innerJoin(user, eq(user.id, runs.studentId))
    .where(and(eq(runs.organizationId, tenantId), eq(runs.id, runId)))
    .limit(1)
  return row
}

/** Whether a claim id belongs to the run's own package version (the neutralization's first check). */
export async function claimInVersion(
  packageVersionId: string,
  claimId: string,
  dbx: DbOrTx = db,
): Promise<boolean> {
  const [row] = await dbx
    .select({ id: scenarioClaims.id })
    .from(scenarioClaims)
    .where(
      and(eq(scenarioClaims.packageVersionId, packageVersionId), eq(scenarioClaims.id, claimId)),
    )
    .limit(1)
  return row !== undefined
}

/** The claims of a package version, in authored order: what the replay draws a claim object for. */
export async function listVersionClaimIds(
  packageVersionId: string,
  dbx: DbOrTx = db,
): Promise<string[]> {
  const rows = await dbx
    .select({ id: scenarioClaims.id })
    .from(scenarioClaims)
    .where(eq(scenarioClaims.packageVersionId, packageVersionId))
    .orderBy(asc(scenarioClaims.position), asc(scenarioClaims.key))
  return rows.map((row) => row.id)
}

/**
 * Whether the run's trace already holds an event of this type (FR-152's `debrief_answer`).
 *
 * `exists` rather than a list: the question is whether the student has already answered, and
 * loading the payload to find out would be reading a student's two sentences to make a transition.
 */
export async function hasEventOfType(
  runId: string,
  type: RunEvent['type'],
  dbx: DbOrTx = db,
): Promise<boolean> {
  const [row] = await dbx
    .select({ seq: runEvents.seq })
    .from(runEvents)
    .where(and(eq(runEvents.runId, runId), eq(runEvents.type, type)))
    .limit(1)
  return row !== undefined
}

/** The instructors and TAs of a section: who an `export_ready` notice goes to (SYS-010). */
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

/** One row of the reviewer's run list: the run, who took it, and how far the decisions have got. */
export type ReviewRunRow = {
  run: Run
  studentId: string
  studentName: string
  variantKey: 'defective' | 'sound'
  decisionsMade: number
  latestExportVersion: number | null
}

const decisionsMadeSql = sql<number>`(
  select count(*)::int from ${runBands}
   where ${runBands.runId} = ${runs.id} and ${runBands.decision} is not null
)`

const latestExportVersionSql = sql<number | null>`(
  select max(${courseExports.version}) from ${courseExports}
   where ${courseExports.runId} = ${runs.id}
)`

/**
 * The runs of one section, newest first, with their decision progress (10 §12).
 *
 * Voided runs are listed. A voided run is part of what happened in the section — the re-offer beside
 * it is the other half — and a table that hid them would leave an instructor wondering where an
 * attempt went. What a voided run does *not* do is contribute an export, which is the export
 * reads' rule rather than this one's (D-434).
 */
export async function listSectionRuns(
  tenantId: string,
  sectionId: string,
  dbx: DbOrTx = db,
): Promise<ReviewRunRow[]> {
  return dbx
    .select({
      run: runs,
      studentId: runs.studentId,
      studentName: user.name,
      variantKey: scenarioVariants.key,
      decisionsMade: decisionsMadeSql,
      latestExportVersion: latestExportVersionSql,
    })
    .from(runs)
    .innerJoin(assignments, eq(assignments.id, runs.assignmentId))
    .innerJoin(user, eq(user.id, runs.studentId))
    .innerJoin(scenarioVariants, eq(scenarioVariants.id, runs.variantId))
    .where(and(eq(runs.organizationId, tenantId), eq(assignments.sectionId, sectionId)))
    .orderBy(desc(runs.createdAt), desc(runs.id))
}

/**
 * The runs waiting for this reviewer across every section they hold a role in (FR-186, D-096).
 *
 * `scored` and held runs both: a scored run wants seven decisions, and a held one wants a hand or a
 * void (FR-140). Neither is a "queue position" and nothing here is ranked — the order is newest
 * first, which is the only order a list of other people's work should have.
 */
export async function listRunsAwaitingReview(
  tenantId: string,
  sectionIds: readonly string[],
  dbx: DbOrTx = db,
): Promise<ReviewRunRow[]> {
  if (sectionIds.length === 0) return []
  return dbx
    .select({
      run: runs,
      studentId: runs.studentId,
      studentName: user.name,
      variantKey: scenarioVariants.key,
      decisionsMade: decisionsMadeSql,
      latestExportVersion: latestExportVersionSql,
    })
    .from(runs)
    .innerJoin(assignments, eq(assignments.id, runs.assignmentId))
    .innerJoin(user, eq(user.id, runs.studentId))
    .innerJoin(scenarioVariants, eq(scenarioVariants.id, runs.variantId))
    .where(
      and(
        eq(runs.organizationId, tenantId),
        inArray(assignments.sectionId, [...sectionIds]),
        sql`(${runs.state} = 'scored' or ${runs.scoringStatus} = 'held')`,
      ),
    )
    .orderBy(desc(runs.createdAt), desc(runs.id))
}

/** The sections of the tenant this actor may review, from their own memberships (08 §5). */
export async function listReviewerSectionIds(
  tenantId: string,
  userId: string,
  dbx: DbOrTx = db,
): Promise<string[]> {
  const rows = await dbx
    .select({ sectionId: sectionMemberships.sectionId })
    .from(sectionMemberships)
    .where(
      and(
        eq(sectionMemberships.organizationId, tenantId),
        eq(sectionMemberships.userId, userId),
        inArray(sectionMemberships.role, ['instructor', 'ta']),
      ),
    )
  return [...new Set(rows.map((row) => row.sectionId))]
}
