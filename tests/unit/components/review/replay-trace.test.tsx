import type { Route } from 'next'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DelegationFlag } from '@/components/features/review/delegation-flag'
import {
  ReplayTrace,
  eventTypeLabel,
  summarize,
  type ReplayTraceProps,
} from '@/components/features/review/replay-trace'
import { DEFAULT_MESSAGES } from '@/lib/errors'
import { enUS } from '@/lib/i18n/en-US'
import { t } from '@/lib/i18n/t'
import { RUN_EVENT_TYPES, type TraceEventView } from '@/server/modules/trace/schema'

// The two halves of UI-033 a reviewer reads a run through: the trace, which is the run in the order
// it was written (FR-007, FR-180, D-042), and FR-055's mark, which is the whole of what an
// instructor may record about a student's use of the assistant.
//
// The trace ships no JavaScript, so what is worth holding here is its arithmetic and its judgement
// rather than any interaction — the clock as it stood, the three payload fields that make a dense
// table scannable, the filter that keeps a filtered view addressable, and the one rule the two
// orderings on the screen make easy to confuse: the filter's options are sorted, the rows are not.
// A trace whose rows were sorted by anything at all would no longer be the run.
//
// The mark is the opposite: one press, three answers from the server, and a sentence that has to
// stay true. Nothing Tassl observes is treated as misconduct (PRD §7 standing rules), so the mark
// is a note about the material — it takes nothing away, and the student is never told, in any state
// (12 §8.1). The tests below hold the control to saying exactly that, and to recording a mark once.

const refresh = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

// A Server Action: the real module drags the review service, the database client and `server-only`
// into jsdom.
const actions = vi.hoisted(() => ({ flagDelegationAction: vi.fn() }))
vi.mock('@/server/modules/review/actions', () => ({
  flagDelegationAction: actions.flagDelegationAction,
}))

// ---------------------------------------------------------------------------------------------
// The trace
// ---------------------------------------------------------------------------------------------

const RUN_ID = '4a4a5f22-1d2f-4a1b-9c33-2b1f8a10c001'
const BASE_PATH = `/review/runs/${RUN_ID}` as Route
const ACTOR = '7b1e0c64-8a2f-4f3b-9d21-0c5a9b7e4411'

/** 45 minutes and 5.4 seconds left: the display floors, so a part-second never reads as a whole one. */
const STANCE_SET: TraceEventView = {
  seq: 1,
  type: 'stance_set',
  occurredAt: '2026-09-01T09:00:01.000Z',
  clockRemainingMs: 2_705_400,
  actorId: ACTOR,
  payload: { claim_key: 'claim-payback', stance: 'verify', auto: false },
}

const FRAME_LOCKED: TraceEventView = {
  seq: 2,
  type: 'frame_locked',
  occurredAt: '2026-09-01T09:00:02.000Z',
  clockRemainingMs: 1_800_000,
  actorId: ACTOR,
  payload: { assumptions: ['The plant runs', 'The supplier holds', 'The rate stands'] },
}

/** A second short of a minute; the minute must not be rounded up while the clock still has it. */
const SOURCE_TRACE: TraceEventView = {
  seq: 3,
  type: 'action',
  occurredAt: '2026-09-01T09:00:03.000Z',
  clockRemainingMs: 59_999,
  actorId: ACTOR,
  payload: { type: 'source_trace', claim_key: 'claim-payback', failed: false },
}

const SECOND_STANCE: TraceEventView = {
  seq: 4,
  type: 'stance_set',
  occurredAt: '2026-09-01T09:00:04.000Z',
  clockRemainingMs: 0,
  actorId: ACTOR,
  payload: { claim_key: 'claim-margin', stance: 'challenge' },
}

/** The clock is null outside the working period and the Turn window (D-042). */
const DEFENSE_ANSWER: TraceEventView = {
  seq: 5,
  type: 'defense_answer',
  occurredAt: '2026-09-01T09:30:00.000Z',
  clockRemainingMs: null,
  actorId: ACTOR,
  payload: {},
}

const RUN: readonly TraceEventView[] = [
  STANCE_SET,
  FRAME_LOCKED,
  SOURCE_TRACE,
  SECOND_STANCE,
  DEFENSE_ANSWER,
]

function renderTrace(props: Partial<ReplayTraceProps> = {}): void {
  render(
    <ReplayTrace
      events={props.events ?? RUN}
      action={props.action ?? BASE_PATH}
      filter={props.filter ?? null}
      total={props.total ?? RUN.length}
    />,
  )
}

/** The five columns, in the order the header names them. */
const COLUMN = { seq: 0, clock: 1, type: 2, summary: 3, record: 4 } as const

/** The rows under the header, in the order they were drawn. */
const bodyRows = (): HTMLElement[] => screen.getAllByRole('row').slice(1)

/** The `No.` column read downwards, which is the order the reviewer is being shown the run in. */
const seqColumn = (): string[] =>
  bodyRows().map((row) => within(row).getAllByRole('cell')[COLUMN.seq]?.textContent ?? '')

function rowFor(seq: number): HTMLElement {
  const row = bodyRows().find(
    (candidate) => within(candidate).getAllByRole('cell')[COLUMN.seq]?.textContent === String(seq),
  )
  if (!row) throw new Error(`The trace drew no row for event ${String(seq)}.`)
  return row
}

function cellOf(seq: number, column: keyof typeof COLUMN): HTMLElement {
  const cell = within(rowFor(seq)).getAllByRole('cell')[COLUMN[column]]
  if (!cell) throw new Error(`Event ${String(seq)} has no ${column} cell.`)
  return cell
}

const filterControl = (): HTMLElement =>
  screen.getByRole('combobox', { name: enUS['review.traceFilterLabel'] })

function filterForm(): HTMLFormElement {
  const form = filterControl().closest('form')
  if (!form) throw new Error('The trace filter is not inside a form.')
  return form
}

/** The line under the filter: what is being shown, and how much of the run that is. */
const summaryLine = (caption: string, shown: number, total: number): string =>
  `${caption} ${t('review.traceCount', { shown, total })}`

describe('the trace is the run in the order it was written (FR-007, FR-180)', () => {
  // The screen sorts one thing — the filter's options, by their label — and a trace that took the
  // same treatment would stop being a record. The rows keep the order the events arrived in, which
  // here is neither alphabetical by label nor the order of the event-type enum.
  it('draws every event once, in the order the run wrote them', () => {
    renderTrace()

    expect(seqColumn()).toEqual(['1', '2', '3', '4', '5'])
    expect(bodyRows()).toHaveLength(RUN.length)
  })

  it('reads the clock as it stood, to the second and rounded down', () => {
    renderTrace()

    expect(within(rowFor(1)).getByText('45:05')).toBeInTheDocument()
    expect(within(rowFor(2)).getByText('30:00')).toBeInTheDocument()
    expect(within(rowFor(3)).getByText('00:59')).toBeInTheDocument()
    expect(within(rowFor(4)).getByText('00:00')).toBeInTheDocument()
  })

  // A blank clock cell and a clock reading zero are two different facts about a run, and the em
  // dash that separates them for a sighted reader is `aria-hidden`. The sentence is what a screen
  // reader is given instead, so the two stay distinguishable without it.
  it('says a clock was not running rather than leaving the cell to a dash', () => {
    renderTrace()

    expect(within(rowFor(5)).getByText(enUS['review.traceNoClockFull'])).toBeInTheDocument()
    expect(within(rowFor(4)).queryByText(enUS['review.traceNoClockFull'])).not.toBeInTheDocument()
  })

  it('names each event with the catalogue word for its kind', () => {
    renderTrace()

    expect(within(rowFor(2)).getByText(enUS['review.eventType.frame_locked'])).toBeInTheDocument()
    expect(within(rowFor(3)).getByText(enUS['review.eventType.action'])).toBeInTheDocument()
  })

  // The summary column is a hint, not the record: up to three fields in `SUMMARY_KEYS` order, which
  // is the order a reviewer scans a trace in — which claim, which stance, then why.
  it('puts the payload fields a reviewer scans for in the summary column', () => {
    renderTrace()

    expect(
      within(rowFor(1)).getByText('claim key claim-payback · stance verify · auto false'),
    ).toBeInTheDocument()
    expect(
      within(rowFor(3)).getByText('claim key claim-payback · type source_trace · failed false'),
    ).toBeInTheDocument()
  })

  // Three assumptions are a list, and a list folded into one cell of a dense table is unreadable.
  // The summary says nothing rather than guessing, and the record below the row still holds them.
  it('leaves the summary empty when the payload holds nothing scalar', () => {
    renderTrace()

    expect(cellOf(2, 'summary')).toBeEmptyDOMElement()
    expect(within(rowFor(2)).getByText(enUS['review.traceOpenRecord'])).toBeInTheDocument()
  })

  // The record is the payload exactly as it was written, one press away in the same row: a native
  // `<details>` that is shut until it is asked for, so a dense table stays readable.
  it('keeps the stored record shut until it is asked for, then shows it unedited', async () => {
    const user = userEvent.setup()
    renderTrace()

    const record = within(rowFor(1)).getByRole('group')
    expect(record).not.toHaveAttribute('open')

    await user.click(within(rowFor(1)).getByText(enUS['review.traceOpenRecord']))

    expect(record).toHaveAttribute('open')
    expect(record).toHaveTextContent('"claim_key": "claim-payback"')
    expect(record).toHaveTextContent('"auto": false')
  })

  it('says an event carries nothing beyond its type rather than offering an empty control', () => {
    renderTrace()

    expect(within(rowFor(5)).getByText(enUS['review.traceNoRecord'])).toBeInTheDocument()
    expect(within(rowFor(5)).queryByRole('group')).not.toBeInTheDocument()
  })

  // A band's evidence links into the trace by fragment (`#event-42`), so the row's id is part of
  // the product rather than a hook for this test: renaming it breaks every evidence link at once.
  it('anchors each row at the fragment a band’s evidence links to', () => {
    renderTrace()

    expect(rowFor(3)).toHaveAttribute('id', 'event-3')
    expect(rowFor(5)).toHaveAttribute('id', 'event-5')
  })

  // The table scrolls inside its own region, and a region a keyboard can reach has to say what it
  // holds; the caption is the same sentence the line above the table reads (UI-033 A11y).
  it('names the scroll region with the caption, and says how much of the run is on screen', () => {
    renderTrace()

    expect(screen.getByRole('region', { name: enUS['review.traceCaption'] })).toBeInTheDocument()
    expect(
      screen.getByText(summaryLine(enUS['review.traceCaption'], RUN.length, RUN.length)),
    ).toBeInTheDocument()
  })
})

describe('the filtered trace is an address (D-176)', () => {
  // Thirty-two options, thirty of which answer "no events of that kind", is a control that mostly
  // wastes a press — so the select offers the kinds this run wrote, once each, and orders them by
  // the word the reviewer reads rather than by the enum. Here that puts "Defense answer" first,
  // which the enum puts twenty-fourth.
  it('offers only the kinds this run wrote, once each, in the reader’s alphabet', () => {
    renderTrace()

    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      enUS['review.traceFilterAll'],
      enUS['review.eventType.defense_answer'],
      enUS['review.eventType.frame_locked'],
      enUS['review.eventType.action'],
      enUS['review.eventType.stance_set'],
    ])
  })

  // A GET form, because the filtered trace has to be an address a reviewer can send to a colleague
  // and come back to with the back gesture. The tab travels with it or the submission would land
  // the reader on the Overview.
  it('submits the kind and the tab as a plain navigation to the replay', async () => {
    const user = userEvent.setup()
    renderTrace()

    await user.selectOptions(
      filterControl(),
      screen.getByRole('option', { name: enUS['review.eventType.frame_locked'] }),
    )

    const form = filterForm()
    expect(form).toHaveAttribute('method', 'get')
    expect(form).toHaveAttribute('action', BASE_PATH)

    const query = new URLSearchParams()
    for (const [name, value] of new FormData(form)) query.append(name, String(value))
    expect(query.get('tab')).toBe('trace')
    expect(query.get('event')).toBe('frame_locked')
  })

  it('opens on the kind the address asked for', () => {
    renderTrace({ filter: 'stance_set' })

    expect(filterControl()).toHaveValue('stance_set')
  })

  // The count is against the run, not against the page: "Showing 2 of 5" is what tells a reviewer
  // that three events are being withheld by their own filter rather than missing from the run.
  it('shows the one kind asked for, and says how much of the run that leaves out', () => {
    renderTrace({ filter: 'stance_set' })

    expect(seqColumn()).toEqual(['1', '4'])
    const caption = t('review.traceCaptionFiltered', {
      type: enUS['review.eventType.stance_set'],
    })
    expect(screen.getByRole('region', { name: caption })).toBeInTheDocument()
    expect(screen.getByText(summaryLine(caption, 2, RUN.length))).toBeInTheDocument()
  })

  it('offers the way back to every kind only while one kind is being shown', () => {
    renderTrace({ filter: 'stance_set' })

    expect(screen.getByRole('link', { name: enUS['review.traceFilterClear'] })).toHaveAttribute(
      'href',
      `${BASE_PATH}?tab=trace`,
    )
  })

  it('offers no way back when every kind is already shown', () => {
    renderTrace()

    expect(
      screen.queryByRole('link', { name: enUS['review.traceFilterClear'] }),
    ).not.toBeInTheDocument()
  })

  // An address can name a kind this run never wrote. That is an empty filter, not an empty trace,
  // and the two say different things: the run wrote nothing of that kind, and the filter is still
  // there to be cleared.
  it('says the run wrote no event of that kind rather than drawing an empty table', () => {
    renderTrace({ filter: 'escalation' })

    expect(
      screen.getByRole('heading', { name: enUS['review.traceEmptyFilterTitle'] }),
    ).toBeInTheDocument()
    expect(screen.getByText(enUS['review.traceEmptyFilterBody'])).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: enUS['review.traceFilterApply'] })).toBeVisible()
  })
})

// A blank Event cell would be a defect a reviewer could only find by reading the enum, and a
// mistyped catalogue key is exactly how one arrives: `t` returns nothing for a key that is not
// there, so every one of the thirty-two is asked for here.
describe('every kind of event the trace can hold has a name', () => {
  it.each([...RUN_EVENT_TYPES])('names %s', (type) => {
    expect(eventTypeLabel(type)).toBe(enUS[`review.eventType.${type}`])
  })
})

describe('the summary column’s rule', () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ['nothing at all', {}, ''],
    ['one field', { key: 'frame-1' }, 'key frame-1'],
    // The order is `SUMMARY_KEYS`, never the order the payload happens to have been written in.
    [
      'the preference order rather than the payload’s',
      { stance: 'reject', key: 'frame-1', claim_key: 'claim-1' },
      'key frame-1 · claim key claim-1 · stance reject',
    ],
    // Three is the cap: the fourth field is in the record, one press below the row.
    [
      'at most three fields',
      { key: 'a', claim_key: 'b', to: 'c', stance: 'verify', dimension: 'framing' },
      'key a · claim key b · to c',
    ],
    // A falsy scalar is a value the reviewer wants: "auto false" is the difference between a stance
    // the student set and one the lock wrote for them.
    ['a false as a value, not an absence', { auto: false, seq: 0 }, 'seq 0 · auto false'],
    // Anything structured is left to the record: a mapping folded into one cell is unreadable.
    [
      'nothing structured',
      { mapping: { novice: 1 }, assumptions: ['a', 'b', 'c'], actor: null },
      '',
    ],
    ['a sixty-character string whole', { key: 'x'.repeat(60) }, `key ${'x'.repeat(60)}`],
    ['a longer string cut to an ellipsis', { key: 'x'.repeat(61) }, `key ${'x'.repeat(57)}…`],
  ]

  it.each(cases)('keeps %s', (_case, payload, expected) => {
    expect(summarize(payload)).toBe(expected)
  })
})

// ---------------------------------------------------------------------------------------------
// The mark on a delegation (FR-055)
// ---------------------------------------------------------------------------------------------

const DELEGATION_ID = '2c7f9a10-59e3-4d7c-8a55-6d0b3e21f077'

function renderFlag(
  props: { alreadyFlagged?: boolean; reachesDrafting?: boolean } = {},
): ReturnType<typeof userEvent.setup> {
  render(
    <DelegationFlag
      runId={RUN_ID}
      delegationId={DELEGATION_ID}
      alreadyFlagged={props.alreadyFlagged ?? false}
      reachesDrafting={props.reachesDrafting ?? true}
    />,
  )
  return userEvent.setup()
}

const markControl = (): HTMLElement =>
  screen.getByRole('button', { name: enUS['review.flagButton'] })

const refusal = (message: string) => ({
  ok: false as const,
  error: { code: 'DELEGATION_NOT_FOUND', message, requestId: 'req_1' },
})

describe('marking an exchange is a note about the material, never an accusation (FR-055)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actions.flagDelegationAction.mockResolvedValue({ ok: true, data: {} })
  })

  // The whole of what the mark does is arithmetic: 10 §11.3 leaves a marked exchange out of the
  // Delegation read, so the band is placed over the exchanges that remain. Nothing Tassl observes
  // is treated as misconduct (PRD §7), and `runs.flags` is kept out of every student payload in
  // every state (12 §8.1) — which is what makes the two sentences beside the control true rather
  // than merely reassuring, and why they are asserted rather than left to the copy review.
  it('says what the mark does, that the student is not told, and that nothing is taken away', () => {
    renderFlag()

    expect(screen.getByText(enUS['review.flagExplains'])).toBeInTheDocument()
    expect(markControl()).toBeInTheDocument()
  })

  it('records nothing until it is pressed', () => {
    renderFlag()

    expect(actions.flagDelegationAction).not.toHaveBeenCalled()
  })

  // The exclusion is applied where the bands are drafted (D-481), so a mark set after they exist
  // does not move them and nothing re-drafts them. `reachesDrafting` is the server's answer to
  // which of the two presses this is, and a control that acts without saying what it did not do is
  // the one thing this control was not to be (D-474, D-482).
  it('says a mark now will not move bands that were drafted before it', () => {
    renderFlag({ reachesDrafting: false })

    expect(screen.getByText(enUS['review.flagAfterDraft'])).toBeInTheDocument()
  })

  it('says nothing about the drafting while a mark would still reach it', () => {
    renderFlag({ reachesDrafting: true })

    expect(screen.queryByText(enUS['review.flagAfterDraft'])).not.toBeInTheDocument()
  })

  it('marks the exchange it was rendered for, and lets the server render draw the result', async () => {
    const user = renderFlag()

    await user.click(markControl())

    await waitFor(() => {
      expect(actions.flagDelegationAction).toHaveBeenCalledWith({
        runId: RUN_ID,
        delegationId: DELEGATION_ID,
        flag: 'out_of_scenario',
      })
    })
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  // `aria-disabled`, not `disabled`: the browser blurs a control the moment it is disabled, which
  // would drop the keyboard to <body> exactly when a refusal is about to be announced under it.
  // The early return in the handler is what `disabled` used to do, so a mark is recorded once.
  it('says it is working without losing the keyboard, and records the mark once', async () => {
    let release: (result: { ok: true; data: Record<string, never> }) => void = () => {}
    actions.flagDelegationAction.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    const user = renderFlag()

    await user.click(markControl())

    const busy = await screen.findByRole('button', { name: enUS['review.flagPending'] })
    expect(busy).toHaveAttribute('aria-disabled', 'true')
    expect(busy).toHaveAttribute('aria-busy', 'true')
    expect(busy).not.toBeDisabled()
    expect(busy).toHaveFocus()

    await user.click(busy)
    expect(actions.flagDelegationAction).toHaveBeenCalledTimes(1)

    release({ ok: true, data: {} })
    await waitFor(() => expect(markControl()).toBeInTheDocument())
  })

  it('carries the refusal’s own sentence and leaves the exchange as it was', async () => {
    actions.flagDelegationAction.mockResolvedValue(refusal(DEFAULT_MESSAGES.DELEGATION_NOT_FOUND))
    const user = renderFlag()

    await user.click(markControl())

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(DEFAULT_MESSAGES.DELEGATION_NOT_FOUND)
    })
    expect(refresh).not.toHaveBeenCalled()
    // The mark was not recorded, so the press is still there to be made again.
    expect(markControl()).toBeInTheDocument()
  })

  it('falls back to its own sentence when a refusal arrives with none', async () => {
    actions.flagDelegationAction.mockResolvedValue(refusal(''))
    const user = renderFlag()

    await user.click(markControl())

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(enUS['review.flagRefused'])
    })
    expect(refresh).not.toHaveBeenCalled()
  })

  // A request that never arrives has no envelope to quote, and a control left saying "Marking…"
  // for ever is worse than one that says the mark was not recorded and offers the press again.
  it('says the same when the request never arrives at all', async () => {
    actions.flagDelegationAction.mockRejectedValue(new Error('The network dropped.'))
    const user = renderFlag()

    await user.click(markControl())

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(enUS['review.flagRefused'])
    })
    expect(markControl()).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })

  // A mark is recorded once — `flagDelegation` adds the flag only when it is absent, so a second
  // press is a no-op. The control says so rather than offering a press that looks like it did
  // something; the log's own flag list carries the sentence from then on.
  it('becomes the sentence, not the control, once the exchange carries the mark', () => {
    renderFlag({ alreadyFlagged: true })

    expect(screen.getByText(enUS['review.flagAlready'])).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText(enUS['review.flagExplains'])).not.toBeInTheDocument()
  })
})
