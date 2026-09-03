import { render, screen } from '@testing-library/react'
import type { Route } from 'next'
import { describe, expect, it, vi } from 'vitest'
import { AppShell } from '@/components/layout/app-shell'
import type { RailItem } from '@/components/layout/rail'

vi.mock('next/navigation', () => ({
  usePathname: () => '/runs/abc',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

const rail: RailItem[] = [
  { href: '/home' as Route, label: 'Home', icon: 'home' },
  { href: '/runs' as Route, label: 'Runs', icon: 'runs' },
]

describe('AppShell', () => {
  it('starts with a skip link to main', () => {
    render(
      <AppShell rail={rail} institutions={[]} unreadCount={0} user={null}>
        <p>content</p>
      </AppShell>,
    )
    const skip = screen.getByRole('link', { name: 'Skip to main content' })
    expect(skip).toHaveAttribute('href', '#main')
    expect(document.body.querySelector('a')).toBe(skip)
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main')
  })

  it('renders the rail items from props inside a labelled nav', () => {
    render(
      <AppShell rail={rail} institutions={[]} unreadCount={0} user={null}>
        <p>content</p>
      </AppShell>,
    )
    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(nav).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/home')
    expect(screen.getByRole('link', { name: 'Runs' })).toHaveAttribute('href', '/runs')
    expect(nav.querySelectorAll('svg')).toHaveLength(2)
  })

  it('marks the active item with aria-current, including nested routes', () => {
    render(
      <AppShell rail={rail} institutions={[]} unreadCount={0} user={null}>
        <p>content</p>
      </AppShell>,
    )
    expect(screen.getByRole('link', { name: 'Runs' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current')
  })

  it('shows the zero-membership and signed-out placeholders, and the unread count', () => {
    render(
      <AppShell rail={rail} institutions={[]} unreadCount={3} user={null}>
        <p>content</p>
      </AppShell>,
    )
    expect(screen.getByText('No institution yet')).toBeInTheDocument()
    expect(screen.getByText('Not signed in')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Notifications: 3 unread' })).toBeInTheDocument()
  })

  it('shows a single institution as plain text', () => {
    render(
      <AppShell
        rail={rail}
        institutions={[{ id: 'org1', name: 'Georgetown' }]}
        unreadCount={0}
        user={{ name: 'Yusuf', email: 'y@example.edu' }}
      >
        <p>content</p>
      </AppShell>,
    )
    expect(screen.getByText('Georgetown')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Switch institution' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Account: Yusuf' })).toBeInTheDocument()
  })
})
