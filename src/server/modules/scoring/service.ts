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
import type { EventProps } from '@/lib/analytics/events'
import { MANUAL_BAND_RATIONALE } from '@/lib/band-prose'
import { AppError, isAppError } from '@/lib/errors'
import { runContext, type VariantKey } from '@/server/analytics/run-context'
import { track } from '@/server/analytics/track'
import { requireRunReviewer } from '@/server/auth/permissions'
import { findRunContext } from '@/server/auth/queries'
import type { SessionUser } from '@/server/auth/types'
import { t } from '@/lib/i18n/t'
import { getLogger, getRequestContext } from '@/server/http/request-context'
import type { LlmProviderName } from '@/server/llm/provider'
import { getProvider } from '@/server/llm/registry'
import { alertOps, countOps } from '@/server/logging/ops-events'
import { notify } from '@/server/modules/notifications'
import { lockRunForMutation, markScored } from '@/server/modules/runs'
import { append, readEvents } from '@/server/modules/trace'
import { DIMENSION_GRAPHS, draftBands, type DraftBand } from './bands'
import { runNotFound, runNotScorable } from './errors'
import { categoricalFacts, type CategoricalFacts } from './facts'
import { buildGraphs, type GraphEvent, type GraphInput, type RunGraphs } from './graphs'
import { eventsOfType, firstOfType, rate3 } from './graphs/types'
import { computePoints, higherPoints, type BandMapping } from './points'
import {
  recomputeAfterNeutralization,
  type Neutralization,
  type RecomputeResult,
} from './recompute'
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
  type RecomputePoints,
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
  BAND_RATIONALE_TERMS,
  MAX_BAND_QUOTES,
  QUOTE_MIN_CHARS,
  QUOTE_MIN_WORDS,
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
  /** `defective` or `sound` — the `R` group's `variant` and nothing the pipeline itself reads. */
  variantKey: VariantKey
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

  const [events, authored, variantStates, defenseRows, flaggedDelegationIds, variantKey] =
    await Promise.all([
      readEvents(runId),
      repo.findPackageForScoring(tenantId, run.packageVersionId),
      repo.listVariantStates(run.variantId),
      repo.listDefenseForScoring(runId),
      // FR-055, D-481: the exchanges a reviewer marked out of scenario, read from `run_delegations`
      // beside the package and the variant states because that is where a mark added after the fact
      // lives — the `delegation` event was written when the exchange happened (D-272).
      repo.listFlaggedDelegationIds(runId),
      // Analytics only (17 §3.5). It rides in this batch rather than beside the `track` call so a
      // dashboard property never costs the scored run a round trip of its own.
      repo.findVariantKey(run.variantId),
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
      flaggedDelegationIds,
    },
    defense,
    positions: authored.positions,
    documents: authored.documents,
    // A variant row is a NOT NULL foreign key, so `null` here is a database nobody can reach; the
    // fallback keeps a missing key from throwing inside a job whose work is otherwise finished.
    variantKey: variantKey ?? 'defective',
  }
}

// ---------------------------------------------------------------------------------------------
// The job (10 §11; FR-130, FR-140, FR-141, NFR-001, D-046, D-047)
// ---------------------------------------------------------------------------------------------

/** The states a `score_run` job can legitimately arrive at a run in and find nothing left to do. */
const ALREADY_SCORED: ReadonlySet<string> = new Set(['scored', 'confirmed', 'recorded'])

/**
 * When one scoring *attempt* has taken long enough to be worth an alert (13 §5, D-425).
 *
 * Four minutes, not D-047's eight. The number has to be reachable, and the ceiling on one attempt is
 * not NFR-001's ten minutes: `score_run` has `expireInSeconds: 280` (10 §7) and the drain that runs
 * it in production has a 270-second budget inside a route capped at 300 by the platform, so an
 * attempt that ran for eight minutes would have been expired and re-dispatched — beside the first
 * one, which is still running — a full three minutes before it could raise this. A threshold nothing
 * can cross is not a threshold.
 *
 * D-047's eight minutes is not lost and does not belong here: it is *end to end*, from the defense
 * completing to the debrief existing, which is what NFR-001 states and what queue wait and retries
 * are part of. 13 §5 gives that figure to `scoring_overdue`, emitted by the drain over
 * `defense_completed_at`, and both alerts feed the one Sentry rule (`ops:scoring_slow` or
 * `ops:scoring_overdue`, one or more in an hour). Four minutes sits above NFR-001's three-minute p95
 * target for the real provider and below the expiry, so a healthy run is silent and a run heading
 * for a silent re-dispatch is not.
 */
export const SCORING_SLOW_MS = 240_000

/**
 * The payload of every notification this module sends (SYS-010).
 *
 * They are built here rather than written inline at the three `notify` calls so that there is an
 * artifact to walk. `tests/unit/scoring/field-names.test.ts` reads these shapes for FR-131's
 * field-name rule; a key added inline inside a call would be a payload no walker in that file could
 * see, and a notification payload is the one shape this module produces that no schema covers.
 */
export const SCORING_NOTIFICATION_PAYLOADS = {
  runScoredStudent: (runId: string) => ({ runId }),
  runScoredReviewer: (runId: string, sectionId: string) => ({ runId, sectionId }),
  runHeld: (runId: string, reason: HoldReason) => ({ runId, reason }),
} as const

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

  const { run, input, defense, positions, documents, variantKey } = await loadRun(runId)
  if (ALREADY_SCORED.has(run.state)) {
    return {
      runId,
      outcome: 'already_scored',
      holdReason: null,
      durationMs: elapsed(startedAt),
      provider: provider.name,
    }
  }
  // A held run is deliberately *not* short-circuited here. It is still `defense_complete` (D-405),
  // and a later attempt is how FR-140's held run recovers when the provider comes back — so the job
  // runs again in full and only the *writes* are guarded, under the run's lock, by `holdRun`. That
  // is what makes a second hold a no-op without making a retry impossible (D-424).
  if (run.state !== 'defense_complete') runNotScorable(run.state, 'not_complete')

  const graphs = buildGraphs(input)
  const facts = categoricalFacts(input, graphs)

  // Everything AN-005 measures, gathered once at the point both endings can still see it (17 §3.5).
  // A held run fires the same event as a scored one — a run that could not be banded is a fact the
  // dashboard needs, and a gap where the run should be reads as a run that never happened (FR-140).
  const measures: ScoredMeasures = {
    run,
    variantKey,
    graphs,
    facts,
    events: input.events,
    providerName: provider.name,
  }

  // FR-087's larger loss: more than a third of the consequential claims lost their stance record, so
  // what the run did with its claims cannot be read either way and no band would mean anything.
  if (facts.stanceRecordLoss === 'unscoreable') {
    return holdRun(measures, 'record_lost', startedAt)
  }

  const readContext: ReadContext = {
    events: input.events,
    graphs,
    flaggedDelegationIds: input.flaggedDelegationIds,
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
    return holdRun(measures, reason, startedAt)
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
      payload: SCORING_NOTIFICATION_PAYLOADS.runScoredStudent(runId),
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
      payload: SCORING_NOTIFICATION_PAYLOADS.runScoredReviewer(runId, run.sectionId),
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
  // AN-005 (17 §3.5), after the commit and only on the attempt that actually wrote: the job that
  // found the run already scored has measured nothing, and a second `run_scored` would double every
  // average on the dashboard. No actor, because there is none — `scoreRun` runs behind a queue, not
  // behind a seat, so the event is the `system` distinct id and creates no person (17 §5.4).
  track('run_scored', runScoredProps(measures, bands, scoredAt), {
    userId: null,
    organizationId: run.organizationId,
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
 *
 * **Holding twice is holding once, and here the state cannot be the guard** (D-424). The scoring
 * transaction is idempotent because scoring *moves* the run and the second job finds it moved
 * (D-400); a hold moves nothing on purpose (D-405), so the run is still `defense_complete`
 * afterwards and the state gate below would admit a second hold — a second `run_held` notification
 * per reviewer, a second `ops_run_held`, a second `ops_scoring_completed{held:true}` and a second
 * alert about one run. So the column the hold actually writes is the one it reads back under the
 * lock: a run already `held` is left exactly as it is.
 */
async function holdRun(
  measures: ScoredMeasures,
  reason: HoldReason,
  startedAt: number,
): Promise<ScoreRunResult> {
  const { run, providerName } = measures
  const held = await withTransaction(async (tx) => {
    const locked = await lockRunForMutation(tx, run.organizationId, run.id)
    // The same lock and the same reading as the scoring transaction: a run another job has already
    // scored is not held, and saying so would raise an alert about a run that is fine.
    if (locked.state !== 'defense_complete') return 'moved'
    if (locked.scoringStatus === 'held') return 'held_already'
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
      payload: SCORING_NOTIFICATION_PAYLOADS.runHeld(run.id, reason),
      orgId: run.organizationId,
    })
    return 'wrote'
  })

  const durationMs = elapsed(startedAt)
  if (held !== 'wrote') {
    return {
      runId: run.id,
      outcome: held === 'held_already' ? 'already_held' : 'already_scored',
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
  // FR-140 on the dashboard (17 §3.5): `held: true`, seven unassessed bands, no shares. The counts
  // still travel — how many claims, checks and escalations the run made is a fact about the run and
  // not about the scoring that could not finish. The hold *reason* does not: it is an operational
  // detail, it is on `ops_run_held` beside this, and it is not a property of the event.
  track('run_scored', runScoredProps(measures, null, new Date()), {
    userId: null,
    organizationId: run.organizationId,
  })
  alertOps('run_held', { run_id: run.id, reason })

  return { runId: run.id, outcome: 'held', holdReason: reason, durationMs, provider: providerName }
}

const elapsed = (startedAt: number): number =>
  Math.max(0, Math.round(performance.now() - startedAt))

// ---------------------------------------------------------------------------------------------
// AN-005: the per-run measures at scoring (17 §3.5)
// ---------------------------------------------------------------------------------------------

/**
 * What both endings of the job hand the `run_scored` projection.
 *
 * It is gathered before the fork rather than at the two `track` calls because a held run and a
 * scored run measured different amounts of the same pipeline, and the only way the two events can
 * be compared on one dashboard is if they were read from the same objects.
 */
type ScoredMeasures = {
  run: repo.ScoringRunRow
  variantKey: VariantKey
  graphs: RunGraphs
  facts: CategoricalFacts
  events: readonly GraphEvent[]
  providerName: LlmProviderName
}

/** Whole milliseconds between two instants; 0 when either end was never recorded. */
function spanMs(from: string | Date | null, to: Date | null): number {
  if (from === null || to === null) return 0
  const start = typeof from === 'string' ? Date.parse(from) : from.getTime()
  if (Number.isNaN(start)) return 0
  return Math.max(0, Math.round(to.getTime() - start))
}

/**
 * The `run_scored` payload (17 §3.5), projected from the pipeline's own outputs.
 *
 * `bands` is `null` for the held ending, and that null is the whole difference between the two
 * events: every dimension reports `unassessed`, the three shares and the accuracy report null, and
 * `held` is true. Nothing is estimated to fill the gap (FR-004) — a share this run cannot support is
 * absent, not zero, because a zero would sit in the cohort average as a real measurement.
 *
 * Everything else is a count, a duration, an enum or a boolean read off the run's own record. No
 * claim text, no band rationale, no defense answer and no quote reaches this object: what a
 * dashboard is owed about a run is its shape, and D-066 is the same rule here as on `llm_calls`.
 */
function runScoredProps(
  measures: ScoredMeasures,
  bands: Record<Dimension, DraftBand> | null,
  finishedAt: Date,
): EventProps<'run_scored'> {
  const { run, variantKey, graphs, facts, events, providerName } = measures
  // A `const` alias so the null check narrows inside the closures below, which a parameter does not.
  const drafted = bands
  const matrix = graphs.stance_matrix
  // The D-107 denominator the FCR and the matched share already use: every consequential claim in
  // the variant, neutralized ones excluded, met or not. `accept_share` shares it so the three
  // numbers on one dashboard row are three readings of one population.
  const live = matrix.rows.filter((row) => !row.neutralized)
  const bandOf = (dimension: Dimension): EventProps<'run_scored'>['band_framing'] =>
    drafted === null ? 'unassessed' : (drafted[dimension].band ?? 'unassessed')
  const everyBandIs = (band: Band): boolean =>
    drafted !== null && DIMENSIONS.every((dimension) => drafted[dimension].band === band)
  // `defense_completed_at` anchors both durations. It is nullable on the row and never null on a run
  // that reached this job, so a null here is a broken record rather than a measurement: 0 says "not
  // measured" in a property that has no null.
  const completedAt = run.defenseCompletedAt

  return {
    ...runContext(run, variantKey),
    false_challenge_rate: drafted === null ? null : facts.fcr,
    matched_stance_share: drafted === null ? null : facts.matchedShare,
    accept_share:
      drafted === null
        ? null
        : rate3(live.filter((row) => row.stance_taken === 'accept').length, live.length),
    unassessed_count:
      drafted === null
        ? DIMENSIONS.length
        : DIMENSIONS.filter((dimension) => drafted[dimension].status === 'unassessed').length,
    provisional_count:
      drafted === null
        ? 0
        : DIMENSIONS.filter((dimension) => drafted[dimension].provisional).length,
    scoring_latency_ms: spanMs(completedAt, finishedAt),
    rubric_version: CURRENT_RUBRIC,
    provider: providerName,
    consequential_claims_count: matrix.consequential_claim_count,
    surfaced_claims_count: live.filter((row) => row.surfaced).length,
    // Every exchange the run made, the flagged ones included: FR-055 removes an exchange from the
    // *rubric*, and how much a student delegated is a fact about the run either way.
    delegations_count: facts.delegationCount + facts.flaggedDelegationCount,
    actions_count: facts.actionCount,
    escalations_count: facts.escalationCount,
    // Distinct documents, not opens: re-reading the same memo four times is one document read.
    documents_opened_count: new Set(
      eventsOfType(events, 'document_open').map((event) => event.payload.document_id),
    ).size,
    duration_ms: spanMs(firstOfType(events, 'frame_locked')?.occurredAt ?? null, completedAt),
    confidence_at_frame: facts.confidence.frame,
    confidence_at_lock: facts.confidence.lock,
    confidence_after_turn: facts.confidence.turn,
    accuracy_at_lock: drafted === null ? null : facts.accuracyAtLock,
    band_framing: bandOf('framing'),
    band_delegation: bandOf('delegation'),
    band_verification: bandOf('verification'),
    band_calibration: bandOf('calibration'),
    band_decision_quality: bandOf('decision_quality'),
    band_adaptation: bandOf('adaptation'),
    band_ownership: bandOf('ownership'),
    all_novice: everyBandIs('novice'),
    all_professional: everyBandIs('professional'),
    held: drafted === null,
  }
}

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
 * FR-005, FR-182 and 10 §11.4's effective band: **the instructor's decision, with the correction as
 * a floor under it** — and the draft where there is no decision.
 *
 * Two rules meet here and both are absolute, so the order they are applied in is the whole of this
 * function (D-422).
 *
 *   *FR-182 — the instructor's judgment is final.* `decided` is what the run stands on: the decided
 *   band where a faculty seat decided one, the draft where they have not. `unassessed` is terminal
 *   and returns before the floor is applied at all: nothing may band a dimension a faculty seat has
 *   said this run cannot be assessed on, and there is no band there for a floor to protect.
 *
 *   *FR-005 — a correction for Tassl's own error can raise a band and never lowers one.* So the
 *   recomputed band is a floor under `decided`, never a replacement for it: D-397 says in as many
 *   words that "a correction has no business undoing an override".
 *
 * `bandBeforeCorrection` is deliberately **not** an input. It is the record of what the recompute
 * saw — when the decision came first it *is* `decided`, and when the decision came later `decided`
 * is the fresher of the two and the one FR-182 makes final. Reading it instead of `decided` is the
 * defect this replaces: it made every decision on a corrected dimension a no-op, including an
 * override that *raised* the band, and including `unassessed`.
 */
export function effectiveBandOf(row: {
  draftBand: Band | null
  decision: 'confirmed' | 'overridden' | 'unassessed' | null
  decidedBand: Band | null
  bandBeforeCorrection: Band | null
  bandAfterCorrection: Band | null
}): Band | null {
  if (row.decision === 'unassessed') return null
  const decided = row.decision === null ? row.draftBand : (row.decidedBand ?? row.draftBand)
  return higherBand(decided, row.bandAfterCorrection)
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
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt === null ? null : row.decidedAt.toISOString(),
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

// ---------------------------------------------------------------------------------------------
// What `review` writes (10 §11.4, §11.5; 10 §12; FR-005, FR-140, FR-181, FR-182, FR-232)
//
// `run_bands` and `run_scores` are this module's tables, and three different writers touch them:
// the pipeline drafts, the faculty seat decides, and a neutralization corrects (D-423). The
// decision and the correction are the `review` module's *acts* — it names the actor, applies the
// permission matrix, writes the trace event and the audit row — but the columns are written here,
// because a second module writing these two tables would be a second definition of what a band is.
//
// Each function below takes the transaction the act commits in, and none of them takes an actor.
// That is the same seam `trace.append`, `reliance.surfaceClaims` and `runs.markScored` have, and it
// is what keeps "every run mutation appends its event in the same transaction" a signature rather
// than a habit.
// ---------------------------------------------------------------------------------------------

/** One dimension's decision as the faculty seat makes it (FR-181, 10 §12). */
export type BandDecisionWrite = {
  dimension: Dimension
  decision: 'confirmed' | 'overridden' | 'unassessed'
  /** The band the decision settles on; null for `unassessed`. */
  band: Band | null
  note: string | null
  decidedBy: string
  decidedAt: Date
}

/**
 * The run's seven bands in rubric order, or an empty list before the pipeline has written any.
 *
 * It takes no actor, like `readScore` above and for the same reason (D-340): the replay names
 * `requireRunReviewer` and the confirmation names the run's instructor, and neither reads these
 * rows without having done so. `dbx` is the transaction when a decision is being made inside one,
 * so the rules that follow read the rows as that transaction has them.
 */
export async function readBands(runId: string, dbx?: repo.DbOrTx): Promise<BandView[]> {
  const rows = await repo.listBands(runId, dbx)
  const order = new Map(DIMENSIONS.map((dimension, index) => [dimension, index]))
  return rows
    .slice()
    .sort((a, b) => (order.get(a.dimension) ?? 0) - (order.get(b.dimension) ?? 0))
    .map(toBandView)
}

/**
 * Writes the decision half of one or more bands, re-prices the run, and answers both (D-510).
 *
 * **The draft half is not named, so it is not written** (D-423). `upsertBands` builds its SET clause
 * from the columns the caller's rows actually carry, and the rows below carry the five decision
 * columns and nothing else of substance — `draft_band`, `draft_reason`, `provisional`, `graph_keys`,
 * `evidence_event_seqs`, `quotes` and `rationale` keep whatever the pipeline wrote, and so do the
 * two correction columns. `draft_status` and `basis` travel because they are NOT NULL with no
 * default and the statement is an insert until it conflicts; they are read from the rows this
 * function just loaded, so they are rewritten with the values they already hold.
 *
 * **It takes the mapping and writes the points, because a band write that did not was the defect**
 * (D-510). The confirmation used to write `points_confirmed` alone and leave the three correction
 * columns holding whatever the last correction put there — and the export files
 * `points_effective ?? points_confirmed`, so on a corrected run every later decision was invisible
 * to the gradebook while every screen, priced from the bands (D-445, D-451), showed the new one.
 * The two are now one statement pair: nothing can write a decision without re-deriving all five
 * figures from the bands that decision produced.
 */
export async function writeBandDecisions(
  tx: repo.Tx,
  runId: string,
  mapping: BandMapping,
  decisions: readonly BandDecisionWrite[],
): Promise<{ bands: BandView[]; points: RunPoints }> {
  if (decisions.length === 0) {
    const bands = await readBands(runId, tx)
    return { bands, points: priceBands(bands, mapping) }
  }
  const existing = new Map((await repo.listBands(runId, tx)).map((row) => [row.dimension, row]))
  const rows = decisions.map((decision) => {
    const row = existing.get(decision.dimension)
    if (!row) throw new AppError('INTERNAL_ERROR', 'That dimension has no drafted band.')
    return {
      dimension: decision.dimension,
      draftStatus: row.draftStatus,
      basis: row.basis,
      decision: decision.decision,
      decidedBand: decision.band,
      decidedBy: decision.decidedBy,
      decidedAt: decision.decidedAt,
      note: decision.note,
    }
  })
  await repo.upsertBands(runId, rows, tx)
  const bands = await readBands(runId, tx)
  return { bands, points: await writeRunPoints(tx, runId, bands, mapping) }
}

/**
 * **The one writer of `run_scores.points_*` after the pipeline's draft** (FR-202, FR-005, D-510).
 *
 * Every point column of the run, re-derived from the bands it now stands on and written together.
 * A writer that touched one column and left the others is what put a filed export and the screen
 * above it on two different arithmetics: `trace.buildExport` reads
 * `points_effective ?? points_confirmed`, so a stale `points_effective` from an earlier correction
 * outranked every confirmation made after it.
 *
 * A column patch rather than an upsert (D-435): the run has a score row by definition, because a
 * band cannot be decided or corrected before it was drafted, and an upsert would mean sending the
 * four graphs back with every one of the seven decisions.
 */
export async function writeRunPoints(
  tx: repo.Tx,
  runId: string,
  bands: readonly BandView[],
  mapping: BandMapping,
): Promise<RunPoints> {
  const priced = priceBands(bands, mapping)
  await repo.patchScore(
    runId,
    {
      pointsDraft: numeric(priced.draft, 3),
      pointsConfirmed: numeric(priced.confirmed, 3),
      pointsBeforeCorrection: numeric(priced.beforeCorrection, 3),
      pointsAfterCorrection: numeric(priced.afterCorrection, 3),
      pointsEffective: numeric(priced.effective, 3),
    },
    tx,
  )
  return priced
}

/** The effective band of every dimension the run has a row for (D-422), keyed for `computePoints`. */
export function effectiveBandsOf(
  bands: readonly BandView[],
): Partial<Record<Dimension, Band | null>> {
  const effective: Partial<Record<Dimension, Band | null>> = {}
  for (const band of bands) effective[band.dimension] = band.effectiveBand
  return effective
}

// ---------------------------------------------------------------------------------------------
// Pricing a run under a mapping (FR-202, FR-203, FR-206; D-091, D-095)
// ---------------------------------------------------------------------------------------------

/** Every point figure `run_scores` holds for one run, under one course mapping. */
export type RunPoints = {
  draft: number | null
  confirmed: number | null
  beforeCorrection: number | null
  afterCorrection: number | null
  effective: number | null
}

/**
 * The five figures a run's bands produce under a mapping — the whole of the course's arithmetic in
 * one place (FR-202).
 *
 * It exists because three callers need the same sum and none of them may own it: the confirmation
 * writes `points_confirmed`, the mapping change rewrites every column of every confirmed run in a
 * course (FR-206, D-095), and the preview that change is shown behind has to produce the *same*
 * number without writing anything. A second implementation of "add the mapping's value for each
 * assessed band and divide by how many were assessed" is a second answer to what a grade is.
 *
 * `afterCorrection` is the arithmetic over the bands the run currently stands on, which is what
 * `effectiveBandOf` composes: the decision where a faculty seat made one, floored by a correction
 * that raises and never lowers (D-422). `beforeCorrection` substitutes what the recompute saw on the
 * dimensions it touched, and `effective` is the higher of the two — FR-005's floor, applied to the
 * totals exactly as `higherPoints` applies it everywhere else. A run that has had no correction
 * carries nulls in all three, because there is nothing for the floor to be under (D-447).
 */
export function priceBands(bands: readonly BandView[], mapping: BandMapping): RunPoints {
  const effective = effectiveBandsOf(bands)
  const draftInput: Partial<Record<Dimension, Band | 'unassessed'>> = {}
  for (const band of bands) draftInput[band.dimension] = band.band ?? 'unassessed'

  // A dimension a correction touched, read off either column rather than the first alone (D-511).
  // `bandBeforeCorrection` is null on a dimension the run held no band on before the correction, and
  // a correction that raised one from there is exactly the case FR-005 is about — so a detector that
  // asked only about the "before" column would file the raise as no correction at all.
  const corrected = bands.filter(
    (band) => band.bandBeforeCorrection !== null || band.bandAfterCorrection !== null,
  )
  if (corrected.length === 0) {
    return {
      draft: computePoints(draftInput, mapping),
      confirmed: allDimensionsDecided(bands) ? computePoints(effective, mapping) : null,
      beforeCorrection: null,
      afterCorrection: null,
      effective: null,
    }
  }

  const before = { ...effective }
  for (const band of corrected) before[band.dimension] = band.bandBeforeCorrection
  const beforeCorrection = computePoints(before, mapping)
  const afterCorrection = computePoints(effective, mapping)
  return {
    draft: computePoints(draftInput, mapping),
    confirmed: allDimensionsDecided(bands) ? computePoints(effective, mapping) : null,
    beforeCorrection,
    afterCorrection,
    effective: higherPoints(beforeCorrection, afterCorrection),
  }
}

/**
 * The one number a gradebook receives, from the five (FR-204, D-087).
 *
 * `points_effective ?? points_confirmed` is the rule `trace.buildExport` already applies to the
 * stored columns, and it is stated once here so the mapping-change preview, the export and the
 * debrief cannot each pick a different one.
 */
export const gradebookPointsOf = (points: RunPoints): number | null =>
  points.effective ?? points.confirmed

/**
 * Rewrites a run's point columns under a new mapping and answers what moved (FR-206, 10 §3).
 *
 * The bands do not move: a mapping change is the course changing what a band is worth, not Tassl
 * changing what the run recorded. So this reads the seven bands, prices them twice — once as they
 * stand and once under the new mapping — and writes the second. It lives here because `run_scores`
 * is this module's table and a second module writing it would be a second definition of what a
 * band is worth (the note above `writeBandDecisions`, applied to the other half of the row).
 *
 * Answering both prices is what lets the caller write the audit row and the mapping-change record
 * without asking again.
 */
export async function repriceRun(
  tx: repo.Tx,
  runId: string,
  before: BandMapping,
  after: BandMapping,
): Promise<{ before: RunPoints; after: RunPoints }> {
  const bands = await readBands(runId, tx)
  return {
    before: priceBands(bands, before),
    after: await writeRunPoints(tx, runId, bands, after),
  }
}

/** Whether every dimension of the rubric now carries a decision (10 §12's confirmation rule). */
export function allDimensionsDecided(bands: readonly BandView[]): boolean {
  const decided = new Set(
    bands.filter((band) => band.decision !== null).map((band) => band.dimension),
  )
  return DIMENSIONS.every((dimension) => decided.has(dimension))
}

/** What `applyNeutralization` needs beyond the run id: the correction, and when it was made. */
export type ApplyNeutralizationArgs = {
  tenantId: string
  runId: string
  neutralization: Neutralization
  occurredAt: Date
}

/**
 * §11.5's recompute, applied (FR-005, FR-232).
 *
 * The arithmetic is `recompute.ts`, which is pure and knows nothing about a database. This is the
 * half that touches the world, and it writes exactly two rows' worth: the two correction columns on
 * the two dimensions a neutralization can move, and the point totals and rates on the score row. It
 * writes **no** decision column and no draft column — a correction has no business undoing an
 * override (D-397), and the floor that protects the student is applied when the effective band is
 * read (`effectiveBandOf`, D-422) rather than by overwriting what the instructor decided.
 *
 * The reads are not re-run and are not passed: the five free-text dimensions never depended on the
 * neutralized claim (§11.5), and `RECOMPUTED_DIMENSIONS` is the only part of the result this reads.
 *
 * `effectiveBands` is what the run currently stands on — the decision where a reviewer made one and
 * the draft where they have not — so a correction after a confirmation floors the *confirmed* band
 * and a correction before one floors the draft. `unassessedDimensions` travels beside it because
 * `null` in that record means two different things and only one of them is terminal (D-512): a
 * dimension the *pipeline* could not place may still be raised by a correction, and a dimension a
 * faculty seat decided `unassessed` may not be banded by anything (FR-182).
 *
 * The three point columns are written by `writeRunPoints` from the bands as they stand *after* the
 * two correction columns are committed, not from the recompute's own totals (D-510). One function
 * prices a run, and the figures the event and the dialog carry are the figures that were filed.
 */
export async function applyNeutralization(
  tx: repo.Tx,
  args: ApplyNeutralizationArgs,
): Promise<RecomputeResult> {
  const run = await repo.findRunForScoring(args.tenantId, args.runId, tx)
  if (!run) runNotFound()
  const bands = await readBands(args.runId, tx)
  if (bands.length === 0) runNotScorable(run.state, 'not_scored')
  const input = await loadGraphInput(run, tx)

  const result = recomputeAfterNeutralization({
    input,
    neutralization: args.neutralization,
    occurredAt: args.occurredAt.toISOString(),
    effectiveBands: effectiveBandsOf(bands),
    unassessedDimensions: bands
      .filter((band) => band.decision === 'unassessed')
      .map((band) => band.dimension),
    mapping: run.mapping,
  })

  const byDimension = new Map(bands.map((band) => [band.dimension, band]))
  await repo.upsertBands(
    args.runId,
    result.dimensions.map((dimension) => {
      const row = byDimension.get(dimension)
      if (!row) throw new AppError('INTERNAL_ERROR', 'That dimension has no drafted band.')
      return {
        dimension,
        draftStatus: row.status,
        basis: row.basis,
        bandBeforeCorrection: result.bandsBefore[dimension] ?? null,
        bandAfterCorrection: result.bandsAfter[dimension] ?? null,
      }
    }),
    tx,
  )
  const priced = await writeRunPoints(tx, args.runId, await readBands(args.runId, tx), run.mapping)
  await repo.patchScore(
    args.runId,
    {
      falseChallengeRate: numeric(result.facts.fcr, 4),
      matchedStanceShare: numeric(result.facts.matchedShare, 4),
    },
    tx,
  )
  return {
    ...result,
    pointsBefore: priced.beforeCorrection,
    pointsAfter: priced.afterCorrection,
    pointsEffective: priced.effective,
    points: { points_before: priced.beforeCorrection, points_after: priced.afterCorrection },
  }
}

/**
 * The four graphs as the pipeline stored them, or null before a run has been scored.
 *
 * A read of its own rather than a field on `RunScoreView`, because the two readers want opposite
 * things: `getScore` answers a reviewer's band table and would carry a few hundred kilobytes of
 * graph payload on every poll, and the Judgment Record wants the graphs and none of the rates. Like
 * `readScore` it takes no actor (D-340) — `records.getRecord` names `requireRunOwner` and the replay
 * names `requireRunReviewer`.
 */
export async function readGraphs(
  runId: string,
  dbx?: repo.DbOrTx,
): Promise<Record<string, unknown> | null> {
  const score = await repo.findScore(runId, dbx)
  return score ? (score.graphs as unknown as Record<string, unknown>) : null
}

/**
 * The same four graphs, projected for the run's **own student** (12 §8.1, FR-170).
 *
 * One field differs, and it is not a nicety. `frame_beside_decision.brief.speed_outlier` is FR-106's
 * observation — the decision was locked under four minutes of working time — and 12 §8.1 keeps
 * instructor flags out of every student payload in every state; `trace/owner-view.ts` already
 * withholds the same field from the `decision_locked` event, and the graph is the second place it
 * appears. A student reading "you were flagged" is a student penalised by being told.
 *
 * The brief is **picked** rather than stripped, which is the rule `student-view.ts` states at its
 * own header: a projection that lists what it shows cannot leak a field the payload grows later.
 * Every other graph is carried whole, because nothing else in them is withheld after scoring — the
 * stance matrix's warranted stances and evidence statuses are precisely what the debrief and the
 * record reveal once the run is scored (12 §8.2).
 */
export async function readGraphsForOwner(
  runId: string,
  dbx?: repo.DbOrTx,
): Promise<Record<string, unknown> | null> {
  const graphs = await readGraphs(runId, dbx)
  if (!graphs) return null
  const frame = graphs.frame_beside_decision as
    { brief?: Record<string, unknown> | null } | undefined
  if (!frame || !frame.brief) return graphs
  const brief = frame.brief
  return {
    ...graphs,
    frame_beside_decision: {
      ...frame,
      brief: {
        recommendation: brief.recommendation,
        rationale: brief.rationale,
        assumptions: brief.assumptions,
        change_my_mind: brief.change_my_mind,
        named_values: brief.named_values,
        confidence: brief.confidence,
        auto: brief.auto,
        locked_at: brief.locked_at,
      },
    },
  }
}

/**
 * `run_bands.rationale` for a band a faculty seat placed rather than the pipeline (10 §12).
 *
 * Defined in `src/lib/band-prose.ts` and re-exported here (D-515). The string the pipeline writes
 * and the string the three screens compare against have to be one literal, or the branch that turns
 * it into a sentence goes dead the day one of them changes — which is how `manual` came to be
 * printed at a student in the first place.
 */
export { MANUAL_BAND_RATIONALE } from '@/lib/band-prose'

/**
 * FR-140's manual banding: a held run gets the bands a faculty seat placed by hand.
 *
 * The four graphs are rebuilt from the trace, because a held run has none stored and the debrief,
 * the record and the export all read them — a run banded by hand is still a run whose evidence the
 * student is entitled to see. What is *not* rebuilt is the drafting: every band is the reviewer's,
 * written with `basis = 'none'` and the rationale `manual`, so nothing in the record claims Tassl
 * placed a band it could not place (10 §12).
 *
 * It writes the rows and answers them; the seven `draft_band` events and the decisions that confirm
 * them are `review`'s, in the same transaction.
 */
export async function bandRunManually(
  tx: repo.Tx,
  tenantId: string,
  runId: string,
  placements: Readonly<Record<Dimension, Band | 'unassessed'>>,
): Promise<{ bands: DraftBand[]; pointsDraft: number | null }> {
  const run = await repo.findRunForScoring(tenantId, runId, tx)
  if (!run) runNotFound()
  const input = await loadGraphInput(run, tx)
  const graphs = buildGraphs(input)
  const facts = categoricalFacts(input, graphs)

  const bands: DraftBand[] = DIMENSIONS.map((dimension) => {
    const placement = placements[dimension]
    return {
      dimension,
      band: placement === 'unassessed' ? null : placement,
      status: placement === 'unassessed' ? 'unassessed' : 'drafted',
      // FR-004: a dimension holds a band or says why it holds none. A reviewer who marks one
      // unassessed by hand has said the run cannot be assessed on it, which is `no_evidence` — the
      // reason the rubric already carries for exactly that.
      reason: placement === 'unassessed' ? 'no_evidence' : '',
      basis: 'none',
      provisional: false,
      graphKeys: [...DIMENSION_GRAPHS[dimension]],
      evidenceEventSeqs: [],
      quotes: [],
      rationale: MANUAL_BAND_RATIONALE,
    }
  })
  const byDimension = Object.fromEntries(bands.map((band) => [band.dimension, band])) as Record<
    Dimension,
    DraftBand
  >
  const pointsDraft = computePoints(
    Object.fromEntries(bands.map((band) => [band.dimension, band.band ?? 'unassessed'])),
    run.mapping,
  )

  await repo.upsertBands(runId, bands.map(bandRow), tx)
  await repo.upsertScore(
    runId,
    {
      rubricVersion: CURRENT_RUBRIC,
      graphs,
      falseChallengeRate: numeric(facts.fcr, 4),
      matchedStanceShare: numeric(facts.matchedShare, 4),
      pointsDraft: numeric(pointsDraft, 3),
      flags: [...flagsOf(byDimension, facts.nothingAnswered)],
      scoredAt: new Date(),
    },
    tx,
  )
  return { bands, pointsDraft }
}

/** The `draft_band` payload of one hand-placed band, so `review` can append the seven events. */
export function draftBandEventPayload(band: DraftBand) {
  return draftBandPayload(band)
}

/**
 * The trace, the authored standard, the variant's answer key and the reviewer's marks, read through
 * one handle. The marks are FR-055's (D-481): every construction of a `GraphInput` carries them, so
 * a graph rebuilt here excludes a flagged exchange exactly as the pipeline's own did.
 */
async function loadGraphInput(run: repo.ScoringRunRow, dbx: repo.DbOrTx): Promise<GraphInput> {
  const [events, authored, variantStates, flaggedDelegationIds] = await Promise.all([
    readEvents(run.id, dbx),
    repo.findPackageForScoring(run.organizationId, run.packageVersionId, dbx),
    repo.listVariantStates(run.variantId, dbx),
    repo.listFlaggedDelegationIds(run.id, dbx),
  ])
  if (!authored) runNotFound()
  return {
    events: events.map((event) => ({
      seq: event.seq,
      type: event.type,
      occurredAt: event.occurredAt.toISOString(),
      clockRemainingMs: event.clockRemainingMs,
      payload: event.payload,
    })),
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
    flaggedDelegationIds,
  }
}
