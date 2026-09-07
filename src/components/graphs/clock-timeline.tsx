'use client'

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { GraphFrame, type GraphDataTable } from './graph-frame'
import { t } from '@/lib/i18n/messages/graph'

// `ClockTimeline` (09 §3; FR-133, FR-063, D-074): the working clock and the Turn window drawn as
// two strips, segmented by activity.
//
// **A stacked bar is a timeline when the segments partition the axis.** The builder guarantees
// exactly that — every millisecond of the working period belongs to one segment, `unattributed`
// included — so one `Bar` per segment on a shared `stackId` reproduces the strip with no gaps and
// no overlaps, and no bespoke SVG. The two tracks keep their own time bases and each starts at
// zero, which is why they are two rows of one chart rather than one continuous line.
//
// **The marks are in the payload, the table and the description, and not on the strip.** FR-133
// asks that each claim-touching event and each clock-stop credit be marked, and they are: the
// payload carries them, the data table gives every one a row with its clock and its instant, and
// the description counts them. Drawing them as rules across the plot would put thirty vertical
// lines over two tracks whose time bases differ, so a mark from the Turn window would appear to
// stand at a moment in the working period — a worse graph, not a more complete one (D-387).
//
// **Every segment carries a hairline.** Three of the eight fills are pale by design (the brief,
// unattributed time, a pause), and a pale block on pale paper is a block a reader cannot find; the
// outline is what keeps each one visible against its neighbours and against the page.

export type TimelineSegmentPayload = {
  type:
    | 'reading'
    | 'delegation'
    | 'action'
    | 'escalation'
    | 'brief'
    | 'unattributed'
    | 'turn_response'
    | 'paused'
  start_ms: number
  end_ms: number
  ref_id: string | null
  document_id?: string
  claim_ids: readonly string[]
}

export type TimelineTrackPayload = {
  total_ms: number
  segments: readonly TimelineSegmentPayload[]
  marks: ReadonlyArray<{ at_ms: number; kind: string; ref_id: string | null }>
}

export type ClockTimelinePayload = TimelineTrackPayload & {
  available: boolean
  missing_event_types: readonly string[]
  window: TimelineTrackPayload | null
  data_table: GraphDataTable
  description: string
}

export type ClockTimelineProps = {
  payload: ClockTimelinePayload
  height?: number
  headingLevel?: 2 | 3 | 4
}

const SEGMENT_LABELS: Record<TimelineSegmentPayload['type'], string> = {
  reading: t('graph.clockTimeline.segmentReading'),
  delegation: t('graph.clockTimeline.segmentDelegation'),
  action: t('graph.clockTimeline.segmentAction'),
  escalation: t('graph.clockTimeline.segmentEscalation'),
  brief: t('graph.clockTimeline.segmentBrief'),
  unattributed: t('graph.clockTimeline.segmentUnattributed'),
  turn_response: t('graph.clockTimeline.segmentTurnResponse'),
  paused: t('graph.clockTimeline.segmentPaused'),
}

/** One token per activity; every one is a DESIGN.md colour, and none of them is a gradient. */
const SEGMENT_FILLS: Record<TimelineSegmentPayload['type'], string> = {
  reading: 'var(--primary)',
  delegation: 'var(--stance-escalate)',
  action: 'var(--green)',
  escalation: 'var(--amber)',
  brief: 'var(--primary-soft)',
  unattributed: 'var(--paper-sunken)',
  turn_response: 'var(--ink)',
  paused: 'var(--line-strong)',
}

const AXIS_TICK = { fill: 'var(--ink-muted)', fontSize: 12 }

/** `mm:ss` for an axis tick. The table's own spans are formatted by the builder. */
const mmss = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export function ClockTimeline({ payload, height = 260, headingLevel = 3 }: ClockTimelineProps) {
  const working = payload.segments
  const windowSegments = payload.window?.segments ?? []

  // One row per clock; each segment becomes its own stacked key, so the strip is the partition the
  // builder computed and nothing has to be re-derived here.
  const workingRow: Record<string, number | string> = {
    name: t('graph.clockTimeline.clockWorking'),
  }
  working.forEach((segment, index) => {
    workingRow[`w${String(index)}`] = segment.end_ms - segment.start_ms
  })
  const windowRow: Record<string, number | string> = { name: t('graph.clockTimeline.clockWindow') }
  windowSegments.forEach((segment, index) => {
    windowRow[`t${String(index)}`] = segment.end_ms - segment.start_ms
  })
  const data = payload.window === null ? [workingRow] : [workingRow, windowRow]

  const used = [...new Set([...working, ...windowSegments].map((segment) => segment.type))]

  return (
    <GraphFrame
      graphKey="clock_timeline"
      title={t('graph.clockTimeline.title')}
      description={payload.description}
      dataTable={payload.data_table}
      available={payload.available}
      missingEventTypes={payload.missing_event_types}
      height={height}
      headingLevel={headingLevel}
    >
      {(chart) => (
        <div className="flex h-full min-h-0 flex-col gap-2">
          <div className="min-h-0 flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                {...chart}
                layout="vertical"
                data={data}
                margin={{ top: 8, right: 16, bottom: 4, left: 0 }}
                barCategoryGap="30%"
              >
                <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" horizontal={false} />
                <XAxis
                  type="number"
                  tickFormatter={mmss}
                  tick={{ ...AXIS_TICK }}
                  stroke="var(--line-strong)"
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={104}
                  tick={{ ...AXIS_TICK }}
                  stroke="var(--line-strong)"
                />
                {working.map((segment, index) => (
                  <Bar
                    key={`w${String(index)}`}
                    dataKey={`w${String(index)}`}
                    stackId="clock"
                    fill={SEGMENT_FILLS[segment.type]}
                    stroke="var(--line-strong)"
                    strokeWidth={1}
                    isAnimationActive={false}
                  />
                ))}
                {windowSegments.map((segment, index) => (
                  <Bar
                    key={`t${String(index)}`}
                    dataKey={`t${String(index)}`}
                    stackId="clock"
                    fill={SEGMENT_FILLS[segment.type]}
                    stroke="var(--line-strong)"
                    strokeWidth={1}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ul className="text-ink-muted text-meta flex flex-wrap gap-x-5 gap-y-1">
            {used.map((type) => (
              <li key={type} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="border-line-strong inline-block size-2.5 rounded-xs border"
                  style={{ background: SEGMENT_FILLS[type] }}
                />
                {SEGMENT_LABELS[type]}
              </li>
            ))}
          </ul>
        </div>
      )}
    </GraphFrame>
  )
}
