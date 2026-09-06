// Module `scoring` (docs/tech/10-backend-spec-modules.md §11) — service.
//
// Two halves. The re-exports below are the door: every pure function of the pipeline lives in its
// own file under this folder, and a `src/app` reader may reach a module only through its public
// `index.ts`, which may re-export only from `service.ts` and `schema.ts` (04 §2, enforced by
// eslint-plugin-boundaries). Under them is `scoreRun`, the one function in this module that touches
// the world.
//
// **`scoreRun` is the whole of §11's pipeline in one transaction at the end.** Everything before
// that transaction is a read and a computation — the trace, the authored standard, four graphs, the
// categorical facts, five model reads, seven draft bands, the points — and none of it is allowed to
// change anything. Then one transaction locks the run row and writes what it computed: the seven
// `draft_band` events, the seven `run_bands` rows, the `run_scores` row, the transition to `scored`,
// and the notifications that say so. A run is scored all at once or not at all.
//
// **A held run is not a scored run** (FR-140). Two things hold a run: stance records lost past
// FR-087's one third, and a band read that did not come back where the recorded events alone cannot
// place the dimension (11 §3). Neither writes a band. The run stays at `defense_complete` with
// `scoring_status = 'held'`, its section's instructors are told, and a faculty seat bands it by hand
// or voids it — because a band nobody can support is worse than no band, and FR-004 says so.
//
// **Scoring twice is scoring once, and the guarantee is the row lock rather than the queue.** Every
// `score_run` job carries the singleton key `score_run:<runId>` (10 §7), but pg-boss applies a key
// as a dedupe only under a `singleton` queue policy — the queues here are `standard`, so a second
// send makes a second job. That is fine, because the transaction below takes `select … for update`
// on the run row and re-reads its state: the second job waits, finds the run already `scored`, and
// writes nothing — no second set of events, no second notification, no second set of points
// (D-400).
import { performance } from 'node:perf_hooks'
import { randomUUID } from 'node:crypto'
import { isAppError } from '@/lib/errors'
import { requireRunReviewer } from '@/server/auth/permissions'
import { findRunContext } from '@/server/auth/queries'
import type { SessionUser } from '@/server/auth/types'
import { t } from '@/lib/i18n/t'
import { getLogger, getRequestContext } from '@/server/http/request-context'
import { getProvider } from '@/server/llm/registry'
import { alertOps, countOps } from '@/server/logging/ops-events'
import { notify } from '@/server/modules/notifications'
import { lockRunForMutation, markScored } from '@/server/modules/runs'
import { append, readEvents } from '@/server/modules/trace'
import { draftBands, type DraftBand } from './bands'
import { runNotFound, runNotScorable } from './errors'
import { categoricalFacts } from './facts'
import { buildGraphs, type GraphEvent, type GraphInput } from './graphs'
import { computePoints, higherPoints } from './points'
import { runBandReads, type ReadContext, type ReadDefenseEntry } from './reads'
import * as repo from './repository'
import { withTransaction } from './repository'
import {
  CURRENT_RUBRIC,
  DIMENSIONS,
  currentRubric,
  higherBand,
  type Band,
  type Dimension,
} from './rubric'
import {
  type BandView,
  type HoldReason,
  type RunScoreView,
  type RunScoreFlag,
  type ScoreRunResult,
} from './schema'

export {
  BANDS,
  BOUNDARIES,
  CURRENT_RUBRIC,
  DIMENSIONS,
  RUBRICS,
  bandRank,
  currentRubric,
  higherBand,
  lowerBand,
  rubricFor,
  v1,
  type Band,
  type Boundary,
  type Dimension,
  type DimensionRubric,
  type Rubric,
  type RubricVersion,
} from './rubric'
export {
  FCR_FEW,
  FCR_NOVICE,
  FCR_PROFESSIONAL,
  SPEED_OUTLIER_MS,
  STANCE_RECORD_LOSS_LIMIT,
  type ArchitectConstant,
  type Hypothesis,
} from './constants'
export {
  categoricalFacts,
  stanceRecordLoss,
  type CategoricalFacts,
  type ConfidenceShape,
  type ResponseVsWarrant,
  type StanceRecordLoss,
} from './facts'
export {
  COMPUTED_DIMENSIONS,
  DIMENSION_GRAPHS,
  calibrationBand,
  draftBands,
  unavailableGraphsFor,
  verificationBand,
  type BandBasis,
  type BandContext,
  type BandQuote,
  type BandRead,
  type BandReads,
  type BandStatus,
  type DecisionQualityRead,
  type DraftBand,
  type MatchedPosition,
  type UnassessedReason,
} from './bands'
export {
  DEFAULT_MAPPING,
  computePoints,
  higherPoints,
  round3,
  type BandMapping,
  type PointsInput,
} from './points'
export {
  RECOMPUTED_DIMENSIONS,
  recomputeAfterNeutralization,
  withNeutralization,
  type Neutralization,
  type NeutralizationReason,
  type RecomputeArgs,
  type RecomputeBlock,
  type RecomputeResult,
  type RecomputedDimension,
} from './recompute'
export {
  buildClockTimeline,
  buildConfidenceLine,
  buildFrameBesideDecision,
  buildGraphs,
  buildStanceMatrix,
  falseChallengeRate,
  formatSpan,
  matchDisruptions,
  unavailableGraphKeys,
  GRAPH_KEYS,
  STANCES,
  type ClockTimelineGraph,
  type ConfidenceLineGraph,
  type ConfidencePoint,
  type ConfidencePointAt,
  type FalseChallengeRate,
  type FiledRecordPayload,
  type FrameBesideDecisionGraph,
  type FramedRecordPayload,
  type GraphClaim,
  type GraphDataTable,
  type GraphDocument,
  type GraphEvent,
  type GraphInput,
  type GraphKey,
  type GraphNamedField,
  type GraphPackageVersion,
  type GraphTurnSpec,
  type GraphVariantClaimState,
  type PrecedingAction,
  type ReadinessContext,
  type RunGraphs,
  type StanceMatrixGraph,
  type StanceMatrixRow,
  type StanceValue,
  type TimelineMark,
  type TimelineMarkKind,
  type TimelineSegment,
  type TimelineSegmentType,
  type TimelineTrack,
  type TurnRecordPayload,
  type TurnResponseValue,
} from './graphs'

// The wire shapes Phase 11's replay and debrief read the score back through, and the two internal
// vocabularies a caller of `scoreRun` needs to act on its answer.
export {
  BandBasisSchema,
  BandDecisionSchema,
  BandSchema,
  DimensionSchema,
  DraftStatusSchema,
  GraphKeySchema,
  HOLD_REASONS,
  HoldReasonSchema,
  RUN_SCORE_FLAGS,
  RunScoreFlagSchema,
  ScoringStatusSchema,
  bandQuoteSchema,
  bandViewSchema,
  runIdParamsSchema,
  runScoreViewSchema,
  scoreRunResultSchema,
  type BandValue,
  type BandView,
  type DimensionValue,
  type HoldReason,
  type RunIdParams,
  type RunScoreFlag,
  type RunScoreView,
  type ScoreRunResult,
  type ScoringStatusValue,
} from './schema'

export {
  MAX_BAND_QUOTES,
  READ_DIMENSIONS,
  anchorQuotes,
  buildReadInputs,
  filterRationale,
  matchedPositionOf,
  runBandReads,
  toBandRead,
  type BandReadsResult,
  type BuiltReads,
  type QuoteSource,
  type RawBandRead,
  type ReadClaim,
  type ReadContext,
  type ReadDefenseEntry,
  type ReadDimension,
  type ReadDocument,
  type ReadFailure,
  type ReadFailureReason,
  type ReadInputs,
  type ReadPosition,
} from './reads'

export { SCORING_ERROR_CODES } from './errors'

// ---------------------------------------------------------------------------------------------
// Reading the run (10 §11, step one: "read events + package version + variant states")
// ---------------------------------------------------------------------------------------------

/** Everything the pipeline reads before it computes anything. */
type ScoringLoad = {
  run: repo.ScoringRunRow
  input: GraphInput
  defense: ReadDefenseEntry[]
  positions: repo.ScoringPositionRow[]
  documents: repo.ScoringDocumentRow[]
}

/**
 * The run, its trace, the authored standard it is read against, and the interview it ended with.
 *
 * Read outside the writing transaction on purpose. The pipeline's expensive part is five model
 * calls, and holding `select … for update` on the run row across them would block every read of
 * that run — its own student polling their status among them — for as long as a provider takes.
 */
async function loadRun(runId: string): Promise<ScoringLoad> {
  // The job payload carries a run id and nothing else, so the tenant is resolved the way every
  // permission guard resolves one (`auth/queries.findRunContext`) and then named on every read
  // below (D-006). A run id that names no run is NOT_FOUND rather than a job that half-runs.
  const context = await findRunContext(runId)
  if (!context) runNotFound()
  const tenantId = context.organizationId

  const run = await repo.findRunForScoring(tenantId, runId)
  if (!run) runNotFound()

  const [events, authored, variantStates, defenseRows] = await Promise.all([
    readEvents(runId),
    repo.findPackageForScoring(tenantId, run.packageVersionId),
    repo.listVariantStates(run.variantId),
    repo.listDefenseForScoring(runId),
  ])
  if (!authored) runNotFound()

  const graphEvents: GraphEvent[] = events.map((event) => ({
    seq: event.seq,
    type: event.type,
    occurredAt: event.occurredAt.toISOString(),
    clockRemainingMs: event.clockRemainingMs,
    payload: event.payload,
  }))

  // The seq of the `defense_answer` event each answer was written as, so a quote taken from it is
  // anchored to the trace rather than to a row id nothing else in the record carries.
  const answerSeq = new Map<string, number>()
  for (const event of graphEvents) {
    if (event.type !== 'defense_answer') continue
    const questionId = (event.payload as { run_question_id?: unknown }).run_question_id
    if (typeof questionId === 'string') answerSeq.set(questionId, event.seq)
  }

  const followUps = defenseRows.filter((row) => row.followUpOf !== null)
  const defense: ReadDefenseEntry[] = defenseRows
    .filter((row) => row.followUpOf === null)
    .map((row) => {
      // The authored follow-up prompt is not passed unless it was actually asked: a question the
      // student never met has no answer to read, and the bank is not evidence about this run.
      const asked = followUps.find((child) => child.followUpOf === row.runQuestionId)
      return {
        question: row.question,
        expectedAnswerNotes: row.expectedAnswerNotes,
        answer: row.answer ?? '',
        followUp: asked?.question ?? null,
        followUpAnswer: asked?.answer ?? null,
        answerEventSeq: answerSeq.get(row.runQuestionId) ?? null,
      }
    })

  return {
    run,
    input: {
      events: graphEvents,
      packageVersion: {
        workingClockSeconds: run.workingClockSeconds,
        claims: authored.claims,
        documents: authored.documents.map((document) => ({
          id: document.id,
          key: document.key,
          title: document.title,
        })),
        namedFields: authored.namedFields,
        turn: authored.turn,
      },
      variantStates,
    },
    defense,
    positions: authored.positions,
    documents: authored.documents,
  }
}

// ---------------------------------------------------------------------------------------------
// The job (10 §11; FR-130, FR-140, FR-141, NFR-001, D-046, D-047)
// ---------------------------------------------------------------------------------------------

/** The states a `score_run` job can legitimately arrive at a run in and find nothing left to do. */
const ALREADY_SCORED: ReadonlySet<string> = new Set(['scored', 'confirmed', 'recorded'])

/** D-047: eight minutes is the alert, three the target, five seconds the mock's budget (NFR-001). */
export const SCORING_SLOW_MS = 480_000

/**
 * `score_run`: the run's trace becomes four graphs, seven draft bands and a set of points, or the
 * run is held (10 §11).
 *
 * It takes a run id and no actor. The job is enqueued by the run's own completion (D-046) and there
 * is no seat behind it — the permission that made the run scoreable was the student's own act of
 * finishing their defense, which `completeDefense` already checked.
 */
export async function scoreRun(runId: string): Promise<ScoreRunResult> {
  const startedAt = performance.now()
  const provider = getProvider()
  const logger = getLogger()

  const { run, input, defense, positions, documents } = await loadRun(runId)
  if (ALREADY_SCORED.has(run.state)) {
    return {
      runId,
      outcome: 'already_scored',
      holdReason: null,
      durationMs: elapsed(startedAt),
      provider: provider.name,
    }
  }
  if (run.state !== 'defense_complete') runNotScorable(run.state, 'not_complete')

  const graphs = buildGraphs(input)
  const facts = categoricalFacts(input, graphs)

  // FR-087's larger loss: more than a third of the consequential claims lost their stance record, so
  // what the run did with its claims cannot be read either way and no band would mean anything.
  if (facts.stanceRecordLoss === 'unscoreable') {
    return holdRun(run, 'record_lost', startedAt, provider.name)
  }

  const readContext: ReadContext = {
    events: input.events,
    graphs,
    turn: input.packageVersion.turn,
    positions,
    documents,
    claims: input.packageVersion.claims.map((claim) => ({
      id: claim.id,
      text: claim.text,
      sourceDocumentId: claim.sourceDocumentId,
    })),
    defense,
    rubric: currentRubric(),
  }
  const { reads, failures } = await runBandReads(readContext, provider, {
    runId,
    packageVersionId: run.packageVersionId,
    requestId: getRequestContext()?.requestId ?? randomUUID(),
  })

  const bands = draftBands({ facts, graphs, reads })

  // 11 §3's ladder, read off what the bands actually became rather than off the failure count: a
  // read that did not come back is only a hold when the recorded events could not place the
  // dimension without it. Adaptation's implicit hold, Framing's single-token floor and an empty
  // recommendation are all placed from the trace, and a failed read beside them degrades to
  // `categorical_only` (D-395) rather than holding the run.
  const unreadable = DIMENSIONS.filter((dimension) => bands[dimension].reason === 'read_failed')
  if (unreadable.length > 0) {
    const reason: HoldReason = failures.some((failure) => failure.reason === 'budget_exceeded')
      ? 'budget_exceeded'
      : failures.length > 0
        ? 'provider_error'
        : 'read_failed'
    logger.warn(
      { runId, dimensions: unreadable, failures: failures.map((failure) => failure.code) },
      'band reads did not place every dimension',
    )
    return holdRun(run, reason, startedAt, provider.name)
  }

  const pointsDraft = computePoints(
    Object.fromEntries(
      DIMENSIONS.map((dimension) => [dimension, bands[dimension].band ?? 'unassessed']),
    ),
    run.mapping,
  )
  const flags = flagsOf(bands, facts.nothingAnswered)
  const scoredAt = new Date()

  const wrote = await withTransaction(async (tx) => {
    const locked = await lockRunForMutation(tx, run.organizationId, runId)
    // The lock is the idempotency guard, and it is the only one: two jobs that both read a
    // `defense_complete` run and computed the same bands arrive here, and the second one waits for
    // the first to commit and then finds the run already `scored`. It writes nothing and says so —
    // reporting `scored` twice would put two `ops_scoring_completed` counts on one run and make the
    // latency panel count a scoring that never happened.
    if (locked.state !== 'defense_complete') return false

    await repo.upsertBands(
      runId,
      DIMENSIONS.map((dimension) => bandRow(bands[dimension])),
      tx,
    )
    for (const dimension of DIMENSIONS) {
      await append(tx, locked, 'draft_band', draftBandPayload(bands[dimension]))
    }
    await repo.upsertScore(
      runId,
      {
        rubricVersion: CURRENT_RUBRIC,
        graphs,
        falseChallengeRate: numeric(facts.fcr, 4),
        matchedStanceShare: numeric(facts.matchedShare, 4),
        pointsDraft: numeric(pointsDraft, 3),
        flags: [...flags],
        scoredAt,
      },
      tx,
    )
    await markScored(tx, locked, { at: scoredAt })

    await notify(tx, {
      userIds: [run.studentId],
      type: 'run_scored',
      title: t('notifications.runScored.title'),
      body: t('notifications.runScored.body'),
      link: `/runs/${runId}`,
      payload: { runId },
      orgId: run.organizationId,
    })
    const reviewers = (
      await repo.listSectionReviewerIds(run.organizationId, run.sectionId, tx)
    ).filter((userId) => userId !== run.studentId)
    await notify(tx, {
      userIds: reviewers,
      type: 'run_scored',
      title: t('notifications.runScoredReviewer.title'),
      body: t('notifications.runScoredReviewer.body'),
      link: `/review/runs/${runId}`,
      payload: { runId, sectionId: run.sectionId },
      orgId: run.organizationId,
    })
    return true
  })

  const durationMs = elapsed(startedAt)
  if (!wrote) {
    return {
      runId,
      outcome: 'already_scored',
      holdReason: null,
      durationMs,
      provider: provider.name,
    }
  }
  countOps('ops_scoring_completed', {
    run_id: runId,
    duration_ms: durationMs,
    provider: provider.name,
    rubric_version: CURRENT_RUBRIC,
    provisional_dimensions: DIMENSIONS.filter((d) => bands[d].provisional).length,
    unassessed_dimensions: DIMENSIONS.filter((d) => bands[d].status === 'unassessed').length,
    reads_failed: failures.length,
  })
  if (durationMs > SCORING_SLOW_MS) {
    alertOps('scoring_slow', { run_id: runId, duration_ms: durationMs, provider: provider.name })
  }

  return { runId, outcome: 'scored', holdReason: null, durationMs, provider: provider.name }
}

/**
 * FR-140: the run stays where it is, its instructors are told, and nobody's band is invented.
 *
 * `scoring_status = 'held'` is the one thing about scoring a student is shown (10 §6): their run
 * reads "under review" rather than a state they cannot act on. The notice goes to the section's
 * instructors and TAs, who band it by hand or void it from the replay (FR-140, Phase 11).
 */
async function holdRun(
  run: repo.ScoringRunRow,
  reason: HoldReason,
  startedAt: number,
  providerName: string,
): Promise<ScoreRunResult> {
  const held = await withTransaction(async (tx) => {
    const locked = await lockRunForMutation(tx, run.organizationId, run.id)
    // The same lock and the same reading as the scoring transaction: a run another job has already
    // scored is not held, and saying so would raise an alert about a run that is fine.
    if (locked.state !== 'defense_complete') return false
    await repo.updateScoringStatus(run.organizationId, run.id, 'held', tx)
    const reviewers = (
      await repo.listSectionReviewerIds(run.organizationId, run.sectionId, tx)
    ).filter((userId) => userId !== run.studentId)
    await notify(tx, {
      userIds: reviewers,
      type: 'run_held',
      title: t('notifications.runHeld.title'),
      body: t('notifications.runHeld.body'),
      link: `/review/runs/${run.id}`,
      payload: { runId: run.id, reason },
      orgId: run.organizationId,
    })
    return true
  })

  const durationMs = elapsed(startedAt)
  if (!held) {
    return {
      runId: run.id,
      outcome: 'already_scored',
      holdReason: null,
      durationMs,
      provider: providerName,
    }
  }
  countOps('ops_run_held', { run_id: run.id, reason, provider: providerName })
  countOps('ops_scoring_completed', {
    run_id: run.id,
    duration_ms: durationMs,
    provider: providerName,
    held: true,
    hold_reason: reason,
  })
  alertOps('run_held', { run_id: run.id, reason })

  return { runId: run.id, outcome: 'held', holdReason: reason, durationMs, provider: providerName }
}

const elapsed = (startedAt: number): number =>
  Math.max(0, Math.round(performance.now() - startedAt))

/** `numeric(p,s)` columns are written as strings; `null` stays null rather than becoming "0.000". */
const numeric = (value: number | null, scale: number): string | null =>
  value === null ? null : value.toFixed(scale)

/**
 * FR-141 and FR-125's three flags, on `run_scores.flags`.
 *
 * `all_novice` and `all_professional` are true only when every one of the seven dimensions carries
 * that band: a run with three unassessed dimensions and four at Novice has not shown the pattern
 * FR-141 asks an instructor to act on. They live here rather than on `runs.flags` so a
 * neutralization recompute moves them with the bands it moves (FR-005), which a copy on the run row
 * would not (D-402).
 */
function flagsOf(
  bands: Record<Dimension, DraftBand>,
  nothingAnswered: boolean,
): readonly RunScoreFlag[] {
  const placed = DIMENSIONS.map((dimension) => bands[dimension].band)
  const flags: RunScoreFlag[] = []
  const all = (band: Band): boolean => placed.every((value) => value === band)
  if (all('novice')) flags.push('all_novice')
  if (all('professional')) flags.push('all_professional')
  if (nothingAnswered) flags.push('nothing_answered')
  return flags
}

/** One drafted band as `run_bands` stores it (DATA-041). */
function bandRow(band: DraftBand) {
  return {
    dimension: band.dimension,
    draftBand: band.band,
    draftStatus: band.status,
    draftReason: band.reason,
    basis: band.basis,
    provisional: band.provisional,
    graphKeys: [...band.graphKeys],
    evidenceEventSeqs: [...band.evidenceEventSeqs],
    quotes: band.quotes.map((quote) => ({ event_seq: quote.event_seq, text: quote.text })),
    rationale: band.rationale,
  }
}

/**
 * One drafted band as the trace records it (10 §10).
 *
 * `evidence_event_seqs` and `quotes` are `reviewer_only` in `trace/owner-view.ts` in every state:
 * the owner's trace is renumbered densely so a withheld event leaves no hole, and stored sequence
 * numbers would carry the real numbering straight past it (FR-053). They are written here because
 * the trace is the record; what a student may read of it is that file's decision, not this one's.
 */
function draftBandPayload(band: DraftBand) {
  return {
    dimension: band.dimension,
    band: band.band,
    status: band.status,
    reason: band.reason,
    basis: band.basis,
    provisional: band.provisional,
    graph_keys: [...band.graphKeys],
    evidence_event_seqs: [...band.evidenceEventSeqs],
    quotes: band.quotes.map((quote) => ({ event_seq: quote.event_seq, text: quote.text })),
    rationale: band.rationale,
  }
}

// ---------------------------------------------------------------------------------------------
// Reading the score back
// ---------------------------------------------------------------------------------------------

/**
 * FR-005 and 10 §11.4's effective band: the instructor's decision where there is one, the higher of
 * the two correction bands after a neutralization, the draft otherwise.
 *
 * The correction is applied last and only ever raises, which is the FR-005 floor — "a correction for
 * Tassl's own error can raise a band and never lowers one".
 */
export function effectiveBandOf(row: {
  draftBand: Band | null
  decision: 'confirmed' | 'overridden' | 'unassessed' | null
  decidedBand: Band | null
  bandBeforeCorrection: Band | null
  bandAfterCorrection: Band | null
}): Band | null {
  const decided =
    row.decision === null
      ? row.draftBand
      : row.decision === 'unassessed'
        ? null
        : (row.decidedBand ?? row.draftBand)
  if (row.bandBeforeCorrection === null && row.bandAfterCorrection === null) return decided
  return higherBand(row.bandBeforeCorrection ?? decided, row.bandAfterCorrection)
}

const asNumber = (value: string | null): number | null => (value === null ? null : Number(value))

function toBandView(row: Awaited<ReturnType<typeof repo.listBands>>[number]): BandView {
  return {
    dimension: row.dimension,
    band: row.draftBand,
    status: row.draftStatus,
    reason: row.draftReason,
    basis: row.basis,
    provisional: row.provisional,
    graphKeys: [...row.graphKeys],
    evidenceEventSeqs: [...row.evidenceEventSeqs],
    quotes: row.quotes.map((quote) => ({ event_seq: quote.event_seq, text: quote.text })),
    rationale: row.rationale,
    decision: row.decision,
    decidedBand: row.decidedBand,
    note: row.note,
    bandBeforeCorrection: row.bandBeforeCorrection,
    bandAfterCorrection: row.bandAfterCorrection,
    effectiveBand: effectiveBandOf(row),
  }
}

/**
 * The score of a run, or null before the pipeline has written one — the seam inside the server.
 *
 * It takes no actor, like `trace.readEvents` and `trace.buildExport` and for the same reason
 * (D-340): Phase 11's debrief projects a student's own view of their bands under the `after_scored`
 * rules that live in that module, and the faculty replay reads the whole row. Every reader names its
 * own guard; `getScore` below is the one that names a reviewer.
 */
export async function readScore(runId: string): Promise<RunScoreView | null> {
  const [score, bands] = await Promise.all([repo.findScore(runId), repo.listBands(runId)])
  if (!score) return null
  const order = new Map(DIMENSIONS.map((dimension, index) => [dimension, index]))
  return {
    runId,
    rubricVersion: score.rubricVersion,
    uncalibrated: true,
    scoringStatus: 'done',
    falseChallengeRate: asNumber(score.falseChallengeRate),
    matchedStanceShare: asNumber(score.matchedStanceShare),
    pointsDraft: asNumber(score.pointsDraft),
    pointsConfirmed: asNumber(score.pointsConfirmed),
    pointsBeforeCorrection: asNumber(score.pointsBeforeCorrection),
    pointsAfterCorrection: asNumber(score.pointsAfterCorrection),
    pointsEffective: higherPoints(
      asNumber(score.pointsBeforeCorrection),
      asNumber(score.pointsAfterCorrection),
    ),
    flags: [...score.flags],
    scoredAt: score.scoredAt.toISOString(),
    bands: bands
      .slice()
      .sort((a, b) => (order.get(a.dimension) ?? 0) - (order.get(b.dimension) ?? 0))
      .map(toBandView),
  }
}

/**
 * The score as a reviewer of the run's section reads it (10 §11, 08 §5).
 *
 * A reviewer, not the owner: `run_bands.quotes` and `evidence_event_seqs` are `reviewer_only` in
 * every state (`trace/owner-view.ts`), and a student reads their bands through the debrief's own
 * projection once the run is scored. A run that has not been scored answers `RUN_NOT_SCORABLE` with
 * its state rather than an empty view, so a stale replay tab follows the run instead of drawing
 * nothing.
 *
 * A classmate is answered NOT_FOUND rather than FORBIDDEN, for the reason `trace.listEvents` states
 * at its own guard: `requireRunReviewer` refuses a section member holding the wrong role with
 * FORBIDDEN, and here that is one person only — another student in the same section — to whom 08 §4
 * gives no read of the run at all. A refusal that says "you may not" says the run exists.
 */
export async function getScore(actor: SessionUser, runId: string): Promise<RunScoreView> {
  const scope = await requireRunReviewer(actor, runId).catch((error: unknown) => {
    if (isAppError(error) && error.code === 'FORBIDDEN') runNotFound()
    throw error
  })
  const run = await repo.findRunForScoring(scope.organizationId, runId)
  if (!run) runNotFound()
  const view = await readScore(runId)
  if (!view) runNotScorable(run.state, 'not_scored')
  return { ...view, scoringStatus: run.scoringStatus }
}
