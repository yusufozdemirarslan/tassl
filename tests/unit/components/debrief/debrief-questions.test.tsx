import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DebriefQuestions } from '@/components/features/debrief/debrief-questions'
import { enUS } from '@/lib/i18n/en-US'

// UI-028's two questions (FR-152), and what happens to the caret when they are filed.
//
// The press revalidates the route and the *server* render is what replaces the form with the two
// answers — so the button that was pressed is removed by the act it performed, with no navigation
// to follow it: `/runs/[runId]/debrief` is the same path before and after, so
// `use-focus-on-route-change.ts` never fires. Without a destination of its own the caret is dropped
// on `document.body`, from which WebKit's Tab moves nothing at all. It is the last act of a run, so
// nothing downstream noticed it (D-500, FR-210, WCAG 2.2 AA §2.4.3).

const RUN_ID = '9f6ab2f8-9f14-4f6f-a3a0-64f1f3a1a030'
const STANCE = 'I would challenge the payback figure, because nothing dates it after the deck.'
const DIFFERENT = 'I would run a Source Trace on every figure the recommendation rests on.'

const actions = vi.hoisted(() => ({ answerDebriefAction: vi.fn() }))
const router = vi.hoisted(() => ({ refresh: vi.fn() }))

// The real module drags the debrief service and `server-only` into jsdom.
vi.mock('@/server/modules/debrief/actions', () => ({
  answerDebriefAction: actions.answerDebriefAction,
}))
vi.mock('next/navigation', () => ({ useRouter: () => router }))

const stanceBox = () => screen.getByLabelText(enUS['debrief.questions.stanceToChange.label'])
const differentBox = () => screen.getByLabelText(enUS['debrief.questions.doDifferently.label'])
const fileButton = () => screen.getByRole('button', { name: enUS['debrief.questions.submit'] })
const filedHeading = () =>
  screen.getByRole('heading', { name: enUS['debrief.questions.stanceToChange.label'] })

/** The unfiled form, and the answered pair the server render replaces it with. */
const props = (answered: boolean) => ({
  runId: RUN_ID,
  answered,
  canAnswer: !answered,
  stanceToChange: answered ? STANCE : null,
  doDifferently: answered ? DIFFERENT : null,
  answeredAt: answered ? '2026-09-05T10:00:00.000Z' : null,
})

describe('DebriefQuestions (UI-028, FR-152)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actions.answerDebriefAction.mockResolvedValue({ ok: true, data: null })
  })

  it('files the pair the student wrote, and asks the route for the render that replaces it', async () => {
    const user = userEvent.setup()
    render(<DebriefQuestions {...props(false)} />)

    await user.type(stanceBox(), STANCE)
    await user.type(differentBox(), DIFFERENT)
    await user.click(fileButton())

    await waitFor(() => {
      expect(actions.answerDebriefAction).toHaveBeenCalledWith({
        runId: RUN_ID,
        stanceToChange: STANCE,
        doDifferently: DIFFERENT,
      })
    })
    expect(router.refresh).toHaveBeenCalled()
  })

  it('puts the caret on the first filed answer when the form is replaced', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<DebriefQuestions {...props(false)} />)

    await user.type(stanceBox(), STANCE)
    await user.type(differentBox(), DIFFERENT)
    await user.click(fileButton())
    await waitFor(() => {
      expect(router.refresh).toHaveBeenCalled()
    })

    // What `router.refresh()` brings back: the answered pair, in place of the form.
    rerender(<DebriefQuestions {...props(true)} />)

    await waitFor(() => {
      expect(filedHeading()).toHaveFocus()
    })
  })

  it('leaves the caret where a reader put it while the write was in flight', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <>
        <DebriefQuestions {...props(false)} />
        <button type="button">Somewhere else on the page</button>
      </>,
    )
    const elsewhere = screen.getByRole('button', { name: 'Somewhere else on the page' })

    await user.type(stanceBox(), STANCE)
    await user.type(differentBox(), DIFFERENT)
    await user.click(fileButton())
    await waitFor(() => {
      expect(router.refresh).toHaveBeenCalled()
    })

    // The reader did not wait for the render: they read on down the debrief.
    elsewhere.focus()
    rerender(
      <>
        <DebriefQuestions {...props(true)} />
        <button type="button">Somewhere else on the page</button>
      </>,
    )

    expect(elsewhere).toHaveFocus()
  })
})
