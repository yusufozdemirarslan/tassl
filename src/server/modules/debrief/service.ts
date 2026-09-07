// Service of the `debrief` module (docs/tech/10-backend-spec-modules.md §13; 07-api-spec.md §7;
// 08-auth-authz.md §4; FR-150 to FR-155, D-091).
//
// The debrief is the one screen in Tassl that tells a student how their run went, and everything
// about this file follows from three facts about it.
//
//   * **It is one document, read by two seats** (FR-154). The run's own student and the reviewers of
//     their section read exactly the same sections, the same claim walk and the same four graphs —
//     "student and instructor see identical graphs from the same trace" is a claim about one object,
//     so there is one projection here and not two. The single difference is that a reviewer has no
//     form: the two questions are the student's reflection on their own run.
//   * **It is a student payload, after scoring** (12 §8.2). Everything 12 §8.1 withholds in every
//     state stays out — the question bank, the expected-answer notes, the seed record, `runs.flags`,
//     the band reads' quotes and stored sequence numbers — and everything §8.2 releases *at* scoring
//     is here, because this is the screen that releases it: what each claim deserved and why, which
//     claims the variant authored as defective, and which of the two variants the student drew. The
//     view is swept against `student-view.ts` before it is answered.
//   * **The same route serves both versions** (FR-150). A run at `scored` shows draft bands and
//     provisional points; the same URL after confirmation shows what the instructor decided and any
//     note they wrote, in place of the draft. `debrief_opened` is written once *per version*, because
//     a student who read the draft and comes back after the confirmation is opening a debrief they
//     have not seen.
import { AppError, isAppError } from '@/lib/errors'
import { t } from '@/lib/i18n/t'
import { requireRunOwner, requireRunReviewer } from '@/server/auth/permissions'
import { assertNoForbiddenKeys } from '@/server/auth/student-view'
import type { SessionUser } from '@/server/auth/types'
import {
  lockRunForMutation,
  markRecorded,
  toRunSummary,
  type RunSummary,
} from '@/server/modules/runs'
// The interrogation action costs are pilot parameters and `runs/limits.ts` is the one place in the
// codebase any of them is written (10 §10) — the same import, for the same reason, that
// `reliance/service.ts` makes at its own head. The debrief names what a check would have cost; it
// runs none.
import { ACTION_COSTS, type ActionTypeValue } from '@/server/modules/runs/limits'
import {
  effectiveBandsOf,
  priceBands,
  readBands,
  readGraphsForOwner,
  type BandView,
} from '@/server/modules/scoring'
import { append } from '@/server/modules/trace'
import {
  buildSections,
  selectDoneWell,
  type AssemblyInput,
  type ClaimFacts,
  type ProbeFacts,
} from './assembly'
import { debriefAnswered, debriefNotAvailable, runNotFound } from './errors'
import * as repo from './repository'
import type {
  DebriefAnswers,
  DebriefBand,
  DebriefLabels,
  DebriefPoints,
  DebriefQuestions,
  DebriefSection,
  StanceValue,
} from './schema'

export type { DebriefAnswers, DebriefBand, DebriefPoints, DebriefQuestions, DebriefSection }
export { DEBRIEF_SECTION_ORDER } from './schema'

/** The states in which a run has bands to walk (10 §13: "state ≥ `scored`"). */
const DEBRIEF_STATES: ReadonlySet<string> = new Set(['scored', 'confirmed', 'recorded'])

/** The two states in which the bands on this page are the instructor's rather than the pipeline's. */
const CONFIRMED_STATES: ReadonlySet<string> = new Set(['confirmed', 'recorded'])

/** What `GET /runs/{runId}/debrief` answers (07 §7). */
export type DebriefView = {
  run: RunSummary
  sections: DebriefSection[]
  bands: DebriefBand[]
  points: DebriefPoints
  questions: DebriefQuestions
  doneWell: string
  labels: DebriefLabels
}

// ---------------------------------------------------------------------------------------------
// The two seats (FR-154, 08 §4)
// ---------------------------------------------------------------------------------------------

type Reader = { organizationId: string; viewer: 'owner' | 'reviewer' }

/**
 * The run's own student, or a reviewer of its section — and nobody else (FR-154).
 *
 * The owner is asked for first, because a run belongs to one and every other reader is an exception
 * to that. A classmate is refused by both guards and keeps the owner guard's NOT_FOUND: 08 §4 gives
 * a student no read of another student's run at all, and a refusal that says "you may not" would say
 * the run exists. It is the same two-step `records.exportRecord` and `trace.listEvents` make, for the
 * same reason.
 */
async function requireDebriefReader(actor: SessionUser, runId: string): Promise<Reader> {
  try {
    const scope = await requireRunOwner(actor, runId)
    return { organizationId: scope.organizationId, viewer: 'owner' }
  } catch (error) {
    if (!isAppError(error) || error.code !== 'NOT_FOUND') throw error
  }
  try {
    const scope = await requireRunReviewer(actor, runId)
    return { organizationId: scope.organizationId, viewer: 'reviewer' }
  } catch (error) {
    if (isAppError(error) && error.code === 'FORBIDDEN') throw new AppError('NOT_FOUND')
    throw error
  }
}

// ---------------------------------------------------------------------------------------------
// The debrief (FR-150 to FR-155, UI-028)
// ---------------------------------------------------------------------------------------------

/**
 * `GET /runs/{runId}/debrief`: the run walked in the order it happened (FR-151).
 *
 * **The first open of each version is recorded** (10 §13, FR-152). It is a write inside a read, the
 * same shape `review.getReplay` has one module along and for the same reason: the fact being
 * recorded is that somebody looked. Only the *owner's* open writes it — the event is the record that
 * the student was shown their result, and a reviewer reading the same page has `flags.
 * replay_first_opened_at` for the same purpose on the replay; a reviewer who opened first would
 * otherwise consume the student's own first open and the trace would say they had seen a page they
 * never opened (D-444).
 *
 * The four graphs come from `scoring.readGraphsForOwner`, which withholds one field — FR-106's
 * `speed_outlier`, an instructor observation (D-438) — and carries everything else whole. Both seats
 * are served that projection, because FR-154's "identical graphs from the same trace" is a promise
 * to the student that the instructor is not reading a different picture.
 */
export async function getDebrief(actor: SessionUser, runId: string): Promise<DebriefView> {
  const reader = await requireDebriefReader(actor, runId)
  const tenantId = reader.organizationId

  const context = await repo.findDebriefContext(tenantId, runId)
  if (!context) runNotFound()
  const data = await repo.findDebriefData(tenantId, runId)
  if (!data) runNotFound()
  if (!DEBRIEF_STATES.has(data.run.state)) debriefNotAvailable(data.run.state)

  const version = CONFIRMED_STATES.has(data.run.state) ? 'confirmed' : 'draft'
  if (reader.viewer === 'owner') await recordFirstOpen(tenantId, runId, version)

  const [graphs, bandViews, authored, documents, turnStandard, probeEvents] = await Promise.all([
    readGraphsForOwner(runId),
    readBands(runId),
    repo.listDebriefClaims(context.packageVersionId, context.variantId),
    repo.listDebriefDocuments(context.packageVersionId),
    repo.findTurnStandard(context.packageVersionId),
    repo.listEventsOfType(runId, 'probe_fired'),
  ])

  const bands = bandViews.map(toDebriefBand)
  const claims = joinClaims(authored, documents, data)
  const input: AssemblyInput = {
    version,
    viewer: reader.viewer,
    graphs,
    frame: data.frame
      ? {
          decision: data.frame.decision,
          assumptions: [...data.frame.assumptions],
          position: data.frame.position,
        }
      : null,
    turnResponse: data.turnResponse ? { response: data.turnResponse.response } : null,
    turnStandard: turnStandard ?? null,
    counterfactual: context.counterfactual,
    claims,
    probe: toProbe(probeEvents, claims),
    escalations: escalationsOf(data, claims),
    bands,
    points: pointsOf(context, bandViews),
    questions: questionsOf(data, reader.viewer),
  }

  const view: DebriefView = {
    run: toRunSummary(data.run),
    sections: buildSections(input),
    bands,
    points: input.points,
    questions: input.questions,
    doneWell: selectDoneWell(input),
    labels: {
      version,
      uncalibrated: true,
      isWalkthrough: context.isWalkthrough,
      viewer: reader.viewer,
      mode: context.mode,
      variant: context.variantKey,
    },
  }
  // 12 §8.1 and §8.2, applied to the whole document rather than to the pieces it was built from:
  // this is a student payload on a run that has been scored, so `{ scored: true }` and no record
  // form — the debrief is precisely the screen that *does* show the weight, the mapping and the
  // points (12 §8.3), and it is the record that must not.
  assertNoForbiddenKeys(view, { scored: true })
  return view
}

/**
 * `debrief_opened { version }`, written once per version (10 §13).
 *
 * Its own transaction, taken on the run's row like every other write in the product, and answered
 * with nothing: the page does not change because the event was written, and a reader whose open was
 * the second one is reading the same document as the reader whose open was the first.
 */
async function recordFirstOpen(
  tenantId: string,
  runId: string,
  version: 'draft' | 'confirmed',
): Promise<void> {
  if (await repo.hasDebriefOpened(runId, version)) return
  await repo.withTransaction(async (tx) => {
    const locked = await lockRunForMutation(tx, tenantId, runId)
    // Asked again inside the lock: two tabs opening the same debrief at once would otherwise both
    // pass the check above and write two events for one version.
    if (await repo.hasDebriefOpened(runId, version, tx)) return
    await append(tx, locked, 'debrief_opened', { version })
  })
}

// ---------------------------------------------------------------------------------------------
// The two questions (FR-152, DATA-043)
// ---------------------------------------------------------------------------------------------

/**
 * `POST /runs/{runId}/debrief/answers`: the two questions that close the run (FR-152).
 *
 * The run's own student, and only them: a reviewer reading this page has no form, because the
 * questions ask what *this student* would change and what they will do next.
 *
 * **A confirmed run moves to Recorded here; a scored one waits.** The two acts — the student
 * answering and the instructor confirming — happen in either order, and whichever is second makes
 * the transition: this function moves a `confirmed` run on, and `review.decideBand` moves a run whose
 * student had already answered while the bands were draft (10 §12, D-437's neighbour). Neither
 * asks the student to do anything twice.
 */
export async function answerDebrief(
  actor: SessionUser,
  runId: string,
  input: DebriefAnswers,
): Promise<RunSummary> {
  const scope = await requireRunOwner(actor, runId)
  const at = new Date()

  return repo.withTransaction(async (tx) => {
    const locked = await lockRunForMutation(tx, scope.organizationId, runId)
    if (!DEBRIEF_STATES.has(locked.state)) debriefNotAvailable(locked.state)
    if ((await repo.findDebriefAnswer(runId, tx)) !== null) debriefAnswered()

    await repo.insertDebriefAnswer(
      {
        runId,
        stanceToChange: input.stanceToChange,
        doDifferently: input.doDifferently,
        answeredAt: at,
      },
      tx,
    )
    await append(
      tx,
      locked,
      'debrief_answer',
      { stance_to_change: input.stanceToChange, do_differently: input.doDifferently },
      { actorId: actor.id, occurredAt: at },
    )

    const run = CONFIRMED_STATES.has(locked.state)
      ? await markRecorded(tx, locked, { at, actorId: actor.id })
      : locked
    return toRunSummary(run)
  })
}

// ---------------------------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------------------------

/**
 * One dimension as the student reads it (FR-151, FR-182).
 *
 * `band` is `effectiveBand` — the decision where one was made, the draft where it was not, with a
 * correction as a floor that raises and never lowers (D-422) — so the seven values here are the
 * seven the points below are computed from. `quotes`, `evidenceEventSeqs`, `decidedBy` and
 * `decidedAt` are dropped by *picking* rather than deleting (12 §8): a field `run_bands` grows later
 * cannot reach a student through this function without somebody naming it.
 */
function toDebriefBand(band: BandView): DebriefBand {
  const raised =
    band.bandAfterCorrection !== null &&
    band.bandBeforeCorrection !== null &&
    band.bandAfterCorrection !== band.bandBeforeCorrection
  return {
    dimension: band.dimension,
    band: band.effectiveBand,
    status: band.effectiveBand === null ? 'unassessed' : 'drafted',
    reason: band.effectiveBand === null ? band.reason : '',
    decision: band.decision,
    note: band.note,
    rationale: band.rationale,
    graphKeys: [...band.graphKeys],
    raisedByCorrection: raised,
  }
}

/**
 * The course's arithmetic over this run's bands (FR-202, FR-203, D-091).
 *
 * The three figures are **recomputed from the bands this page is showing**, through the same
 * `scoring.priceBands` the confirmation and the mapping change write with, rather than read back
 * from `run_scores`. The difference is a correction: a neutralization on a confirmed run raises a
 * band and writes the two correction columns without rewriting `points_confirmed` (FR-005), so the
 * stored figure can name a number the bands above it no longer support. One arithmetic, applied to
 * the seven bands the reader is looking at, is the only way the screen and the file cannot disagree
 * (D-445).
 */
function pointsOf(context: repo.DebriefContext, bands: readonly BandView[]): DebriefPoints {
  const priced = priceBands(bands, context.mapping)
  const assessed = Object.values(effectiveBandsOf(bands)).filter((band) => band !== null).length
  return {
    mapping: context.mapping,
    weight: Number(context.weight),
    assessed,
    draft: priced.draft,
    confirmed: priced.confirmed,
    effective: priced.effective,
  }
}

function questionsOf(data: repo.DebriefData, viewer: 'owner' | 'reviewer'): DebriefQuestions {
  const answer = data.debriefAnswer
  return {
    answered: answer !== null,
    // FR-154's one difference between the two seats: the questions are the student's reflection on
    // their own run, not a field a reviewer fills.
    canAnswer: viewer === 'owner' && answer === null,
    stanceToChange: answer?.stanceToChange ?? null,
    doDifferently: answer?.doDifferently ?? null,
    answeredAt: answer?.answeredAt.toISOString() ?? null,
  }
}

/**
 * The authored standard and the run's own row, joined claim by claim (FR-151).
 *
 * Every consequential claim of the variant appears, surfaced or not: an unsurfaced claim is a row of
 * the walk that says so (D-107), because "the claim never came up" is a fact about the run and
 * leaving it out would make the walk shorter than the scenario.
 */
function joinClaims(
  authored: readonly repo.DebriefClaim[],
  documents: readonly repo.DebriefDocument[],
  data: repo.DebriefData,
): ClaimFacts[] {
  const runClaims = new Map(data.claims.map((claim) => [claim.claimId, claim]))
  const byDocument = new Map(documents.map((document) => [document.id, document]))
  const actions = new Map<string, { type: ActionTypeValue; completedAt: string }[]>()
  for (const action of data.actions) {
    const list = actions.get(action.claimId) ?? []
    list.push({
      type: action.type as ActionTypeValue,
      completedAt: action.completedAt.toISOString(),
    })
    actions.set(action.claimId, list)
  }

  return authored.map((claim) => {
    const row = runClaims.get(claim.claimId)
    return {
      claimId: claim.claimId,
      key: claim.key,
      text: claim.text,
      importance: claim.importance,
      rationale: claim.rationale,
      evidenceStatus: claim.evidenceStatus,
      failureFamily: claim.failureFamily,
      warrantedStance: claim.warrantedStance,
      planted: claim.planted,
      surfaced: row !== undefined,
      stanceTaken: (row?.stance ?? null) as StanceValue | null,
      previousStance: (row?.previousStance ?? null) as StanceValue | null,
      stanceSetAt: row?.stanceSetAt?.toISOString() ?? null,
      reliedOn: row?.reliedOn ?? false,
      neutralized: row?.neutralizationId != null,
      inconsistencyCredited: row?.inconsistencyCredited ?? false,
      stanceRecordLost: row?.stanceRecordLost ?? false,
      actions: actions.get(claim.claimId) ?? [],
      document:
        claim.documentTitle !== null &&
        claim.documentAuthor !== null &&
        claim.documentDatedOn !== null
          ? {
              title: claim.documentTitle,
              author: claim.documentAuthor,
              datedOn: claim.documentDatedOn,
            }
          : null,
      passage: claim.sourcePassage,
      check: checkSentence(claim, byDocument),
    }
  })
}

/**
 * What an interrogation action returns for this claim on this variant, and what it costs (FR-151).
 *
 * The path is the authored answer key (`variant_claim_states.verification_paths`), which 12 §8.2
 * releases to the student's own debrief once the run is scored — this is the section that tells them
 * "the check that would have shown it". The cost is `runs/limits.ts`'s parameter, the same number the
 * control on the workspace carried at the time.
 */
function checkSentence(
  claim: repo.DebriefClaim,
  documents: ReadonlyMap<string, repo.DebriefDocument>,
): { type: ActionTypeValue; sentence: string } | null {
  const paths = claim.verificationPaths
  const trace = paths.source_trace
  if (trace) {
    const document = documents.get(trace.document_id)
    return {
      type: 'source_trace',
      sentence: t('debrief.defect.sourceTrace', {
        document: document?.title ?? claim.documentTitle ?? '',
        author: trace.author,
        dated: trace.dated_on,
        minutes: minutesOf('source_trace'),
      }),
    }
  }
  const replication = paths.replication_check
  if (replication) {
    return {
      type: 'replication_check',
      sentence: t('debrief.defect.replicationCheck', {
        result: replication.result,
        minutes: minutesOf('replication_check'),
      }),
    }
  }
  const decomposition = paths.decomposition_check
  if (decomposition) {
    return {
      type: 'decomposition_check',
      sentence: t('debrief.defect.decompositionCheck', {
        steps: decomposition.steps.length,
        minutes: minutesOf('decomposition_check'),
      }),
    }
  }
  return null
}

const minutesOf = (type: ActionTypeValue): number => Math.round(ACTION_COSTS[type] / 60_000)

/** The Sycophancy Probe as this run recorded it, or null when it never fired (FR-053, D-088). */
function toProbe(
  events: readonly { payload: unknown; occurredAt: Date }[],
  claims: readonly ClaimFacts[],
): ProbeFacts | null {
  const event = events[0]
  if (!event) return null
  const payload = event.payload as { claim_id?: unknown; scripted_reversal?: unknown }
  const claimId = typeof payload.claim_id === 'string' ? payload.claim_id : null
  if (claimId === null) return null
  const claim = claims.find((candidate) => candidate.claimId === claimId)
  return {
    claimId,
    claimKey: claim?.key ?? '',
    reversal: typeof payload.scripted_reversal === 'string' ? payload.scripted_reversal : '',
    occurredAt: event.occurredAt.toISOString(),
    stanceAfter: claim?.stanceTaken ?? null,
  }
}

/** The escalations the run recorded, each named by the claim it was raised on (FR-090). */
function escalationsOf(
  data: repo.DebriefData,
  claims: readonly ClaimFacts[],
): { claimId: string; claimKey: string }[] {
  return data.escalations.map((escalation) => ({
    claimId: escalation.claimId,
    claimKey: claims.find((claim) => claim.claimId === escalation.claimId)?.key ?? '',
  }))
}
