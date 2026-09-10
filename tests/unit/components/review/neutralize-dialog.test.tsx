import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NeutralizeDialog,
  type NeutralizeDialogProps,
} from '@/components/features/review/neutralize-dialog'
import { DEFAULT_MESSAGES, type ActionResult, type ErrorCode } from '@/lib/errors'
import { enUS } from '@/lib/i18n/en-US'
import { t } from '@/lib/i18n/t'
import type { NeutralizeResultView } from '@/server/modules/review/schema'

// UI-033 → `NeutralizeDialog` (FR-003, FR-005, FR-232, D-092, D-464, D-706): the one control with
// which Tassl admits its own error on a claim, and the five facts the recompute produces.
//
// What is protected here is the dialog's judgement rather than its layout, and each property below
// is a rule the product would break silently if the component drifted.
//
//   * **The floor is stated where the correction is entered.** FR-005 — "a correction can raise a
//     band and never lowers one" — is the sentence an instructor wants before they press, not
//     after, so it is in the dialog's description while the form is still a question.
//   * **The floor is what the answer reports.** Every row is drawn from `bandsEffective`, never
//     from `bandsAfter`: when the raw recompute comes back *lower* the dialog says no band moved
//     and the run keeps the points it had. A row drawn from `bandsAfter` would tell an instructor
//     they had just cost a student a band by admitting a mistake, which is the one thing FR-005
//     exists to forbid.
//   * **Whether the student was right is asked, never assumed.** D-092's checkbox opens unchecked
//     and its value travels either way; a silent `false` would answer for the instructor.
//   * **The answer outlives the revalidation it causes (D-464).** `neutralizeClaimAction`
//     revalidates the replay, so the page re-renders the moment the correction lands; the dialog
//     renders the already-corrected state itself and refreshes on close rather than on success, or
//     the five facts would be taken off the screen at the instant they arrived.

const RUN_ID = '4a4a5f22-1d2f-4a1b-9c33-2b1f8a10c001'
const CLAIM_ID = '6b6b7d44-3e4f-4c2d-8b55-4d3f9c32e002'
const CLAIM_KEY = 'C3'

const router = vi.hoisted(() => ({ refresh: vi.fn() }))
const actions = vi.hoisted(() => ({ neutralizeClaimAction: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: router.refresh,
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
  usePathname: () => `/review/runs/${RUN_ID}`,
}))

// A Server Action: importing the real module would pull the review service, the scoring recompute,
// the database client and `server-only` into jsdom.
vi.mock('@/server/modules/review/actions', () => ({
  neutralizeClaimAction: actions.neutralizeClaimAction,
}))

const BASE: NeutralizeDialogProps = {
  runId: RUN_ID,
  claimId: CLAIM_ID,
  claimKey: CLAIM_KEY,
  alreadyCorrected: false,
}

/**
 * A correction that raised one dimension and left another where it was, on a confirmed run.
 *
 * `calibration` is in `dimensions` and did not move, which is the ordinary case: both dimensions
 * are re-read after a claim leaves the stance matrix and only one of them changes.
 */
const RAISED: NeutralizeResultView = {
  recompute: {
    dimensions: ['verification', 'calibration'],
    bandsBefore: { verification: 'developing', calibration: 'proficient' },
    bandsAfter: { verification: 'proficient', calibration: 'proficient' },
    bandsEffective: { verification: 'proficient', calibration: 'proficient' },
    pointsBefore: 6,
    pointsAfter: 7.5,
    pointsEffective: 7.5,
  },
  run: { id: RUN_ID, state: 'adjusted' },
  exportVersion: 2,
}

/**
 * The recompute came back *lower* than the run already stood on, and FR-005's floor holds it.
 *
 * `bandsAfter` is Developing and `bandsEffective` is the Proficient the run keeps; the export is
 * still filed, because a correction on a confirmed run re-exports whether or not a band moved and
 * the export carries all six figures.
 */
const FLOORED: NeutralizeResultView = {
  recompute: {
    dimensions: ['calibration'],
    bandsBefore: { calibration: 'proficient' },
    bandsAfter: { calibration: 'developing' },
    bandsEffective: { calibration: 'proficient' },
    pointsBefore: 7.5,
    pointsAfter: 6,
    pointsEffective: 7.5,
  },
  run: { id: RUN_ID, state: 'adjusted' },
  exportVersion: 3,
}

/**
 * A run whose bands are drafted but not confirmed: nothing has been exported and there are no
 * points yet, and one dimension the pipeline could not place has now been placed.
 *
 * `calibration` carries an explicit `null` and `adaptation` is absent from `bandsBefore` entirely,
 * because the service says "unassessed" in both of those ways and the reader must see one word.
 */
const UNPLACED: NeutralizeResultView = {
  recompute: {
    dimensions: ['calibration', 'adaptation'],
    bandsBefore: { calibration: null },
    bandsAfter: { calibration: 'developing', adaptation: 'novice' },
    bandsEffective: { calibration: 'developing', adaptation: 'novice' },
    pointsBefore: null,
    pointsAfter: null,
    pointsEffective: null,
  },
  run: { id: RUN_ID, state: 'adjusted' },
  exportVersion: null,
}

/** A correction that reached every dimension, each of them landing on a different rung. */
const ALL_SEVEN: NeutralizeResultView = {
  recompute: {
    dimensions: [
      'framing',
      'delegation',
      'verification',
      'calibration',
      'decision_quality',
      'adaptation',
      'ownership',
    ],
    bandsBefore: {
      framing: 'novice',
      delegation: 'developing',
      verification: 'proficient',
      calibration: null,
      decision_quality: 'novice',
      adaptation: 'developing',
      ownership: 'proficient',
    },
    bandsAfter: {
      framing: 'developing',
      delegation: 'proficient',
      verification: 'professional',
      calibration: 'novice',
      decision_quality: 'professional',
      adaptation: 'professional',
      ownership: 'professional',
    },
    bandsEffective: {
      framing: 'developing',
      delegation: 'proficient',
      verification: 'professional',
      calibration: 'novice',
      decision_quality: 'professional',
      adaptation: 'professional',
      ownership: 'professional',
    },
    pointsBefore: 4.25,
    pointsAfter: 9,
    pointsEffective: 9,
  },
  run: { id: RUN_ID, state: 'adjusted' },
  exportVersion: 4,
}

/** The rows `ALL_SEVEN` must produce, as dimension, band left, band arrived at. */
const ALL_SEVEN_ROWS = [
  [enUS['band.dimension.framing'], enUS['band.novice'], enUS['band.developing']],
  [enUS['band.dimension.delegation'], enUS['band.developing'], enUS['band.proficient']],
  [enUS['band.dimension.verification'], enUS['band.proficient'], enUS['band.professional']],
  [enUS['band.dimension.calibration'], enUS['band.unassessed'], enUS['band.novice']],
  [enUS['band.dimension.decision_quality'], enUS['band.novice'], enUS['band.professional']],
  [enUS['band.dimension.adaptation'], enUS['band.developing'], enUS['band.professional']],
  [enUS['band.dimension.ownership'], enUS['band.proficient'], enUS['band.professional']],
] as const

const answered = (view: NeutralizeResultView): ActionResult<NeutralizeResultView> => ({
  ok: true,
  data: view,
})

const refused = (code: ErrorCode, message: string): ActionResult<NeutralizeResultView> => ({
  ok: false,
  error: { code, message, requestId: 'req_1' },
})

function renderDialog(overrides: Partial<NeutralizeDialogProps> = {}) {
  const view = render(<NeutralizeDialog {...BASE} {...overrides} />)
  return {
    user: userEvent.setup(),
    /** Re-renders as the revalidated server tree would, with the claim's state moved on. */
    rerender: (next: Partial<NeutralizeDialogProps>) => {
      view.rerender(<NeutralizeDialog {...BASE} {...overrides} {...next} />)
    },
  }
}

const trigger = () =>
  screen.getByRole('button', { name: t('review.neutralizeOpen', { key: CLAIM_KEY }) })
const reason = (label: string) => screen.getByRole('radio', { name: label })
const credit = () => screen.getByRole('checkbox', { name: enUS['review.neutralizeCredit'] })
const note = () => screen.getByLabelText(enUS['review.neutralizeNoteLabel'])
const enter = () => screen.getByRole('button', { name: enUS['review.neutralizeConfirm'] })
const cancel = () => screen.getByRole('button', { name: enUS['review.neutralizeCancel'] })

/**
 * The footer's Close, which is the first of the two the dialog draws: the primitive adds its own
 * icon-only close in the corner and both carry the same accessible name, the collision
 * tests/e2e/walkthrough/15-neutralize-void.spec.ts resolves with `.first()`.
 */
const close = () => screen.getAllByRole('button', { name: enUS['review.neutralizeClose'] })[0]!

/** Presses the trigger and waits for the question. */
async function openQuestion(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(trigger())
  return screen.findByRole('dialog', {
    name: t('review.neutralizeDialogTitle', { key: CLAIM_KEY }),
  })
}

/** Enters the correction as the dialog opens with it and waits for the answer to replace the form. */
async function enterCorrection(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await openQuestion(user)
  await user.click(enter())
  return screen.findByRole('dialog', { name: enUS['review.recomputeTitle'] })
}

/** A deferred answer, so the pending state can be read while the recompute is still running. */
function deferAnswer(): (result: ActionResult<NeutralizeResultView>) => void {
  let release: (result: ActionResult<NeutralizeResultView>) => void = () => {}
  actions.neutralizeClaimAction.mockReturnValue(
    new Promise<ActionResult<NeutralizeResultView>>((resolve) => {
      release = resolve
    }),
  )
  return (result) => {
    release(result)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  actions.neutralizeClaimAction.mockResolvedValue(answered(RAISED))
})

describe('the control the claim carries', () => {
  it('names the claim in the trigger and holds the dialog shut until it is pressed', () => {
    renderDialog()

    expect(trigger()).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(actions.neutralizeClaimAction).not.toHaveBeenCalled()
  })

  // One correction per claim per run (`NEUTRALIZATION_EXISTS`). A second control would exist only
  // to be refused, so the claim states its position instead of offering one.
  it('says the claim already carries a correction rather than offering a control that would refuse', () => {
    renderDialog({ alreadyCorrected: true })

    expect(screen.getByText(enUS['review.neutralizeAlreadyDone'])).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('the question the dialog asks', () => {
  it('opens on the six reasons with the first of them already chosen', async () => {
    const { user } = renderDialog()

    await openQuestion(user)

    expect(reason(enUS['review.neutralizeReason.unintendedDefect'])).toBeChecked()
    for (const label of [
      enUS['review.neutralizeReason.wrongVerification'],
      enUS['review.neutralizeReason.misbehavingMaterial'],
      enUS['review.neutralizeReason.adaptation'],
      enUS['review.neutralizeReason.recordLost'],
      enUS['review.neutralizeReason.other'],
    ]) {
      expect(reason(label)).not.toBeChecked()
    }
    expect(note()).toHaveValue('')
    expect(screen.getByRole('alert')).toBeEmptyDOMElement()
  })

  // FR-005 is the rule an instructor is most likely to be uneasy about — "will this take points off
  // a student because I admitted a mistake?" — and the sentence that answers it belongs where the
  // correction is entered rather than in a document nobody has open.
  it('states the floor before anything is sent, not only in the answer', async () => {
    const { user } = renderDialog()

    const dialog = await openQuestion(user)

    expect(dialog).toHaveTextContent(enUS['review.neutralizeDialogBody'])
    expect(dialog).toHaveTextContent('A correction can raise a band and never lowers one.')
  })

  // D-092: the checkbox is required rather than defaulted. It is rendered unchecked as a starting
  // position, and the sentence beside it says the credit counts as a match on this run alone — so
  // an instructor is never guessing what the box does to a student's Verification and Calibration.
  it('leaves the credit unanswered and explains what answering it does', async () => {
    const { user } = renderDialog()

    await openQuestion(user)

    expect(credit()).not.toBeChecked()
    expect(credit()).toHaveAccessibleDescription(enUS['review.neutralizeCreditHint'])
  })

  it('sends nothing while the instructor is still making up their mind', async () => {
    const { user } = renderDialog()

    await openQuestion(user)
    await user.click(reason(enUS['review.neutralizeReason.recordLost']))
    await user.click(credit())
    await user.type(note(), 'The stance record for this claim was lost.')

    expect(reason(enUS['review.neutralizeReason.recordLost'])).toBeChecked()
    expect(credit()).toBeChecked()
    expect(actions.neutralizeClaimAction).not.toHaveBeenCalled()
  })
})

describe('what the correction sends', () => {
  it('sends the run, the claim, the chosen reason, an unchecked credit and an empty note', async () => {
    const { user } = renderDialog()

    await enterCorrection(user)

    expect(actions.neutralizeClaimAction).toHaveBeenCalledWith({
      runId: RUN_ID,
      claimId: CLAIM_ID,
      reason: 'unintended_defect',
      creditChallenge: false,
      note: '',
    })
  })

  // The six reasons are FR-003's own list, and the one chosen is what flags the package version for
  // review — `adaptation_failed` is FR-026's deeper re-skin — so the value has to be the value.
  it('sends the reason the instructor chose', async () => {
    const { user } = renderDialog()

    await openQuestion(user)
    await user.click(reason(enUS['review.neutralizeReason.adaptation']))
    await user.click(enter())

    await waitFor(() => {
      expect(actions.neutralizeClaimAction).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'adaptation_failed' }),
      )
    })
  })

  // D-092 again, from the other side: the credit travels as `true` only because it was checked, and
  // it is present in the payload either way rather than left for the service to assume.
  it('sends the credit once the student’s challenge is marked correct', async () => {
    const { user } = renderDialog()

    await openQuestion(user)
    await user.click(credit())
    await user.click(enter())

    await waitFor(() => {
      expect(actions.neutralizeClaimAction).toHaveBeenCalledWith(
        expect.objectContaining({ creditChallenge: true }),
      )
    })
  })

  // The note is filed on the correction and read back on the replay, so a field holding only spaces
  // must arrive as no note at all rather than as a blank line under the claim.
  it('sends the note trimmed', async () => {
    const { user } = renderDialog()

    await openQuestion(user)
    await user.type(note(), '   The check reported defective on a sound figure.   ')
    await user.click(enter())

    await waitFor(() => {
      expect(actions.neutralizeClaimAction).toHaveBeenCalledWith(
        expect.objectContaining({ note: 'The check reported defective on a sound figure.' }),
      )
    })
  })

  it('sends no note for a field holding only whitespace', async () => {
    const { user } = renderDialog()

    await openQuestion(user)
    await user.type(note(), '    ')
    await user.click(enter())

    await waitFor(() => {
      expect(actions.neutralizeClaimAction).toHaveBeenCalledWith(
        expect.objectContaining({ note: '' }),
      )
    })
  })
})

describe('the answer the dialog becomes', () => {
  // The dialog does not close on success (D-464): the instructor who pressed the button is the only
  // person who will ever see the recompute, the two totals and the export version together.
  it('stays open and reports what moved, both totals and the export version filed', async () => {
    const { user } = renderDialog()

    const dialog = await enterCorrection(user)

    const answer = within(dialog).getByRole('status')
    expect(
      within(answer).getByText(
        t('review.recomputeRow', {
          dimension: enUS['band.dimension.verification'],
          before: enUS['band.developing'],
          after: enUS['band.proficient'],
        }),
      ),
    ).toBeInTheDocument()
    // Calibration was recomputed and stayed where it was, so it is not a row: the answer lists what
    // moved, not what was looked at.
    expect(within(answer).getAllByRole('listitem')).toHaveLength(1)
    expect(
      within(answer).getByText(t('review.recomputePoints', { before: '6.000', after: '7.500' })),
    ).toBeInTheDocument()
    expect(
      within(answer).getByText(t('review.recomputeKeeps', { effective: '7.500' })),
    ).toBeInTheDocument()
    // FR-232: a correction on a confirmed, recorded, exported run writes a new export version
    // rather than editing the one already filed, and the dialog names the version it wrote.
    expect(
      within(answer).getByText(t('review.recomputeExport', { version: 2 })),
    ).toBeInTheDocument()
    expect(dialog).toHaveTextContent(enUS['review.recomputeFloor'])
  })

  // FR-005, the property the whole feature turns on: the recompute came back a band lower, and the
  // dialog reports the band the run keeps. The lowered band is nowhere on the screen as an outcome,
  // and the run keeps its points.
  it('reports the floored band and says no band moved when the recompute came back lower', async () => {
    actions.neutralizeClaimAction.mockResolvedValue(answered(FLOORED))
    const { user } = renderDialog()

    const dialog = await enterCorrection(user)

    const answer = within(dialog).getByRole('status')
    expect(within(answer).getByText(enUS['review.recomputeNothing'])).toBeInTheDocument()
    expect(within(answer).queryAllByRole('listitem')).toHaveLength(0)
    expect(
      screen.queryByText(
        t('review.recomputeRow', {
          dimension: enUS['band.dimension.calibration'],
          before: enUS['band.proficient'],
          after: enUS['band.developing'],
        }),
      ),
      'a correction that lowered a band is a correction that cost a student points, which FR-005 forbids',
    ).not.toBeInTheDocument()
    // The raw recompute is still shown honestly beside the figure the run keeps.
    expect(
      within(answer).getByText(t('review.recomputePoints', { before: '7.500', after: '6.000' })),
    ).toBeInTheDocument()
    expect(
      within(answer).getByText(t('review.recomputeKeeps', { effective: '7.500' })),
    ).toBeInTheDocument()
  })

  // A dimension the pipeline could not place is Unassessed, whether the service says so with a null
  // or by leaving the dimension out of the map; both ends of a move read as one word. A run with no
  // confirmed bands has no points and files no export, and the dialog says which rather than
  // printing a blank where a version number goes.
  it('names an unassessed end of a move, and says when no export was written', async () => {
    actions.neutralizeClaimAction.mockResolvedValue(answered(UNPLACED))
    const { user } = renderDialog()

    const dialog = await enterCorrection(user)

    const answer = within(dialog).getByRole('status')
    expect(
      within(answer).getByText(
        t('review.recomputeRow', {
          dimension: enUS['band.dimension.calibration'],
          before: enUS['band.unassessed'],
          after: enUS['band.developing'],
        }),
      ),
    ).toBeInTheDocument()
    expect(
      within(answer).getByText(
        t('review.recomputeRow', {
          dimension: enUS['band.dimension.adaptation'],
          before: enUS['band.unassessed'],
          after: enUS['band.novice'],
        }),
      ),
    ).toBeInTheDocument()
    expect(
      within(answer).getByText(t('review.recomputePoints', { before: '—', after: '—' })),
    ).toBeInTheDocument()
    expect(
      within(answer).getByText(t('review.recomputeKeeps', { effective: '—' })),
    ).toBeInTheDocument()
    expect(within(answer).getByText(enUS['review.recomputeNoExport'])).toBeInTheDocument()
  })

  // The seven dimensions and the four rungs of the band ladder are one closed vocabulary, and a
  // correction reaches all of it: a claim leaving the stance matrix can move any dimension the
  // pipeline reads it into. The dialog names each of them from a lookup, so a dimension or a band
  // the map has not got is not a blank row — it throws where the row is drawn, and takes the answer
  // the instructor is standing there to read with it.
  it('names every dimension and every band the ladder holds', async () => {
    actions.neutralizeClaimAction.mockResolvedValue(answered(ALL_SEVEN))
    const { user } = renderDialog()

    const dialog = await enterCorrection(user)

    const answer = within(dialog).getByRole('status')
    for (const [dimension, before, after] of ALL_SEVEN_ROWS) {
      expect(
        within(answer).getByText(t('review.recomputeRow', { dimension, before, after })),
      ).toBeInTheDocument()
    }
    expect(within(answer).getAllByRole('listitem')).toHaveLength(ALL_SEVEN_ROWS.length)
  })

  it('puts the question away once it is answered', async () => {
    const { user } = renderDialog()

    await enterCorrection(user)

    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: enUS['review.neutralizeConfirm'] }),
    ).not.toBeInTheDocument()
  })
})

describe('a refusal from the service', () => {
  it('keeps the form, says why, and leaves the correction unfiled', async () => {
    actions.neutralizeClaimAction.mockResolvedValue(
      refused('NEUTRALIZATION_EXISTS', DEFAULT_MESSAGES.NEUTRALIZATION_EXISTS),
    )
    const { user } = renderDialog()

    await openQuestion(user)
    await user.click(enter())

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(DEFAULT_MESSAGES.NEUTRALIZATION_EXISTS)
    })
    // The dialog is still the question: nothing was recomputed, so there is nothing to report.
    expect(reason(enUS['review.neutralizeReason.unintendedDefect'])).toBeChecked()
    expect(screen.queryByText(enUS['review.recomputeTitle'])).not.toBeInTheDocument()
    expect(router.refresh).not.toHaveBeenCalled()
  })

  it('replaces the refusal with the answer when the correction goes through on a second press', async () => {
    actions.neutralizeClaimAction.mockResolvedValueOnce(
      refused('RUN_NOT_SCORED', DEFAULT_MESSAGES.RUN_NOT_SCORED),
    )
    const { user } = renderDialog()

    await openQuestion(user)
    await user.click(enter())
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(DEFAULT_MESSAGES.RUN_NOT_SCORED)
    })

    await user.click(enter())

    await screen.findByRole('dialog', { name: enUS['review.recomputeTitle'] })
    expect(screen.queryByText(DEFAULT_MESSAGES.RUN_NOT_SCORED)).not.toBeInTheDocument()
    expect(actions.neutralizeClaimAction).toHaveBeenCalledTimes(2)
  })
})

describe('while the recompute is running', () => {
  // `aria-disabled`, never `disabled`: the browser blurs a control the moment it is disabled, and
  // inside a dialog that drops a keyboard user out of the focus trap at the exact moment a refusal
  // is about to be announced under it.
  it('marks the control busy without losing the keyboard, and swallows a second press', async () => {
    const release = deferAnswer()
    const { user } = renderDialog()

    await openQuestion(user)
    const button = enter()
    await user.click(button)

    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'true'))
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).toHaveAccessibleName(enUS['review.neutralizePending'])
    expect(button).not.toBeDisabled()
    expect(button).toHaveFocus()

    await user.click(button)
    expect(actions.neutralizeClaimAction).toHaveBeenCalledTimes(1)

    release(answered(RAISED))
    await screen.findByRole('dialog', { name: enUS['review.recomputeTitle'] })
  })

  // A recompute that is already with the service cannot be dismissed out from under: the answer is
  // the only place five of its facts exist, and a dialog that closed here would lose them.
  it('refuses to close under a recompute in flight, by either way out', async () => {
    const release = deferAnswer()
    const { user } = renderDialog()

    await openQuestion(user)
    const button = enter()
    await user.click(button)
    await waitFor(() => expect(button).toHaveAccessibleName(enUS['review.neutralizePending']))

    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.click(cancel())
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(actions.neutralizeClaimAction).toHaveBeenCalledTimes(1)

    release(answered(RAISED))
    await screen.findByRole('dialog', { name: enUS['review.recomputeTitle'] })
  })

  // D-706: React 19 leaves an update made after an `await` outside the async transition unless it
  // is wrapped again, so the answer used to paint one commit before `pending` fell — and a Close
  // pressed in that gap was refused by the guard above. The answer and the end of the pending state
  // land together, so the first press on Close is the press that closes it.
  it('closes on the first press the moment the answer is on screen', async () => {
    const release = deferAnswer()
    const { user } = renderDialog()

    await openQuestion(user)
    await user.click(enter())
    release(answered(RAISED))

    await screen.findByRole('dialog', { name: enUS['review.recomputeTitle'] })
    expect(
      screen.queryByRole('button', { name: enUS['review.neutralizePending'] }),
      'the answer and the end of the pending state land in one commit, so the guard on the close is already down',
    ).not.toBeInTheDocument()

    await user.click(close())

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

describe('closing the answer', () => {
  // D-464: the refresh moved from the success handler to the close handler, because the refreshed
  // tree renders "this claim already carries a correction" in place of the trigger — which unmounts
  // the open dialog holding the recompute and drops focus to the document.
  it('holds the page still until the reader has closed the answer', async () => {
    const { user } = renderDialog()

    await enterCorrection(user)
    expect(router.refresh).not.toHaveBeenCalled()

    await user.click(close())

    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1))
  })

  // The same decision from the page's side: the action revalidates the replay, so this component is
  // re-rendered with `alreadyCorrected` true while its dialog is open. It renders that state itself
  // and only once the answer has been dismissed, so the recompute survives its own revalidation.
  it('keeps the recompute on screen when the page re-renders with the claim now corrected', async () => {
    const { user, rerender } = renderDialog()

    const dialog = await enterCorrection(user)
    rerender({ alreadyCorrected: true })

    expect(dialog).toHaveTextContent(enUS['review.recomputeTitle'])
    expect(
      within(dialog).getByText(t('review.recomputeKeeps', { effective: '7.500' })),
    ).toBeInTheDocument()
    expect(screen.queryByText(enUS['review.neutralizeAlreadyDone'])).not.toBeInTheDocument()

    await user.click(close())

    await waitFor(() =>
      expect(screen.getByText(enUS['review.neutralizeAlreadyDone'])).toBeInTheDocument(),
    )
    expect(
      screen.queryByRole('button', { name: t('review.neutralizeOpen', { key: CLAIM_KEY }) }),
    ).not.toBeInTheDocument()
  })

  // A closed dialog is a finished act. Reopening it is a new correction, not last time's answer
  // shown again over a claim that already carries one.
  it('opens a fresh question rather than the answer it last showed', async () => {
    const { user } = renderDialog()

    await enterCorrection(user)
    await user.click(close())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await openQuestion(user)

    expect(reason(enUS['review.neutralizeReason.unintendedDefect'])).toBeInTheDocument()
    expect(screen.queryByText(enUS['review.recomputeTitle'])).not.toBeInTheDocument()
    expect(
      screen.queryByText(t('review.recomputeKeeps', { effective: '7.500' })),
    ).not.toBeInTheDocument()
  })
})
