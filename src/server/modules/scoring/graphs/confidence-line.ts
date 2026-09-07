// Graph 1 of 4 — the confidence line (FR-132, FR-083; 10-backend-spec-modules.md §11.1; D-078).
//
// "Confidence at the frame, at lock, and after the Turn, plotted against the authored accuracy of
// the claims the student relied on at each point" (PRD §7.13). Two series over three points, and
// the whole of the reading is in the gap between them: a rising line with a falling accuracy is
// `rising_unchecked` (10 §11.2), which is what caps Calibration.
//
// Three decisions are worth stating because each could have gone the other way.
//
// **Relied on is read from `claim_used`, not from `run_claims`.** FR-084 and D-077 give a claim
// three ways to become relied on — a log mark, a named field in the brief, and the Turn window —
// and every one of them writes a `claim_used` event in the same transaction as the row it sets.
// Reading the row instead would make this graph disagree with the export beside it the moment a
// read model drifts, and would break the one promise the graph set makes (PRD §7.13: plotted "from
// the run trace and nothing else"). The lock's own list is unioned in at the lock point, because
// `decision_locked.relied_on_claim_ids` is the gate's record of what the brief leant on and is
// written in the same transaction as the marks it counts — taking both makes the point independent
// of the order two writes in one transaction happened to take.
//
// **Accurate is "sound *or* verified", and verified means an action ran on it (D-078).** The PRD
// says "sound or verified under the authored conditions", and D-078 reads that literally: a claim
// counts as accurate at a point if its variant evidence status is `sound`, or the student ran an
// interrogation action on it before that point. A defective claim the student traced is a claim
// they know the truth about, and relying on it is not the same act as relying on one they never
// looked at. Strictly *before*: an action and the confidence it justified are two events, and the
// action has to have happened first for the confidence to have been informed by it.
//
// **The frame's accuracy is null, and that is a value.** Nothing is relied on before the assistant
// unlocks, so the denominator is zero and the point carries `accuracy: null` rather than 0 or 1
// (10 §11.1). `GraphFrame` renders a null cell as "not available", so the table says so out loud.
import { t } from '@/lib/i18n/t'
import type { RunEventTypeValue } from '@/server/modules/trace/schema'
import {
  eventsOfType,
  firstOfType,
  missingEventTypes,
  percent,
  rate3,
  type GraphBase,
  type GraphInput,
} from './types'

/** The three instants FR-083 captures confidence at. */
export type ConfidencePointAt = 'frame' | 'lock' | 'turn'

export type ConfidencePoint = {
  at: ConfidencePointAt
  /** 0 to 100, or null when the run filed none (an auto-locked brief may carry no confidence). */
  confidence: number | null
  /** 0 to 1 with three decimals, or null when nothing was relied on yet. */
  accuracy: number | null
  relied_on_claim_ids: string[]
  accurate_claim_ids: string[]
}

export type ConfidenceLineGraph = GraphBase & { points: ConfidencePoint[] }

/** Without both ends of the working period there is no line to draw (10 §11.1). */
const REQUIRED: readonly RunEventTypeValue[] = ['frame_locked', 'decision_locked']

const POINT_LABELS: Record<ConfidencePointAt, string> = {
  frame: t('graph.confidenceLine.pointFrame'),
  lock: t('graph.confidenceLine.pointLock'),
  turn: t('graph.confidenceLine.pointTurn'),
}

const COLUMNS = [
  t('graph.confidenceLine.columnPoint'),
  t('graph.confidenceLine.columnConfidence'),
  t('graph.confidenceLine.columnAccuracy'),
  t('graph.confidenceLine.columnReliedOn'),
  t('graph.confidenceLine.columnAccurate'),
]

export function buildConfidenceLine(input: GraphInput): ConfidenceLineGraph {
  const missing = missingEventTypes(input.events, REQUIRED)
  if (missing.length > 0) return unavailable(missing)

  const frame = firstOfType(input.events, 'frame_locked')
  const lock = firstOfType(input.events, 'decision_locked')
  // `missingEventTypes` already proved both are present; the guard is for the type, not the case.
  if (!frame || !lock) return unavailable(REQUIRED)
  const turn = firstOfType(input.events, 'turn_response_locked')

  // Every `claim_used` in the trace, with the sequence it was written at, so a point can take the
  // marks that stood at its own instant and no later ones (FR-084, D-077).
  const marks = eventsOfType(input.events, 'claim_used').map((event) => ({
    seq: event.seq,
    claimId: event.payload.claim_id,
  }))
  const reliedOnBy = (seq: number, also: readonly string[] = []): string[] => {
    const ids = new Set<string>(also)
    for (const mark of marks) if (mark.seq <= seq) ids.add(mark.claimId)
    return [...ids]
  }

  // Every action, with the sequence it ran at: "verified before this point" is a question about
  // order, so the sequence is what answers it (D-078).
  const actions = eventsOfType(input.events, 'action').map((event) => ({
    seq: event.seq,
    claimId: event.payload.claim_id,
  }))
  const soundClaimIds = new Set(
    input.variantStates.filter((s) => s.evidenceStatus === 'sound').map((s) => s.claimId),
  )
  const accurateAt = (claimId: string, seq: number): boolean =>
    soundClaimIds.has(claimId) ||
    actions.some((action) => action.claimId === claimId && action.seq < seq)

  const at = (
    key: ConfidencePointAt,
    seq: number,
    confidence: number | null,
    also: readonly string[] = [],
  ): ConfidencePoint => {
    const reliedOn = reliedOnBy(seq, also)
    const accurate = reliedOn.filter((claimId) => accurateAt(claimId, seq))
    return {
      at: key,
      confidence,
      accuracy: rate3(accurate.length, reliedOn.length),
      relied_on_claim_ids: reliedOn,
      accurate_claim_ids: accurate,
    }
  }

  const points: ConfidencePoint[] = [
    at('frame', frame.seq, frame.payload.confidence),
    at('lock', lock.seq, lock.payload.confidence, lock.payload.relied_on_claim_ids),
  ]
  if (turn) {
    points.push(at('turn', turn.seq, turn.payload.confidence, lock.payload.relied_on_claim_ids))
  }

  return {
    available: true,
    missing_event_types: [],
    points,
    data_table: {
      caption: t('graph.confidenceLine.caption'),
      columns: COLUMNS,
      rows: points.map((point) => [
        POINT_LABELS[point.at],
        point.confidence,
        point.accuracy === null ? null : percent(point.accuracy),
        point.relied_on_claim_ids.length,
        point.accurate_claim_ids.length,
      ]),
    },
    description: describe(points),
  }
}

function describe(points: readonly ConfidencePoint[]): string {
  const sentences = points.map((point) =>
    t('graph.confidenceLine.point', {
      point: POINT_LABELS[point.at],
      confidence:
        point.confidence === null
          ? t('graph.confidenceLine.confidenceMissing')
          : t('graph.confidenceLine.confidenceValue', { value: point.confidence }),
      accuracy:
        point.accuracy === null
          ? t('graph.confidenceLine.accuracyNone')
          : t('graph.confidenceLine.accuracyValue', {
              percent: percent(point.accuracy),
              accurate: point.accurate_claim_ids.length,
              reliedOn: point.relied_on_claim_ids.length,
            }),
    }),
  )
  return t('graph.confidenceLine.description', { points: sentences.join(' ') })
}

function unavailable(missing: readonly RunEventTypeValue[]): ConfidenceLineGraph {
  return {
    available: false,
    missing_event_types: [...missing],
    points: [],
    data_table: {
      caption: t('graph.confidenceLine.caption'),
      columns: COLUMNS,
      rows: [],
    },
    description: t('graph.unavailableDescription', { types: missing.join(', ') }),
  }
}
