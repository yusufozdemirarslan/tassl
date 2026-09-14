import { render, screen } from '@testing-library/react'
import type { Route } from 'next'
import { describe, expect, it, vi } from 'vitest'
import { HomeRunsPanel } from '@/components/features/home/runs-panel'
import { AppShell } from '@/components/layout/app-shell'
import { ErrorState } from '@/components/layout/error-state'
import type { RailItem } from '@/components/layout/rail'
import { permittedRailKeys, railFor } from '@/components/layout/rail-items'
import { enUS } from '@/lib/i18n/en-US'

vi.mock('next/navigation', () => ({
  usePathname: () => '/runs/abc',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))

// The header's two menus reach the server and Better Auth; the shell test is about what the header
// renders, so both boundaries are stubbed here.
vi.mock('@/server/modules/tenancy/actions', () => ({ setActiveInstitutionAction: vi.fn() }))
vi.mock('@/lib/auth-client', () => ({ authClient: { signOut: vi.fn() } }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

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
    // When focused it is a 40 px control like every other button in the header.
    expect(skip.className).toContain('focus:h-10')
    expect(skip.className).toContain('focus:items-center')
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main')
  })

  it('reserves room for the bottom bar under md and aligns the rail with main from md', () => {
    render(
      <AppShell rail={rail} institutions={[]} unreadCount={0} user={null}>
        <p>content</p>
      </AppShell>,
    )
    // 80 px clears the 57 px bar by the page's 24 px gutter and equals the html scroll padding.
    expect(screen.getByRole('main').className).toContain('pb-20')
    const list = screen.getByRole('navigation', { name: 'Primary' }).querySelector('ul')
    expect(list?.className).toContain('md:py-6')
  })

  it('links the brand wordmark to home', () => {
    render(
      <AppShell rail={rail} institutions={[]} unreadCount={0} user={null}>
        <p>content</p>
      </AppShell>,
    )
    const brand = screen.getByRole('link', { name: 'Tassl' })
    expect(brand).toHaveAttribute('href', '/home')
    expect(brand.className).toContain('rounded-sm')
    expect(brand.className).toContain('focus-visible:outline-2')
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
    // The signed-out text hides under sm; the screen-reader copy is always present, exactly once.
    expect(screen.getByText('Not signed in', { selector: '.sr-only' })).toBeInTheDocument()
    expect(
      screen.getByText('Not signed in', { selector: '[aria-hidden="true"]' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Notifications: 3 unread' })).toBeInTheDocument()
  })

  it('groups the unread count in the bell label and caps the badge at 99+', () => {
    render(
      <AppShell rail={rail} institutions={[]} unreadCount={1200} user={null}>
        <p>content</p>
      </AppShell>,
    )
    const bell = screen.getByRole('link', { name: 'Notifications: 1,200 unread' })
    expect(bell).toHaveTextContent('99+')
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
    expect(screen.getByText('Georgetown')).toHaveAttribute('title', 'Georgetown')
    expect(screen.queryByRole('button', { name: 'Switch institution' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Account: Yusuf' })).toBeInTheDocument()
  })

  it('renders the account menu trigger as a closed menu button', () => {
    // Base UI menus do not open reliably in jsdom; the trigger is what is asserted here.
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
    const trigger = screen.getByRole('button', { name: 'Account: Yusuf' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('offers several institutions through a switcher whose name includes the active one', () => {
    render(
      <AppShell
        rail={rail}
        institutions={[
          { id: 'org1', name: 'Georgetown' },
          { id: 'org2', name: 'Howard' },
        ]}
        activeInstitutionId="org2"
        unreadCount={0}
        user={null}
      >
        <p>content</p>
      </AppShell>,
    )
    const trigger = screen.getByRole('button', { name: /Switch institution/ })
    expect(trigger).toHaveAccessibleName(/Howard/)
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(screen.getByText('Howard')).toHaveAttribute('title', 'Howard')
  })
})

describe('rail derivation (UI-008, D-748)', () => {
  const home = { href: '/home', label: enUS['nav.home'], icon: 'home' }
  const runs = { href: '/runs', label: enUS['nav.runs'], icon: 'runs' }
  const courses = { href: '/courses', label: enUS['nav.courses'], icon: 'courses' }
  const review = { href: '/review', label: enUS['nav.review'], icon: 'review' }
  const packages = { href: '/packages', label: enUS['nav.packages'], icon: 'packages' }
  const admin = { href: '/admin/users', label: enUS['nav.admin'], icon: 'admin', section: '/admin' }

  it('derives each destination from the one platform role', () => {
    expect(permittedRailKeys({ platformRole: 'student' })).toEqual(['home', 'runs'])
    expect(permittedRailKeys({ platformRole: 'tassl_scenario_editor' })).toEqual([
      'home',
      'runs',
      'packages',
    ])
    expect(permittedRailKeys({ platformRole: 'instructor' })).toEqual([
      'home',
      'courses',
      'review',
      'packages',
    ])
    expect(permittedRailKeys({ platformRole: 'admin' })).toEqual([
      'home',
      'runs',
      'courses',
      'review',
      'packages',
      'admin',
    ])
  })

  it('renders only the destinations whose routes exist, so no rail link can 404', () => {
    // Every destination now has a route, each landing with the step that built it: `/courses` 4.2,
    // `/packages` 5.4, `/runs` 6.5, `/review` 11.4, `/admin/users` 13.5 — and each renders in the
    // order `permittedRailKeys` puts it. Admin points at its first section rather than at `/admin`,
    // which is a prefix that only redirects (UI-050).
    expect(railFor({ platformRole: 'admin' })).toEqual([
      home,
      runs,
      courses,
      review,
      packages,
      admin,
    ])
  })

  it('offers a Student their own runs and nothing else: no course, no queue, no shelf', () => {
    expect(railFor({ platformRole: 'student' })).toEqual([home, runs])
  })

  it('offers a Scenario Editor a Student’s runs and the shelf, and no course or queue', () => {
    expect(railFor({ platformRole: 'tassl_scenario_editor' })).toEqual([home, runs, packages])
  })

  it('offers an Instructor courses, review and the shelf, and no runs of their own', () => {
    const items = railFor({ platformRole: 'instructor' })
    expect(items).toEqual([home, courses, review, packages])
    expect(items).not.toContainEqual(runs)
    expect(items).not.toContainEqual(admin)
  })
})

describe('HomeRunsPanel (UI-009)', () => {
  it('explains how an institution arrives when the person has no membership', () => {
    render(<HomeRunsPanel hasMembership={false} rows={[]} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Your runs' })).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 3, name: 'Waiting for an invitation' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/adds you by an invitation email/)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Your runs' })).toHaveAttribute('id', 'home-runs')
  })

  it('says nothing is assigned yet once the person belongs to an institution', () => {
    render(<HomeRunsPanel hasMembership rows={[]} />)
    expect(
      screen.getByRole('heading', { level: 3, name: enUS['home.emptyTitle'] }),
    ).toBeInTheDocument()
    expect(screen.queryByText(enUS['home.noMembershipsTitle'])).not.toBeInTheDocument()
  })
})

describe('ErrorState heading levels', () => {
  it('renders the requested element while keeping the title style', () => {
    render(<ErrorState headingLevel={2} message="Could not load." />)
    const heading = screen.getByRole('heading', { level: 2, name: 'Something went wrong' })
    expect(heading.className).toContain('text-h3')
  })

  it('renders the page-level variant as the focusable h1', () => {
    render(<ErrorState headingLevel={1} message="Could not load." requestId="req_123" />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveAttribute('id', 'page-title')
    expect(screen.getByText('req_123').className).toContain('break-all')
  })
})
