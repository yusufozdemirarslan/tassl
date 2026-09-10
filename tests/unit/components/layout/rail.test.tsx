import { render, screen } from '@testing-library/react'
import type { Route } from 'next'
import { describe, expect, it, vi } from 'vitest'
import { Rail } from '@/components/layout/rail'
import { railFor } from '@/components/layout/rail-items'

// UI-008's active mark. Every item is lit on its own screen and on every screen beneath it; Admin
// links to its first section and owns the whole `/admin` prefix, so `/admin/flags` and
// `/admin/audit` light it exactly as `/runs/abc` lights Runs.

const location = vi.hoisted(() => ({ pathname: '/home' }))

vi.mock('next/navigation', () => ({ usePathname: () => location.pathname }))

const admin = railFor({ roles: ['student'], platformRole: 'admin' })

function activeLinks(): string[] {
  return screen
    .getAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'page')
    .map((link) => link.textContent ?? '')
}

describe('Rail active item', () => {
  it.each(['/admin/users', '/admin/flags', '/admin/audit', '/admin/audit/some-row'])(
    'marks Admin active on %s',
    (pathname) => {
      location.pathname = pathname
      render(<Rail items={admin} />)
      expect(activeLinks()).toEqual(['Admin'])
    },
  )

  it('keeps the item dark on a sibling that only shares the prefix', () => {
    location.pathname = '/administration'
    render(<Rail items={admin} />)
    expect(activeLinks()).toEqual([])
  })

  it('marks the other items on their own nested routes', () => {
    location.pathname = '/runs/abc/work'
    render(<Rail items={admin} />)
    expect(activeLinks()).toEqual(['Runs'])
  })

  it('does not light Admin on a screen outside it', () => {
    location.pathname = '/home'
    render(
      <Rail items={[...admin, { href: '/courses' as Route, label: 'Courses', icon: 'courses' }]} />,
    )
    expect(activeLinks()).toEqual(['Home'])
  })
})
