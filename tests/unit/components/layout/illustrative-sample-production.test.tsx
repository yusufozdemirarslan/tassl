import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IllustrativeSample } from '@/components/layout/illustrative-sample'

// In production a missing label must not crash the page; the fixed chip still marks the data.
describe('IllustrativeSample in production', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('renders the fixed sample chip even without a label', () => {
    vi.stubEnv('NODE_ENV', 'production')
    render(
      // @ts-expect-error exercising the production fallback for a missing label
      <IllustrativeSample label={undefined}>
        <p>Fixture body</p>
      </IllustrativeSample>,
    )
    expect(screen.getByText('Illustrative sample data')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Illustrative sample data' })).toHaveAttribute(
      'data-sample',
      'true',
    )
  })
})
