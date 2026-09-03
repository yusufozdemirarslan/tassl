import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

describe('DropdownMenuLabel', () => {
  it('renders without a menu group ancestor and stays presentational', () => {
    // Base UI's GroupLabel throws outside Menu.Group; the label must be a plain element.
    render(<DropdownMenuLabel>Claim actions</DropdownMenuLabel>)
    const label = screen.getByText('Claim actions')
    expect(label.tagName).toBe('DIV')
    expect(label).toHaveAttribute('data-slot', 'dropdown-menu-label')
    expect(label).toHaveAttribute('role', 'presentation')
    expect(label.className).toContain('text-meta')
    expect(label.className).toContain('text-ink-muted')
  })
})

describe('DropdownMenu', () => {
  it('opens with a label above items in the popup recipe', () => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Claim actions</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem>Verify against the ledger</DropdownMenuItem>
          <DropdownMenuItem variant="destructive">Escalate</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    )
    const menu = screen.getByRole('menu')
    expect(menu).toContainElement(screen.getByText('Claim actions'))
    expect(menu.className).toContain('rounded-md')
    expect(menu.className).toContain('shadow-float')
    expect(menu.className).toContain('bg-paper-raised')
    expect(menu.className).toContain('duration-200')
    expect(menu.className).toContain('ease-out')
    expect(menu.className).not.toMatch(/ring-1|shadow-md|duration-100|ease-in-out|dark:/)

    const item = screen.getByRole('menuitem', { name: 'Verify against the ledger' })
    expect(item.className).toContain('min-h-10')
    expect(item.className).toContain('text-body')
    expect(item.className).toContain('rounded-sm')
    expect(item.className).toContain('data-highlighted:bg-paper-sunken')
    expect(item.className).not.toMatch(/\/10|\/20|accent|zinc|black|gray-/)

    const destructive = screen.getByRole('menuitem', { name: 'Escalate' })
    expect(destructive).toHaveAttribute('data-variant', 'destructive')
    expect(destructive.className).toContain('data-[variant=destructive]:text-red')
  })
})
