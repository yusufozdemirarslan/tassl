// Graph 2 of 4 — the clock timeline (FR-133, FR-063; 10-backend-spec-modules.md §11.1).
//
// "The working clock and the Turn window as a timeline segmented by activity: Evidence Room reading
// by document, delegations, each interrogation action, each escalation, time in the brief,
// unattributed time, and the Turn response, with each claim-touching event and each clock-stop
// credit marked" (PRD §7.13). Delegation and Verification are read off it, and Framing reads it
// beside the frame.
//
// **The axis is wall time over the working period, and the segments are a partition of it.** Every
// millisecond between the frame lock and the Decision Lock belongs to exactly one segment — that is
// what makes "unattributed time" a fact about the run rather than an arithmetic leftover, and it is
// what the debrief's "minute by minute" (PRD §7.14) means. `paused` is a segment type in 10 §11.1,
// and a pause has width only on a wall-clock axis (on a consumed-clock axis a credited pause is a
// point), which settles the choice.
//
// **Attribution is a priority paint, and that is how overlaps are split.** 10 §11.1 asks that
// "overlapping reading and brief segments are split"; painting spans onto the axis in priority
// order does exactly that, and generalises to every other pair. Highest priority first:
//
//   `paused`   — the clock is stopped and the room is behind an overlay (FR-001). Nothing else is
//                happening, whatever else is still open.
//   `reading`  — a document open. It beats the brief deliberately: a student who opens a document
//                while the brief editor is up has gone to check a figure, and the specific act is
//                the truer label. A brief span with a read inside it is drawn brief · reading ·
//                brief, which is the split 10 §11.1 asks for.
//   `brief`    — the brief editor, open to closed.
//
// What is left over is attributed backwards to the act it ended in: the interval running up to a
// delegation is the time spent composing it and reading what came back, and the same for an
// interrogation action, an escalation and the Turn response. FR-063 asks that "each delegation
// appears as a segment", and a delegation is one event in the trace — there is no start to pair it
// with — so the segment has to be the time it closed. Everything still unclaimed is `unattributed`.
//
// **The window is the same construction over its own span**, and its origin is the `lifecycle`
// event, not `turn_delivered`. D-334: a Turn fires at `turn_due_at` and `turn_delivered` carries
// that instant, while everything the window is *made of* is stamped at the read. A run whose
// student was away for an hour would otherwise be drawn as an hour-long window.
import { t } from '@/lib/i18n/t'
import type { RunEventTypeValue } from '@/server/modules/trace/schema'
import {
  eventsOfType,
  firstOfType,
  missingEventTypes,
  msBetween,
  type GraphBase,
  type GraphDataTable,
  type GraphDocument,
  type GraphEvent,
  type GraphInput,
  type GraphPackageVersion,
} from './types'

export type TimelineSegmentType =
  | 'reading'
  | 'delegation'
  | 'action'
  | 'escalation'
  | 'brief'
  | 'unattributed'
  | 'turn_response'
  | 'paused'

export type TimelineSegment = {
  type: TimelineSegmentType
  start_ms: number
  end_ms: number
  /** The delegation, action, escalation, open or pause the segment is attributed to; null for gaps. */
  ref_id: string | null
  document_id?: string
  claim_ids: string[]
}

export type TimelineMarkKind = 'claim_touch' | 'clock_credit' | 'lock' | 'turn_delivered'
export type TimelineMark = { at_ms: number; kind: TimelineMarkKind; ref_id: string | null }

/** One clock drawn end to end: the working period, or the Turn window. */
export type TimelineTrack = {
  total_ms: number
  segments: TimelineSegment[]
  marks: TimelineMark[]
}

export type ClockTimelineGraph = GraphBase &
  TimelineTrack & {
    /** The Turn window, drawn the same way; null on a run that never received a Turn. */
    window: TimelineTrack | null
  }

/** Both ends of the working period. Without them there is no axis (10 §11.1). */
const REQUIRED: readonly RunEventTypeValue[] = ['frame_locked', 'decision_locked']

const SEGMENT_LABELS: Record<TimelineSegmentType, string> = {
  reading: t('graph.clockTimeline.segmentReading'),
  delegation: t('graph.clockTimeline.segmentDelegation'),
  action: t('graph.clockTimeline.segmentAction'),
  escalation: t('graph.clockTimeline.segmentEscalation'),
  brief: t('graph.clockTimeline.segmentBrief'),
  unattributed: t('graph.clockTimeline.segmentUnattributed'),
  turn_response: t('graph.clockTimeline.segmentTurnResponse'),
  paused: t('graph.clockTimeline.segmentPaused'),
}

const MARK_LABELS: Record<TimelineMarkKind, string> = {
  claim_touch: t('graph.clockTimeline.markClaimTouch'),
  clock_credit: t('graph.clockTimeline.markClockCredit'),
  lock: t('graph.clockTimeline.markLock'),
  turn_delivered: t('graph.clockTimeline.markTurnDelivered'),
}

const COLUMNS = [
  t('graph.clockTimeline.columnClock'),
  t('graph.clockTimeline.columnActivity'),
  t('graph.clockTimeline.columnStart'),
  t('graph.clockTimeline.columnEnd'),
  t('graph.clockTimeline.columnLength'),
  t('graph.clockTimeline.columnDetail'),
]

/** `mm:ss` from a span, floored — an elapsed length, not a countdown (contrast `formatClock`). */
export function formatSpan(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------------------------

export function buildClockTimeline(input: GraphInput): ClockTimelineGraph {
  const missing = missingEventTypes(input.events, REQUIRED)
  if (missing.length > 0) return unavailable(missing)

  const frame = firstOfType(input.events, 'frame_locked')
  const lock = firstOfType(input.events, 'decision_locked')
  if (!frame || !lock) return unavailable(REQUIRED)

  const working = track(
    input.events.filter((event) => event.seq >= frame.seq && event.seq <= lock.seq),
    frame.occurredAt,
    lock.occurredAt,
    input.packageVersion,
  )
  const window = buildWindow(input)

  return {
    available: true,
    missing_event_types: [],
    ...working,
    window,
    data_table: table(working, window, input.packageVersion.documents),
    description: describe(working, window),
  }
}

/** The Turn window, or null when no Turn was delivered (10 §11.1: "same for the Turn window"). */
function buildWindow(input: GraphInput): TimelineTrack | null {
  const delivered = firstOfType(input.events, 'turn_delivered')
  if (!delivered) return null

  // D-334: `turn_delivered` carries the firing instant; the transition to `turn_open` is stamped at
  // the read, which is when the window actually opened in front of the student.
  const opened =
    eventsOfType(input.events, 'lifecycle').find(
      (event) => event.payload.to === 'turn_open' && event.seq >= delivered.seq,
    ) ?? delivered
  const response = firstOfType(input.events, 'turn_response_locked')
  const endsAt = response?.occurredAt ?? delivered.payload.window_ends_at
  const lastSeq = response?.seq ?? Number.MAX_SAFE_INTEGER

  const inWindow = input.events.filter(
    (event) => event.seq >= opened.seq && event.seq <= lastSeq && event.seq !== delivered.seq,
  )
  const built = track(inWindow, opened.occurredAt, endsAt, input.packageVersion)
  built.marks.unshift({ at_ms: 0, kind: 'turn_delivered', ref_id: delivered.payload.turn_id })
  return built
}

// ---------------------------------------------------------------------------------------------
// One track
// ---------------------------------------------------------------------------------------------

/** A span of the axis that one activity occupied, with the priority that settles an overlap. */
type Span = {
  type: TimelineSegmentType
  priority: number
  from: number
  to: number
  refId: string | null
  documentId?: string
  claimIds: string[]
}

/** An act with no duration of its own, which claims the interval that ran up to it. */
type Closer = {
  type: TimelineSegmentType
  priority: number
  at: number
  refId: string
  claimIds: string[]
}

function track(
  events: readonly GraphEvent[],
  originIso: string,
  terminusIso: string,
  packageVersion: GraphPackageVersion,
): TimelineTrack {
  const total = msBetween(originIso, terminusIso)
  const at = (iso: string): number => Math.min(total, msBetween(originIso, iso))

  const spans: Span[] = []
  const closers: Closer[] = []
  const marks: TimelineMark[] = []

  // Pauses: `pause` opens, the `resume` carrying the same `pause_id` closes it (FR-001).
  const resumes = eventsOfType(events, 'resume')
  for (const pause of eventsOfType(events, 'pause')) {
    const resume = resumes.find((event) => event.payload.pause_id === pause.payload.pause_id)
    spans.push({
      type: 'paused',
      priority: 1,
      from: at(pause.occurredAt),
      to: resume ? at(resume.occurredAt) : total,
      refId: pause.payload.pause_id,
      claimIds: [],
    })
  }
  for (const resume of resumes) {
    if (resume.payload.clock_credited_ms > 0) {
      marks.push({
        at_ms: at(resume.occurredAt),
        kind: 'clock_credit',
        ref_id: resume.payload.pause_id,
      })
    }
  }

  // Reading: one span per document open, closed by the `document_close` carrying the same open id.
  const closesByOpen = new Map(
    eventsOfType(events, 'document_close').map((event) => [event.payload.open_id, event] as const),
  )
  const claimsByDocument = new Map<string, string[]>()
  for (const claim of packageVersion.claims) {
    if (claim.sourceDocumentId === null) continue
    const list = claimsByDocument.get(claim.sourceDocumentId) ?? []
    list.push(claim.id)
    claimsByDocument.set(claim.sourceDocumentId, list)
  }
  for (const open of eventsOfType(events, 'document_open')) {
    const close = closesByOpen.get(open.payload.open_id)
    spans.push({
      type: 'reading',
      priority: 2,
      from: at(open.occurredAt),
      to: close ? at(close.occurredAt) : total,
      refId: open.payload.open_id,
      documentId: open.payload.document_id,
      claimIds: claimsByDocument.get(open.payload.document_id) ?? [],
    })
  }

  // The brief editor: `brief_opened` and `brief_closed` alternate, so they pair in order.
  const briefCloses = eventsOfType(events, 'brief_closed')
  eventsOfType(events, 'brief_opened').forEach((open, index) => {
    const close = briefCloses[index]
    spans.push({
      type: 'brief',
      priority: 3,
      from: at(open.occurredAt),
      to: close ? at(close.occurredAt) : total,
      refId: null,
      claimIds: [],
    })
  })

  // The acts with no duration of their own. Each takes the interval that ran up to it.
  for (const response of eventsOfType(events, 'turn_response_locked')) {
    closers.push({
      type: 'turn_response',
      priority: 4,
      at: at(response.occurredAt),
      refId: 'turn_response',
      claimIds: [],
    })
  }
  for (const delegation of eventsOfType(events, 'delegation')) {
    closers.push({
      type: 'delegation',
      priority: 5,
      at: at(delegation.occurredAt),
      refId: delegation.payload.delegation_id,
      claimIds: delegation.payload.claim_ids,
    })
  }
  for (const action of eventsOfType(events, 'action')) {
    closers.push({
      type: 'action',
      priority: 6,
      at: at(action.occurredAt),
      refId: action.payload.action_id,
      claimIds: [action.payload.claim_id],
    })
    marks.push({
      at_ms: at(action.occurredAt),
      kind: 'claim_touch',
      ref_id: action.payload.claim_id,
    })
  }
  for (const escalation of eventsOfType(events, 'escalation')) {
    closers.push({
      type: 'escalation',
      priority: 7,
      at: at(escalation.occurredAt),
      refId: escalation.payload.escalation_id,
      claimIds: [escalation.payload.claim_id],
    })
    marks.push({
      at_ms: at(escalation.occurredAt),
      kind: 'claim_touch',
      ref_id: escalation.payload.claim_id,
    })
  }

  // The remaining claim-touching events (FR-133): a stance, a reliance mark, a fired probe.
  for (const stance of eventsOfType(events, 'stance_set')) {
    marks.push({
      at_ms: at(stance.occurredAt),
      kind: 'claim_touch',
      ref_id: stance.payload.claim_id,
    })
  }
  for (const used of eventsOfType(events, 'claim_used')) {
    marks.push({ at_ms: at(used.occurredAt), kind: 'claim_touch', ref_id: used.payload.claim_id })
  }
  for (const probe of eventsOfType(events, 'probe_fired')) {
    marks.push({ at_ms: at(probe.occurredAt), kind: 'claim_touch', ref_id: probe.payload.claim_id })
  }
  for (const locked of eventsOfType(events, 'decision_locked')) {
    marks.push({ at_ms: at(locked.occurredAt), kind: 'lock', ref_id: null })
  }

  marks.sort((a, b) => a.at_ms - b.at_ms)
  return { total_ms: total, segments: paint(total, spans, closers), marks }
}

/**
 * Paints the axis: for every interval between two consecutive boundaries, the covering span of
 * lowest priority wins; failing that the act the interval ends in; failing that, `unattributed`.
 * Adjacent intervals with the same attribution are merged, and zero-length ones are dropped.
 */
function paint(
  total: number,
  spans: readonly Span[],
  closers: readonly Closer[],
): TimelineSegment[] {
  const bounds = new Set<number>([0, total])
  for (const span of spans) {
    bounds.add(clamp(span.from, total))
    bounds.add(clamp(span.to, total))
  }
  for (const closer of closers) bounds.add(clamp(closer.at, total))
  const ordered = [...bounds].sort((a, b) => a - b)

  const byPriority = [...spans].sort((a, b) => a.priority - b.priority)
  const closersByPriority = [...closers].sort((a, b) => a.priority - b.priority)

  const out: TimelineSegment[] = []
  for (let i = 0; i < ordered.length - 1; i += 1) {
    const from = ordered[i]!
    const to = ordered[i + 1]!
    if (to <= from) continue

    const covering = byPriority.find((span) => span.from <= from && span.to >= to)
    const closer = covering ? undefined : closersByPriority.find((c) => c.at === to)
    const next: TimelineSegment = covering
      ? {
          type: covering.type,
          start_ms: from,
          end_ms: to,
          ref_id: covering.refId,
          ...(covering.documentId === undefined ? {} : { document_id: covering.documentId }),
          claim_ids: covering.claimIds,
        }
      : closer
        ? {
            type: closer.type,
            start_ms: from,
            end_ms: to,
            ref_id: closer.refId,
            claim_ids: closer.claimIds,
          }
        : { type: 'unattributed', start_ms: from, end_ms: to, ref_id: null, claim_ids: [] }

    const previous = out[out.length - 1]
    if (
      previous &&
      previous.type === next.type &&
      previous.ref_id === next.ref_id &&
      previous.document_id === next.document_id
    ) {
      previous.end_ms = next.end_ms
    } else {
      out.push(next)
    }
  }
  return out
}

const clamp = (value: number, total: number): number => Math.min(total, Math.max(0, value))

// ---------------------------------------------------------------------------------------------
// The table and the description
// ---------------------------------------------------------------------------------------------

function table(
  working: TimelineTrack,
  window: TimelineTrack | null,
  documents: readonly GraphDocument[],
): GraphDataTable {
  const titles = new Map(documents.map((document) => [document.id, document.title] as const))
  const rows: Array<Array<string | number | null>> = []
  const push = (clock: string, part: TimelineTrack): void => {
    for (const segment of part.segments) {
      // A reading segment says which document it was spent in; every other segment that touched a
      // claim names the claims. A reader of the table should never have to hold an id in their head.
      const detail: string[] = []
      const title = segment.document_id === undefined ? undefined : titles.get(segment.document_id)
      if (title !== undefined) detail.push(t('graph.clockTimeline.detailDocument', { title }))
      if (segment.claim_ids.length > 0) {
        detail.push(t('graph.clockTimeline.detailClaims', { keys: segment.claim_ids.join(', ') }))
      }
      rows.push([
        clock,
        SEGMENT_LABELS[segment.type],
        formatSpan(segment.start_ms),
        formatSpan(segment.end_ms),
        formatSpan(segment.end_ms - segment.start_ms),
        detail.length > 0 ? detail.join('. ') : null,
      ])
    }
    for (const mark of part.marks) {
      rows.push([clock, MARK_LABELS[mark.kind], formatSpan(mark.at_ms), null, null, mark.ref_id])
    }
  }
  push(t('graph.clockTimeline.clockWorking'), working)
  if (window) push(t('graph.clockTimeline.clockWindow'), window)
  return { caption: t('graph.clockTimeline.caption'), columns: COLUMNS, rows }
}

/** Total time per activity, largest first — the shape of how the clock was spent. */
function breakdown(part: TimelineTrack): string {
  const totals = new Map<TimelineSegmentType, number>()
  for (const segment of part.segments) {
    totals.set(segment.type, (totals.get(segment.type) ?? 0) + (segment.end_ms - segment.start_ms))
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, ms]) =>
      t('graph.clockTimeline.breakdownEntry', {
        label: SEGMENT_LABELS[type],
        duration: formatSpan(ms),
      }),
    )
    .join(', ')
}

function describe(working: TimelineTrack, window: TimelineTrack | null): string {
  const count = (part: TimelineTrack, kind: TimelineMarkKind): number =>
    part.marks.filter((mark) => mark.kind === kind).length
  return t('graph.clockTimeline.description', {
    total: formatSpan(working.total_ms),
    breakdown: breakdown(working),
    marks: t('graph.clockTimeline.marks', {
      claimTouch: count(working, 'claim_touch') + (window ? count(window, 'claim_touch') : 0),
      clockCredit: count(working, 'clock_credit') + (window ? count(window, 'clock_credit') : 0),
    }),
    window: window
      ? t('graph.clockTimeline.windowSentence', {
          total: formatSpan(window.total_ms),
          breakdown: breakdown(window),
        })
      : t('graph.clockTimeline.windowNone'),
  })
}

function unavailable(missing: readonly RunEventTypeValue[]): ClockTimelineGraph {
  return {
    available: false,
    missing_event_types: [...missing],
    total_ms: 0,
    segments: [],
    marks: [],
    window: null,
    data_table: { caption: t('graph.clockTimeline.caption'), columns: COLUMNS, rows: [] },
    description: t('graph.unavailableDescription', { types: missing.join(', ') }),
  }
}
