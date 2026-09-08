// Module `assistant` — repository (docs/tech/10-backend-spec-modules.md §7; table run_delegations,
// 06 §3.4). A delegation row is inserted empty before the stream starts and completed or failed when
// it ends; `why` and reviewer flags are edited later. run_delegations has no organization_id; every
// function is scoped through the run id the service already resolved in the tenant.
//
// Below the delegation rows sit four reads of tables this module does not own: the version's claims
// with their trigger phrases, the brief and the stakeholders' names, the documents the student has
// opened, and the version's Sycophancy Probe. They are here for the reason D-242 gives one module
// along: what `assistant-reply@5` renders is a handful of columns across four tables, and the
// alternative — a view on the `scenarios` module wide enough to carry them — would be a second
// student-facing projection of a package, built for a prompt, sitting next to the one 12 §8 governs.
// Reading the columns here keeps the withholding *in the query*: the trigger phrases and the carried
// values that reach this file are prompt inputs and guard inputs, and no field of
// `variant_claim_states` — the warranted stance, the evidence status, the planted flag — is
// selected by any statement in it. The assistant cannot leak an answer key it never loads.
//
// The last section reads three more of those tables for the analytics groups of 17 §3.3 — the
// variant key, two enums per claim, the course's outside-AI policy — and keeps the same rule: ids
// and enums, nothing authored, nothing a student wrote, and no column of `variant_claim_states`.
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { AppError } from '@/lib/errors'
import { db } from '@/server/db/client'
import {
  assignments,
  courses,
  runClaims,
  runDelegations,
  runDocumentOpens,
  runs,
  scenarioClaims,
  scenarioDocuments,
  scenarioPackageVersions,
  scenarioTurns,
  scenarioVariants,
  sections,
  stakeholders,
  sycophancyProbes,
  type NewRunDelegation,
  type RunDelegation,
} from '@/server/db/schema'
import type { DbOrTx } from '@/server/db/tx'

// The service layer may not import `src/server/db` (04 §2), so the handles and row types it names
// reach it through here, the one file in this module that may.
export type { DbOrTx, Tx } from '@/server/db/tx'
export { withTransaction } from '@/server/db/tx'
export type { RunDelegation }

/**
 * The request as it is stored before streaming. `seq` may be supplied; when omitted it is allocated
 * as `max(seq) + 1` for the run inside the insert, which is safe because the service holds the run
 * row lock for the whole mutation (10 §6).
 */
export type DelegationInsert = Omit<
  NewRunDelegation,
  'id' | 'runId' | 'seq' | 'responseText' | 'failed' | 'createdAt' | 'updatedAt'
> & { seq?: number }

/** What the completed stream produced (FR-050 to FR-056). */
export type DelegationCompletion = Pick<
  NewRunDelegation,
  'responseText' | 'claimIds' | 'flags' | 'unverifiedNumbers'
>

/** Later edits: the why line (FR-060), reviewer flags (FR-055), and claim references. */
export type DelegationPatch = Partial<
  Pick<NewRunDelegation, 'why' | 'flags' | 'claimIds' | 'unverifiedNumbers'>
>

export async function insertDelegation(
  runId: string,
  values: DelegationInsert,
  dbx: DbOrTx = db,
): Promise<RunDelegation> {
  const { seq, ...rest } = values
  const [row] = await dbx
    .insert(runDelegations)
    .values({
      ...rest,
      runId,
      seq:
        seq ??
        sql<number>`(select coalesce(max(${runDelegations.seq}), 0) + 1 from ${runDelegations} where ${runDelegations.runId} = ${runId})`,
    })
    .returning()
  if (!row) throw new AppError('INTERNAL_ERROR', 'The insert returned no row.')
  return row
}

/** Stores the reply once the stream has ended; `undefined` when the delegation is not on the run. */
export async function completeDelegation(
  runId: string,
  delegationId: string,
  completion: DelegationCompletion,
  dbx: DbOrTx = db,
): Promise<RunDelegation | undefined> {
  const [row] = await dbx
    .update(runDelegations)
    .set(completion)
    .where(and(eq(runDelegations.runId, runId), eq(runDelegations.id, delegationId)))
    .returning()
  return row
}

/** Marks a delegation whose stream failed; the response stays empty (FR-001). */
export async function failDelegation(
  runId: string,
  delegationId: string,
  dbx: DbOrTx = db,
): Promise<RunDelegation | undefined> {
  const [row] = await dbx
    .update(runDelegations)
    .set({ failed: true })
    .where(and(eq(runDelegations.runId, runId), eq(runDelegations.id, delegationId)))
    .returning()
  return row
}

/** The Delegation Log in request order. */
export async function listDelegations(runId: string, dbx: DbOrTx = db): Promise<RunDelegation[]> {
  return dbx
    .select()
    .from(runDelegations)
    .where(eq(runDelegations.runId, runId))
    .orderBy(asc(runDelegations.seq))
}

export async function updateDelegation(
  runId: string,
  delegationId: string,
  patch: DelegationPatch,
  dbx: DbOrTx = db,
): Promise<RunDelegation | undefined> {
  const [row] = await dbx
    .update(runDelegations)
    .set(patch)
    .where(and(eq(runDelegations.runId, runId), eq(runDelegations.id, delegationId)))
    .returning()
  return row
}

// ---------------------------------------------------------------------------------------------
// What the prompt and the guards are built from (11 §2.1, §3)
// ---------------------------------------------------------------------------------------------

/** One claim of the run's version as the matcher and the prompt need it (10 §7, D-030). */
export type ClaimCandidate = {
  id: string
  key: string
  text: string
  triggerPhrases: string[]
  triggerDescription: string
  /** `scenario_claims.carried_values`: the exact figures the claim text may round (D-068). */
  carriedValues: number[]
}

/**
 * Every consequential claim of a package version, in authored order.
 *
 * All of them, not only the unsurfaced ones. 10 §7's "already-surfaced claims are referenced, not
 * re-surfaced" is a rule about `run_claims`, not about matching: a student who asks the same
 * question twice gets the same answer twice, with the claim carried again, and the second delegation
 * records that it carried it. Matching only the unsurfaced ones would make the assistant go quiet on
 * a repeated question — the one behaviour a student would read as the room hiding something (D-267).
 */
export async function listVersionClaims(
  versionId: string,
  dbx: DbOrTx = db,
): Promise<ClaimCandidate[]> {
  const rows = await dbx
    .select({
      id: scenarioClaims.id,
      key: scenarioClaims.key,
      text: scenarioClaims.text,
      triggerPhrases: scenarioClaims.triggerPhrases,
      triggerDescription: scenarioClaims.triggerDescription,
      carriedValues: scenarioClaims.carriedValues,
    })
    .from(scenarioClaims)
    .where(eq(scenarioClaims.packageVersionId, versionId))
    .orderBy(asc(scenarioClaims.position), asc(scenarioClaims.key))

  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    text: row.text,
    triggerPhrases: row.triggerPhrases,
    triggerDescription: row.triggerDescription,
    carriedValues: row.carriedValues.map((carried) => carried.value),
  }))
}

/** The `worldSummary` half of `assistant-reply@5`: the brief, and who is in the room (10 §7). */
export type WorldSummarySource = {
  brief: string
  people: { name: string; roleTitle: string }[]
}

/**
 * The brief and the stakeholders' names and roles — and neither their position statements nor their
 * blind spots, which 10 §7 keeps out of the world summary in as many words and 12 §8.1 keeps out of
 * every student-facing surface. The prompt is a student-facing surface: whatever the model is told
 * it can be asked to repeat.
 *
 * `scenario_package_versions` is a tenant-scoped table (06 §2), so the tenant comes first and is
 * filtered on (D-006) — even though the version id was read off a run row this transaction already
 * resolved in that tenant. The guard is cheap and it is one fewer place where "the caller checked"
 * has to be true.
 */
export async function findWorldSummarySource(
  tenantId: string,
  versionId: string,
  dbx: DbOrTx = db,
): Promise<WorldSummarySource> {
  const [version] = await dbx
    .select({ brief: scenarioPackageVersions.brief })
    .from(scenarioPackageVersions)
    .where(
      and(
        eq(scenarioPackageVersions.id, versionId),
        eq(scenarioPackageVersions.organizationId, tenantId),
      ),
    )

  const people = await dbx
    .select({ name: stakeholders.name, roleTitle: stakeholders.roleTitle })
    .from(stakeholders)
    .where(eq(stakeholders.packageVersionId, versionId))
    .orderBy(asc(stakeholders.key))

  return { brief: version?.brief ?? '', people }
}

/** One document the student has opened, as the prompt carries it (11 §3 caps the excerpt). */
export type OpenedDocument = { id: string; title: string; body: string }

/**
 * The documents this run has opened, most recently first, one row each however often they were
 * opened.
 *
 * The assistant is given what the student has read, which is what makes "never state a number that
 * is not in the claims, the documents quoted below, or the student's own words" a rule the numeric
 * guard can enforce over the same set (11 §3). A document nobody opened is not in the room as far
 * as this reply is concerned, even though it is in the Evidence Room: quoting it would put a figure
 * in front of a student who has not seen where it came from.
 */
export async function listOpenedDocuments(
  runId: string,
  limit: number,
  dbx: DbOrTx = db,
): Promise<OpenedDocument[]> {
  const rows = await dbx
    .select({
      id: scenarioDocuments.id,
      title: scenarioDocuments.title,
      body: scenarioDocuments.body,
      lastOpenedAt: sql<Date>`max(${runDocumentOpens.openedAt})`.as('last_opened_at'),
    })
    .from(runDocumentOpens)
    .innerJoin(scenarioDocuments, eq(scenarioDocuments.id, runDocumentOpens.documentId))
    .where(eq(runDocumentOpens.runId, runId))
    .groupBy(scenarioDocuments.id, scenarioDocuments.title, scenarioDocuments.body)
    .orderBy(desc(sql`max(${runDocumentOpens.openedAt})`))
    .limit(limit)

  return rows.map((row) => ({ id: row.id, title: row.title, body: row.body }))
}

/**
 * Whether this run has opened any document at all (FR-022, 17 §3.3 `before_any_document_open`).
 *
 * One row or none, never the bodies: `listOpenedDocuments` above answers the same question by
 * carrying every document the student has read, and asking it that way to learn a boolean would
 * pull a dozen document bodies through the process to count them.
 */
export async function hasOpenedDocument(runId: string, dbx: DbOrTx = db): Promise<boolean> {
  const [row] = await dbx
    .select({ id: runDocumentOpens.id })
    .from(runDocumentOpens)
    .where(eq(runDocumentOpens.runId, runId))
    .limit(1)
  return row !== undefined
}

/** DATA-022: the version's Sycophancy Probe, when it has one (FR-053, D-088). */
export type ProbeRow = { claimId: string; scriptedReversal: string }

export async function findProbe(
  versionId: string,
  dbx: DbOrTx = db,
): Promise<ProbeRow | undefined> {
  const [row] = await dbx
    .select({
      claimId: sycophancyProbes.claimId,
      scriptedReversal: sycophancyProbes.scriptedReversal,
    })
    .from(sycophancyProbes)
    .where(eq(sycophancyProbes.packageVersionId, versionId))
  return row
}

/** The claims of one delegation, joined to their authored text, in authored order. */
export async function listClaimTexts(
  claimIds: readonly string[],
  dbx: DbOrTx = db,
): Promise<{ id: string; key: string; text: string }[]> {
  if (claimIds.length === 0) return []
  return dbx
    .select({ id: scenarioClaims.id, key: scenarioClaims.key, text: scenarioClaims.text })
    .from(scenarioClaims)
    .where(inArray(scenarioClaims.id, [...claimIds]))
    .orderBy(asc(scenarioClaims.position), asc(scenarioClaims.key))
}

/** One delegation of one run, or `undefined` when the id belongs to another run. */
export async function findDelegation(
  runId: string,
  delegationId: string,
  dbx: DbOrTx = db,
): Promise<RunDelegation | undefined> {
  const [row] = await dbx
    .select()
    .from(runDelegations)
    .where(and(eq(runDelegations.runId, runId), eq(runDelegations.id, delegationId)))
  return row
}

/** The Turn's own text, for the `turnContext` a delegation inside the window carries (11 §2.1). */
export async function findTurnText(versionId: string, dbx: DbOrTx = db): Promise<string | null> {
  const [row] = await dbx
    .select({ text: scenarioTurns.text })
    .from(scenarioTurns)
    .where(eq(scenarioTurns.packageVersionId, versionId))
  return row?.text ?? null
}

// ---------------------------------------------------------------------------------------------
// The run's own claims, as the Delegation Log lists them (FR-060)
// ---------------------------------------------------------------------------------------------

/** One surfaced claim of the run: the claim, the stance it carries now, and the used mark. */
export type RunClaimRow = {
  claimId: string
  key: string
  text: string
  stance: 'accept' | 'verify' | 'challenge' | 'reject' | 'escalate' | null
  usedMarked: boolean
}

/**
 * Every claim this run has surfaced, in surfacing order, with its current stance.
 *
 * `run_claims` belongs to the `reliance` module, and this is the second read of it here rather than
 * a call into that module for a reason its own `listRunClaims` makes plain: that function is the
 * student's claim list and starts with `requireRunOwner`, and the Delegation Log is read by the
 * run's reviewers as well (07 §7). Rather than open a second, guard-free entry point on another
 * module's service, the log reads the five columns it renders — and the columns it does *not* read
 * are the point: no join to `variant_claim_states`, so the warranted stance and the planted flag are
 * not in the query that draws the log.
 */
export async function listRunClaimRows(runId: string, dbx: DbOrTx = db): Promise<RunClaimRow[]> {
  return (
    dbx
      .select({
        claimId: runClaims.claimId,
        key: scenarioClaims.key,
        text: scenarioClaims.text,
        stance: runClaims.stance,
        usedMarked: runClaims.usedMarked,
      })
      .from(runClaims)
      .innerJoin(scenarioClaims, eq(scenarioClaims.id, runClaims.claimId))
      .where(eq(runClaims.runId, runId))
      // Surfacing order, then the authored position — the tiebreak `reliance` uses for the same
      // reason (D-274): several claims surface in one instant and a random uuid is not an order.
      .orderBy(asc(runClaims.surfacedAt), asc(scenarioClaims.position), asc(scenarioClaims.key))
  )
}

// ---------------------------------------------------------------------------------------------
// The three reads the run's analytics events are built from (17 §3.3)
//
// None of them touches `variant_claim_states`, so the rule the rest of this file keeps holds here
// too: the answer key is not loaded, and an event cannot carry what the query never fetched.
// ---------------------------------------------------------------------------------------------

/**
 * Which variant the run was given, as the `R` group names it (17 §3.3).
 *
 * `runs.variant_id` is a uuid and the property is the key. Copied from `runs/repository.ts` rather
 * than reached through the runs module for the reason the four authored reads above are copied
 * (D-242): a repository reaches the database and `src/lib`, and one indexed read is a smaller thing
 * to repeat than a door to open. `null` when the row is gone, which the foreign key does not allow.
 */
export async function findVariantKey(
  variantId: string,
  dbx: DbOrTx = db,
): Promise<'defective' | 'sound' | null> {
  const [row] = await dbx
    .select({ key: scenarioVariants.key })
    .from(scenarioVariants)
    .where(eq(scenarioVariants.id, variantId))
  return row?.key ?? null
}

/** The `C` group of a claim (17 §3.3): a uuid and two enums, which is all an event carries. */
export type ClaimAnalyticsRow = {
  id: string
  importance: 'load_bearing' | 'supporting'
  consequenceLevel: 'low' | 'medium' | 'high'
}

/**
 * The importance and consequence level of the claims an event names.
 *
 * Read here rather than taken off a claim card, because neither is on one: both are the author's
 * reading of the claim, `ClaimView` carries neither in any state (12 §8), and an analytics group is
 * not a reason to put them there.
 */
export async function listClaimContexts(
  claimIds: readonly string[],
  dbx: DbOrTx = db,
): Promise<ClaimAnalyticsRow[]> {
  if (claimIds.length === 0) return []
  return dbx
    .select({
      id: scenarioClaims.id,
      importance: scenarioClaims.importance,
      consequenceLevel: scenarioClaims.consequenceLevel,
    })
    .from(scenarioClaims)
    .where(inArray(scenarioClaims.id, [...claimIds]))
    .orderBy(asc(scenarioClaims.position), asc(scenarioClaims.key))
}

/**
 * The outside-AI policy of the course the run belongs to (FR-061, 17 §3.3).
 *
 * The one property `outside_tool_declared` carries beside the run's own context, and the only thing
 * about the declaration that ever leaves the run: what the student typed is theirs. Three joins
 * from the run to the course that set the policy, filtered on the tenant like every read of a
 * tenant-scoped table (D-006).
 */
export async function findCoursePolicy(
  tenantId: string,
  runId: string,
  dbx: DbOrTx = db,
): Promise<'open' | 'declared' | 'in_environment_only' | undefined> {
  const [row] = await dbx
    .select({ policy: courses.outsideAiPolicy })
    .from(runs)
    .innerJoin(assignments, eq(assignments.id, runs.assignmentId))
    .innerJoin(sections, eq(sections.id, assignments.sectionId))
    .innerJoin(courses, eq(courses.id, sections.courseId))
    .where(and(eq(runs.organizationId, tenantId), eq(runs.id, runId)))
  return row?.policy
}
