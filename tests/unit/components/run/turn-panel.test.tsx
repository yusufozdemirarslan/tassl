import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RunWorkProvider } from '@/components/features/run/run-work-context'
import { TurnPanel } from '@/components/features/run/turn-panel'
import { enUS } from '@/lib/i18n/en-US'

// UI-025's response form (FR-112, FR-113). Three things it has to get right, and the step names the
// first two:
//
//   * **the three options are there, defined, and none of them is preselected** — a default would be
//     a recommendation, and `warrants_change` and `proportionate_response` are precisely what this
//     response is measured against (D-336);
//   * **the refusal names the claim** in the words the student already read on its card (FR-111,
//     D-306), and offers the way back to it;
//   * and **nothing on it says what the Turn deserves**. The assertions below pin the absence of a
//     preselected option and sweep the rendered text for the vocabulary a hint would have to use.

const RUN_ID = '9f6ab2f8-9f14-4f6f-a3a0-64f1f3a1a010'
const CLAIM_ID = '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e70'
const CLAIM_TEXT = 'Premium payback is about 11 months.'

const actions = vi.hoisted(() => ({ respondToTurnAction: vi.fn() }))
const router = vi.hoisted(() => ({ refresh: vi.fn() }))

// The real modules drag the runs service and the database into jsdom.
vi.mock('@/server/modules/runs/actions', () => ({
  respondToTurnAction: actions.respondToTurnAction,
}))
vi.mock('next/navigation', () => ({ useRouter: () => router }))

const CLAIMS = [{ id: CLAIM_ID, text: CLAIM_TEXT }]

/** The panel inside the screen's announcer, which is what the arrival is spoken through (D-347). */
function renderPanel() {
  return render(
    <RunWorkProvider>
      <TurnPanel runId={RUN_ID} claims={CLAIMS} />
    </RunWorkProvider>,
  )
}

const option = (label: string) => screen.getByRole('radio', { name: new RegExp(label) })

beforeEach(() => {
  actions.respondToTurnAction.mockReset()
  router.refresh.mockReset()
})

describe('TurnPanel', () => {
  it('offers hold, revise and reverse with a plain description and no default', () => {
    renderPanel()

    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(3)
    for (const radio of radios) expect(radio).toHaveAttribute('aria-checked', 'false')

    expect(screen.getByText(enUS['turn.responseHold'])).toBeInTheDocument()
    expect(screen.getByText(enUS['turn.responseHoldDescription'])).toBeInTheDocument()
    expect(screen.getByText(enUS['turn.responseRevise'])).toBeInTheDocument()
    expect(screen.getByText(enUS['turn.responseReviseDescription'])).toBeInTheDocument()
    expect(screen.getByText(enUS['turn.responseReverse'])).toBeInTheDocument()
    expect(screen.getByText(enUS['turn.responseReverseDescription'])).toBeInTheDocument()
  })

  it('says nothing about which response the Turn calls for', () => {
    const { container } = renderPanel()
    const spoken = (container.textContent ?? '').toLowerCase()
    for (const word of ['recommend', 'should', 'warrant', 'correct', 'proportionate', 'expected']) {
      expect(spoken, `the response form must not say "${word}"`).not.toContain(word)
    }
  })

  it('refuses an empty form without asking the server', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole('button', { name: enUS['turn.submit'] }))

    expect(await screen.findByText(enUS['turn.responseRequired'])).toBeInTheDocument()
    expect(screen.getByText(enUS['turn.justificationRequired'])).toBeInTheDocument()
    expect(screen.getByText(enUS['turn.confidenceInvalid'])).toBeInTheDocument()
    expect(actions.respondToTurnAction).not.toHaveBeenCalled()
  })

  it('files the response the student chose, with the justification and the confidence', async () => {
    const user = userEvent.setup()
    actions.respondToTurnAction.mockResolvedValue({ ok: true, data: { id: RUN_ID } })
    renderPanel()

    await user.click(option(enUS['turn.responseRevise']))
    await user.type(
      screen.getByLabelText(enUS['turn.justificationLabel']),
      'The retention figure the payback rested on has been corrected, so the share moves.',
    )
    await user.type(screen.getByLabelText(enUS['turn.confidenceLabel']), '48')
    await user.click(screen.getByRole('button', { name: enUS['turn.submit'] }))

    await waitFor(() => {
      expect(actions.respondToTurnAction).toHaveBeenCalledWith({
        runId: RUN_ID,
        response: 'revise',
        justification:
          'The retention figure the payback rested on has been corrected, so the share moves.',
        confidence: 48,
      })
    })
  })

  it('names the claim when the response is refused for an unstanced window claim', async () => {
    const user = userEvent.setup()
    actions.respondToTurnAction.mockResolvedValue({
      ok: false,
      error: {
        code: 'TURN_CLAIMS_UNSTANCED',
        message: enUS['run.turnClaimsUnstanced'],
        details: { claimIds: [CLAIM_ID] },
        requestId: 'req_turn_1',
      },
    })
    renderPanel()

    await user.click(option(enUS['turn.responseHold']))
    await user.type(
      screen.getByLabelText(enUS['turn.justificationLabel']),
      'Nothing in the message moves the number the decision rests on.',
    )
    await user.type(screen.getByLabelText(enUS['turn.confidenceLabel']), '55')
    await user.click(screen.getByRole('button', { name: enUS['turn.submit'] }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(CLAIM_TEXT)
    expect(alert).toHaveTextContent('req_turn_1')
    expect(screen.getByRole('button', { name: enUS['turn.goToClaim'] })).toBeInTheDocument()
    // The refusal writes nothing, so what the student typed is still in the box (D-293).
    expect(screen.getByLabelText(enUS['turn.justificationLabel'])).toHaveValue(
      'Nothing in the message moves the number the decision rests on.',
    )
  })

  it('counts the words the server will count and marks the field over the limit', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.type(screen.getByLabelText(enUS['turn.justificationLabel']), 'one two three')

    expect(
      screen.getByText(
        enUS['turn.justificationWordCount'].replace('{count}', '3').replace('{limit}', '150'),
      ),
    ).toBeInTheDocument()
  })

  it('announces the Turn’s arrival through the screen’s one polite region', async () => {
    renderPanel()
    const announcer = document.getElementById('run-announcer')
    await waitFor(() => {
      expect(announcer).toHaveTextContent(enUS['turn.arrived'])
    })
  })
})
