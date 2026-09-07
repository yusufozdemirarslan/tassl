// Service of the `review` module (docs/tech/10-backend-spec-modules.md §12; 07-api-spec.md §8;
// 08-auth-authz.md §4; FR-003, FR-005, FR-008, FR-055, FR-118, FR-140, FR-180 to FR-186, FR-232).
//
// This is the faculty seat. Everything a run *becomes* after the pipeline has drafted its bands is
// decided here: the replay a reviewer reads, the seven decisions that confirm it, the correction
// that raises a band when Tassl got something wrong, the hand-banding of a run nothing could place,
// and the void that takes a run out of the gradebook altogether.
//
// Three rules run through every function below and none of them is a preference.
//
//   * **The instructor's judgment is final** (FR-182). Nothing in this file re-scores a confirmed
//     run, and a correction is a floor under a decision rather than a replacement for it — the
//     composition lives in `scoring.effectiveBandOf` (D-422) and every reader takes it from there.
//   * **A TA may decide, but not re-decide what the instructor decided** (08 §4). It is one row of
//     the permission matrix and it is enforced per dimension, because a TA may perfectly well
//     decide the six the instructor has not touched.
//   * **The replay is the reviewer's document and a student reaches none of it.** It carries
//     warranted stances, evidence status, failure families, the probe, the expected-answer notes and
//     the reviewer-only band evidence — every one of them a thing 12 §8.1 keeps out of a student
//     payload in every state. `requireRunReviewer` is the gate, and there is no student route into
//     any shape this file builds.
import { AppError, isAppError } from '@/lib/errors'
import { flagsFromEnv } from '@/lib/flags'
import { t } from '@/lib/i18n/t'
import { findSectionMembership } from '@/server/auth/queries'
import {
  requireRunInstructor,
  requireRunReviewer,
  requireSectionRole,
  type SectionRole,
} from '@/server/auth/permissions'
import type { SessionUser } from '@/server/auth/types'
import { env } from '@/server/config'
import { audit } from '@/server/modules/admin'
import { listDelegations, type DelegationView } from '@/server/modules/assistant'
import { notify } from '@/server/modules/notifications'
import {
  listRunExports,
  sample,
  writeCourseExport,
  type ExportSummary,
} from '@/server/modules/records'
import { markClaimNeutralized } from '@/server/modules/reliance'
import {
  lockRunForMutation,
  markAdjusted,
  markConfirmed,
  markRecorded,
  markReplayOpened,
  markScored,
  toRunSummary,
  type RunReviewSummary,
  type RunSummary,
} from '@/server/modules/runs'
import {
  flagVersionForReview,
  getClaimObject,
  getPackageVersion,
  type ClaimObjectView,
  type PackageVersionView,
} from '@/server/modules/scenarios'
import {
  DIMENSIONS,
  allDimensionsDecided,
  applyNeutralization,
  bandRunManually,
  computePoints,
  draftBandEventPayload,
  effectiveBandsOf,
  priceBands,
  readBands,
  writeBandDecisions,
  writeConfirmedPoints,
  type Band,
  type BandDecisionWrite,
  type BandView,
  type Dimension,
  type RecomputeResult,
  type RunGraphs,
} from '@/server/modules/scoring'
import { listMyInstitutions } from '@/server/modules/tenancy'
import { append, listEvents, type TraceEventView } from '@/server/modules/trace'
import {
  bandDecisionInvalid,
  bandLockedByInstructor,
  claimNotFound,
  neutralizationExists,
  runNotFound,
  runNotHeld,
  runNotScored,
} from './errors'
import * as repo from './repository'
import type {
  BandDecisionInput,
  ManualBandsInput,
  NeutralizeInput,
  ReplayCapabilities,
  ReplayConcept,
  ReplayDeclaration,
  ReplayNeutralization,
  ReplayObservationValue,
  ReplayPoints,
  ReplayPointsBasisValue,
  ReplayUnverifiedNumber,
} from './schema'

export type {
  BandDecisionInput,
  BandDecisionKind,
  ManualBandsInput,
  NeutralizeInput,
  NeutralizeResultView,
  ReplayCapabilities,
  ReplayConcept,
  ReplayDeclaration,
  ReplayExport,
  ReplayLabels,
  ReplayMapping,
  ReplayNeutralization,
  ReplayObservationValue,
  ReplayPoints,
  ReplayPointsBasisValue,
  ReplayUnverifiedNumber,
} from './schema'

/** The states a run's bands can be decided in (10 §12). */
const DECIDABLE_STATES: ReadonlySet<string> = new Set(['scored', 'confirmed', 'recorded'])

/** The states in which a decision is a *re*-decision, and so writes a new export (D-087). */
const CONFIRMED_STATES: ReadonlySet<string> = new Set(['confirmed', 'recorded'])

// ---------------------------------------------------------------------------------------------
// The seat
// ---------------------------------------------------------------------------------------------

type Reviewer = {
  runId: string
  organizationId: string
  sectionId: string
  studentId: string
  role: SectionRole
}

/**
 * The section role behind a reviewer, which `requireRunReviewer` proves but does not report.
 *
 * Two questions rather than one, and both are needed: whether this actor may read the run at all
 * (`requireRunReviewer`, which answers NOT_FOUND for a run outside their sections and FORBIDDEN for
 * a classmate), and *which* of the two reviewing roles they hold — because 08 §4 gives an instructor
 * and a TA different rows on void, neutralize and re-decision.
 */
async function requireReviewer(actor: SessionUser, runId: string): Promise<Reviewer> {
  const scope = await requireRunReviewer(actor, runId)
  const membership = await requireSectionRole(actor, scope.sectionId, ['instructor', 'ta'])
  return {
    runId: scope.runId,
    organizationId: scope.organizationId,
    sectionId: scope.sectionId,
    studentId: scope.studentId,
    role: membership.role,
  }
}

// ---------------------------------------------------------------------------------------------
// The replay (FR-180, UI-033, D-120)
// ---------------------------------------------------------------------------------------------

/**
 * `GET /review/runs/{runId}`: everything a faculty seat needs to read one run (10 §12).
 *
 * It is a composition rather than a query. Each piece is answered by the module that owns it — the
 * trace by `trace.listEvents`, the graphs and bands by `scoring`, the package and the claim objects
 * by `scenarios`, the log by `assistant` — and what this function adds is the run's own context and
 * the two things only the seat knows: what this reviewer may do (`capabilities`) and what the
 * screen must always say (`labels.uncalibrated`, Appendix A.0).
 *
 * **The first open is recorded** (D-120). `flags.replay_first_opened_at` is what
 * `run_confirmed.review_duration_ms` is measured from, so it is stamped once and never restamped —
 * a reviewer who reopens the replay after confirming has not made the review longer. It is a write
 * inside a read, which is the same shape `debrief_opened` has one module along and for the same
 * reason: the fact being recorded is that somebody looked.
 */
export async function getReplay(actor: SessionUser, runId: string): Promise<ReplayBundle> {
  const seat = await requireReviewer(actor, runId)
  const tenantId = seat.organizationId

  const context = await repo.findRunContext(tenantId, runId)
  if (!context) runNotFound()

  await repo.withTransaction(async (tx) => {
    const run = await lockRunForMutation(tx, tenantId, runId)
    await markReplayOpened(tx, run)
  })

  const data = await repo.findReplayData(tenantId, runId)
  if (!data) runNotFound()

  const [events, bands, delegations, packageView, exports, claimIds] = await Promise.all([
    listEvents(actor, runId),
    readBands(runId),
    listDelegations(actor, runId),
    getPackageVersion(actor, context.packageVersionId),
    listRunExports(actor, runId).catch(emptyWhenNoExports),
    repo.listVersionClaimIds(context.packageVersionId),
  ])
  // One claim object per authored claim, carrying **both** variants' states (UI-033, FR-253).
  //
  // `getClaimObject`'s variant argument filters the states down to one, and passing the run's own
  // would leave the replay unable to draw the two side by side — which is the whole of what the
  // Package tab is for: the difference between the two readings of a claim *is* the defect, and a
  // reviewer deciding a band on a defective variant is asking what the sound one said. The run's
  // variant is on the bundle already (`run.variantKey`), and the screen marks it there.
  const claims: ClaimObjectView[] = []
  for (const claimId of claimIds) {
    claims.push(await getClaimObject(actor, context.packageVersionId, claimId))
  }

  const isInstructor = seat.role === 'instructor'
  return {
    run: toReviewSummary(data.run, context, data.bands, exports),
    events,
    graphs: (data.score?.graphs as RunGraphs | undefined) ?? null,
    defense: data.questions.map((entry) => ({
      runQuestionId: entry.question.id,
      seq: entry.question.seq,
      kind: entry.kind,
      text: entry.question.renderedText,
      followUpOf: entry.question.followUpOf,
      // 12 §8.1's "expected-answer notes" row: the replay is the one read that carries them, and no
      // student payload anywhere does.
      expectedAnswerNotes: entry.expectedAnswerNotes,
      answer: entry.answer?.text ?? null,
      answeredAt: entry.answer?.answeredAt.toISOString() ?? null,
      durationMs: entry.answer?.durationMs ?? null,
    })),
    bands,
    delegations,
    readiness: readinessConcepts(data.readiness),
    package: packageView,
    claims,
    declarations: declarationsFrom(data.events, context.outsideAiPolicy),
    unverifiedNumbers: unverifiedNumbersFrom(delegations),
    neutralizations: data.neutralizations.map(toReplayNeutralization),
    exports,
    points: pointsOf(context.mapping, bands),
    deciders: await decidersOf(tenantId, seat.sectionId, bands),
    // `runs.flags` — instructor observations, forbidden in every student payload (12 §8.1).
    flags: { ...data.run.flags },
    observations: observationsOf(data),
    labels: { uncalibrated: true, isWalkthrough: data.run.isWalkthrough },
    // Every one of these answers "may this seat press it *on this run*", not "may this seat press
    // it at all". A voided run keeps its bands and its claims, so a capability that asked only
    // about the role would have offered seven decision controls, a correction per claim and a
    // second void on a run every one of those acts refuses (`assertDecidable`, `voidRun`'s
    // transition). A control that can only refuse is worse than an absent one.
    capabilities: {
      canDecide: DECIDABLE_STATES.has(data.run.state),
      canVoid: isInstructor && data.run.state !== 'voided',
      canNeutralize: isInstructor && DECIDABLE_STATES.has(data.run.state),
      canForceFailure: isInstructor && flagsFromEnv(env).testControls,
      canBandManually: data.run.scoringStatus === 'held',
      isInstructor,
    } satisfies ReplayCapabilities,
  }
}

/**
 * The replay bundle as the screens read it (07 §8, UI-033).
 *
 * The wire schema in `./schema.ts` declares the foreign documents loosely, because a module schema
 * may import nothing but `src/lib` (04 §2); this type names their real shapes, so a Server Component
 * building the replay gets the types the owning modules published.
 */
export type ReplayBundle = {
  run: RunReviewSummary
  events: TraceEventView[]
  graphs: RunGraphs | null
  defense: ReplayDefenseEntry[]
  bands: BandView[]
  delegations: DelegationView[]
  readiness: ReplayConcept[]
  package: PackageVersionView
  claims: ClaimObjectView[]
  declarations: ReplayDeclaration[]
  unverifiedNumbers: ReplayUnverifiedNumber[]
  neutralizations: ReplayNeutralization[]
  exports: ExportSummary[]
  points: ReplayPoints
  deciders: Record<string, { name: string; isInstructor: boolean }>
  flags: Record<string, unknown>
  observations: ReplayObservationValue[]
  labels: { uncalibrated: boolean; isWalkthrough: boolean }
  capabilities: ReplayCapabilities
}

/**
 * The course's arithmetic over the seven bands the replay is carrying (FR-202, D-445).
 *
 * `scoring.priceBands` and nothing else: the confirmation writes `points_confirmed` with it, the
 * mapping change rewrites every point column with it, and the debrief prices its own page with it.
 * A second implementation of "add the mapping's value for each assessed band and divide by how many
 * were assessed" would be a second answer to what a grade is — and the reviewer's screen and the
 * student's debrief must never be able to give different ones.
 *
 * It is priced here rather than read back from `run_scores` for the reason D-445 gives: a
 * neutralization raises a band and writes the correction columns without rewriting the confirmed
 * figure, so the stored number can name a total the bands beside it no longer support.
 */
function pointsOf(mapping: repo.ReviewRunContext['mapping'], bands: readonly BandView[]) {
  const priced = priceBands(bands, mapping)
  // Which bands the figure a reader is shown was priced from. `effective` is FR-005's floor — the
  // higher of the pre- and post-correction totals — so on a run whose correction raised nothing it
  // is the *pre*-correction figure, and a screen that showed the effective bands beside it would be
  // showing terms that do not sum to the total it prints (D-462).
  const basis: ReplayPointsBasisValue =
    priced.effective !== null
      ? priced.effective === priced.beforeCorrection
        ? 'before_correction'
        : 'after_correction'
      : priced.confirmed !== null
        ? 'confirmed'
        : 'draft'
  return {
    mapping,
    basis,
    assessed: Object.values(effectiveBandsOf(bands)).filter((band) => band !== null).length,
    draft: priced.draft,
    confirmed: priced.confirmed,
    effective: priced.effective,
  }
}

/**
 * Who decided each band, resolved once for the whole bundle (08 §4, `scoring/schema.ts`).
 *
 * `run_bands.decided_by` is a user id and a screen needs two other things from it: the colleague's
 * name, and whether they hold the instructor role on *this* section — which is the only thing that
 * makes a dimension untouchable by a teaching assistant. `assertNotInstructorLocked` asks the same
 * question one band at a time when a decision is written; the replay has to ask it for all seven
 * before it draws a control that would refuse.
 */
async function decidersOf(
  tenantId: string,
  sectionId: string,
  bands: readonly BandView[],
): Promise<Record<string, { name: string; isInstructor: boolean }>> {
  const ids = [...new Set(bands.map((band) => band.decidedBy).filter((id) => id !== null))]
  const rows = await repo.findDeciders(tenantId, sectionId, ids)
  return Object.fromEntries(
    rows.map((row) => [row.id, { name: row.name, isInstructor: row.role === 'instructor' }]),
  )
}

/**
 * What the run and the pipeline recorded about how the run went (FR-018, FR-106, FR-118, FR-125,
 * FR-141), gathered from the three tables that hold it into the one list UI-033 draws.
 *
 * `runs.flags` carries the run's own three, `run_scores.flags` carries FR-141's two placements and
 * FR-125's, and the locked brief carries FR-106's speed outlier — so `nothing_answered` is written
 * in two of them and appears once here. The screen labels what it is handed rather than deciding
 * which keys of three raw records are observations.
 *
 * **None of these is a finding about a person** (PRD §7 standing rules). Each names something that
 * happened in the run; `replay_first_opened_at` and `test` are not observations at all and are not
 * in the enum, which is why the raw `flags` record travels beside this list rather than instead of
 * it.
 */
function observationsOf(data: repo.ReplayData): ReplayObservationValue[] {
  const found = new Set<ReplayObservationValue>()
  for (const key of [
    'nothing_answered',
    'readiness_submit_failed',
    'forced_failure_armed',
  ] as const) {
    if (data.run.flags[key] === true) found.add(key)
  }
  for (const flag of data.score?.flags ?? []) {
    if (flag === 'all_novice' || flag === 'all_professional' || flag === 'nothing_answered') {
      found.add(flag)
    }
  }
  // FR-106's outlier is a field of the locked brief, and the layout graph is where it is published.
  const layout = (data.score?.graphs as { frame_beside_decision?: { brief?: unknown } } | undefined)
    ?.frame_beside_decision?.brief
  if ((layout as { speed_outlier?: unknown } | null | undefined)?.speed_outlier === true) {
    found.add('speed_outlier')
  }
  return [...found]
}

/** One question of the interview as the reviewer reads it, with the notes its author wrote. */
export type ReplayDefenseEntry = {
  runQuestionId: string
  seq: number
  kind: string
  text: string
  followUpOf: string | null
  expectedAnswerNotes: string
  answer: string | null
  answeredAt: string | null
  durationMs: number | null
}

/** A run with no export yet is a run with no export history, not a failed replay (FR-184). */
function emptyWhenNoExports(error: unknown): ExportSummary[] {
  if (isAppError(error) && error.code === 'RUN_NOT_CONFIRMED') return []
  throw error
}

function toReviewSummary(
  run: Parameters<typeof toRunSummary>[0],
  context: repo.ReviewRunContext,
  bands: readonly { decision: string | null }[],
  exports: readonly ExportSummary[],
): RunReviewSummary {
  return {
    ...toRunSummary(run),
    studentId: context.studentId,
    studentName: context.studentName,
    variantKey: context.variantKey,
    decisionsMade: bands.filter((band) => band.decision !== null).length,
    latestExportVersion: exports[0]?.version ?? null,
  }
}

function readinessConcepts(result: repo.ReplayData['readiness']): ReplayConcept[] {
  if (!result) return []
  // `run_readiness_results.concepts` is a jsonb body, so its keys are snake_case like every other
  // stored payload; the view is camelCase like every other view.
  return result.concepts.map((concept) => ({
    conceptKey: concept.concept_key,
    status: concept.status,
  }))
}

/**
 * Every outside-tool declaration of the run, beside the policy the course had set (FR-061).
 *
 * The policy travels with the declaration because that is the only way the sentence reads
 * correctly, and because **nothing Tassl observes is treated as misconduct** (PRD §7 standing
 * rules): a declaration is a fact about how the student worked, and the replay puts it next to what
 * the course asked for rather than next to a judgment.
 */
function declarationsFrom(
  events: repo.ReplayData['events'],
  coursePolicy: repo.ReviewRunContext['outsideAiPolicy'],
): ReplayDeclaration[] {
  return events
    .filter((event) => event.type === 'outside_tool_declared')
    .map((event) => ({
      purpose: String((event.payload as { purpose?: unknown }).purpose ?? ''),
      at: event.occurredAt.toISOString(),
      coursePolicy,
    }))
}

/** D-068's audit channel: the figures the assistant asserted with no source behind them. */
function unverifiedNumbersFrom(delegations: readonly DelegationView[]): ReplayUnverifiedNumber[] {
  return delegations.flatMap((delegation) =>
    (delegation.unverifiedNumbers ?? []).map((number) => ({
      delegationId: delegation.id,
      value: number.value,
      context: number.context,
    })),
  )
}

function toReplayNeutralization(
  row: repo.ReplayData['neutralizations'][number],
): ReplayNeutralization {
  return {
    id: row.id,
    claimId: row.claimId,
    reason: row.reason,
    creditChallenge: row.creditChallenge,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  }
}

// ---------------------------------------------------------------------------------------------
// Band decisions (FR-181, FR-182; 10 §12)
// ---------------------------------------------------------------------------------------------

/** What a decision answers (07 §8): the band as it now stands, and the run it may have moved. */
export type BandDecisionResult = { band: BandView; run: RunSummary }

/**
 * `PUT /review/runs/{runId}/bands/{dimension}`: confirm the draft, override it, or set the
 * dimension unassessed (FR-181).
 *
 * **The seventh decision confirms the run.** When every dimension carries a decision the run moves
 * `scored → confirmed`, `points_confirmed` is computed from the effective bands under the course's
 * mapping, the first course export is written with reason `initial`, and the student is told. If
 * they had already answered their debrief's two questions while the bands were draft, the run goes
 * straight on to `recorded` in the same transaction (FR-152) — the two acts happened, and the order
 * they happened in is not something to make the student repeat.
 *
 * **A re-decision on a confirmed run writes a new export** (D-087, FR-184). The ledger is
 * append-only and the version is the provenance: an instructor who entered points from version 1
 * can read version 1 back after an override has produced version 2 and see what they entered.
 *
 * **Confirming an unassessed draft records `unassessed`** (D-437). "Confirm the draft" is what the
 * control says, and the draft of a dimension the pipeline could not place is that it cannot be
 * placed; recording `confirmed` with a null band would leave a dimension that claims a decision and
 * holds no band, which is the state FR-004 forbids.
 */
export async function decideBand(
  actor: SessionUser,
  runId: string,
  dimension: Dimension,
  input: BandDecisionInput,
): Promise<BandDecisionResult> {
  const seat = await requireReviewer(actor, runId)
  const context = await repo.findRunContext(seat.organizationId, runId)
  if (!context) runNotFound()
  const at = new Date()

  return repo.withTransaction(async (tx) => {
    const locked = await lockRunForMutation(tx, seat.organizationId, runId)
    assertDecidable(locked.state, seat.role)
    const before = await readBands(runId, tx)
    const current = before.find((band) => band.dimension === dimension)
    if (!current) runNotScored(locked.state)
    await assertNotInstructorLocked(current, seat)

    const write = planDecision(dimension, input, current, actor.id, at)
    await append(tx, locked, 'band_decision', {
      dimension,
      decision: write.decision,
      band: write.band,
      note: write.note,
    })
    const bands = await writeBandDecisions(tx, runId, [write])
    await audit(tx, {
      actorId: actor.id,
      orgId: seat.organizationId,
      action: 'band.decide',
      targetType: 'run',
      targetId: runId,
      metadata: {
        dimension,
        decision: write.decision,
        band: write.band,
        hasNote: write.note !== null,
        changedFromDraft: write.band !== current.band,
      },
    })

    const run = await settleConfirmation(tx, locked, bands, context, seat, actor, at)
    const decided = bands.find((band) => band.dimension === dimension)
    if (!decided) runNotFound()
    return { band: decided, run: toRunSummary(run) }
  })
}

/**
 * `POST /review/runs/{runId}/confirm-remaining`: confirm every undecided dimension with its draft.
 *
 * The same rules as one decision, applied to whatever is left — including the TA lock, which is
 * skipped rather than refused here: a dimension the instructor already decided is not "remaining",
 * so a TA pressing this confirms the six they may and leaves the seventh exactly as it is.
 */
export async function confirmRemaining(actor: SessionUser, runId: string): Promise<RunSummary> {
  const seat = await requireReviewer(actor, runId)
  const context = await repo.findRunContext(seat.organizationId, runId)
  if (!context) runNotFound()
  const at = new Date()

  return repo.withTransaction(async (tx) => {
    const locked = await lockRunForMutation(tx, seat.organizationId, runId)
    assertDecidable(locked.state, seat.role)
    const before = await readBands(runId, tx)
    if (before.length === 0) runNotScored(locked.state)

    const writes: BandDecisionWrite[] = []
    for (const band of before) {
      if (band.decision !== null) continue
      writes.push(planDecision(band.dimension, { decision: 'confirmed' }, band, actor.id, at))
    }
    for (const write of writes) {
      await append(tx, locked, 'band_decision', {
        dimension: write.dimension,
        decision: write.decision,
        band: write.band,
        note: write.note,
      })
    }
    // Nothing left to confirm is not a decision: it writes no event, no audit row and — the one that
    // matters — no export. `settleConfirmation` re-exports whenever every dimension is decided,
    // which is right after a *re-decision* (D-087) and wrong after a button press that changed
    // nothing at all.
    if (writes.length === 0) return toRunSummary(locked)

    const bands = await writeBandDecisions(tx, runId, writes)
    await audit(tx, {
      actorId: actor.id,
      orgId: seat.organizationId,
      action: 'band.decide',
      targetType: 'run',
      targetId: runId,
      metadata: { dimensions: writes.map((write) => write.dimension), decision: 'confirmed' },
    })
    const run = await settleConfirmation(tx, locked, bands, context, seat, actor, at)
    return toRunSummary(run)
  })
}

/** 10 §12's state gate, with 08 §4's TA row folded into it. */
function assertDecidable(state: string, role: SectionRole): void {
  if (!DECIDABLE_STATES.has(state)) runNotScored(state)
  // "or `confirmed`/`recorded` for a re-decision by an instructor" (10 §12). A TA decides while the
  // run is still `scored`; once it is confirmed, changing what a course has already exported is the
  // instructor's act.
  if (role !== 'instructor' && CONFIRMED_STATES.has(state)) {
    throw new AppError('FORBIDDEN', t('review.taCannotRedecide'))
  }
}

/** 08 §4: a TA may not change a band the instructor decided; the instructor's is final (FR-182). */
async function assertNotInstructorLocked(band: BandView, seat: Reviewer): Promise<void> {
  if (seat.role === 'instructor') return
  if (band.decision === null || band.decidedBy === null) return
  const membership = await findSectionMembership(band.decidedBy, seat.sectionId)
  if (membership?.role === 'instructor') bandLockedByInstructor(band.dimension)
}

/** FR-181's three decisions, resolved against the draft the reviewer is looking at. */
function planDecision(
  dimension: Dimension,
  input: BandDecisionInput,
  current: BandView,
  actorId: string,
  at: Date,
): BandDecisionWrite {
  const note = input.note && input.note.length > 0 ? input.note : null
  if (input.decision === 'overridden') {
    if (!input.band) bandDecisionInvalid('band_required')
    return {
      dimension,
      decision: 'overridden',
      band: input.band,
      note,
      decidedBy: actorId,
      decidedAt: at,
    }
  }
  if (input.decision === 'unassessed') {
    if (input.band) bandDecisionInvalid('band_not_allowed')
    return {
      dimension,
      decision: 'unassessed',
      band: null,
      note,
      decidedBy: actorId,
      decidedAt: at,
    }
  }
  // `confirmed` takes the draft, and a draft that places nothing is a dimension the run cannot be
  // assessed on (D-437).
  if (current.band === null) {
    return {
      dimension,
      decision: 'unassessed',
      band: null,
      note,
      decidedBy: actorId,
      decidedAt: at,
    }
  }
  return {
    dimension,
    decision: 'confirmed',
    band: current.band,
    note,
    decidedBy: actorId,
    decidedAt: at,
  }
}

/**
 * Everything that happens once the seventh dimension has a decision (10 §12, FR-181, FR-152).
 *
 * The order is the order the facts happen in, and it matters: the points before the transition, the
 * transition before the export, and the export last of all — `records.writeCourseExport` builds the
 * file through this transaction, so it carries the decisions and the points that were written a few
 * statements ago and nothing that was not (D-087).
 */
async function settleConfirmation(
  tx: repo.Tx,
  locked: Awaited<ReturnType<typeof lockRunForMutation>>,
  bands: readonly BandView[],
  context: repo.ReviewRunContext,
  seat: Reviewer,
  actor: SessionUser,
  at: Date,
): Promise<Awaited<ReturnType<typeof lockRunForMutation>>> {
  if (!allDimensionsDecided(bands)) return locked
  const wasConfirmed = CONFIRMED_STATES.has(locked.state)

  await writeConfirmedPoints(tx, locked.id, computePoints(effectiveBandsOf(bands), context.mapping))

  let run = locked
  if (!wasConfirmed) {
    run = await markConfirmed(tx, run, { at, actorId: actor.id })
    // FR-152: the student answered their two questions while the bands were still draft, so the
    // confirmation is what moves the run on rather than a second act by them.
    if (await hasDebriefAnswer(tx, run.id)) {
      run = await markRecorded(tx, run, { at, actorId: actor.id })
    }
  }

  const reviewerIds = (
    await repo.listSectionReviewerIds(seat.organizationId, seat.sectionId, tx)
  ).filter((userId) => userId !== context.studentId)
  await writeCourseExport(tx, run, wasConfirmed ? 'override' : 'initial', {
    actorId: actor.id,
    reviewerIds,
  })

  if (!wasConfirmed) {
    await notify(tx, {
      userIds: [context.studentId],
      type: 'bands_confirmed',
      title: t('notifications.bandsConfirmed.title'),
      body: t('notifications.bandsConfirmed.body'),
      link: `/runs/${run.id}/debrief`,
      payload: { runId: run.id },
      orgId: seat.organizationId,
    })
  }
  return run
}

/** Whether the student has already answered the debrief's two questions (FR-152). */
async function hasDebriefAnswer(tx: repo.Tx, runId: string): Promise<boolean> {
  return repo.hasEventOfType(runId, 'debrief_answer', tx)
}

// ---------------------------------------------------------------------------------------------
// Neutralization (FR-003, FR-005, FR-232; 10 §11.5, §12; D-092)
// ---------------------------------------------------------------------------------------------

/** What a correction answers (07 §8): what moved, the run, and the export it produced. */
export type NeutralizeResult = {
  recompute: {
    dimensions: Dimension[]
    bandsBefore: Partial<Record<Dimension, Band | null>>
    bandsAfter: Partial<Record<Dimension, Band | null>>
    bandsEffective: Partial<Record<Dimension, Band | null>>
    pointsBefore: number | null
    pointsAfter: number | null
    pointsEffective: number | null
  }
  run: RunSummary
  exportVersion: number | null
}

/**
 * `POST /review/runs/{runId}/claims/{claimId}/neutralize`: Tassl admitting its own error (FR-003).
 *
 * The instructor of the section alone (08 §4). Six things happen, in one transaction:
 *
 *   1. the `claim_neutralizations` row, which is the record of what was said and by whom;
 *   2. the run claim is marked neutralized, and `inconsistency_credited` when the instructor
 *      credited the student's challenge (D-092) — the row stays visible in the debrief, struck
 *      through, because the student did something on that claim and deserves to see what;
 *   3. `scoring.recomputeAfterNeutralization` rebuilds the stance matrix without that row and
 *      recomputes Verification and Calibration, **flooring** each at the band the run already stood
 *      on: a correction for Tassl's own error can raise a band and never lowers one (FR-005);
 *   4. the `claim_neutralized` event, carrying the block of what moved and the two point totals;
 *   5. `adjusted_at`, and the package version flagged for its author's attention (FR-003);
 *   6. a new course export with reason `neutralization`, when the run was already confirmed — which
 *      is FR-184's "a correction after export recomputes and re-exports the run".
 *
 * One correction per claim per run (`NEUTRALIZATION_EXISTS`): a second would recompute a matrix the
 * first already took the row out of, and would floor a band against a value the correction itself
 * set.
 */
export async function neutralizeClaim(
  actor: SessionUser,
  runId: string,
  claimId: string,
  input: NeutralizeInput,
): Promise<NeutralizeResult> {
  const scope = await requireRunInstructor(actor, runId)
  const tenantId = scope.organizationId
  const context = await repo.findRunContext(tenantId, runId)
  if (!context) runNotFound()
  const at = new Date()

  return repo.withTransaction(async (tx) => {
    const locked = await lockRunForMutation(tx, tenantId, runId)
    // The run's state is asked for before the claim id, which is D-331's reading applied here: a run
    // with no bands to correct is refused *for the run*, not for the claim named on it. It also
    // keeps the two refusals in the order a reviewer meets them — the replay only offers a
    // neutralize control on a run that has been scored.
    if (!DECIDABLE_STATES.has(locked.state)) runNotScored(locked.state)
    if (!(await repo.claimInVersion(context.packageVersionId, claimId, tx))) claimNotFound()
    const existing = await repo.findNeutralizationForClaim(runId, claimId, tx)
    if (existing) neutralizationExists(existing.id)

    const row = await repo.insertNeutralization(
      {
        runId,
        claimId,
        reason: input.reason,
        creditChallenge: input.creditChallenge,
        note: input.note,
        actorId: actor.id,
      },
      tx,
    )
    await markClaimNeutralized(tx, locked, claimId, {
      neutralizationId: row.id,
      creditChallenge: input.creditChallenge,
    })

    const result: RecomputeResult = await applyNeutralization(tx, {
      tenantId,
      runId,
      neutralization: {
        neutralizationId: row.id,
        claimId,
        reason: input.reason,
        creditChallenge: input.creditChallenge,
        note: input.note,
      },
      occurredAt: at,
    })

    await append(tx, locked, 'claim_neutralized', {
      neutralization_id: row.id,
      claim_id: claimId,
      reason: input.reason,
      credit_challenge: input.creditChallenge,
      note: input.note,
      recompute: result.block,
      ...result.points,
    })
    const run = await markAdjusted(tx, locked, at)
    await flagVersionForReview(tx, tenantId, context.packageVersionId, input.reason, at)

    let exportVersion: number | null = null
    if (CONFIRMED_STATES.has(locked.state)) {
      const reviewerIds = (
        await repo.listSectionReviewerIds(tenantId, context.sectionId, tx)
      ).filter((userId) => userId !== context.studentId)
      const filed = await writeCourseExport(tx, run, 'neutralization', {
        actorId: actor.id,
        reviewerIds,
      })
      exportVersion = filed.version
    }

    await audit(tx, {
      actorId: actor.id,
      orgId: tenantId,
      action: 'claim.neutralize',
      targetType: 'run',
      targetId: runId,
      metadata: {
        claimId,
        reason: input.reason,
        creditChallenge: input.creditChallenge,
        dimensions: result.dimensions,
        exportVersion,
      },
    })

    return {
      recompute: {
        dimensions: result.dimensions,
        bandsBefore: result.bandsBefore,
        bandsAfter: result.bandsAfter,
        bandsEffective: result.bandsEffective,
        pointsBefore: result.pointsBefore,
        pointsAfter: result.pointsAfter,
        pointsEffective: result.pointsEffective,
      },
      run: toRunSummary(run),
      exportVersion,
    }
  })
}

// ---------------------------------------------------------------------------------------------
// Manual banding of a held run (FR-140; 10 §12)
// ---------------------------------------------------------------------------------------------

/**
 * `POST /review/runs/{runId}/manual-bands`: a faculty seat places the bands nothing could place.
 *
 * A held run stayed at `defense_complete` with everything it recorded intact (D-405) — its trace,
 * its graphs, its stance matrix — and what is missing is the reading. So the reviewer supplies a
 * band or `unassessed` for each of the seven, and the run goes through the whole of the rest of its
 * life in one transaction: seven `draft_band` events with basis `none` and the rationale `manual`,
 * the transition to `scored`, seven decisions recorded as confirmed, the transition to `confirmed`,
 * the points, the first export and the student's notice — and on to `recorded` if they had already
 * answered their debrief.
 *
 * A band nobody can support is worse than no band (FR-004), which is why `unassessed` is one of the
 * choices on every dimension and why nothing here invents a placement.
 */
export async function bandHeldRunManually(
  actor: SessionUser,
  runId: string,
  input: ManualBandsInput,
): Promise<RunSummary> {
  const seat = await requireReviewer(actor, runId)
  const context = await repo.findRunContext(seat.organizationId, runId)
  if (!context) runNotFound()
  const placements = completePlacements(input.bands)
  const at = new Date()

  return repo.withTransaction(async (tx) => {
    const locked = await lockRunForMutation(tx, seat.organizationId, runId)
    if (locked.scoringStatus !== 'held') runNotHeld(locked.state, locked.scoringStatus)

    const { bands: drafted } = await bandRunManually(tx, seat.organizationId, runId, placements)
    for (const band of drafted) {
      await append(tx, locked, 'draft_band', draftBandEventPayload(band))
    }
    let run = await markScored(tx, locked, { at, actorId: actor.id })

    const writes: BandDecisionWrite[] = drafted.map((band) => ({
      dimension: band.dimension,
      decision: band.band === null ? ('unassessed' as const) : ('confirmed' as const),
      band: band.band,
      note: null,
      decidedBy: actor.id,
      decidedAt: at,
    }))
    for (const write of writes) {
      await append(tx, run, 'band_decision', {
        dimension: write.dimension,
        decision: write.decision,
        band: write.band,
        note: write.note,
      })
    }
    const bands = await writeBandDecisions(tx, runId, writes)
    await audit(tx, {
      actorId: actor.id,
      orgId: seat.organizationId,
      action: 'band.decide',
      targetType: 'run',
      targetId: runId,
      metadata: { manual: true, dimensions: writes.map((write) => write.dimension) },
    })

    run = await settleConfirmation(tx, run, bands, context, seat, actor, at)
    return toRunSummary(run)
  })
}

/** Every dimension of the rubric, so a partial body cannot leave a run half banded (FR-004). */
function completePlacements(
  bands: ManualBandsInput['bands'],
): Record<Dimension, Band | 'unassessed'> {
  const placements = {} as Record<Dimension, Band | 'unassessed'>
  for (const dimension of DIMENSIONS) {
    const placement = bands[dimension]
    if (placement === undefined) bandDecisionInvalid('band_required')
    placements[dimension] = placement
  }
  return placements
}

// ---------------------------------------------------------------------------------------------
// The queue and the section list (FR-186, D-096; 10 §12)
// ---------------------------------------------------------------------------------------------

/** What `GET /review/queue` answers (07 §8): the labelled sample, and this reviewer's real runs. */
export type ReviewQueue = {
  illustrative: Record<string, unknown>[]
  runs: RunReviewSummary[]
}

/**
 * `GET /review/queue` (FR-186, D-096).
 *
 * Two lists that are never mixed, because they are two different kinds of thing. `illustrative` is
 * the static sample of PRD §12 — the shapes a queue takes once a course has run for a term — and it
 * carries its own "Illustrative sample data" label inside the data (FR-254). `runs` is the real
 * runs of the actor's own sections that are waiting for a decision or for a hand.
 *
 * Nothing here is ranked and there is no queue position: the order is newest first, which is the
 * only order a list of other people's work should have.
 */
export async function getQueue(actor: SessionUser): Promise<ReviewQueue> {
  const queue = sample.queue()
  const rows: RunReviewSummary[] = []
  let reviews = false
  for (const tenantId of await tenantsOf(actor)) {
    const sectionIds = await repo.listReviewerSectionIds(tenantId, actor.id)
    if (sectionIds.length === 0) continue
    reviews = true
    const awaiting = await repo.listRunsAwaitingReview(tenantId, sectionIds)
    rows.push(...awaiting.map(toReviewRow))
  }
  // Every row of 08 §4 that touches this screen is a reviewer's, and an actor who reviews no section
  // has no queue rather than an empty one: an empty answer would put the illustrative sample in
  // front of a student, which is the one place FR-254's label cannot help — the rows are about
  // reading other people's runs.
  if (!reviews) throw new AppError('FORBIDDEN')
  return {
    illustrative: queue ? (queue.rows as unknown as Record<string, unknown>[]) : [],
    runs: rows,
  }
}

/**
 * `GET /review/sections/{sectionId}/runs`: the runs of one section with their decision progress.
 *
 * A reviewer of *that* section, asked for directly rather than through a run: the list is the
 * section's, and an instructor with no run in it yet still has a table to look at.
 */
export async function listSectionRunsForReview(
  actor: SessionUser,
  sectionId: string,
): Promise<RunReviewSummary[]> {
  const scope = await requireSectionRole(actor, sectionId, ['instructor', 'ta'])
  const rows = await repo.listSectionRuns(scope.organizationId, sectionId)
  return rows.map(toReviewRow)
}

function toReviewRow(row: repo.ReviewRunRow): RunReviewSummary {
  return {
    ...toRunSummary(row.run),
    studentId: row.studentId,
    studentName: row.studentName,
    variantKey: row.variantKey,
    decisionsMade: row.decisionsMade,
    latestExportVersion: row.latestExportVersion,
  }
}

/** The institutions the actor belongs to, active one first (the shape `records` resolves with). */
async function tenantsOf(actor: SessionUser): Promise<string[]> {
  const institutions = await listMyInstitutions(actor)
  const ids = institutions.map((institution) => institution.id)
  const active = actor.activeOrganizationId
  return active && ids.includes(active) ? [active, ...ids.filter((id) => id !== active)] : ids
}
