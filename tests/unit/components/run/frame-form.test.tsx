import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FrameForm } from '@/components/features/run/frame-form'
import { enUS } from '@/lib/i18n/en-US'

// UI-023's frame (FR-040 to FR-043). Two things this form has to get right, and the step names both:
// the word limits, live and on the same count the server refuses on (D-075), and the confidence
// slider and number staying one value rather than two that agree most of the time.
//
// A third is here because it is what makes the first two matter: the lock is irreversible, so a
// frame that breaks a rule must not reach the confirmation dialog at all, and the dialog that does
// open has to say that it is permanent and that the assistant unlocks with it.

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
const actions = vi.hoisted(() => ({ lockFrameAction: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: router.push,
    refresh: router.refresh,
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
}))

// The real module drags the runs service and the database into jsdom.
vi.mock('@/server/modules/runs/actions', () => ({ lockFrameAction: actions.lockFrameAction }))

/** `n` distinct words, so `countWords` sees exactly `n` and nothing collapses. */
const words = (n: number): string => Array.from({ length: n }, (_, index) => `w${index}`).join(' ')

const limitMessage = (limit: number): string =>
  enUS['workspace.wordLimit'].replace('{limit}', String(limit))

const countText = (count: number, limit: number): string =>
  enUS['workspace.wordCount'].replace('{count}', String(count)).replace('{limit}', String(limit))

const assumptionLabel = (number: number): string =>
  enUS['workspace.assumptionLabel'].replace('{number}', String(number))

const decisionBox = () => screen.getByLabelText(enUS['workspace.decisionLabel'])
const assumptionBox = (number: number) => screen.getByLabelText(assumptionLabel(number))
const positionBox = () => screen.getByLabelText(enUS['workspace.positionLabel'])
const slider = () => screen.getByRole('slider', { name: enUS['workspace.confidenceSlider'] })
const numberBox = () => screen.getByRole('spinbutton', { name: enUS['workspace.confidenceNumber'] })
const lockButton = () => screen.getByRole('button', { name: enUS['workspace.lock'] })

const valueOf = (element: HTMLElement): string => (element as HTMLInputElement).value

function type(element: HTMLElement, value: string): void {
  fireEvent.change(element, { target: { value } })
}

/** A frame that satisfies every rule in FR-040, so only the field under test is ever at fault. */
function fillValidFrame(): void {
  type(decisionBox(), 'Keep the current retention programme and fund one more quarter of it.')
  type(assumptionBox(1), 'Churn is measured monthly on active seats.')
  type(assumptionBox(2), 'The survey sample represents the paying cohort.')
  type(assumptionBox(3), 'No competitor changes price inside the quarter.')
  type(positionBox(), 'I lean towards keeping it, because the cost of stopping now is higher.')
}

function renderForm() {
  render(<FrameForm runId="run-1" />)
  return userEvent.setup()
}

describe('FrameForm (UI-023, FR-040)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actions.lockFrameAction.mockResolvedValue({
      ok: true,
      data: { id: 'run-1', state: 'working' },
    })
  })

  it('counts words while they are typed, on the count the server refuses on', () => {
    renderForm()
    expect(screen.getByText(countText(0, 50))).toBeInTheDocument()

    type(decisionBox(), words(12))
    expect(screen.getByText(countText(12, 50))).toBeInTheDocument()
    expect(decisionBox()).not.toHaveAttribute('aria-invalid')
  })

  it('refuses the decision on the word that takes it past fifty', () => {
    renderForm()
    type(decisionBox(), words(50))
    expect(screen.getByText(countText(50, 50))).toBeInTheDocument()
    expect(screen.queryByText(limitMessage(50))).not.toBeInTheDocument()

    type(decisionBox(), words(51))
    expect(screen.getByText(limitMessage(50))).toBeInTheDocument()
    expect(decisionBox()).toHaveAttribute('aria-invalid', 'true')
  })

  it('refuses the position past one hundred words', () => {
    renderForm()
    type(positionBox(), words(101))
    expect(screen.getByText(limitMessage(100))).toBeInTheDocument()
    expect(positionBox()).toHaveAttribute('aria-invalid', 'true')
  })

  // The refusal has to land on the assumption that caused it: three fields share one limit, and
  // "an assumption is too long" would leave the student reading all three.
  it('refuses one assumption past twenty-five words and leaves the other two alone', () => {
    renderForm()
    type(assumptionBox(2), words(26))

    expect(assumptionBox(2)).toHaveAttribute('aria-invalid', 'true')
    expect(assumptionBox(2)).toHaveAttribute(
      'aria-describedby',
      expect.stringContaining('frame-assumption-1-error'),
    )
    expect(assumptionBox(1)).not.toHaveAttribute('aria-invalid')
    expect(assumptionBox(3)).not.toHaveAttribute('aria-invalid')
    expect(screen.getAllByText(limitMessage(25))).toHaveLength(1)
  })

  it('does not reach the lock while a field is over its limit', async () => {
    const user = renderForm()
    fillValidFrame()
    type(decisionBox(), words(51))

    await user.click(lockButton())

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(actions.lockFrameAction).not.toHaveBeenCalled()
  })

  it('names every empty field rather than locking an unfinished frame', async () => {
    const user = renderForm()
    await user.click(lockButton())

    await waitFor(() => {
      expect(screen.getAllByText(enUS['workspace.requiredField'])).toHaveLength(5)
    })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(actions.lockFrameAction).not.toHaveBeenCalled()
  })

  // The slider and the number are one value. Either control moves it, and the other shows it.
  it('keeps the confidence slider and the number in step, in both directions', () => {
    renderForm()
    expect(valueOf(slider())).toBe('50')
    expect(valueOf(numberBox())).toBe('50')

    fireEvent.change(slider(), { target: { value: '80' } })
    expect(valueOf(numberBox())).toBe('80')
    expect(valueOf(slider())).toBe('80')

    type(numberBox(), '30')
    expect(valueOf(slider())).toBe('30')
    expect(valueOf(numberBox())).toBe('30')

    type(numberBox(), '0')
    expect(valueOf(slider())).toBe('0')
  })

  // A half-typed number is not a position on a track: the slider holds where it was rather than
  // jumping to a value nobody chose, and what is locked is always what the box says.
  it('holds the slider still while the number is being retyped', () => {
    renderForm()
    fireEvent.change(slider(), { target: { value: '70' } })
    type(numberBox(), '')
    expect(valueOf(slider())).toBe('70')
    expect(valueOf(numberBox())).toBe('')
  })

  it('refuses a confidence outside nought to one hundred', async () => {
    const user = renderForm()
    fillValidFrame()
    type(numberBox(), '140')
    await user.click(lockButton())

    await waitFor(() => {
      expect(screen.getByText(enUS['workspace.confidenceInvalid'])).toBeInTheDocument()
    })
    expect(actions.lockFrameAction).not.toHaveBeenCalled()
  })

  it('says the lock is permanent and that the assistant unlocks with it, before locking', async () => {
    const user = renderForm()
    fillValidFrame()
    fireEvent.change(slider(), { target: { value: '35' } })

    await user.click(lockButton())

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(enUS['workspace.lockConfirmTitle'])
    expect(dialog).toHaveTextContent(enUS['workspace.lockConfirmBody'])
    expect(actions.lockFrameAction).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: enUS['workspace.lockConfirm'] }))

    await waitFor(() => {
      expect(actions.lockFrameAction).toHaveBeenCalledWith({
        runId: 'run-1',
        decision: 'Keep the current retention programme and fund one more quarter of it.',
        assumptions: [
          'Churn is measured monthly on active seats.',
          'The survey sample represents the paying cohort.',
          'No competitor changes price inside the quarter.',
        ],
        position: 'I lean towards keeping it, because the cost of stopping now is higher.',
        confidence: 35,
      })
    })
    expect(router.refresh).toHaveBeenCalled()
  })

  // 10 §6: `FRAME_INVALID` carries `details.field`, so the refusal lands on the control that caused
  // it rather than under the button.
  it('puts a server refusal on the field the server named', async () => {
    actions.lockFrameAction.mockResolvedValue({
      ok: false,
      error: {
        code: 'FRAME_INVALID',
        message: 'The frame is not ready to lock.',
        details: { field: 'assumptions.2', reason: 'word_limit' },
        requestId: 'r1',
      },
    })

    const user = renderForm()
    fillValidFrame()
    await user.click(lockButton())
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: enUS['workspace.lockConfirm'],
      }),
    )

    await waitFor(() => {
      expect(assumptionBox(3)).toHaveAttribute('aria-invalid', 'true')
    })
    expect(screen.getByText(limitMessage(25))).toBeInTheDocument()
    expect(router.refresh).not.toHaveBeenCalled()
  })

  it('nowhere marks, scores, or rates what the student wrote (FR-041)', () => {
    renderForm()
    fillValidFrame()
    const page = (document.body.textContent ?? '').toLowerCase()
    for (const word of ['score', 'rank', 'percentile', 'grade', 'good', 'strong', 'weak']) {
      expect(page).not.toContain(word)
    }
  })
})
