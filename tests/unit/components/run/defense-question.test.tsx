import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

beforeEach(() => {
  actions.answerDefenseQuestionAction.mockReset()
  actions.completeDefenseAction.mockReset()
  router.refresh.mockReset()
})

describe('DefenseQuestion', () => {
  it('reports the duration from the first focus in the box to the press of submit', async () => {
    const user = userEvent.setup()
    const onAnswer = vi.fn()
    render(
      <ol>
        <DefenseQuestion
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
})
