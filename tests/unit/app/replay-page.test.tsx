import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FacultyReplayPage from '@/app/(app)/review/runs/[runId]/page'
import { enUS } from '@/lib/i18n/en-US'
import type { SessionUser } from '@/server/auth/types'
import type { ReplayBundle } from '@/server/modules/review'

// UI-033's header chip. A held run — `scoring_status = 'held'`, nothing could place its bands —
// reads "Under review" on the assignment page and on the queue, and the replay it opens onto has
// to say the same: one word for one fact wherever the reviewer meets it (FR-140).

const RUN_ID = '9f6ab2f8-9f14-4f6f-a3a0-64f1f3a1a033'
const ASSIGNMENT_ID = '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e33'

const ACTOR: SessionUser = {
  id: 'user_1',
  email: 'ada@example.edu',
  name: 'Ada',
  emailVerified: true,
  activeOrganizationId: 'org_1',
  platformRole: 'none',
}

const replay = vi.hoisted(() => ({ current: null as unknown }))

function bundle(scoringStatus: 'held' | 'done'): ReplayBundle {
  return {
    run: {
      id: RUN_ID,
      assignmentId: ASSIGNMENT_ID,
      attemptNo: 1,
      state: 'scored',
      scoringStatus,
      studentName: 'Student One',
      variantKey: 'defective',
    },
    events: [],
    graphs: null,
    defense: [],
    bands: [],
    delegations: [],
    readiness: [],
    claims: [],
    declarations: [],
    unverifiedNumbers: [],
    neutralizations: [],
    exports: [],
    deciders: {},
    flags: {},
    observations: [],
    labels: { uncalibrated: true, isWalkthrough: false },
    capabilities: {
      canDecide: true,
      canVoid: true,
      canNeutralize: true,
      canForceFailure: false,
      canBandManually: scoringStatus === 'held',
      canFlagDelegation: true,
      flagReachesDrafting: true,
      isInstructor: true,
    },
  } as unknown as ReplayBundle
}

vi.mock('@/app/(app)/viewer', () => ({ getViewer: async () => ({ actor: ACTOR }) }))
vi.mock('@/server/modules/review', () => ({ getReplay: async () => replay.current }))
// The replay's controls are client components whose presses are Server Actions.
vi.mock('@/server/modules/review/actions', () => ({
  confirmRemainingAction: vi.fn(),
  decideBandAction: vi.fn(),
  flagDelegationAction: vi.fn(),
  bandHeldRunManuallyAction: vi.fn(),
  neutralizeClaimAction: vi.fn(),
  forceAssistantFailureAction: vi.fn(),
  voidRunAction: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => `/review/runs/${RUN_ID}`,
  useParams: () => ({ runId: RUN_ID }),
}))

async function renderReplay(scoringStatus: 'held' | 'done') {
  replay.current = bundle(scoringStatus)
  render(
    await FacultyReplayPage({
      params: Promise.resolve({ runId: RUN_ID }),
      searchParams: Promise.resolve({ tab: 'trace' }),
    }),
  )
}

describe('FacultyReplayPage header (UI-033, FR-140)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads "Under review" on a held run', async () => {
    await renderReplay('held')

    const chip = screen.getByText(enUS['run.stateUnderReview'])
    expect(chip.closest('[data-state]')).toHaveAttribute('data-state', 'under_review')
    expect(screen.queryByText(enUS['run.stateScored'])).not.toBeInTheDocument()
  })

  it('reads the state word once the bands have been drafted', async () => {
    await renderReplay('done')

    const chip = screen.getByText(enUS['run.stateScored'])
    expect(chip.closest('[data-state]')).toHaveAttribute('data-state', 'scored')
    expect(screen.queryByText(enUS['run.stateUnderReview'])).not.toBeInTheDocument()
  })
})
