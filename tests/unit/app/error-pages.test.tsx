import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import AppRouteError from '@/app/(app)/error'
import AppNotFound from '@/app/(app)/not-found'
import RouteError from '@/app/error'
import NotFound from '@/app/not-found'

vi.mock('next/navigation', () => ({
  usePathname: () => '/home',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

// UI-007. The four boundaries share one rhythm (heading, 12 px, sentence, 16 px, action), the
// Headline style for a page-level h1 (30/38 at weight 500), and the one focus recipe.
describe('root not-found', () => {
  it('sets the Headline style on the h1 and the shared rhythm before the action', () => {
    render(<NotFound />)
    const heading = screen.getByRole('heading', { level: 1, name: 'Not found' })
    expect(heading.className).toContain('text-h2')
    expect(heading.className).toContain('font-medium')
    const home = screen.getByRole('link', { name: 'Go home' })
    expect(home).toHaveAttribute('href', '/')
    expect(home.className).toContain('mt-4')
    expect(home.className).not.toContain('mt-6')
  })
})

describe('root error boundary', () => {
  it('renders the focusable h1 with the focus recipe and no vertical card padding of its own', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { container } = render(
      <RouteError error={Object.assign(new Error('boom'), { digest: 'req_42' })} reset={vi.fn()} />,
    )
    const heading = screen.getByRole('heading', { level: 1, name: 'Something went wrong' })
    expect(heading).toHaveAttribute('id', 'page-title')
    expect(heading.className).toContain('font-medium')
    expect(heading.className).toContain('focus-visible:outline-2')
    expect(heading.className).toContain('focus-visible:outline-offset-2')
    expect(heading.className).not.toContain('outline-none')
    expect(screen.getByText('req_42')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    const card = container.querySelector('main > div')
    expect(card?.className).toContain('px-6')
    expect(card?.className).not.toContain('py-2')
    vi.restoreAllMocks()
  })

  it('drops the reference sentence when there is no digest', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<RouteError error={new Error('boom')} reset={vi.fn()} />)
    expect(screen.getByText(/Try again, or come back in a moment/)).toBeInTheDocument()
    expect(screen.queryByText(/quote the reference/)).not.toBeInTheDocument()
    vi.restoreAllMocks()
  })
})

describe('in-shell boundaries', () => {
  it('renders the not-found page as h1 plus a panel with the sentence and a link home', () => {
    render(<AppNotFound />)
    expect(screen.getByRole('heading', { level: 1, name: 'Not found' })).toHaveAttribute(
      'id',
      'page-title',
    )
    expect(screen.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/home')
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument()
  })

  it('renders the error boundary with the page-level h1 and a retry action', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const reset = vi.fn()
    render(<AppRouteError error={new Error('boom')} reset={reset} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Something went wrong' })).toHaveAttribute(
      'id',
      'page-title',
    )
    screen.getByRole('button', { name: 'Try again' }).click()
    expect(reset).toHaveBeenCalledOnce()
    vi.restoreAllMocks()
  })
})
