import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DefenseInterview, DefenseQuestion } from '@/components/features/run/defense-question'
import { enUS } from '@/lib/i18n/en-US'
import type { DefenseQuestion as Question } from '@/server/modules/defense/schema'

// UI-026's interview (FR-120 to FR-126). The step names two things:
//
//   * **the follow-up appears**, beneath the question it belongs to rather than at the end of the
//     running order (D-344), and it is labelled "Follow-up" with nothing said about why it was
//     asked — the rule that fired is the instrument (D-031, D-090);
//   * **the duration is reported**, measured from the question receiving focus to the press of
//     submit, which is the client's measurement to make because the server sees one request.
//
// A third is asserted because it is the whole design of the screen: there is no assistant, no
// Evidence Room and no route to either, and no question but the current one carries a box.

const RUN_ID = '9f6ab2f8-9f14-4f6f-a3a0-64f1f3a1a020'
const Q1 = '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e01'
const Q2 = '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e02'
const FOLLOW_UP = '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e03'

const actions = vi.hoisted(() => ({
  answerDefenseQuestionAction: vi.fn(),
  completeDefenseAction: vi.fn(),
}))
const router = vi.hoisted(() => ({ refresh: vi.fn() }))

// The real modules drag the defense service and the database into jsdom.
vi.mock('@/server/modules/defense/actions', () => ({
  answerDefenseQuestionAction: actions.answerDefenseQuestionAction,
  completeDefenseAction: actions.completeDefenseAction,
}))
vi.mock('next/navigation', () => ({ useRouter: () => router }))

const question = (
  overrides: Partial<Question> & Pick<Question, 'runQuestionId' | 'seq'>,
): Question => ({
  kind: 'provenance',
  text: 'Where did the payback figure come from, and what is the date on it?',
  answered: false,
  followUpOf: null,
  answer: null,
  ...overrides,
})

const QUESTIONS: Question[] = [
  question({ runQuestionId: Q1, seq: 1 }),
  question({
    runQuestionId: Q2,
    seq: 2,
    text: 'Which cohort is that, how many subscribers, and as of when?',
  }),
]

const FOLLOW_UP_QUESTION: Question = question({
  runQuestionId: FOLLOW_UP,
  seq: 3,
  followUpOf: Q1,
  text: 'Did you check whether the document it came from had been replaced?',
})

/** The tab shelf a draft lives on (D-360), so a test can seed one and read one back. */
const draftKey = (runQuestionId: string) => `tassl.draft.defense.${RUN_ID}.${runQuestionId}`

beforeEach(() => {
  actions.answerDefenseQuestionAction.mockReset()
  actions.completeDefenseAction.mockReset()
  router.refresh.mockReset()
  sessionStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('DefenseQuestion', () => {
  it('reports the duration from the first focus in the box to the press of submit', async () => {
    const user = userEvent.setup()
    const onAnswer = vi.fn()
    render(
      <ol>
        <DefenseQuestion
          runId={RUN_ID}
          question={QUESTIONS[0] as Question}
          number={1}
          current
          onAnswer={onAnswer}
        />
      </ol>,
    )

    const box = screen.getByLabelText(enUS['defense.answerLabel'])
    await user.click(box)
    await user.type(box, 'The positioning review of February 2025.')
    await user.click(screen.getByRole('button', { name: enUS['defense.answerSubmit'] }))

    expect(onAnswer).toHaveBeenCalledTimes(1)
    const input = onAnswer.mock.calls[0]?.[0] as { text: string; durationMs: number }
    expect(input.text).toBe('The positioning review of February 2025.')
    expect(input.durationMs).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(input.durationMs)).toBe(true)
  })

  it('draws an answered question read-only, with no second box', () => {
    render(
      <ol>
        <DefenseQuestion
          runId={RUN_ID}
          question={{
            ...(QUESTIONS[0] as Question),
            answered: true,
            answer: { text: 'The board deck.', answeredAt: '2026-09-05T10:00:00.000Z' },
          }}
          number={1}
          current={false}
          onAnswer={vi.fn()}
        />
      </ol>,
    )

    expect(screen.getByText('The board deck.')).toBeInTheDocument()
    expect(screen.queryByLabelText(enUS['defense.answerLabel'])).not.toBeInTheDocument()
  })

  it('says an empty answer was empty rather than drawing a blank line', () => {
    render(
      <ol>
        <DefenseQuestion
          runId={RUN_ID}
          question={{
            ...(QUESTIONS[0] as Question),
            answered: true,
            answer: { text: '', answeredAt: '2026-09-05T10:00:00.000Z' },
          }}
          number={1}
          current={false}
          onAnswer={vi.fn()}
        />
      </ol>,
    )

    expect(screen.getByText(enUS['defense.answerEmpty'])).toBeInTheDocument()
  })
})

// D-360: the answer being written survives a reload, and nothing else about it changes. The four
// cases below are the whole contract — it comes back, it goes when the answer is filed, a filed
// answer is never offered back as editable, and a browser that refuses storage costs the student
// nothing but the safety net.
describe('DefenseQuestion drafts', () => {
  const HALF_WRITTEN = 'The positioning review of February 2025, though I want to check the date'

  function renderOpen() {
    return render(
      <ol>
        <DefenseQuestion
          runId={RUN_ID}
          question={QUESTIONS[0] as Question}
          number={1}
          current
          onAnswer={vi.fn()}
        />
      </ol>,
    )
  }

  it('puts back what was being written when the question is mounted again', async () => {
    const user = userEvent.setup()
    const first = renderOpen()
    await user.type(screen.getByLabelText(enUS['defense.answerLabel']), HALF_WRITTEN)
    first.unmount()

    renderOpen()

    const box = await screen.findByLabelText(enUS['defense.answerLabel'])
    expect(box).toHaveValue(HALF_WRITTEN)
    // The student is told, in words that promise no more than a per-tab copy is worth.
    expect(screen.getByText(enUS['defense.draftRestored'])).toBeInTheDocument()
    expect(box.getAttribute('aria-describedby')).toContain('-draft')
  })

  it('forgets the draft once the answer is filed', async () => {
    const user = userEvent.setup()
    actions.answerDefenseQuestionAction.mockResolvedValue({
      ok: true,
      data: { next: QUESTIONS[1], followUpQuestion: null },
    })
    render(<DefenseInterview runId={RUN_ID} questions={QUESTIONS} />)

    await user.type(screen.getByLabelText(enUS['defense.answerLabel']), HALF_WRITTEN)
    expect(sessionStorage.getItem(draftKey(Q1))).not.toBeNull()

    await user.click(screen.getByRole('button', { name: enUS['defense.answerSubmit'] }))

    await waitFor(() => {
      expect(screen.getByText(HALF_WRITTEN)).toBeInTheDocument()
    })
    expect(sessionStorage.getItem(draftKey(Q1))).toBeNull()
  })

  it('never offers a filed answer back as an editable draft', async () => {
    sessionStorage.setItem(draftKey(Q1), JSON.stringify(HALF_WRITTEN))

    render(
      <ol>
        <DefenseQuestion
          runId={RUN_ID}
          question={{
            ...(QUESTIONS[0] as Question),
            answered: true,
            answer: { text: 'The board deck.', answeredAt: '2026-09-05T10:00:00.000Z' },
          }}
          number={1}
          current={false}
          onAnswer={vi.fn()}
        />
      </ol>,
    )

    // The filed answer stands, there is no box, and the words that never became the answer are gone.
    expect(screen.getByText('The board deck.')).toBeInTheDocument()
    expect(screen.queryByLabelText(enUS['defense.answerLabel'])).not.toBeInTheDocument()
    expect(screen.queryByText(HALF_WRITTEN)).not.toBeInTheDocument()
    expect(screen.queryByText(enUS['defense.draftRestored'])).not.toBeInTheDocument()
    await waitFor(() => {
      expect(sessionStorage.getItem(draftKey(Q1))).toBeNull()
    })
  })

  it('leaves the form working when the browser refuses storage', async () => {
    // Private mode, "block site data", or a full quota: every one of them throws here.
    const denied = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(denied)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(denied)
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(denied)

    const user = userEvent.setup()
    const onAnswer = vi.fn()
    render(
      <ol>
        <DefenseQuestion
          runId={RUN_ID}
          question={QUESTIONS[0] as Question}
          number={1}
          current
          onAnswer={onAnswer}
        />
      </ol>,
    )

    await user.type(screen.getByLabelText(enUS['defense.answerLabel']), HALF_WRITTEN)
    await user.click(screen.getByRole('button', { name: enUS['defense.answerSubmit'] }))

    expect(onAnswer).toHaveBeenCalledTimes(1)
    expect((onAnswer.mock.calls[0]?.[0] as { text: string }).text).toBe(HALF_WRITTEN)
    // No claim is made about a copy that was never kept.
    expect(screen.queryByText(enUS['defense.draftRestored'])).not.toBeInTheDocument()
  })
})

describe('DefenseInterview', () => {
  it('opens one box, on the first question without an answer', () => {
    render(<DefenseInterview runId={RUN_ID} questions={QUESTIONS} />)

    // Every question is listed — a student may read ahead — and exactly one carries a box.
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(screen.getByRole('heading', { name: QUESTIONS[0]?.text ?? '' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: QUESTIONS[1]?.text ?? '' })).toBeInTheDocument()
  })

  it('spends the accent on answering while questions are open, not on finishing', () => {
    const { rerender } = render(<DefenseInterview runId={RUN_ID} questions={QUESTIONS} />)

    // DESIGN.md §Do's: one accent per screen, on the act the student is there to take. The teal
    // fill is `bg-primary`; the secondary treatment is raised paper with a control hairline.
    expect(screen.getByRole('button', { name: enUS['defense.finish'] }).className).toContain(
      'bg-paper-raised',
    )

    rerender(
      <DefenseInterview
        runId={RUN_ID}
        questions={QUESTIONS.map((row) => ({
          ...row,
          answered: true,
          answer: { text: 'x', answeredAt: '2026-09-05T10:00:00.000Z' },
        }))}
      />,
    )
    expect(screen.getByRole('button', { name: enUS['defense.finish'] }).className).toContain(
      'bg-primary',
    )
  })

  it('shows the follow-up beneath the question that earned it, labelled and unexplained', async () => {
    const user = userEvent.setup()
    actions.answerDefenseQuestionAction.mockResolvedValue({
      ok: true,
      data: { next: QUESTIONS[1], followUpQuestion: FOLLOW_UP_QUESTION },
    })
    const { container } = render(<DefenseInterview runId={RUN_ID} questions={QUESTIONS} />)

    await user.type(
      screen.getByLabelText(enUS['defense.answerLabel']),
      'I remember it from the room.',
    )
    await user.click(screen.getByRole('button', { name: enUS['defense.answerSubmit'] }))

    expect(await screen.findByText(FOLLOW_UP_QUESTION.text)).toBeInTheDocument()
    expect(screen.getByText(enUS['defense.followUpHeading'])).toBeInTheDocument()

    // Beneath its own question, and not at the end of the list (D-344).
    const items = Array.from(container.querySelectorAll('li'))
    const parentIndex = items.findIndex((item) =>
      item.textContent?.includes(QUESTIONS[0]?.text ?? ''),
    )
    const followUpIndex = items.findIndex((item) =>
      item.textContent?.startsWith(enUS['defense.followUpHeading']),
    )
    const secondIndex = items.findIndex((item) =>
      item.textContent?.includes(QUESTIONS[1]?.text ?? ''),
    )
    expect(parentIndex).toBeGreaterThanOrEqual(0)
    expect(followUpIndex).toBeGreaterThan(parentIndex)
    expect(followUpIndex).toBeLessThan(secondIndex)

    // The rule that fired is never named.
    const spoken = (container.textContent ?? '').toLowerCase()
    for (const word of ['because you', 'no source', 'verbatim', 'rule']) {
      expect(spoken, `the interview must not say "${word}"`).not.toContain(word)
    }
  })

  it('offers no assistant, no Evidence Room, and no route to either', () => {
    const { container } = render(<DefenseInterview runId={RUN_ID} questions={QUESTIONS} />)

    expect(container.querySelectorAll('a')).toHaveLength(0)
    const spoken = (container.textContent ?? '').toLowerCase()
    for (const word of ['assistant', 'evidence room', 'delegat', 'escalat']) {
      expect(spoken, `the defense must not offer "${word}"`).not.toContain(word)
    }
  })

  it('names the unanswered count before it files the remainder empty', async () => {
    const user = userEvent.setup()
    render(<DefenseInterview runId={RUN_ID} questions={QUESTIONS} />)

    await user.click(screen.getByRole('button', { name: enUS['defense.finish'] }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(enUS['defense.finishConfirmTitle'])
    expect(dialog).toHaveTextContent(
      enUS['defense.finishConfirmUnansweredMany'].replace('{count}', '2'),
    )
    expect(actions.completeDefenseAction).not.toHaveBeenCalled()
  })

  it('files the unanswered questions empty and then completes', async () => {
    const user = userEvent.setup()
    actions.answerDefenseQuestionAction.mockResolvedValue({
      ok: true,
      data: { next: null, followUpQuestion: null },
    })
    actions.completeDefenseAction.mockResolvedValue({ ok: true, data: { id: RUN_ID } })
    render(<DefenseInterview runId={RUN_ID} questions={QUESTIONS} />)

    await user.click(screen.getByRole('button', { name: enUS['defense.finish'] }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(
      within(dialog).getByRole('button', { name: enUS['defense.finishConfirmAction'] }),
    )

    await waitFor(() => {
      expect(actions.completeDefenseAction).toHaveBeenCalledWith({ runId: RUN_ID })
    })
    expect(actions.answerDefenseQuestionAction).toHaveBeenCalledTimes(2)
    for (const call of actions.answerDefenseQuestionAction.mock.calls) {
      expect((call[0] as { text: string }).text).toBe('')
    }
  })

  // D-368: the loop terminates (D-351) and it also recovers. A question the server has already
  // answered — a second tab, a response lost after the write landed — used to stop the finish dead:
  // `apply` never marked the row, so the next press queued the same question, met the same code and
  // stopped in the same place, for ever, with a manual reload the only way out.
  it('carries on past a question the server has already answered, and finishes', async () => {
    const user = userEvent.setup()
    actions.answerDefenseQuestionAction.mockImplementation((input: unknown) =>
      Promise.resolve(
        (input as { runQuestionId: string }).runQuestionId === Q1
          ? {
              ok: false,
              error: {
                code: 'QUESTION_ALREADY_ANSWERED',
                message: 'This question already has its answer.',
                requestId: 'req-1',
              },
            }
          : { ok: true, data: { next: null, followUpQuestion: null } },
      ),
    )
    actions.completeDefenseAction.mockResolvedValue({ ok: true, data: { id: RUN_ID } })
    render(<DefenseInterview runId={RUN_ID} questions={QUESTIONS} />)

    await user.click(screen.getByRole('button', { name: enUS['defense.finish'] }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(
      within(dialog).getByRole('button', { name: enUS['defense.finishConfirmAction'] }),
    )

    // Both questions were attempted, the second was filed, and the defense completed.
    await waitFor(() => {
      expect(actions.completeDefenseAction).toHaveBeenCalledWith({ runId: RUN_ID })
    })
    expect(actions.answerDefenseQuestionAction).toHaveBeenCalledTimes(2)
    // Nothing under the scrim claims the answer failed: the run holds one.
    expect(screen.queryByText(enUS['defense.finishFailed'])).not.toBeInTheDocument()
    expect(router.refresh).toHaveBeenCalled()
  })

  it('re-reads the interview when the finish is stopped by something else after a stale question', async () => {
    const user = userEvent.setup()
    actions.answerDefenseQuestionAction.mockImplementation((input: unknown) =>
      Promise.resolve(
        (input as { runQuestionId: string }).runQuestionId === Q1
          ? {
              ok: false,
              error: {
                code: 'QUESTION_ALREADY_ANSWERED',
                message: 'This question already has its answer.',
                requestId: 'req-1',
              },
            }
          : {
              ok: false,
              error: { code: 'RUN_PAUSED', message: 'This run is paused.', requestId: 'req-2' },
            },
      ),
    )
    render(<DefenseInterview runId={RUN_ID} questions={QUESTIONS} />)

    await user.click(screen.getByRole('button', { name: enUS['defense.finish'] }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(
      within(dialog).getByRole('button', { name: enUS['defense.finishConfirmAction'] }),
    )

    // The real refusal is shown where the student is standing …
    await waitFor(() => {
      expect(within(dialog).getByText(enUS['defense.finishFailed'])).toBeInTheDocument()
    })
    expect(actions.completeDefenseAction).not.toHaveBeenCalled()
    // … and the list is re-read, so the next press meets a list that is true.
    expect(router.refresh).toHaveBeenCalled()
  })

  // FR-210, WCAG 2.2 AA §2.4.3, D-500. Every answer but the last hands the caret to the question
  // that becomes current; the last one has nobody to hand it to, and the form it was submitted from
  // unmounts into the quoted answer. Without this the caret is dropped on `document.body`, from
  // which WebKit's Tab moves nothing at all — on the screen whose only remaining act is finishing.
  it('puts the caret on the finish control when the last question is answered', async () => {
    const user = userEvent.setup()
    const only = [question({ runQuestionId: Q1, seq: 1 })]
    actions.answerDefenseQuestionAction.mockResolvedValue({
      ok: true,
      data: { next: null, followUpQuestion: null },
    })
    render(<DefenseInterview runId={RUN_ID} questions={only} />)

    await user.type(screen.getByLabelText(enUS['defense.answerLabel']), 'I read it in the room.')
    await user.click(screen.getByRole('button', { name: enUS['defense.answerSubmit'] }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: enUS['defense.finish'] })).toHaveFocus()
    })
  })
})
