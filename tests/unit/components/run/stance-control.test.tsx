import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RunWorkProvider } from '@/components/features/run/run-work-context'
import { StanceControl } from '@/components/features/run/stance-control'
import { enUS } from '@/lib/i18n/en-US'
import type { ClaimView } from '@/server/modules/reliance/schema'

// UI-023's stance control (FR-080, FR-085). Three things it has to get right, and the step names
// the first two:
//
//   * **it is a radio group**, so it is one tab stop and the arrow keys move and select inside it —
//     which is what a keyboard user expects of five chips and what a hand-written group is easy to
//     get wrong;
//   * **the previous stance is shown after a change** (FR-085), because both stances are kept and a
//     student who re-thought a claim should be able to see that they did;
//   * and **nothing on it says what the claim deserved**. The five options are the five stances in
//     06 §3.3's order on every claim, with no default, no recommendation and no mark — the
//     assertions below pin the order and the absence of a pre-selected option, which is where a
//     hint would have to live if there were one.

const RUN_ID = '9f6ab2f8-9f14-4f6f-a3a0-64f1f3a1a001'
const CLAIM_ID = '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f'

const actions = vi.hoisted(() => ({ setStanceAction: vi.fn() }))

// The real module drags the reliance service and the database into jsdom.
vi.mock('@/server/modules/reliance/actions', () => ({ setStanceAction: actions.setStanceAction }))

const CLAIM: ClaimView = {
  id: CLAIM_ID,
  key: 'C3',
  text: 'Premium payback is about 11 months.',
  surfacedBy: 'delegation',
  surfacedAt: '2026-09-05T10:00:00.000Z',
  inTurnWindow: false,
  stance: null,
  previousStance: null,
  stanceSetAt: null,
  actions: [],
  availableActions: ['source_trace'],
  escalation: null,
  canEscalate: true,
  remainingEscalations: 2,
  usedMarked: false,
  reliedOn: false,
}

/** The claim as the server answers it after a stance is recorded (FR-080, FR-085). */
const answered = (
  stance: ClaimView['stance'],
  previous: ClaimView['previousStance'],
): ClaimView => ({
  ...CLAIM,
  stance,
  previousStance: previous,
  stanceSetAt: '2026-09-05T10:05:00.000Z',
})

const group = () =>
  screen.getByRole('radiogroup', {
    name: enUS['workspace.stanceLegendFor'].replace('{key}', CLAIM.key),
  })

const chip = (label: string) => screen.getByRole('radio', { name: label })

/**
 * The control inside the screen's announcer, which is where every claim act now speaks (D-314).
 *
 * The provider is what the workspace wraps its working column in; a control rendered outside one
 * still works and says nothing, which is what the Turn's read-only record and the reviewer's replay
 * want. Here it is present, so the assertions can read the one region the screen owns.
 */
function renderControl(claim: ClaimView = CLAIM, canWrite = true) {
  render(
    <RunWorkProvider>
      <StanceControl runId={RUN_ID} claim={claim} canWrite={canWrite} />
    </RunWorkProvider>,
  )
  return userEvent.setup()
}

describe('StanceControl (UI-023, FR-080, FR-085)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actions.setStanceAction.mockResolvedValue({ ok: true, data: answered('verify', null) })
  })

  it('offers the five stances in the declared order, with none chosen', () => {
    renderControl()
    const options = screen.getAllByRole('radio')
    expect(options.map((option) => option.textContent)).toEqual([
      enUS['stance.accept'],
      enUS['stance.verify'],
      enUS['stance.challenge'],
      enUS['stance.reject'],
      enUS['stance.escalate'],
    ])
    // No default: a pre-selected stance would be the product taking a position for the student.
    for (const option of options) expect(option).toHaveAttribute('aria-checked', 'false')
  })

  it('is one tab stop, and the arrow keys move and select inside it', async () => {
    const user = renderControl()
    expect(group()).toBeInTheDocument()

    // Roving tabindex: exactly one chip is reachable by Tab.
    const tabbable = screen.getAllByRole('radio').filter((option) => option.tabIndex === 0)
    expect(tabbable).toHaveLength(1)
    expect(tabbable[0]).toHaveTextContent(enUS['stance.accept'])

    await user.tab()
    expect(chip(enUS['stance.accept'])).toHaveFocus()

    // Right moves to the next stance and selects it, which is what a radio group does.
    await user.keyboard('{ArrowRight}')
    expect(chip(enUS['stance.verify'])).toHaveFocus()
    await waitFor(() => {
      expect(actions.setStanceAction).toHaveBeenCalledWith({
        runId: RUN_ID,
        claimId: CLAIM_ID,
        stance: 'verify',
      })
    })
    await waitFor(() => {
      expect(chip(enUS['stance.verify'])).toHaveAttribute('aria-checked', 'true')
    })
  })

  it('wraps at the ends and reaches both with Home and End', async () => {
    const user = renderControl()
    await user.tab()
    await user.keyboard('{End}')
    expect(chip(enUS['stance.escalate'])).toHaveFocus()
    await user.keyboard('{Home}')
    expect(chip(enUS['stance.accept'])).toHaveFocus()
    // Left from the first wraps to the last, so the group has no dead end.
    await user.keyboard('{ArrowLeft}')
    expect(chip(enUS['stance.escalate'])).toHaveFocus()
  })

  it('shows the stance it replaced once the change has been recorded (FR-085)', async () => {
    const changed = enUS['workspace.stanceChanged'].replace('{stance}', enUS['stance.verify'])
    actions.setStanceAction.mockResolvedValue({ ok: true, data: answered('challenge', 'verify') })

    // The claim arrives with a stance and no previous one; nothing says "changed from" yet.
    const user = renderControl(answered('verify', null))
    expect(screen.queryByText(changed)).not.toBeInTheDocument()

    await user.click(chip(enUS['stance.challenge']))

    await waitFor(() => {
      expect(screen.getByText(changed)).toBeInTheDocument()
    })
    expect(chip(enUS['stance.challenge'])).toHaveAttribute('aria-checked', 'true')
    // And the mark on the stance that was replaced is a fact about the record, not a warning: the
    // chip for it is not selected any more.
    expect(chip(enUS['stance.verify'])).toHaveAttribute('aria-checked', 'false')
  })

  it('puts the previous stance back when the server refuses, and says so', async () => {
    actions.setStanceAction.mockResolvedValue({
      ok: false,
      error: { code: 'RUN_PAUSED', message: 'The run is paused.', requestId: 'r1' },
    })
    const user = renderControl(answered('accept', null))

    await user.click(chip(enUS['stance.reject']))

    // The refusal stands beside the control that refused, and is said once into the screen's one
    // polite region rather than into a fourteenth live region of this card's own (D-314).
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('The run is paused.')
    })
    expect(screen.getByText('The run is paused.', { selector: 'p.text-red' })).toBeInTheDocument()
    expect(chip(enUS['stance.accept'])).toHaveAttribute('aria-checked', 'true')
    expect(chip(enUS['stance.reject'])).toHaveAttribute('aria-checked', 'false')
  })

  it('refuses to write while the run is paused, and keeps the control reachable', async () => {
    const user = renderControl(CLAIM, false)
    expect(screen.getByText(enUS['workspace.stanceClosed'])).toBeInTheDocument()

    await user.click(chip(enUS['stance.accept']))
    expect(actions.setStanceAction).not.toHaveBeenCalled()
    // `aria-disabled`, never `disabled`: the chip keeps its focus and its reason while refusing.
    expect(chip(enUS['stance.accept'])).toHaveAttribute('aria-disabled', 'true')
  })
})
