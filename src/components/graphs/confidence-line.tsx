'use client'

import { CartesianGrid, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { GraphFrame, type GraphDataTable } from './graph-frame'
import { t } from '@/lib/i18n/messages/graph'

// `ConfidenceLine` (09 §3; FR-132, FR-083, D-074): confidence at the frame, at the Decision Lock
// and after the Turn, against the authored accuracy of the claims relied on at each point.
//
// **The payload's shape is restated rather than imported.** `src/components/*` may import a module
// `schema.ts` and nothing deeper (04 §2), and the graph payloads are built by
// `src/server/modules/scoring/graphs/*`, which is module-internal. So the props say structurally
// what this component draws — the rule D-348 set for `FrameBesideDecision` — and the compiler
// checks the two agree wherever a builder's output is handed to it.
//
// **Two series, told apart three ways.** Colour alone never carries a distinction (16 §8.7):
// confidence is a solid line with round markers, accuracy a dashed line with square ones, both are
// named in the legend below the plot, and every value is in the data table `GraphFrame` opens.
//
// **Nothing animates** (`isAnimationActive={false}`, 16 §9.2). A graph is an instrument reading,
// not an entrance; and a line that grows on load is a line a reader has to wait for.

/** One of the three confidence points, as `scoring/graphs/confidence-line.ts` builds it. */
export type ConfidenceLinePoint = {
  at: 'frame' | 'lock' | 'turn'
  confidence: number | null
  /** 0 to 1, or null when nothing was relied on yet. */
  accuracy: number | null
  relied_on_claim_ids: readonly string[]
  accurate_claim_ids: readonly string[]
}

export type ConfidenceLinePayload = {
  available: boolean
  missing_event_types: readonly string[]
  points: readonly ConfidenceLinePoint[]
  data_table: GraphDataTable
  description: string
}

export type ConfidenceLineProps = {
  payload: ConfidenceLinePayload
  height?: number
  headingLevel?: 2 | 3 | 4
}

const POINT_LABELS: Record<ConfidenceLinePoint['at'], string> = {
  frame: t('graph.confidenceLine.pointFrame'),
  lock: t('graph.confidenceLine.pointLock'),
  turn: t('graph.confidenceLine.pointTurn'),
}

const AXIS = { stroke: 'var(--line-strong)', fill: 'var(--ink-muted)', fontSize: 12 }

export function ConfidenceLine({ payload, height = 320, headingLevel = 3 }: ConfidenceLineProps) {
  const data = payload.points.map((point) => ({
    point: POINT_LABELS[point.at],
    confidence: point.confidence,
    accuracy: point.accuracy === null ? null : Math.round(point.accuracy * 100),
  }))

  return (
    <GraphFrame
      graphKey="confidence_line"
      title={t('graph.confidenceLine.title')}
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
              <LineChart {...chart} data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" vertical={false} />
                <XAxis
                  dataKey="point"
                  tick={{ fill: AXIS.fill, fontSize: AXIS.fontSize }}
                  stroke={AXIS.stroke}
                />
                <YAxis
                  domain={[0, 100]}
                  ticks={[0, 25, 50, 75, 100]}
                  width={36}
                  tick={{ fill: AXIS.fill, fontSize: AXIS.fontSize }}
                  stroke={AXIS.stroke}
                />
                <Line
                  type="linear"
                  dataKey="confidence"
                  name={t('graph.confidenceLine.seriesConfidence')}
                  stroke="var(--primary)"
                  strokeWidth={2}
                  dot={{ r: 4, fill: 'var(--primary)', stroke: 'var(--primary)' }}
                  activeDot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                <Line
                  type="linear"
                  dataKey="accuracy"
                  name={t('graph.confidenceLine.seriesAccuracy')}
                  stroke="var(--amber)"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  dot={{ r: 4, fill: 'var(--amber)', stroke: 'var(--amber)', strokeWidth: 1 }}
                  activeDot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <ul className="text-ink-muted text-meta flex flex-wrap gap-x-5 gap-y-1">
            <li className="flex items-center gap-2">
              <span aria-hidden="true" className="bg-primary inline-block size-2.5 rounded-full" />
              {t('graph.confidenceLine.seriesConfidence')}
            </li>
            <li className="flex items-center gap-2">
              <span aria-hidden="true" className="bg-amber inline-block size-2.5 rounded-xs" />
              {t('graph.confidenceLine.seriesAccuracy')}
            </li>
          </ul>
        </div>
      )}
    </GraphFrame>
  )
}
