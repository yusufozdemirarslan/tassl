import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { IllustrativeSample } from '@/components/layout/illustrative-sample'
import { LabelChip } from '@/components/layout/label-chip'

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
