'use client'

import { GraphFrame, type GraphDataTable } from './graph-frame'
import { t } from '@/lib/i18n/messages/graph'
import { t as stanceT } from '@/lib/i18n/messages/stance'

// `StanceMatrix` (09 §3; FR-134, FR-082, D-107): the five-by-five summary of stances taken against
// stances warranted, with the False Challenge Rate beneath it and every claim in the data table.
//
// **This one is not a recharts chart, and should not be.** The plot is a five-by-five grid whose
// cells carry their own counts as text (16 §9.2: "matrix cells carry text"), which recharts has no
// primitive for; drawn by hand it is thirty rects and thirty numbers, it costs no library, and
// every cell says what it is instead of being a shade a reader has to decode against a scale
// (D-388). It is still inside `GraphFrame` and still takes the frame's `role="img"` identity, so a
// screen-reader user meets the description — which enumerates every non-zero cell — exactly as they
// meet the line chart's.
//
// **The diagonal is the only thing the drawing says.** A cell on it is a stance that matched what
// the claim warranted; it is tinted, and nothing else is. There is no scale from good to bad, no
// composite and no total that could be read as one (FR-131) — the counts are the finding, and the
// instructor reads them.

export type StanceMatrixPayload = {
  available: boolean
  missing_event_types: readonly string[]
  /** `summary[taken][warranted]`, both in the order accept, verify, challenge, reject, escalate. */
  summary: readonly (readonly number[])[]
  false_challenge_rate: number | null
  false_challenge_count: number
  consequential_claim_count: number
  matched_share: number | null
  data_table: GraphDataTable
  description: string
}

export type StanceMatrixProps = {
  payload: StanceMatrixPayload
  height?: number
  headingLevel?: 2 | 3 | 4
}

const STANCE_LABELS = [
  stanceT('stance.accept'),
  stanceT('stance.verify'),
  stanceT('stance.challenge'),
  stanceT('stance.reject'),
  stanceT('stance.escalate'),
]

// The grid, in user units. The SVG scales to its box; these numbers only fix the proportions.
const LABEL_W = 92
const HEADER_H = 34
const CELL_W = 74
const CELL_H = 40
const PAD = 22
const WIDTH = LABEL_W + CELL_W * 5 + PAD
const HEIGHT = HEADER_H + CELL_H * 5 + PAD

export function StanceMatrix({ payload, height = 320, headingLevel = 3 }: StanceMatrixProps) {
  const percentOf = (share: number | null): number => (share === null ? 0 : Math.round(share * 100))

  return (
    <GraphFrame
      graphKey="stance_matrix"
      title={t('graph.stanceMatrix.title')}
      description={payload.description}
      dataTable={payload.data_table}
      available={payload.available}
      missingEventTypes={payload.missing_event_types}
      height={height}
      headingLevel={headingLevel}
    >
      {(chart) => (
        <div className="flex h-full min-h-0 flex-col gap-3">
          <div className="min-h-0 flex-1">
            <svg
              {...chart}
              viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
              preserveAspectRatio="xMinYMin meet"
              className="h-full w-full"
            >
              {/* Column heads: the stance the claim warranted. */}
              <text
                x={PAD}
                y={14}
                className="fill-ink-muted"
                fontSize={11}
                fontFamily="var(--font-sans)"
              >
                {t('graph.stanceMatrix.summaryRowHeader')}
              </text>
              {STANCE_LABELS.map((label, column) => (
                <text
                  key={`head-${label}`}
                  x={LABEL_W + column * CELL_W + CELL_W / 2}
                  y={HEADER_H - 10}
                  textAnchor="middle"
                  className="fill-ink-muted"
                  fontSize={11}
                  fontFamily="var(--font-sans)"
                >
                  {label}
                </text>
              ))}

              {STANCE_LABELS.map((takenLabel, row) => (
                <g key={`row-${takenLabel}`}>
                  <text
                    x={LABEL_W - 10}
                    y={HEADER_H + row * CELL_H + CELL_H / 2 + 4}
                    textAnchor="end"
                    className="fill-ink-muted"
                    fontSize={11}
                    fontFamily="var(--font-sans)"
                  >
                    {takenLabel}
                  </text>
                  {STANCE_LABELS.map((warrantedLabel, column) => {
                    const count = payload.summary[row]?.[column] ?? 0
                    const matched = row === column
                    return (
                      <g key={`cell-${takenLabel}-${warrantedLabel}`}>
                        <rect
                          x={LABEL_W + column * CELL_W}
                          y={HEADER_H + row * CELL_H}
                          width={CELL_W}
                          height={CELL_H}
                          fill={
                            matched && count > 0
                              ? 'var(--green-soft)'
                              : count > 0
                                ? 'var(--paper-sunken)'
                                : 'var(--paper-raised)'
                          }
                          stroke="var(--line)"
                          strokeWidth={1}
                        />
                        <text
                          x={LABEL_W + column * CELL_W + CELL_W / 2}
                          y={HEADER_H + row * CELL_H + CELL_H / 2 + 5}
                          textAnchor="middle"
                          className={count > 0 ? 'fill-ink' : 'fill-ink-faint'}
                          fontSize={14}
                          fontFamily="var(--font-mono)"
                        >
                          {count}
                        </text>
                      </g>
                    )
                  })}
                </g>
              ))}

              <text
                x={LABEL_W}
                y={HEIGHT - 6}
                className="fill-ink-muted"
                fontSize={11}
                fontFamily="var(--font-sans)"
              >
                {t('graph.stanceMatrix.summaryColumnHeader')}
              </text>
            </svg>
          </div>

          <dl className="text-body flex flex-wrap gap-x-8 gap-y-2">
            <div className="flex flex-col gap-0.5">
              <dt className="text-ink-muted text-meta font-medium">
                {t('graph.stanceMatrix.fcrLabel')}
              </dt>
              <dd className="text-ink text-mono font-mono tabular-nums">
                {payload.false_challenge_rate === null
                  ? t('graph.notAvailable')
                  : t('graph.stanceMatrix.fcrValue', {
                      percent: percentOf(payload.false_challenge_rate),
                      falseChallenges: payload.false_challenge_count,
                      denominator: payload.consequential_claim_count,
                    })}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-ink-muted text-meta font-medium">
                {t('graph.stanceMatrix.matchedLabel')}
              </dt>
              <dd className="text-ink text-mono font-mono tabular-nums">
                {payload.matched_share === null
                  ? t('graph.notAvailable')
                  : t('graph.stanceMatrix.percentValue', {
                      percent: percentOf(payload.matched_share),
                    })}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </GraphFrame>
  )
}
