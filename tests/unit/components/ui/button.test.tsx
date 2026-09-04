import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from '@/components/ui/button'

describe('Button', () => {
  it.each([
    ['primary', 'bg-primary'],
    ['secondary', 'bg-paper-raised'],
    ['ghost', 'text-ink'],
    ['destructive', 'bg-red'],
  ] as const)('renders the %s variant with its token class', (variant, cls) => {
    render(<Button variant={variant}>Go</Button>)
    const button = screen.getByRole('button', { name: 'Go' })
    expect(button).toBeInTheDocument()
    expect(button.className).toContain(cls)
  })

  it('defaults to the primary variant at 40 px with a visible focus ring', () => {
    render(<Button>Lock decision</Button>)
    const button = screen.getByRole('button', { name: 'Lock decision' })
    expect(button.className).toContain('bg-primary')
    expect(button.className).toContain('min-h-10')
    expect(button.className).toMatch(/focus-visible:outline-2/)
    expect(button.className).toMatch(/focus-visible:outline-focus/)
  })

  it('exposes the three sizes', () => {
    const { rerender } = render(<Button size="sm">A</Button>)
    expect(screen.getByRole('button').className).toContain('min-h-8')
    rerender(<Button size="lg">A</Button>)
    expect(screen.getByRole('button').className).toContain('min-h-12')
  })

  // WCAG 1.4.4: at 200 % text size a nowrap label was clipped and pushed the page sideways at
  // 360 px, so the label wraps and the height is a floor rather than a fixed box.
  it('lets a long label wrap inside the control instead of escaping it', () => {
    render(<Button>Lock decision</Button>)
    const button = screen.getByRole('button', { name: 'Lock decision' })
    expect(button.className).not.toContain('whitespace-nowrap')
    expect(button.className).toContain('text-center')
    expect(button.className).toContain('max-w-full')
    expect(button.className).not.toMatch(/(^| )h-10( |$)/)
  })

  it('is disabled when asked', () => {
    render(<Button disabled>Go</Button>)
    expect(screen.getByRole('button', { name: 'Go' })).toBeDisabled()
  })

  it('never uses zinc, black, or gradient classes', () => {
    render(<Button variant="destructive">Go</Button>)
    expect(screen.getByRole('button').className).not.toMatch(/zinc|black|gradient|gray-/)
  })
})
