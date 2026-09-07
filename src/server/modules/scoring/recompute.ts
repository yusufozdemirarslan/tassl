// The neutralization recompute (10-backend-spec-modules.md §11.5; PRD §7 standing rules, §7.19;
// FR-003, FR-005, FR-087, FR-232).
//
// A neutralization is Tassl admitting its own error: a claim the authority marked sound turned out
// to be defective by accident, a verification path returned the wrong result, a stance record was
// lost, a Turn was miscalibrated. The standing rule that governs every one of them is one sentence
// and it only points one way — "a correction for Tassl's own error can raise a band or neutralize a
// dimension and never lowers a band or the points computed from it". So this file recomputes, and
// then **floors**: each affected dimension keeps the higher of its pre- and post-correction band,
// the run keeps the higher of its pre- and post-correction points, and all six values are recorded
// so the arithmetic can be read back (FR-005).
//
// **What is recomputed, and what is not.** A neutralization removes one claim from the stance
// matrix, which moves the False Challenge Rate, the defect counts and the two dimensions computed
// from them — Verification and Calibration. It does not move Framing, Delegation, Decision Quality,
// Adaptation or Ownership, whose reads never depended on that claim (10 §11.5). Re-running those
// reads would burn five model calls to produce the same five answers, and would let a
// non-deterministic reader move a band a correction was not supposed to touch.
//
// **This file is the pure half.** Everything §11.5 lists that touches the world — inserting the
// neutralization row, writing the `claim_neutralized` event with the block computed here, setting
// `adjusted_at`, and re-exporting a confirmed or recorded run — belongs to the service and to the
// `review` module's entry point, which arrive with Step 10.4 and Phase 11. What is here is the
// arithmetic: given a run's input, the correction, and the bands the run currently stands on, what
// the run stands on afterwards. It is pure so that the answer is reproducible and testable without
// a database, which is what a correction to a *graded* artifact has to be.
import type { StoredEventPayload } from '@/server/modules/trace/schema'
import { draftBands, type BandReads, type DraftBand } from './bands'
import { categoricalFacts, type CategoricalFacts } from './facts'
import { buildGraphs, type GraphEvent, type GraphInput, type RunGraphs } from './graphs'
import { computePoints, higherPoints, type BandMapping, type PointsInput } from './points'
import { higherBand, type Band, type Dimension } from './rubric'

/** `claim_neutralizations.reason` (06 §3.5), restated the way every module schema restates an enum. */
export type NeutralizationReason =
  | 'unintended_defect'
  | 'wrong_verification_result'
  | 'misbehaving_material'
  | 'adaptation_failed'
  | 'record_lost'
  | 'other'

export type Neutralization = {
  neutralizationId: string
  claimId: string
  reason: NeutralizationReason
  /**
   * FR-003, A.3's fixed modifier: the student challenged the claim and was right, so the row is
   * counted as a match whatever stance it carries. The row itself stays visible in the debrief.
   */
  creditChallenge: boolean
  note?: string
}

/**
 * The dimensions a neutralization can move (10 §11.5): the two PRD §7.13 computes throughout.
 *
 * They are also the two FR-087 reports unassessed together, which is not a coincidence — both are
 * read off the stance matrix, and a neutralization is a change to the stance matrix.
 */
export const RECOMPUTED_DIMENSIONS = ['verification', 'calibration'] as const
export type RecomputedDimension = (typeof RECOMPUTED_DIMENSIONS)[number]

/** The `recompute` block of the `claim_neutralized` event (10 §10), as the service writes it. */
export type RecomputeBlock = StoredEventPayload<'claim_neutralized'>['recompute']

/**
 * The two point totals the same event carries beside that block (D-420).
 *
 * They are a separate piece because they are classified separately: `points` may not appear in the
 * record export form at any depth (12 §8.1, FR-170), and `trace/owner-view.ts` classifies the top
 * level of a payload — so inside `recompute` they were the student's copy's problem, and outside it
 * they are `reviewer_only`.
 */
export type RecomputePoints = Pick<
  StoredEventPayload<'claim_neutralized'>,
  'points_before' | 'points_after'
>

export type RecomputeResult = {
  /** The dimensions the recompute touched, in rubric order. */
  dimensions: Dimension[]
  bandsBefore: Partial<Record<Dimension, Band | null>>
  bandsAfter: Partial<Record<Dimension, Band | null>>
  /** FR-005: the higher of the two, per dimension. Never below `bandsBefore`. */
  bandsEffective: Partial<Record<Dimension, Band | null>>
  pointsBefore: number | null
  pointsAfter: number | null
  /** FR-005: `max(before, after)`. Never below `pointsBefore`. */
  pointsEffective: number | null
  /** The full band set as it stands after the correction, for the caller to persist. */
  bands: Record<Dimension, DraftBand>
  facts: CategoricalFacts
  graphs: RunGraphs
  /** Ready for the `claim_neutralized` payload the service appends in the same transaction. */
  block: RecomputeBlock
  /** The same event's two point fields, which the record export withholds (D-420). */
  points: RecomputePoints
}

export type RecomputeArgs = {
  /** The run's trace, package version and variant states, exactly as the scoring job read them. */
  input: GraphInput
  neutralization: Neutralization
  /** When the correction was made; the synthetic event is stamped with it. */
  occurredAt: string
  /**
   * What each dimension currently stands at: the decided band where a reviewer decided one, the
   * draft where they have not, `null` where the dimension is unassessed. This is the run's own
   * record and not something to recompute — an instructor's override is final (FR-182), and a
   * correction that recomputed it would undo a decision it has no business touching.
   */
  effectiveBands: Partial<Readonly<Record<Dimension, Band | null>>>
  mapping: BandMapping
  /** The reads the run was scored with, carried through unchanged: they are not re-run (§11.5). */
  reads?: BandReads
  defenseMissed?: boolean
}

/**
 * The run as it stands after one claim is neutralized.
 *
 * The correction is applied by appending a `claim_neutralized` event to the trace rather than by
 * filtering the claim out of the package version, because that is what the database will hold and
 * because the stance matrix already knows what to do with one: the row stays visible and struck
 * through in the debrief — the student did something on that claim and deserves to see what — and
 * leaves the summary, the False Challenge Rate and the defect counts (D-107, `stance-matrix.ts`).
 * Recomputing from a trimmed package would produce a run that never existed.
 */
export function recomputeAfterNeutralization(args: RecomputeArgs): RecomputeResult {
  const input = withNeutralization(args.input, args.neutralization, args.occurredAt)
  const graphs = buildGraphs(input)
  const facts = categoricalFacts(input, graphs)
  const bands = draftBands({
    facts,
    graphs,
    ...(args.reads === undefined ? {} : { reads: args.reads }),
    ...(args.defenseMissed === undefined ? {} : { defenseMissed: args.defenseMissed }),
  })

  const bandsBefore: Partial<Record<Dimension, Band | null>> = {}
  const bandsAfter: Partial<Record<Dimension, Band | null>> = {}
  const bandsEffective: Partial<Record<Dimension, Band | null>> = {}
  for (const dimension of RECOMPUTED_DIMENSIONS) {
    const before = args.effectiveBands[dimension] ?? null
    const after = bands[dimension].band
    bandsBefore[dimension] = before
    bandsAfter[dimension] = after
    bandsEffective[dimension] = higherBand(before, after)
  }

  // The points are computed over the whole run both times — the five dimensions the recompute did
  // not touch stay exactly as they were — so the two numbers differ only by what the correction
  // moved, which is what makes `max` of them meaningful (§11.4).
  const asPoints = (
    overrides: Partial<Record<Dimension, Band | null>>,
  ): Partial<Record<Dimension, PointsInput>> => ({ ...args.effectiveBands, ...overrides })
  const pointsBefore = computePoints(asPoints({}), args.mapping)
  const pointsAfter = computePoints(asPoints(bandsAfter), args.mapping)
  const pointsEffective = higherPoints(pointsBefore, pointsAfter)

  return {
    dimensions: [...RECOMPUTED_DIMENSIONS],
    bandsBefore,
    bandsAfter,
    bandsEffective,
    pointsBefore,
    pointsAfter,
    pointsEffective,
    bands,
    facts,
    graphs,
    block: {
      dimensions: [...RECOMPUTED_DIMENSIONS],
      bands_before: bandsBefore,
      bands_after: bandsAfter,
    },
    points: { points_before: pointsBefore, points_after: pointsAfter },
  }
}

/**
 * The same trace with the correction appended.
 *
 * The event takes the next sequence number, because the trace is append-only with a gapless per-run
 * sequence (NFR-005) and a correction happened after everything it corrects. Its `recompute` block
 * is empty here and filled by the service from the result — the block records what the correction
 * moved, so it cannot be known before the recompute it describes has run.
 */
export function withNeutralization(
  input: GraphInput,
  neutralization: Neutralization,
  occurredAt: string,
): GraphInput {
  const seq = input.events.reduce((max, event) => Math.max(max, event.seq), 0) + 1
  const event: GraphEvent = {
    seq,
    type: 'claim_neutralized',
    occurredAt,
    clockRemainingMs: null,
    payload: {
      neutralization_id: neutralization.neutralizationId,
      claim_id: neutralization.claimId,
      reason: neutralization.reason,
      credit_challenge: neutralization.creditChallenge,
      note: neutralization.note ?? '',
      recompute: { dimensions: [], bands_before: {}, bands_after: {} },
      points_before: null,
      points_after: null,
    },
  }
  return { ...input, events: [...input.events, event] }
}
