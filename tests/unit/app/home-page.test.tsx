import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import HomePage from '@/app/(app)/home/page'
import { AppError } from '@/lib/errors'
import { enUS } from '@/lib/i18n/en-US'
import type { SessionUser } from '@/server/auth/types'
import type { MeView, PlatformRole } from '@/server/modules/identity'

// UI-009, read with D-748: which panels a person gets is decided by their one platform role.
//
//   Your runs → Student, Scenario Editor, Platform Admin, and anyone with no membership at all
//   Review    → Instructor, Platform Admin
//   Packages  → Scenario Editor, Platform Admin (the drafts to confirm)
//   Courses   → Instructor, Platform Admin
//
// A panel a role is not offered is not drawn and its read is not made: an instructor was once shown
// "Nothing to do yet" about runs they cannot take, which is exactly the empty box the page forbids.

const viewer = vi.hoisted(() => ({ me: null as unknown, actor: null as unknown }))
const reads = vi.hoisted(() => ({
  listMyAssignments: vi.fn(),
  listMyRunsForAssignments: vi.fn(),
  getQueue: vi.fn(),
  listPackages: vi.fn(),
  listCourses: vi.fn(),
}))

vi.mock('@/app/(app)/viewer', () => ({
  getViewer: async () => ({ actor: viewer.actor, me: viewer.me }),
}))
vi.mock('@/server/modules/courses', () => ({
  listCourses: reads.listCourses,
  listMyAssignments: reads.listMyAssignments,
}))
vi.mock('@/server/modules/review', () => ({ getQueue: reads.getQueue }))
vi.mock('@/server/modules/runs', () => ({
  listMyRunsForAssignments: reads.listMyRunsForAssignments,
}))
vi.mock('@/server/modules/scenarios', () => ({ listPackages: reads.listPackages }))
// The runs list is a client component whose Start control is a Server Action.
vi.mock('@/server/modules/runs/actions', () => ({ startRunAction: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

function actor(platformRole: PlatformRole): SessionUser {
  return {
    id: 'user_1',
    email: 'lena@example.edu',
    name: 'Lena',
    emailVerified: true,
    activeOrganizationId: 'org_1',
    platformRole,
  }
}

/** The capabilities `identity.getCurrentUser` derives from the role (D-748). */
function me(platformRole: PlatformRole, { member = true } = {}): MeView {
  const admin = platformRole === 'admin'
  return {
    id: 'user_1',
    name: 'Lena',
    email: 'lena@example.edu',
    emailVerified: true,
    image: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    platformRole,
    memberships: member
      ? [
          {
            organizationId: 'org_1',
            name: 'Georgetown',
            slug: 'georgetown',
            joinedAt: '2026-09-01T00:00:00.000Z',
          },
        ]
      : [],
    activeOrganizationId: member ? 'org_1' : null,
    capabilities: {
      canTakeRuns: admin || platformRole === 'student' || platformRole === 'tassl_scenario_editor',
      canReviewRuns: admin || platformRole === 'instructor',
      canAuthorPackages: admin || platformRole === 'tassl_scenario_editor',
      canManageInstitution: admin,
      canCreateInstitution: admin,
    },
  }
}

async function renderHome(view: MeView) {
  viewer.me = view
  viewer.actor = actor(view.platformRole)
  render(await HomePage())
}

const heading = (key: keyof typeof enUS) =>
  screen.queryByRole('heading', { level: 2, name: enUS[key] })

const PANEL_TITLES: readonly string[] = [
  enUS['home.runsTitle'],
  enUS['home.reviewTitle'],
  enUS['home.packagesTitle'],
  enUS['home.coursesTitle'],
]

/** The four panel headings the page drew, in page order. */
function panels(): string[] {
  return screen
    .queryAllByRole('heading', { level: 2 })
    .map((node) => node.textContent ?? '')
    .filter((text) => PANEL_TITLES.includes(text))
}

describe('HomePage panels (UI-009, D-748)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reads.listMyAssignments.mockResolvedValue({ items: [], nextCursor: null })
    reads.listMyRunsForAssignments.mockResolvedValue([])
    reads.getQueue.mockResolvedValue({ illustrative: [], runs: [] })
    reads.listPackages.mockResolvedValue({ items: [], nextCursor: null })
    reads.listCourses.mockResolvedValue({ items: [], nextCursor: null })
  })

  it('gives a Student their runs and nothing else', async () => {
    await renderHome(me('student'))

    expect(panels()).toEqual([enUS['home.runsTitle']])
    expect(screen.getByText(enUS['home.emptyTitle'])).toBeInTheDocument()
    expect(reads.listMyAssignments).toHaveBeenCalled()
    expect(reads.getQueue).not.toHaveBeenCalled()
    expect(reads.listPackages).not.toHaveBeenCalled()
    expect(reads.listCourses).not.toHaveBeenCalled()
  })

  it('gives a Scenario Editor their runs and the drafts to confirm', async () => {
    await renderHome(me('tassl_scenario_editor'))

    expect(panels()).toEqual([enUS['home.runsTitle'], enUS['home.packagesTitle']])
    expect(reads.getQueue).not.toHaveBeenCalled()
    expect(reads.listCourses).not.toHaveBeenCalled()
  })

  it('gives an Instructor review and courses, and no runs panel or drafts to confirm', async () => {
    await renderHome(me('instructor'))

    expect(panels()).toEqual([enUS['home.reviewTitle'], enUS['home.coursesTitle']])
    expect(screen.queryByText(enUS['home.emptyTitle'])).not.toBeInTheDocument()
    // The learner reads are not made for a role that takes no runs, nor the authoring read.
    expect(reads.listMyAssignments).not.toHaveBeenCalled()
    expect(reads.listMyRunsForAssignments).not.toHaveBeenCalled()
    expect(reads.listPackages).not.toHaveBeenCalled()
  })

  it('gives the Platform Admin every panel', async () => {
    await renderHome(me('admin'))

    expect(panels()).toEqual([
      enUS['home.runsTitle'],
      enUS['home.reviewTitle'],
      enUS['home.packagesTitle'],
      enUS['home.coursesTitle'],
    ])
  })

  it('draws the runs panel for a person with no membership, whose empty state is the invitation', async () => {
    await renderHome(me('instructor', { member: false }))

    expect(heading('home.runsTitle')).toBeInTheDocument()
    expect(screen.getByText(enUS['home.noMembershipsTitle'])).toBeInTheDocument()
  })

  it('draws no panel whose read the service refuses', async () => {
    reads.getQueue.mockRejectedValue(new AppError('FORBIDDEN'))
    await renderHome(me('instructor'))

    expect(heading('home.reviewTitle')).not.toBeInTheDocument()
    expect(heading('home.coursesTitle')).toBeInTheDocument()
  })
})
