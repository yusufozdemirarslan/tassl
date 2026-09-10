import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RunTurnPage from '@/app/(app)/runs/[runId]/turn/page'
import type { SessionUser } from '@/server/auth/types'
import type { RunStatus, RunWorkspace, TurnView } from '@/server/modules/runs'

// UI-025, the Turn window (FR-110 to FR-115). FR-061 puts the outside-tool declaration on every
// working-period screen, and the window is one: the room and the assistant are open again. The
// workspace drew the control and this screen did not, so a student who reached for another tool
// during the twelve minutes had nowhere to say so.

const RUN_ID = '9f6ab2f8-9f14-4f6f-a3a0-64f1f3a1a025'
const ASSIGNMENT_ID = '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e25'

const ACTOR: SessionUser = {
  id: 'user_1',
  email: 'lena@example.edu',
  name: 'Lena',
  emailVerified: true,
  activeOrganizationId: 'org_1',
  platformRole: 'none',
}

const status = {
  run: {
    id: RUN_ID,
    assignmentId: ASSIGNMENT_ID,
    state: 'turn_open',
    links: { next: `/runs/${RUN_ID}/turn` },
    timestamps: { turnDeliveredAt: '2026-09-05T10:20:00.000Z' },
  },
  underReview: false,
} as unknown as RunStatus

const turn = {
  run: status.run,
  text: 'The roastery has withdrawn the premium fulfillment quote.',
  voice: 'supplier_notice',
  windowEndsAt: '2026-09-05T10:32:00.000Z',
  remainingMs: 600_000,
  frozen: { frame: null, brief: null },
  namedFields: [],
} as unknown as TurnView

const workspace = {
  run: status.run,
  documents: [],
  openDocuments: [],
  pause: null,
  capabilities: { assistantUnlocked: true, canOpenDocuments: true, canWriteBrief: false },
} as unknown as RunWorkspace

vi.mock('@/app/(app)/viewer', () => ({ getViewer: async () => ({ actor: ACTOR }) }))
vi.mock('@/app/(app)/runs/[runId]/run-view', () => ({
  getRunView: async () => ({ status, assignmentLabel: 'Decision Run 1' }),
}))
vi.mock('@/server/modules/admin', () => ({ effectiveAssistantMode: async () => 'mock' }))
vi.mock('@/server/modules/reliance', () => ({ listRunClaims: async () => [] }))
vi.mock('@/server/modules/runs', () => ({
  getTurn: async () => turn,
  getRunWorkspace: async () => workspace,
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`)
  },
}))

// The panels arrive through `next/dynamic`; what this test is about is which of them the page
// asks for and with what, so each is a marker that reports its props.
vi.mock('@/components/features/run/deferred-panels', () => ({
  AssistantPanel: () => <div data-testid="assistant-panel" />,
  ClaimCard: () => <div data-testid="claim-card" />,
  ClaimControls: () => <div data-testid="claim-controls" />,
  TurnPanel: () => <div data-testid="turn-panel" />,
  DeclarationControl: ({ runId }: { runId: string }) => (
    <section aria-label="declaration-stub" data-run-id={runId} />
  ),
}))
vi.mock('@/components/features/run/evidence-room', () => ({
  EvidenceRoom: () => <div data-testid="evidence-room" />,
}))
vi.mock('@/components/features/run/paused-overlay', () => ({
  PausedOverlay: () => <div data-testid="paused-overlay" />,
}))
vi.mock('@/components/graphs/frame-beside-decision', () => ({
  FrameBesideDecision: () => <div data-testid="frame-beside-decision" />,
}))

describe('RunTurnPage (UI-025, FR-061)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('draws the outside-tool declaration for this run, beside the reopened assistant', async () => {
    render(
      await RunTurnPage({
        params: Promise.resolve({ runId: RUN_ID }),
        searchParams: Promise.resolve({}),
      }),
    )

    const declaration = screen.getByLabelText('declaration-stub')
    expect(declaration).toHaveAttribute('data-run-id', RUN_ID)
    // In the reference column, after the assistant it sits beside on the workspace.
    const aside = screen.getByRole('complementary')
    expect(aside).toContainElement(declaration)
    const assistant = screen.getByTestId('assistant-panel')
    expect(assistant.compareDocumentPosition(declaration) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })
})
