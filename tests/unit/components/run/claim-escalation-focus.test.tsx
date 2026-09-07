import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClaimControls } from '@/components/features/run/claim-card'
import { enUS } from '@/lib/i18n/en-US'
import type { ClaimView } from '@/server/modules/reliance/schema'

// UI-023's escalation, and where the caret goes when the answer arrives (FR-090, FR-210,
// WCAG 2.2 AA §2.4.3, D-500).
//
// Sending an escalation is the one act on this screen that closes a dialog *and* removes the
// control the dialog would hand focus back to: "Escalate" is drawn only while the claim has no
// escalation, so the trigger and the dialog go in the same commit. Base UI's own restore has
// nowhere to land, the caret falls to `document.body`, and from there WebKit's Tab moves nothing at
// all — on the workspace, under a clock, with the Decision Lock still to press. The colleague's
// reply is what the press produced and what five minutes of the run bought, so that is where the
// caret goes.

const RUN_ID = '9f6ab2f8-9f14-4f6f-a3a0-64f1f3a1a040'
const CLAIM_ID = '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e40'
const STATEMENT = 'I cannot tell from the room whether the payback figure was ever recomputed.'
const REPLY = 'Nothing in the room dates that figure after the board deck.'

const actions = vi.hoisted(() => ({
  setStanceAction: vi.fn(),
  runActionAction: vi.fn(),
  escalateAction: vi.fn(),
}))
const router = vi.hoisted(() => ({ refresh: vi.fn() }))

// The real module drags the reliance service and the database into jsdom.
vi.mock('@/server/modules/reliance/actions', () => actions)
vi.mock('next/navigation', () => ({ useRouter: () => router }))

const CLAIM: ClaimView = {
  id: CLAIM_ID,
  key: 'C3',
  text: 'Month-three retention on the premium pilot is 78 percent.',
  surfacedBy: 'delegation',
  surfacedAt: '2026-09-05T10:00:00.000Z',
  inTurnWindow: false,
  stance: null,
  previousStance: null,
  stanceSetAt: null,
  actions: [],
  availableActions: [],
  escalation: null,
  canEscalate: true,
  remainingEscalations: 2,
  usedMarked: false,
  reliedOn: false,
}

describe('ClaimControls escalation (UI-023, FR-090)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actions.escalateAction.mockResolvedValue({
      ok: true,
      data: {
        statement: STATEMENT,
        responseText: REPLY,
        clockCostMs: 300_000,
        remainingEscalations: 1,
      },
    })
  })

  it('puts the caret on the colleague’s reply, rather than dropping it with the trigger', async () => {
    const user = userEvent.setup()
    render(<ClaimControls runId={RUN_ID} claim={CLAIM} canWrite />)

    await user.click(
      screen.getByRole('button', {
        name: enUS['workspace.escalateFor'].replace('{key}', 'C3'),
      }),
    )
    await user.type(await screen.findByRole('textbox'), STATEMENT)
    await user.click(screen.getByRole('button', { name: enUS['workspace.escalateSubmit'] }))

    // The answer is on screen, the trigger is gone, and the caret is on the answer.
    expect(await screen.findByText(REPLY)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: enUS['workspace.escalateFor'].replace('{key}', 'C3'),
      }),
    ).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('region', { name: enUS['workspace.escalationTitle'] })).toHaveFocus()
    })
  })
})
