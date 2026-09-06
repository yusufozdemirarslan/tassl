import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BriefEditor } from '@/components/features/run/brief-editor'
import { enUS } from '@/lib/i18n/en-US'
import type { BriefNamedField, BriefView } from '@/server/modules/runs/schema'

// UI-023's Decision Brief (FR-100, FR-103, FR-108). Two things the step asks this to pin, and both
// are rules the server also holds:
//
//   * **the word limits, live and on the same count the server refuses on** (D-075) — the counter
//     under a textarea and `wordLimit(n)` inside `BriefSchema` are one implementation, so a field
//     that reads "121 of 120 words" is a field the lock will refuse;
//   * **the numeric fields reject letters** — FR-100's own acceptance criterion is "numeric fields
//     accept numbers only", and the field takes digits, one decimal point and a leading minus and
//     nothing else, so there is never a wrong value to correct afterwards.
//
// The lock is here too, because it is what the limits are for: a brief over a limit must not reach
// the confirmation, and the confirmation that does open has to say the lock is irreversible.

const RUN_ID = '9f6ab2f8-9f14-4f6f-a3a0-64f1f3a1a001'

/**
 * The confirmation is a separate chunk (`useDeferredModule`), so opening it is an `import()` and a
 * render rather than a render. Testing Library's one-second default is enough on an idle machine and
 * not on a loaded one, and a flake here would be a fact about the runner rather than about the form.
 */
const DIALOG_TIMEOUT_MS = 10_000

const router = vi.hoisted(() => ({ refresh: vi.fn() }))
const actions = vi.hoisted(() => ({
  saveBriefDraftAction: vi.fn(),
  briefSignalAction: vi.fn(),
  lockDecisionAction: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: router.refresh,
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
}))

// The real module drags the runs service and the database into jsdom.
vi.mock('@/server/modules/runs/actions', () => ({
  saveBriefDraftAction: actions.saveBriefDraftAction,
  briefSignalAction: actions.briefSignalAction,
  lockDecisionAction: actions.lockDecisionAction,
}))

const NAMED_FIELDS: BriefNamedField[] = [
  { key: 'budget_share_to_premium', label: 'Share going to premium', unit: 'percent' },
  { key: 'premium_payback_months', label: 'Premium payback', unit: 'months' },
]

/** `n` distinct words, so `countWords` sees exactly `n` and nothing collapses. */
const words = (n: number): string => Array.from({ length: n }, (_, index) => `w${index}`).join(' ')

const briefLimit = (limit: number): string =>
  enUS['workspace.briefWordLimit'].replace('{limit}', String(limit))

const countText = (count: number, limit: number): string =>
  enUS['workspace.wordCount'].replace('{count}', String(count)).replace('{limit}', String(limit))

const fieldLabel = (label: string, unit: string): string =>
  enUS['workspace.briefNamedFieldLabel'].replace('{label}', label).replace('{unit}', unit)

const recommendation = () => screen.getByLabelText(enUS['workspace.briefRecommendationLabel'])
const rationale = () => screen.getByLabelText(enUS['workspace.briefRationaleLabel'])
const changeMyMind = () => screen.getByLabelText(enUS['workspace.briefChangeMyMindLabel'])
const assumption = (number: number) =>
  screen.getByLabelText(enUS['workspace.briefAssumptionLabel'].replace('{number}', String(number)))
const confidence = () =>
  screen.getByRole('spinbutton', { name: enUS['workspace.briefConfidenceNumber'] })
const payback = () =>
  screen.getByLabelText(fieldLabel('Premium payback', enUS['workspace.unitMonths']))
const lockButton = () => screen.getByRole('button', { name: enUS['workspace.decisionLock'] })

const valueOf = (element: HTMLElement): string => (element as HTMLInputElement).value

function type(element: HTMLElement, value: string): void {
  fireEvent.change(element, { target: { value } })
}

/** A brief that satisfies every rule in FR-100, so only the field under test is ever at fault. */
function fillValidBrief(): void {
  type(recommendation(), 'Hold the premium share where it is for one more quarter.')
  type(rationale(), 'The payback figure the recommendation would rest on has not been checked.')
  type(assumption(1), 'The board deck figure has not been revised.')
  type(assumption(2), 'Value acquisition holds at its current rate.')
  type(assumption(3), 'Capacity absorbs current premium volume.')
  type(changeMyMind(), 'A payback figure dated later than the board deck.')
  type(confidence(), '58')
  type(payback(), '11')
}

function renderEditor(draft: BriefView | null = null, canWrite = true) {
  render(
    <BriefEditor runId={RUN_ID} draft={draft} namedFields={NAMED_FIELDS} canWrite={canWrite} />,
  )
  return userEvent.setup()
}

describe('BriefEditor (UI-023, FR-100, FR-103)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actions.saveBriefDraftAction.mockResolvedValue({ ok: true, data: null })
    actions.briefSignalAction.mockResolvedValue({ ok: true, data: null })
    actions.lockDecisionAction.mockResolvedValue({ ok: true, data: { id: RUN_ID } })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('counts words while they are typed, on the count the server refuses on', () => {
    renderEditor()
    expect(screen.getByText(countText(0, 120))).toBeInTheDocument()

    type(recommendation(), words(3))
    expect(screen.getByText(countText(3, 120))).toBeInTheDocument()
    expect(screen.queryByText(briefLimit(120))).not.toBeInTheDocument()
  })

  it('says a field is over its limit the moment it goes over, without a submit', () => {
    renderEditor()
    type(rationale(), words(251))
    expect(screen.getByText(countText(251, 250))).toBeInTheDocument()
    expect(screen.getByText(briefLimit(250))).toBeInTheDocument()
  })

  it('holds each of FR-100 four limits', () => {
    renderEditor()
    type(recommendation(), words(121))
    type(rationale(), words(251))
    type(assumption(2), words(26))
    type(changeMyMind(), words(61))
    expect(screen.getByText(briefLimit(120))).toBeInTheDocument()
    expect(screen.getByText(briefLimit(250))).toBeInTheDocument()
    expect(screen.getByText(briefLimit(25))).toBeInTheDocument()
    expect(screen.getByText(briefLimit(60))).toBeInTheDocument()
  })

  it('names the numeric fields with the unit they are entered in', () => {
    renderEditor()
    expect(
      screen.getByLabelText(fieldLabel('Share going to premium', enUS['workspace.unitPercent'])),
    ).toBeInTheDocument()
    expect(payback()).toBeInTheDocument()
  })

  it('refuses letters in a numeric field and takes digits, a point and a minus', () => {
    renderEditor()
    const field = payback()

    type(field, '11')
    expect(valueOf(field)).toBe('11')

    // A letter is not taken at all: the box still holds the last number that was typed.
    type(field, '11a')
    expect(valueOf(field)).toBe('11')
    type(field, 'eleven')
    expect(valueOf(field)).toBe('11')
    type(field, '11e5')
    expect(valueOf(field)).toBe('11')

    type(field, '11.5')
    expect(valueOf(field)).toBe('11.5')
    type(field, '-4')
    expect(valueOf(field)).toBe('-4')
    // One decimal point only.
    type(field, '-4.2.1')
    expect(valueOf(field)).toBe('-4')
    // And it can be emptied, because an unfilled figure is a thing a draft may hold.
    type(field, '')
    expect(valueOf(field)).toBe('')
  })

  it('reads a saved draft back into the fields it came from (FR-108)', () => {
    const draft: BriefView = {
      recommendation: 'Hold the split.',
      rationale: 'The payback figure is unchecked.',
      assumptions: ['One.', 'Two.', 'Three.'],
      changeMyMind: 'A later figure.',
      confidence: 58,
      namedValues: { premium_payback_months: 11 },
      updatedAt: '2026-09-05T10:00:00.000Z',
      lockedAt: null,
    }
    renderEditor(draft)
    expect(valueOf(recommendation())).toBe('Hold the split.')
    expect(valueOf(assumption(3))).toBe('Three.')
    expect(valueOf(confidence())).toBe('58')
    expect(valueOf(payback())).toBe('11')
  })

  it('autosaves the draft once the typing stops, with the numbers parsed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderEditor()

    type(recommendation(), 'Hold the split.')
    type(payback(), '11')
    expect(actions.saveBriefDraftAction).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(900)
    await waitFor(() => {
      expect(actions.saveBriefDraftAction).toHaveBeenCalledTimes(1)
    })
    expect(actions.saveBriefDraftAction).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: RUN_ID,
        recommendation: 'Hold the split.',
        namedValues: { premium_payback_months: 11 },
      }),
    )
  })

  it('opens a confirmation that says the lock is irreversible, and files nothing until it is taken', async () => {
    const user = renderEditor()
    fillValidBrief()

    await user.click(lockButton())

    const confirm = await screen.findByRole('alertdialog', {}, { timeout: DIALOG_TIMEOUT_MS })
    expect(confirm).toHaveTextContent(enUS['workspace.decisionLockConfirmTitle'])
    expect(confirm).toHaveTextContent(enUS['workspace.decisionLockConfirmBody'])
    expect(actions.lockDecisionAction).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: enUS['workspace.decisionLockConfirm'] }))
    await waitFor(() => {
      expect(actions.lockDecisionAction).toHaveBeenCalledWith(
        expect.objectContaining({ runId: RUN_ID, confidence: 58 }),
      )
    })
  })

  it('names the field the server refused and puts the focus in it (FR-108)', async () => {
    actions.lockDecisionAction.mockResolvedValue({
      ok: false,
      error: {
        code: 'BRIEF_INVALID',
        message: 'The brief is not ready to file.',
        details: { field: 'changeMyMind', reason: 'required' },
        requestId: 'r1',
      },
    })
    const user = renderEditor()
    fillValidBrief()

    await user.click(lockButton())
    await user.click(screen.getByRole('button', { name: enUS['workspace.decisionLockConfirm'] }))

    await waitFor(() => {
      expect(screen.getByText(enUS['workspace.briefRequiredField'])).toBeInTheDocument()
    })
    expect(changeMyMind()).toHaveFocus()
    // Nothing was cleared: the student comes back to the brief exactly as they left it.
    expect(valueOf(recommendation())).toBe(
      'Hold the premium share where it is for one more quarter.',
    )
  })

  it('names the claim when the lock is refused over an unstanced relied-on claim (FR-084)', async () => {
    actions.lockDecisionAction.mockResolvedValue({
      ok: false,
      error: {
        code: 'LOCK_REFUSED_UNSTANCED_CLAIM',
        message: 'You leaned on a claim you have not taken a position on.',
        details: {
          claimId: '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f',
          claimText: 'Premium payback is about 11 months.',
        },
        requestId: 'r1',
      },
    })
    const user = renderEditor()
    fillValidBrief()

    await user.click(lockButton())
    await user.click(screen.getByRole('button', { name: enUS['workspace.decisionLockConfirm'] }))

    const dialog = await screen.findByRole('alertdialog', {}, { timeout: DIALOG_TIMEOUT_MS })
    await waitFor(() => {
      expect(dialog).toHaveTextContent(enUS['workspace.lockRefusedTitle'])
    })
    expect(dialog).toHaveTextContent('Premium payback is about 11 months.')
    expect(
      screen.getByRole('button', { name: enUS['workspace.lockRefusedGoToClaim'] }),
    ).toBeInTheDocument()
  })

  it('refuses to write while the run is paused, and says why', () => {
    renderEditor(null, false)
    expect(screen.getByText(enUS['workspace.briefClosedNote'])).toBeInTheDocument()
    expect(lockButton()).toHaveAttribute('aria-disabled', 'true')
    expect(actions.briefSignalAction).not.toHaveBeenCalled()
  })
})
