import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ManualBandsForm } from '@/components/features/review/manual-bands-form'
import { DEFAULT_MESSAGES } from '@/lib/errors'
import { enUS } from '@/lib/i18n/en-US'
import { t } from '@/lib/i18n/t'

// UI-033's held-run form (FR-140): the seven bands a reviewer records by hand when the pipeline
// could not place a single one. It is only drawn under `capabilities.canBandManually`, so a seat
// that may not band never meets it; what is protected here is what the form itself decides.
//
//   * **All seven, or none.** A held run has no draft to fall back on for a dimension the reviewer
//     skipped, so a partial hand-banding would leave the run in `scored` with dimensions holding
//     neither a band nor a reason — the state FR-004 forbids. The form refuses locally, and the
//     refusal names the dimensions still wanting one: on thirty-five radios, "one of the seven is
//     missing" sends the reader back to the top to count.
//   * **Nothing opens selected.** There is no draft here — that is what "held" means — so a
//     pre-selected option would be the screen guessing a band for a run nothing could read.
//     `Unassessed` is offered as the answer for a dimension the run holds nothing to place, which
//     is a band-shaped answer and not a score: no composite, rank or percentile exists anywhere.
//   * **One press carries the run the whole way.** `bandHeldRunManually` writes the seven drafts,
//     confirms them, and takes the run `defense_complete → scored → confirmed` (10 §12), so the
//     press is not repeatable. The pending guard has to swallow a second one, and a refusal from
//     the service has to leave the thirty-five selections exactly where the reviewer left them.

const RUN_ID = '9b1c0f77-2c4d-4a55-9c1e-77b0a1e4c210'

const actions = vi.hoisted(() => ({ bandHeldRunManuallyAction: vi.fn() }))

// The real module drags the review service, the database client and `server-only` into jsdom.
vi.mock('@/server/modules/review/actions', () => ({
  bandHeldRunManuallyAction: actions.bandHeldRunManuallyAction,
}))

const refresh = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

// `@/lib/toast` reaches sonner through a dynamic import, which this mock answers as well.
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: toasts.success, error: toasts.error } }))

/** The seven in the order the form draws them, which is the order the refusal names them in. */
const DIMENSION_KEYS = [
  'framing',
  'delegation',
  'verification',
  'calibration',
  'decision_quality',
  'adaptation',
  'ownership',
] as const
type DimensionKey = (typeof DIMENSION_KEYS)[number]

/** The four rubric bands and the one answer that is not a band, in the order the row offers them. */
const OPTION_VALUES = ['novice', 'developing', 'proficient', 'professional', 'unassessed'] as const
type OptionValue = (typeof OPTION_VALUES)[number]

const DIMENSION_LABELS: Record<DimensionKey, string> = {
  framing: enUS['band.dimension.framing'],
  delegation: enUS['band.dimension.delegation'],
  verification: enUS['band.dimension.verification'],
  calibration: enUS['band.dimension.calibration'],
  decision_quality: enUS['band.dimension.decision_quality'],
  adaptation: enUS['band.dimension.adaptation'],
  ownership: enUS['band.dimension.ownership'],
}

const OPTION_LABELS: Record<OptionValue, string> = {
  novice: enUS['band.novice'],
  developing: enUS['band.developing'],
  proficient: enUS['band.proficient'],
  professional: enUS['band.professional'],
  unassessed: enUS['review.decisionOptionUnassessed'],
}

/** A complete hand-banding, with `unassessed` among it because that is an answer the form takes. */
const COMPLETE: Record<DimensionKey, OptionValue> = {
  framing: 'proficient',
  delegation: 'developing',
  verification: 'novice',
  calibration: 'professional',
  decision_quality: 'proficient',
  adaptation: 'unassessed',
  ownership: 'developing',
}

type User = ReturnType<typeof userEvent.setup>

/** Every label repeats down the form, so a radio is only unambiguous inside its own dimension. */
const group = (dimension: DimensionKey) =>
  screen.getByRole('radiogroup', { name: DIMENSION_LABELS[dimension] })

const option = (dimension: DimensionKey, value: OptionValue) =>
  within(group(dimension)).getByRole('radio', { name: OPTION_LABELS[value] })

const submit = () => screen.getByRole('button', { name: enUS['review.manualSubmit'] })

const recording = () => screen.getByRole('button', { name: enUS['review.manualPending'] })

/** The refusal, as the reader sees it: the dimensions still wanting an answer, in form order. */
const incomplete = (dimensions: readonly DimensionKey[]) =>
  t('review.manualIncompleteNamed', {
    dimensions: dimensions.map((key) => DIMENSION_LABELS[key]).join(', '),
  })

function renderForm(): User {
  render(<ManualBandsForm runId={RUN_ID} />)
  return userEvent.setup()
}

/** Answers the dimensions given, in form order, leaving the rest as the form opened them. */
async function chooseBands(
  user: User,
  bands: Partial<Record<DimensionKey, OptionValue | undefined>>,
): Promise<void> {
  for (const key of DIMENSION_KEYS) {
    const value = bands[key]
    if (value === undefined) continue
    await user.click(option(key, value))
  }
}

/** What `runNotHeld` reaches the form as: a hold moves nothing, so the run may already have left it. */
const refused = (message: string) => ({
  ok: false as const,
  error: { code: 'RUN_NOT_SCORABLE', message, requestId: 'req_1' },
})

describe('ManualBandsForm (UI-033, FR-140)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actions.bandHeldRunManuallyAction.mockResolvedValue({ ok: true, data: {} })
  })

  it('draws the seven dimensions and says the seven go on the record together', () => {
    renderForm()

    expect(screen.getByText(enUS['review.manualDescription'])).toBeInTheDocument()
    for (const key of DIMENSION_KEYS) {
      expect(group(key)).toBeInTheDocument()
    }
    expect(screen.getAllByRole('radiogroup')).toHaveLength(DIMENSION_KEYS.length)
  })

  // The pipeline could not place this run, so the screen must not place it either: an option
  // already selected would be a band the reviewer never chose but would be recorded as theirs.
  it('opens with nothing chosen anywhere, and sends nothing on mount', () => {
    renderForm()

    for (const key of DIMENSION_KEYS) {
      for (const value of OPTION_VALUES) {
        expect(option(key, value)).not.toBeChecked()
      }
    }
    expect(actions.bandHeldRunManuallyAction).not.toHaveBeenCalled()
  })

  // Four bands and `Unassessed`, and nothing else: there is no composite, no rank and no percentile
  // in the product, so a hand-banding has no total to enter either.
  it('offers the four bands and Unassessed, in rubric order, on every dimension', () => {
    renderForm()

    for (const key of DIMENSION_KEYS) {
      const radios = within(group(key)).getAllByRole('radio')
      expect(radios).toHaveLength(OPTION_VALUES.length)
      OPTION_VALUES.forEach((value, index) => {
        expect(radios[index]).toBe(option(key, value))
      })
    }
  })

  it('sends nothing while bands are merely being chosen', async () => {
    const user = renderForm()

    await chooseBands(user, COMPLETE)

    expect(option('adaptation', 'unassessed')).toBeChecked()
    expect(actions.bandHeldRunManuallyAction).not.toHaveBeenCalled()
  })

  // FR-004: a partial hand-banding would leave dimensions with neither a band nor a reason, so the
  // form answers for the service rather than sending six and letting the seventh come back refused.
  it('refuses an empty form by name, and sends nothing', async () => {
    const user = renderForm()

    await user.click(submit())

    expect(await screen.findByText(incomplete(DIMENSION_KEYS))).toBeInTheDocument()
    expect(actions.bandHeldRunManuallyAction).not.toHaveBeenCalled()
  })

  it('names only the dimension still wanting an answer when six of the seven are set', async () => {
    const user = renderForm()

    await chooseBands(user, { ...COMPLETE, ownership: undefined })
    await user.click(submit())

    expect(await screen.findByText(incomplete(['ownership']))).toBeInTheDocument()
    expect(actions.bandHeldRunManuallyAction).not.toHaveBeenCalled()
  })

  it('names the several that are missing, in the order the form draws them', async () => {
    const user = renderForm()

    await chooseBands(user, {
      framing: 'novice',
      calibration: 'proficient',
      ownership: 'developing',
    })
    await user.click(submit())

    expect(
      await screen.findByText(
        incomplete(['delegation', 'verification', 'decision_quality', 'adaptation']),
      ),
    ).toBeInTheDocument()
  })

  // The refusal is stale the moment the reader acts on it; leaving it up would have them reading a
  // list of dimensions they have just answered.
  it('drops the refusal as soon as a band is chosen, and then sends the seven', async () => {
    const user = renderForm()

    await chooseBands(user, { ...COMPLETE, ownership: undefined })
    await user.click(submit())
    expect(await screen.findByText(incomplete(['ownership']))).toBeInTheDocument()

    await user.click(option('ownership', COMPLETE.ownership))

    expect(screen.queryByText(incomplete(['ownership']))).not.toBeInTheDocument()
    await user.click(submit())
    await waitFor(() => {
      expect(actions.bandHeldRunManuallyAction).toHaveBeenCalledWith({
        runId: RUN_ID,
        bands: COMPLETE,
      })
    })
  })

  it('sends all seven in one call, with `unassessed` carried as an answer of its own', async () => {
    const user = renderForm()

    await chooseBands(user, COMPLETE)
    await user.click(submit())

    await waitFor(() => {
      expect(actions.bandHeldRunManuallyAction).toHaveBeenCalledWith({
        runId: RUN_ID,
        bands: COMPLETE,
      })
    })
    expect(actions.bandHeldRunManuallyAction).toHaveBeenCalledTimes(1)
  })

  // A reviewer who changes their mind on a dimension has changed it, not added to it: the payload
  // carries one band per dimension, the last one chosen.
  it('records the last band chosen on a dimension, not the first', async () => {
    const user = renderForm()

    await chooseBands(user, COMPLETE)
    await user.click(option('framing', 'novice'))
    await user.click(submit())

    await waitFor(() => {
      expect(actions.bandHeldRunManuallyAction).toHaveBeenCalledWith({
        runId: RUN_ID,
        bands: { ...COMPLETE, framing: 'novice' },
      })
    })
    expect(option('framing', 'proficient')).not.toBeChecked()
  })

  it('confirms the record and catches the page up once the seven are written', async () => {
    const user = renderForm()

    await chooseBands(user, COMPLETE)
    await user.click(submit())

    await waitFor(() => {
      expect(toasts.success).toHaveBeenCalledWith(enUS['review.manualDone'])
    })
    expect(refresh).toHaveBeenCalled()
  })

  // WCAG 2.2 AA §2.4.3. The run leaves `held` on this press, so the server render removes the whole
  // panel — and with it the button holding the caret. Focus goes to the page title, which is where
  // a client-side navigation puts it, rather than to `document.body`.
  it('sends the caret to the page title, because the panel it was in is about to go', async () => {
    const heading = document.createElement('h1')
    heading.id = 'page-title'
    heading.tabIndex = -1
    document.body.append(heading)

    const user = renderForm()
    await chooseBands(user, COMPLETE)
    await user.click(submit())

    await waitFor(() => {
      expect(heading).toHaveFocus()
    })
    heading.remove()
  })

  it('says why when the service refuses, and keeps the thirty-five selections as they were', async () => {
    actions.bandHeldRunManuallyAction.mockResolvedValue(refused(DEFAULT_MESSAGES.RUN_NOT_SCORABLE))
    const user = renderForm()

    await chooseBands(user, COMPLETE)
    await user.click(submit())

    const message = await screen.findByText(DEFAULT_MESSAGES.RUN_NOT_SCORABLE)
    expect(screen.getByRole('alert')).toContainElement(message)
    expect(toasts.success).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
    // The reviewer's work survives the refusal: none of it is re-entered to press again, and the
    // button comes back rather than the panel being left in the state the failed press put it in.
    expect(await screen.findByRole('button', { name: enUS['review.manualSubmit'] })).toBeVisible()
    expect(option('adaptation', 'unassessed')).toBeChecked()
    expect(option('calibration', 'professional')).toBeChecked()
  })

  // `aria-disabled`, not `disabled`: the browser blurs a control the moment it is disabled, which
  // would drop the keyboard to `<body>` on the press that ends the run's review.
  it('marks the button busy while the seven are being written, without losing focus', async () => {
    let release: (result: { ok: true; data: unknown }) => void = () => {}
    actions.bandHeldRunManuallyAction.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    const user = renderForm()

    await chooseBands(user, COMPLETE)
    await user.click(submit())

    await waitFor(() => expect(recording()).toHaveAttribute('aria-busy', 'true'))
    expect(recording()).toHaveAttribute('aria-disabled', 'true')
    expect(recording()).not.toBeDisabled()
    expect(recording()).toHaveFocus()

    release({ ok: true, data: {} })
    await waitFor(() => expect(submit()).not.toHaveAttribute('aria-disabled'))
  })

  // The hand-banding takes the run through to `confirmed`, so a second press is a second attempt at
  // something already irreversible: it is swallowed rather than sent.
  it('swallows a second press while the first is still with the service', async () => {
    let release: (result: { ok: true; data: unknown }) => void = () => {}
    actions.bandHeldRunManuallyAction.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    const user = renderForm()

    await chooseBands(user, COMPLETE)
    await user.click(submit())
    await waitFor(() => expect(recording()).toHaveAttribute('aria-disabled', 'true'))

    await user.click(recording())
    expect(actions.bandHeldRunManuallyAction).toHaveBeenCalledTimes(1)

    release({ ok: true, data: {} })
    await waitFor(() => expect(submit()).toBeInTheDocument())
  })
})
