'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { t } from '@/lib/i18n/messages/graph'

// `GraphFrame` (docs/tech/16-performance-a11y-budgets.md §9; FR-212, FR-136, FR-004, D-074).
//
// **A graph a screen-reader user cannot read is a failed graph.** That is the whole of this
// component. Every one of the four graphs is drawn inside it, and it owns the three things that
// make a plot readable without sight: the visible heading the SVG is named by, a description that
// is always in the DOM, and the underlying data table behind a toggle. The chart itself contributes
// pixels; everything a person can be told is here.
//
// **The chart receives its accessible identity from the frame, and the frame checks.** `children`
// is called with `{ role: 'img', 'aria-labelledby', 'aria-describedby', tabIndex }`, which a
// recharts chart spreads on its root — recharts 3 passes `role`, `tabIndex` and the `aria-*` keys
// straight through to the root `<svg>` (`container/RootSurface.js`), and without an explicit `role`
// it would stamp `role="application"` from its own accessibility layer. An effect re-applies the
// four attributes to the first descendant `<svg>` whenever the graph region's children change, so a
// chart that arrives late (a `next/dynamic` chunk, a `ResponsiveContainer` that has just measured
// itself) is named the moment it exists. §9.2 writes that check as a `useLayoutEffect`; it is a
// `useEffect` here because this component is server-rendered and React warns that a layout effect
// does nothing on the server — the check reads and writes attributes nothing paints (D-386).
//
// **`children` may be a node instead.** Three of the four graphs are plots; frame-beside-decision
// is two columns of the student's own prose (D-348) and has no SVG to name. Passing it as a plain
// node rather than a render function is also what lets a Server Component compose it — a function
// prop cannot cross that boundary — and the effect simply finds no `<svg>` and does nothing.

export type GraphKey =
  'confidence_line' | 'clock_timeline' | 'stance_matrix' | 'frame_beside_decision'

export type GraphDataTable = {
  caption: string
  columns: readonly string[]
  rows: ReadonlyArray<ReadonlyArray<string | number | null>>
}

/** The identity the frame hands the chart; spread on the recharts root, or on a hand-drawn `svg`. */
export type ChartA11yProps = {
  role: 'img'
  'aria-labelledby': string
  'aria-describedby': string
  tabIndex: 0
}

export type GraphFrameProps = {
  graphKey: GraphKey
  /** The visible heading, from i18n. */
  title: string
  /** The payload's text description (FR-136). Always in the DOM, visually hidden. */
  description: string
  /** The payload's `data_table` (FR-136). */
  dataTable: GraphDataTable
  /** `false` renders the unavailable state and drops the toggle (FR-004, FR-136). */
  available: boolean
  /** Named in the unavailable state, so a reader can see which events the run never wrote. */
  missingEventTypes?: readonly string[]
  /**
   * Reserved height of the graph region in px, so a deferred chart causes no layout shift. It
   * applies to a chart only: a graph whose `children` is a node rather than a render function is
   * prose (frame beside decision), and prose that has to fit a box is prose that gets cut off.
   */
  height?: number
  defaultView?: 'graph' | 'table'
  /**
   * Element for the visible heading. The default is the rung below a `Panel` title, so the
   * document outline never skips a level (DESIGN.md §The Descending-Heading Rule).
   */
  headingLevel?: 2 | 3 | 4
  children: ReactNode | ((chart: ChartA11yProps) => ReactNode)
}

const HEADING_CLASS: Record<2 | 3 | 4, string> = {
  2: 'text-h3',
  3: 'text-h4',
  4: 'text-reading',
}

export function GraphFrame({
  graphKey,
  title,
  description,
  dataTable,
  available,
  missingEventTypes = [],
  height = 320,
  defaultView = 'graph',
  headingLevel = 3,
  children,
}: GraphFrameProps) {
  const id = useId()
  const titleId = `${id}-title`
  const descId = `${id}-desc`
  const tableId = `${id}-table`

  // An unavailable graph has no plot to show, so its table is the view (§9.2). The toggle is gone
  // with the plot, which is why this is seeded rather than switched.
  const [view, setView] = useState<'graph' | 'table'>(available ? defaultView : 'table')
  const region = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = region.current
    if (!node) return
    const name = (): void => {
      const svg = node.querySelector('svg')
      if (!svg) return
      svg.setAttribute('role', 'img')
      svg.setAttribute('aria-labelledby', titleId)
      svg.setAttribute('aria-describedby', descId)
      svg.setAttribute('tabindex', '0')
    }
    name()
    const observer = new MutationObserver(name)
    observer.observe(node, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
    }
  }, [titleId, descId, view, available])

  const Heading = `h${headingLevel}` as const
  const isChart = typeof children === 'function'
  const chart: ChartA11yProps = {
    role: 'img',
    'aria-labelledby': titleId,
    'aria-describedby': descId,
    tabIndex: 0,
  }

  return (
    <figure data-graph={graphKey} aria-labelledby={titleId} className="m-0 flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <Heading id={titleId} className={HEADING_CLASS[headingLevel]}>
          {title}
        </Heading>
        {available && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-pressed={view === 'table'}
            aria-controls={tableId}
            onClick={() => {
              setView(view === 'table' ? 'graph' : 'table')
            }}
          >
            {view === 'table' ? t('graph.showGraph') : t('graph.showTable')}
          </Button>
        )}
      </div>

      {available ? (
        <div
          ref={region}
          style={isChart ? { height } : undefined}
          hidden={view !== 'graph'}
          className="min-w-0"
        >
          {isChart ? children(chart) : children}
        </div>
      ) : (
        <p role="status" className="text-ink text-body max-w-measure">
          {t('graph.unavailable')}{' '}
          {missingEventTypes.length > 0 &&
            t('graph.unavailableMissing', { types: missingEventTypes.join(', ') })}
        </p>
      )}

      <div id={tableId} hidden={view !== 'table'} className="min-w-0">
        {dataTable.rows.length === 0 ? (
          <p className="text-ink-muted text-body">{t('graph.emptyTable')}</p>
        ) : (
          <Table>
            <TableCaption>{dataTable.caption}</TableCaption>
            <TableHeader>
              <TableRow>
                {dataTable.columns.map((column) => (
                  <TableHead key={column} scope="col">
                    {column}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {dataTable.rows.map((row, rowIndex) => (
                <TableRow key={`row-${String(rowIndex)}`}>
                  {row.map((cell, cellIndex) => (
                    <TableCell
                      key={`cell-${String(cellIndex)}`}
                      className={
                        typeof cell === 'number'
                          ? 'text-mono tabular text-right font-mono'
                          : 'whitespace-normal'
                      }
                    >
                      {cell === null ? t('graph.notAvailable') : cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Always in the DOM, whichever view is on screen: it is the graph's text equivalent, and the
          `aria-describedby` on the SVG points at it. */}
      <p id={descId} className="sr-only">
        {description}
      </p>
    </figure>
  )
}
