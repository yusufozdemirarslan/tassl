import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

function renderTooltip(open: boolean) {
  return render(
    <TooltipProvider>
      <Tooltip defaultOpen={open}>
        <TooltipTrigger>About the clock</TooltipTrigger>
        <TooltipContent>The clock is server time.</TooltipContent>
      </Tooltip>
    </TooltipProvider>,
  )
}

describe('Tooltip', () => {
  it('exposes role="tooltip" with an id and describes the trigger while open', () => {
    renderTooltip(true)
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent('The clock is server time.')
    expect(tooltip.id).not.toBe('')
    expect(screen.getByRole('button', { name: 'About the clock' })).toHaveAttribute(
      'aria-describedby',
      tooltip.id,
    )
  })

  it('does not describe the trigger while closed', () => {
    renderTooltip(false)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'About the clock' })).not.toHaveAttribute(
      'aria-describedby',
    )
  })

  it('keeps a caller-supplied aria-describedby alongside the tooltip id', () => {
    render(
      <TooltipProvider>
        <p id="hint">Hint</p>
        <Tooltip defaultOpen>
          <TooltipTrigger aria-describedby="hint">About the clock</TooltipTrigger>
          <TooltipContent>The clock is server time.</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    )
    const tooltip = screen.getByRole('tooltip')
    expect(screen.getByRole('button', { name: 'About the clock' })).toHaveAttribute(
      'aria-describedby',
      `hint ${tooltip.id}`,
    )
  })

  it('renders ink on paper with a fade only', () => {
    renderTooltip(true)
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip.className).toContain('bg-ink')
    expect(tooltip.className).toContain('text-paper')
    expect(tooltip.className).toContain('text-meta')
    expect(tooltip.className).toContain('rounded-sm')
    expect(tooltip.className).toContain('shadow-float')
    expect(tooltip.className).toContain('duration-150')
    expect(tooltip.className).not.toMatch(/zoom-in|slide-in|foreground|black|dark:/)
  })
})
