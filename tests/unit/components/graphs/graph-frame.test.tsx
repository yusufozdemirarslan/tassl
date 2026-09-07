// `GraphFrame` — the accessible structure every graph is drawn inside (16 §9; FR-212, FR-136,
// FR-004, NFR-006).
//
// A graph a screen-reader user cannot read is a failed graph, so these are not styling assertions.
// The four things asserted here are the four things that make a plot readable without sight: the
// SVG carries `role="img"` and is named by the visible heading and described by the hidden
// description; the description is always in the DOM; the data table opens from a toggle that says
// which state it is in; and a graph that could not be built says so and names the events it went
// looking for, with its table still there.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { GraphFrame, type GraphDataTable } from '@/components/graphs/graph-frame'

const dataTable: GraphDataTable = {
  caption: 'Confidence and accuracy at each of the run’s three confidence points',
  columns: ['Point', 'Confidence', 'Accuracy'],
  rows: [
    ['Frame', 55, null],
    ['Decision lock', 60, 100],
    ['After the Turn', 60, 100],
  ],
}

const DESCRIPTION =
  'Confidence stated by the student, against the authored accuracy of the claims relied on.'

function renderFrame(overrides: Partial<React.ComponentProps<typeof GraphFrame>> = {}) {
  return render(
    <GraphFrame
      graphKey="confidence_line"
      title="Confidence line"
      description={DESCRIPTION}
      dataTable={dataTable}
      available
      {...overrides}
    >
      {(chart) => (
        <svg {...chart} viewBox="0 0 10 10">
          <rect x={0} y={0} width={10} height={10} />
        </svg>
      )}
    </GraphFrame>,
  )
}

describe('GraphFrame — the chart', () => {
  it('renders the SVG as an image named by the title and described by the description', () => {
    const { container } = renderFrame()
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('role')).toBe('img')

    const titleId = svg?.getAttribute('aria-labelledby')
    const descId = svg?.getAttribute('aria-describedby')
    expect(titleId).toBeTruthy()
    expect(descId).toBeTruthy()
    expect(document.getElementById(titleId!)?.textContent).toBe('Confidence line')
    expect(document.getElementById(descId!)?.textContent).toBe(DESCRIPTION)
    expect(svg?.getAttribute('tabindex')).toBe('0')
  })

  it('names an SVG that arrived without the frame’s attributes', () => {
    // A charting library that drops the props it was handed — the failure 16 §9.2 asks the frame to
    // catch — still ends up with a named image.
    const { container } = render(
      <GraphFrame
        graphKey="clock_timeline"
        title="Clock timeline"
        description={DESCRIPTION}
        dataTable={dataTable}
        available
      >
        <svg viewBox="0 0 10 10" />
      </GraphFrame>,
    )
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('role')).toBe('img')
    expect(svg?.getAttribute('aria-labelledby')).toBeTruthy()
    expect(svg?.getAttribute('aria-describedby')).toBeTruthy()
  })

  it('keeps the description in the DOM, visually hidden', () => {
    renderFrame()
    const description = screen.getByText(DESCRIPTION)
    expect(description).toBeInTheDocument()
    expect(description).toHaveClass('sr-only')
  })

  it('labels the figure with its title', () => {
    const { container } = renderFrame()
    const figure = container.querySelector('figure')
    expect(figure?.dataset.graph).toBe('confidence_line')
    expect(figure?.getAttribute('aria-labelledby')).toBeTruthy()
  })
})

describe('GraphFrame — the data table (FR-212)', () => {
  it('opens the table from a toggle that says which state it is in', async () => {
    const user = userEvent.setup()
    renderFrame()

    const toggle = screen.getByRole('button', { name: 'Show data table' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    await user.click(toggle)

    const pressed = screen.getByRole('button', { name: 'Show graph' })
    expect(pressed).toHaveAttribute('aria-pressed', 'true')
    expect(pressed.getAttribute('aria-controls')).toBeTruthy()

    const table = screen.getByRole('table')
    expect(within(table).getByText(dataTable.caption)).toBeInTheDocument()
    for (const column of dataTable.columns) {
      expect(within(table).getByRole('columnheader', { name: column })).toBeInTheDocument()
    }
    expect(within(table).getAllByRole('row')).toHaveLength(dataTable.rows.length + 1)
  })

  it('renders an empty cell as the words "not available", never as a blank', async () => {
    const user = userEvent.setup()
    renderFrame()
    await user.click(screen.getByRole('button', { name: 'Show data table' }))
    expect(within(screen.getByRole('table')).getByText('not available')).toBeInTheDocument()
  })

  it('can open on the table when the caller asks for it', () => {
    renderFrame({ defaultView: 'table' })
    expect(screen.getByRole('button', { name: 'Show graph' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('table')).toBeInTheDocument()
  })
})

describe('GraphFrame — the unavailable state (FR-004, FR-136)', () => {
  it('says the graph is not available, names every missing event, and keeps the table', () => {
    renderFrame({
      available: false,
      missingEventTypes: ['frame_locked', 'decision_locked'],
    })

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('This graph is not available for this run.')
    expect(status).toHaveTextContent('frame_locked, decision_locked')

    // No toggle: there is no plot to switch to.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    // The table and the description are still there.
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText(DESCRIPTION)).toBeInTheDocument()
  })

  it('says so when a graph has no rows at all', () => {
    renderFrame({
      available: false,
      missingEventTypes: ['frame_locked'],
      dataTable: { ...dataTable, rows: [] },
    })
    expect(screen.getByText('This graph has no rows.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})

describe('GraphFrame — one component for every reader (FR-154)', () => {
  it('renders the same payload identically wherever it is drawn', () => {
    const first = renderFrame().container.innerHTML
    const second = renderFrame().container.innerHTML
    // `useId` differs per render tree, so identity is asserted over everything but the ids.
    const stripIds = (html: string) =>
      html.replace(/«[^»]*»/g, 'ID').replace(/_r_[a-z0-9]+_/g, 'ID')
    expect(stripIds(first)).toBe(stripIds(second))
  })

  it('takes a heading level so the document outline never skips a rung', () => {
    renderFrame({ headingLevel: 4 })
    expect(screen.getByRole('heading', { level: 4, name: 'Confidence line' })).toBeInTheDocument()
  })
})
