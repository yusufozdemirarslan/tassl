import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import HomePage from '@/app/(app)/home/page'
import { enUS } from '@/lib/i18n/en-US'
import type { SessionUser } from '@/server/auth/types'
import type { MeView } from '@/server/modules/identity'

// UI-009. "Your runs" is the student's panel: it is drawn for a student membership, and for the
// person with no membership at all, whose empty state is where they learn an invitation comes
// next. An instructor holding no student seat was being shown "Nothing to do yet" about runs they
// cannot take, which is exactly the empty box the page's own rule forbids.

const viewer = vi.hoisted(() => ({ me: null as unknown }))
const reads = vi.hoisted(() => ({
  listMyAssignments: vi.fn(),
  listMyRuns: vi.fn(),
  getQueue: vi.fn(),
  listPackages: vi.fn(),
  listCourses: vi.fn(),
}))

const ACTOR: SessionUser = {
  id: 'user_1',
  email: 'lena@example.edu',
  name: 'Lena',
  emailVerified: true,
  activeOrganizationId: 'org_1',
  platformRole: 'none',
}

vi.mock('@/app/(app)/viewer', () => ({
  getViewer: async () => ({ actor: ACTOR, me: viewer.me }),
}))
vi.mock('@/server/modules/courses', () => ({
  listCourses: reads.listCourses,
  listMyAssignments: reads.listMyAssignments,
}))
vi.mock('@/server/modules/review', () => ({ getQueue: reads.getQueue }))
vi.mock('@/server/modules/runs', () => ({ listMyRuns: reads.listMyRuns }))
vi.mock('@/server/modules/scenarios', () => ({ listPackages: reads.listPackages }))
// The runs list is a client component whose Start control is a Server Action.
vi.mock('@/server/modules/runs/actions', () => ({ startRunAction: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

function me(roles: readonly MeView['memberships'][number]['role'][]): MeView {
  return {
    id: 'user_1',
    name: 'Lena',
    email: 'lena@example.edu',
    emailVerified: true,
    image: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    platformRole: 'none',
    memberships: roles.map((role, index) => ({
      organizationId: 'org_1',
      name: 'Georgetown',
      slug: 'georgetown',
      role,
      joinedAt: `2026-09-0${index + 1}T00:00:00.000Z`,
    })),
    activeOrganizationId: 'org_1',
    capabilities: {
      canTakeRuns: roles.includes('student'),
      canReviewRuns: roles.includes('instructor'),
      canAuthorPackages: roles.includes('instructor'),
      canManageInstitution: false,
      canCreateInstitution: false,
    },
  }
}

async function renderHome(view: MeView) {
  viewer.me = view
  render(await HomePage())
}

const runsHeading = () => screen.queryByRole('heading', { level: 2, name: enUS['home.runsTitle'] })

describe('HomePage panels (UI-009)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reads.listMyAssignments.mockResolvedValue({ items: [], nextCursor: null })
    reads.listMyRuns.mockResolvedValue({ items: [], nextCursor: null })
    reads.getQueue.mockResolvedValue({ illustrative: [], runs: [] })
    reads.listPackages.mockResolvedValue({ items: [], nextCursor: null })
    reads.listCourses.mockResolvedValue({ items: [], nextCursor: null })
  })

  it('draws no runs panel for an instructor who holds no student seat', async () => {
    await renderHome(me(['instructor']))

    expect(runsHeading()).not.toBeInTheDocument()
    expect(screen.queryByText(enUS['home.emptyTitle'])).not.toBeInTheDocument()
    // The two student reads are not made for a seat that has no runs.
    expect(reads.listMyAssignments).not.toHaveBeenCalled()
    expect(reads.listMyRuns).not.toHaveBeenCalled()
    // The instructor's own panels are still there.
    expect(
      screen.getByRole('heading', { level: 2, name: enUS['home.reviewTitle'] }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: enUS['home.coursesTitle'] }),
    ).toBeInTheDocument()
  })

  it('draws the runs panel for a student, with the empty state that names a course', async () => {
    await renderHome(me(['student']))

    expect(runsHeading()).toBeInTheDocument()
    expect(screen.getByText(enUS['home.emptyTitle'])).toBeInTheDocument()
    expect(reads.listMyAssignments).toHaveBeenCalled()
  })

  it('draws it for a person with no membership, whose empty state is the invitation', async () => {
    await renderHome({ ...me([]), activeOrganizationId: null })

    expect(runsHeading()).toBeInTheDocument()
    expect(screen.getByText(enUS['home.noMembershipsTitle'])).toBeInTheDocument()
  })

  it('keeps it for a person who is both instructor and student', async () => {
    await renderHome(me(['instructor', 'student']))

    expect(runsHeading()).toBeInTheDocument()
  })
})
