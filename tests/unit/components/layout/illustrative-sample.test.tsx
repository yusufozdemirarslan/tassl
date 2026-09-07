import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ReviewQueue } from '@/components/features/review/review-queue'
import { TrajectorySample } from '@/components/graphs/trajectory-sample'
import { IllustrativeSample } from '@/components/layout/illustrative-sample'
import { LabelChip } from '@/components/layout/label-chip'
import { enUS } from '@/lib/i18n/en-US'
import trajectoryFixture from '@/server/modules/records/sample/four-run-trajectory.json'
import queueFixture from '@/server/modules/records/sample/review-queue.json'
import { SAMPLE_LABEL, type SampleTrajectory } from '@/server/modules/records/schema'

describe('IllustrativeSample', () => {
  it('always renders the "Illustrative sample data" label text', () => {
    render(
      <IllustrativeSample label="Sample debrief">
        <p>Fixture body</p>
      </IllustrativeSample>,
    )
    expect(screen.getByText('Illustrative sample data')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Sample debrief' })).toBeInTheDocument()
    expect(screen.getByText('Fixture body')).toBeInTheDocument()
  })

  it('renders the label at the requested heading level in the subtitle style', () => {
    render(
      <IllustrativeSample label="Sample debrief" headingLevel={2}>
        <p>Fixture body</p>
      </IllustrativeSample>,
    )
    const heading = screen.getByRole('heading', { level: 2, name: 'Sample debrief' })
    expect(heading.className).toContain('text-h4')
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument()
  })

  it('refuses to render without a label outside production', () => {
    expect(() =>
      render(
        // @ts-expect-error the label is mandatory; the runtime guard is what is under test
        <IllustrativeSample label={undefined}>
          <p>Fixture body</p>
        </IllustrativeSample>,
      ),
    ).toThrow(/label/)
  })

  it('marks the panel as sample data with a dashed strong border', () => {
    render(
      <IllustrativeSample label="Sample">
        <p>x</p>
      </IllustrativeSample>,
    )
    const section = screen.getByRole('region', { name: 'Sample' })
    expect(section).toHaveAttribute('data-sample', 'true')
    expect(section.className).toContain('border-dashed')
    expect(section.className).toContain('border-line-strong')
  })
})

// FR-254, D-035: the two panels that draw invented numbers can only draw them inside the label.
//
// This is the assertion the phase asks for, and the refusal is the point: these are numbers that
// describe no student, shown on a page that is otherwise entirely about one, and an unlabelled
// chart of invented data is the worst thing this product could show. So neither component takes a
// wrapper from its caller — each opens with `IllustrativeSample` itself — and the trajectory checks
// the fixture's own `label` as well, because the label travels in the data.

const trajectory = trajectoryFixture as SampleTrajectory

describe('TrajectorySample (UI-029, FR-171)', () => {
  it('renders only inside the labelled wrapper, with the chip and the dashed border', () => {
    render(<TrajectorySample data={trajectory} />)

    const panel = screen.getByRole('region', { name: enUS['record.trajectoryTitle'] })
    expect(panel).toHaveAttribute('data-sample', 'true')
    expect(panel.className).toContain('border-dashed')
    expect(within(panel).getByText(SAMPLE_LABEL)).toBeInTheDocument()

    // Every row of the fixture is inside that region and nowhere else.
    const bandsTable = within(panel).getByRole('table', {
      name: enUS['record.trajectoryBandsCaption'],
    })
    expect(within(bandsTable).getAllByRole('row')).toHaveLength(trajectory.bands.length + 1)
    expect(within(panel).getByText(enUS['record.trajectoryNote'])).toBeInTheDocument()
  })

  it('refuses a fixture that does not carry the FR-254 label', () => {
    expect(() =>
      render(<TrajectorySample data={{ ...trajectory, label: 'Four-run trajectory' } as never} />),
    ).toThrow(/label/)
  })
})

describe('ReviewQueue (UI-034, FR-186)', () => {
  const rows = (
    queueFixture as { rows: { key: string; heading: string; body: string; count: number }[] }
  ).rows

  it('draws the illustrative groupings only inside the labelled wrapper', () => {
    render(<ReviewQueue illustrative={rows} runs={[]} />)

    const panel = screen.getByRole('region', { name: enUS['review.queueSampleTitle'] })
    expect(panel).toHaveAttribute('data-sample', 'true')
    expect(panel.className).toContain('border-dashed')
    expect(within(panel).getByText(SAMPLE_LABEL)).toBeInTheDocument()
    for (const row of rows) {
      expect(within(panel).getByRole('heading', { name: row.heading })).toBeInTheDocument()
    }
  })

  it('draws no sample panel at all when the flag is off, and never an empty one', () => {
    render(<ReviewQueue illustrative={[]} runs={[]} />)

    expect(screen.queryByText(SAMPLE_LABEL)).toBeNull()
    expect(document.querySelector('[data-sample="true"]')).toBeNull()
    // The real half is still there, saying there is nothing waiting.
    expect(screen.getByText(enUS['review.queueEmptyTitle'])).toBeInTheDocument()
  })

  it('keeps the real runs out of the sample panel', () => {
    render(
      <ReviewQueue
        illustrative={rows}
        runs={[
          {
            id: '11111111-1111-4111-8111-111111111111',
            studentName: 'Marco Bianchi',
            attemptNo: 1,
            state: 'scored',
            decisionsMade: 0,
            latestExportVersion: null,
          },
        ]}
      />,
    )

    const panel = screen.getByRole('region', { name: enUS['review.queueSampleTitle'] })
    expect(within(panel).queryByText('Marco Bianchi')).toBeNull()
    expect(screen.getByText('Marco Bianchi')).toBeInTheDocument()
  })
})

describe('LabelChip', () => {
  it.each([
    ['draft', 'Draft', 'bg-amber-soft'],
    ['confirmed', 'Confirmed', 'bg-green-soft'],
    ['uncalibrated', 'Uncalibrated', 'bg-amber-soft'],
    ['walkthrough', 'Walkthrough', 'bg-primary-soft'],
    ['provisional', 'Provisional', 'bg-amber-soft'],
    ['unreviewed', 'Unreviewed', 'bg-paper-sunken'],
  ] as const)('renders %s with its text and wash', (kind, text, wash) => {
    render(<LabelChip kind={kind} />)
    const chip = screen.getByText(text)
    expect(chip.className).toContain(wash)
    expect(chip.className).toContain('text-ink')
    expect(chip.querySelector('svg')).not.toBeNull()
  })
})
