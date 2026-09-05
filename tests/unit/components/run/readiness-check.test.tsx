import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReadinessCheck } from '@/components/features/run/readiness-check'
import { enUS } from '@/lib/i18n/en-US'
import type { ReadinessItemView } from '@/server/modules/runs/schema'

// UI-022 (FR-010 to FR-018). Four things this screen has to get right and one it must never do.
//
// The one it must never do is tell a student whether an answer was right: correctness is computed
// on the server and never returned, so nothing the item view carries can mark an option, and the
// last test here holds that shut by refusing anything the four options do not say.

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
const actions = vi.hoisted(() => ({
  answerReadinessItemAction: vi.fn(),
  submitReadinessAction: vi.fn(),
  skipReadinessAction: vi.fn(),
}))

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

// Server Actions: importing the real module drags the runs service and the database into jsdom.
vi.mock('@/server/modules/runs/actions', () => ({
  answerReadinessItemAction: actions.answerReadinessItemAction,
  submitReadinessAction: actions.submitReadinessAction,
  skipReadinessAction: actions.skipReadinessAction,
}))

const OPTIONS = [
  { key: 'a', text: 'Twelve months' },
  { key: 'b', text: 'Four point eight months' },
  { key: 'c', text: 'Twenty months' },
  { key: 'd', text: 'It cannot be computed from these two numbers' },
]

function item(position: number, answerKey: string | null = null): ReadinessItemView {
  return {
    id: `item-${position}`,
    position,
    category: 'foundation',
    stem: `Question number ${position + 1}`,
    options: OPTIONS,
    answerKey,
  }
}

/** Sixteen items, with the answers a resumed check would come back with (FR-017). */
function items(answered: readonly number[] = []): ReadinessItemView[] {
  return Array.from({ length: 16 }, (_, index) =>
    item(index, answered.includes(index) ? 'a' : null),
  )
}

function renderCheck(views: ReadinessItemView[] = items()) {
  render(<ReadinessCheck runId="run-1" items={views} remainingMs={480_000} />)
  return userEvent.setup()
}

const navigator = () => screen.getByRole('toolbar', { name: enUS['readiness.navigatorLabel'] })
const navButton = (position: number, answered: boolean) =>
  within(navigator()).getByRole('button', {
    name: (answered ? enUS['readiness.itemAnswered'] : enUS['readiness.itemUnanswered']).replace(
      '{position}',
      String(position),
    ),
  })
const stem = (position: number) => `Question number ${position}`

describe('ReadinessCheck (UI-022)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actions.answerReadinessItemAction.mockResolvedValue({ ok: true, data: undefined })
    actions.submitReadinessAction.mockResolvedValue({
      ok: true,
      data: { skipped: false, concepts: [] },
    })
  })

  it('opens sixteen items on the first one and shows the eight-minute clock', () => {
    renderCheck()
    expect(within(navigator()).getAllByRole('button')).toHaveLength(16)
    expect(screen.getByRole('group', { name: new RegExp(stem(1)) })).toBeInTheDocument()
    expect(screen.getByRole('timer', { name: enUS['readiness.timerLabel'] })).toHaveTextContent(
      '08:00',
    )
  })

  it('resumes at the first item with no answer (FR-017)', () => {
    renderCheck(items([0, 1, 2]))
    expect(screen.getByRole('group', { name: new RegExp(stem(4)) })).toBeInTheDocument()
    expect(navButton(4, false)).toHaveAttribute('aria-current', 'true')
  })

  it('moves between items with the arrow keys on the navigator', async () => {
    const user = renderCheck()
    await user.click(navButton(1, false))
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(screen.getByRole('group', { name: new RegExp(stem(3)) })).toBeInTheDocument()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('group', { name: new RegExp(stem(2)) })).toBeInTheDocument()
    await user.keyboard('{End}')
    expect(screen.getByRole('group', { name: new RegExp(stem(16)) })).toBeInTheDocument()
  })

  it('records an answer and marks the item answered in the navigator', async () => {
    const user = renderCheck()
    await user.click(screen.getByRole('radio', { name: OPTIONS[1]!.text }))

    await waitFor(() => {
      expect(actions.answerReadinessItemAction).toHaveBeenCalledWith({
        runId: 'run-1',
        itemId: 'item-0',
        answerKey: 'b',
      })
    })
    expect(navButton(1, true)).toBeInTheDocument()
    expect(
      screen.getByText(
        enUS['readiness.progress'].replace('{answered}', '1').replace('{total}', '16'),
      ),
    ).toBeInTheDocument()
  })

  it('puts the previous answer back when the write is refused', async () => {
    actions.answerReadinessItemAction.mockResolvedValue({
      ok: false,
      error: { code: 'CLOCK_EXPIRED', message: 'The Readiness Check has closed.', requestId: 'r1' },
    })
    const user = renderCheck()
    await user.click(screen.getByRole('radio', { name: OPTIONS[0]!.text }))

    await waitFor(() => {
      expect(screen.getByText('The Readiness Check has closed.')).toBeInTheDocument()
    })
    expect(screen.getByRole('radio', { name: OPTIONS[0]!.text })).not.toBeChecked()
    expect(navButton(1, false)).toBeInTheDocument()
  })

  it('confirms the submit with the unanswered count, and never with a count of anything else', async () => {
    const user = renderCheck(items([0, 1]))
    await user.click(screen.getByRole('button', { name: enUS['readiness.submit'] }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(enUS['readiness.confirmUnanswered'].replace('{count}', '14'))

    await user.click(within(dialog).getByRole('button', { name: enUS['readiness.confirmSubmit'] }))
    await waitFor(() => {
      expect(actions.submitReadinessAction).toHaveBeenCalledWith({ runId: 'run-1' })
    })
    expect(router.push).toHaveBeenCalledWith('/runs/run-1/readiness/result')
  })

  it('says every item is answered when none is left', async () => {
    const user = renderCheck(items(Array.from({ length: 16 }, (_, index) => index)))
    await user.click(screen.getByRole('button', { name: enUS['readiness.submit'] }))
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      enUS['readiness.confirmAllAnswered'],
    )
  })

  // FR-018: the skip is armed by a failure on our side, and by nothing else. The service refuses it
  // until `flags.readiness_submit_failed` is set, and that flag is set only for a 5xx.
  it('offers the skip only after a submit fails on our side', async () => {
    actions.submitReadinessAction.mockResolvedValue({
      ok: false,
      error: {
        code: 'CONFLICT',
        message: 'The Readiness Check is not open on this run.',
        requestId: 'r1',
      },
    })
    const user = renderCheck()
    await user.click(screen.getByRole('button', { name: enUS['readiness.submit'] }))
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: enUS['readiness.confirmSubmit'],
      }),
    )
    await waitFor(() => {
      expect(screen.getByText('The Readiness Check is not open on this run.')).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: enUS['readiness.skip'] })).not.toBeInTheDocument()

    actions.submitReadinessAction.mockResolvedValue({
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong on our side.',
        requestId: 'r2',
      },
    })
    await user.click(screen.getByRole('button', { name: enUS['readiness.submit'] }))
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: enUS['readiness.confirmSubmit'],
      }),
    )

    const skip = await screen.findByRole('button', { name: enUS['readiness.skip'] })
    actions.skipReadinessAction.mockResolvedValue({
      ok: true,
      data: { skipped: true, concepts: [] },
    })
    await user.click(skip)
    await waitFor(() => {
      expect(actions.skipReadinessAction).toHaveBeenCalledWith({ runId: 'run-1' })
    })
  })

  // Next and Previous change the question under a button that does not move, so focus goes to the
  // fieldset whose legend is the new question; nothing else would tell a screen reader.
  it('moves focus onto the new question when Next is pressed', async () => {
    const user = renderCheck()
    await user.click(screen.getByRole('button', { name: enUS['readiness.next'] }))
    const group = screen.getByRole('group', { name: new RegExp(stem(2)) })
    expect(group).toHaveFocus()
  })

  // The clock is the server's; when the digits reach zero the screen says the check closed itself
  // and asks for the read that makes it so (10 §8 branch 1).
  it('says the check submitted itself when the eight minutes run out', async () => {
    vi.useFakeTimers()
    render(<ReadinessCheck runId="run-1" items={items()} remainingMs={2_000} />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })

    expect(screen.getByText(enUS['readiness.expiredTitle'])).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(enUS['readiness.timerExpired'])
    expect(router.refresh).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: enUS['readiness.submit'] })).not.toBeInTheDocument()
  })

  it('shows nothing about whether an answer was right (FR-012)', async () => {
    const user = renderCheck()
    await user.click(screen.getByRole('radio', { name: OPTIONS[0]!.text }))
    await waitFor(() => {
      expect(actions.answerReadinessItemAction).toHaveBeenCalled()
    })

    const page = document.body.textContent ?? ''
    for (const word of ['correct', 'incorrect', 'wrong', 'right answer', 'score', 'points']) {
      expect(page.toLowerCase()).not.toContain(word)
    }
    // Nor is the category of the item on the screen: naming a question "defect concept" tells a
    // student what to go looking for in the Evidence Room.
    expect(page.toLowerCase()).not.toContain('defect')
  })
})
