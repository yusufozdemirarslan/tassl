import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BandDecisionControl,
  decisionFor,
  type BandDecisionControlProps,
} from '@/components/features/review/band-decision-control'
import { enUS } from '@/lib/i18n/en-US'

// UI-033's decision control (FR-181, FR-182), and the three properties the step names.
//
//   * **The draft is pre-selected and not submitted.** A reviewer arriving at a dimension sees
//     where the run stands without the screen having decided anything for them — which is the whole
//     of UI-033's A11y line, and the difference between a control that informs and one that acts.
//     The primary control's *label* states what the current selection would do — "Confirm the
//     draft: Proficient", "Record Novice instead", "Record this dimension as Unassessed" — because
//     a fixed "Save this decision" beside a second button reading "Confirm the draft" left two
//     controls sending the identical payload in the common case (the critique's P3). The secondary
//     control appears only once the selection has moved off the draft, and names the draft's band.
//   * **An override requires a band.** On a dimension the pipeline could not place there is no
//     draft to pre-select, so the group opens empty and "Save this decision" refuses locally rather
//     than sending a decision with no band for the service to answer BAND_DECISION_INVALID to.
//   * **The note is optional.** FR-182: "an override requires no justification". Saving with the
//     field empty sends no note at all, rather than an empty string that would render as a blank
//     line beside the band in the student's debrief.
//
// A fourth property is asserted because it is the one the other three are easy to break: nothing is
// sent on mount, on selection, or on typing. The action fires on a press and on nothing else.

const RUN_ID = '4a4a5f22-1d2f-4a1b-9c33-2b1f8a10c001'

const actions = vi.hoisted(() => ({ decideBandAction: vi.fn() }))

// The real module drags the review service and the database into jsdom.
vi.mock('@/server/modules/review/actions', () => ({
  decideBandAction: actions.decideBandAction,
}))

const refresh = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const BASE: BandDecisionControlProps = {
  runId: RUN_ID,
  dimension: 'verification',
  dimensionLabel: enUS['band.dimension.verification'],
  draftBand: 'proficient',
  decidedBand: null,
  decision: null,
  note: null,
  canDecide: true,
  willReexport: false,
}

const radio = (label: string) => screen.getByRole('radio', { name: label })

/** The primary control, found by whatever it currently says it will do. */
const act = (label: string) => screen.getByRole('button', { name: label })

const confirmsDraft = (band: string): string =>
  enUS['review.decisionConfirmBand'].replace('{band}', band)
const recordsInstead = (band: string): string =>
  enUS['review.decisionRecordInstead'].replace('{band}', band)
const save = () => act(confirmsDraft(enUS['band.proficient']))

beforeEach(() => {
  actions.decideBandAction.mockReset()
  actions.decideBandAction.mockResolvedValue({ ok: true, data: {} })
  refresh.mockReset()
})

describe('the draft is pre-selected but not submitted', () => {
  it('opens with the drafted band checked and sends nothing', () => {
    render(<BandDecisionControl {...BASE} />)

    expect(radio(enUS['band.proficient'])).toBeChecked()
    expect(radio(enUS['band.novice'])).not.toBeChecked()
    expect(radio(enUS['review.decisionOptionUnassessed'])).not.toBeChecked()
    expect(actions.decideBandAction).not.toHaveBeenCalled()
  })

  it('sends nothing when a different band is merely selected', async () => {
    const user = userEvent.setup()
    render(<BandDecisionControl {...BASE} />)

    await user.click(radio(enUS['band.developing']))

    expect(radio(enUS['band.developing'])).toBeChecked()
    expect(actions.decideBandAction).not.toHaveBeenCalled()
  })

  it('opens on the band already on the record when there is one', () => {
    render(
      <BandDecisionControl
        {...BASE}
        decision="overridden"
        decidedBand="developing"
        note="Read the payback figure again."
      />,
    )

    expect(radio(enUS['band.developing'])).toBeChecked()
    expect(radio(enUS['band.proficient'])).not.toBeChecked()
  })

  it('names the draft in the primary control, and offers no second way to confirm it', () => {
    render(<BandDecisionControl {...BASE} />)

    expect(act(confirmsDraft(enUS['band.proficient']))).toBeInTheDocument()
    expect(
      screen.getAllByRole('button', { name: confirmsDraft(enUS['band.proficient']) }),
      'a second button sending the identical payload is two words for one act',
    ).toHaveLength(1)
  })

  it('names the override in the primary control once the selection moves off the draft', async () => {
    const user = userEvent.setup()
    render(<BandDecisionControl {...BASE} />)

    await user.click(radio(enUS['band.novice']))

    expect(act(recordsInstead(enUS['band.novice']))).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: confirmsDraft(enUS['band.proficient']) }),
      'reverting to the draft is a distinct act once the selection has moved, and it names the band',
    ).toBeInTheDocument()
  })

  it('records confirmation when the draft is saved as it stands', async () => {
    const user = userEvent.setup()
    render(<BandDecisionControl {...BASE} />)

    await user.click(save())

    await waitFor(() => {
      expect(actions.decideBandAction).toHaveBeenCalledWith({
        runId: RUN_ID,
        dimension: 'verification',
        decision: 'confirmed',
      })
    })
  })

  it('records an override when another band is chosen and saved', async () => {
    const user = userEvent.setup()
    render(<BandDecisionControl {...BASE} />)

    await user.click(radio(enUS['band.professional']))
    await user.click(act(recordsInstead(enUS['band.professional'])))

    await waitFor(() => {
      expect(actions.decideBandAction).toHaveBeenCalledWith({
        runId: RUN_ID,
        dimension: 'verification',
        decision: 'overridden',
        band: 'professional',
      })
    })
  })

  it('reverts to the draft from the secondary control after a selection moved', async () => {
    const user = userEvent.setup()
    render(<BandDecisionControl {...BASE} />)

    await user.click(radio(enUS['band.novice']))
    await user.click(act(confirmsDraft(enUS['band.proficient'])))

    await waitFor(() => {
      expect(actions.decideBandAction).toHaveBeenCalledWith({
        runId: RUN_ID,
        dimension: 'verification',
        decision: 'confirmed',
      })
    })
  })
})

describe('an override requires a band', () => {
  it('opens with nothing selected when the draft could not be placed', () => {
    render(<BandDecisionControl {...BASE} draftBand={null} />)

    for (const label of [
      enUS['band.novice'],
      enUS['band.developing'],
      enUS['band.proficient'],
      enUS['band.professional'],
      enUS['review.decisionOptionUnassessed'],
    ]) {
      expect(radio(label)).not.toBeChecked()
    }
  })

  it('refuses to save with no band chosen, and says so instead of sending', async () => {
    const user = userEvent.setup()
    render(<BandDecisionControl {...BASE} draftBand={null} />)

    await user.click(act(enUS['review.decisionChoose']))

    expect(await screen.findByText(enUS['review.decisionChooseBand'])).toBeInTheDocument()
    expect(actions.decideBandAction).not.toHaveBeenCalled()
  })

  it('sends the override once a band is chosen after the refusal', async () => {
    const user = userEvent.setup()
    render(<BandDecisionControl {...BASE} draftBand={null} />)

    await user.click(act(enUS['review.decisionChoose']))
    await user.click(radio(enUS['band.developing']))
    await user.click(act(recordsInstead(enUS['band.developing'])))

    await waitFor(() => {
      expect(actions.decideBandAction).toHaveBeenCalledWith({
        runId: RUN_ID,
        dimension: 'verification',
        decision: 'overridden',
        band: 'developing',
      })
    })
  })

  it('records `unassessed` without a band, because that option is not one', async () => {
    const user = userEvent.setup()
    render(<BandDecisionControl {...BASE} draftBand={null} />)

    await user.click(radio(enUS['review.decisionOptionUnassessed']))
    await user.click(act(enUS['review.decisionMarkUnassessed']))

    await waitFor(() => {
      expect(actions.decideBandAction).toHaveBeenCalledWith({
        runId: RUN_ID,
        dimension: 'verification',
        decision: 'unassessed',
      })
    })
  })
})

describe('the note is optional', () => {
  it('sends no note when the field is left empty', async () => {
    const user = userEvent.setup()
    render(<BandDecisionControl {...BASE} />)

    await user.click(save())

    await waitFor(() => {
      expect(actions.decideBandAction).toHaveBeenCalledTimes(1)
    })
    expect(actions.decideBandAction.mock.calls[0]?.[0]).not.toHaveProperty('note')
  })

  it('sends nothing for a field holding only whitespace', async () => {
    const user = userEvent.setup()
    render(<BandDecisionControl {...BASE} />)

    await user.type(screen.getByLabelText(enUS['review.decisionNoteLabel']), '   ')
    await user.click(save())

    await waitFor(() => {
      expect(actions.decideBandAction).toHaveBeenCalledTimes(1)
    })
    expect(actions.decideBandAction.mock.calls[0]?.[0]).not.toHaveProperty('note')
  })

  it('sends the note when one is written, and it is not required to be', async () => {
    const user = userEvent.setup()
    render(<BandDecisionControl {...BASE} />)

    await user.type(
      screen.getByLabelText(enUS['review.decisionNoteLabel']),
      'The Source Trace was run before the figure was relied on.',
    )
    await user.click(radio(enUS['band.professional']))
    await user.click(act(recordsInstead(enUS['band.professional'])))

    await waitFor(() => {
      expect(actions.decideBandAction).toHaveBeenCalledWith({
        runId: RUN_ID,
        dimension: 'verification',
        decision: 'overridden',
        band: 'professional',
        note: 'The Source Trace was run before the figure was relied on.',
      })
    })
  })
})

describe('a seat that may not change this dimension', () => {
  it('says so rather than offering a control that will refuse (08 §4)', () => {
    render(<BandDecisionControl {...BASE} canDecide={false} />)

    expect(screen.getByText(enUS['review.decisionLockedByInstructor'])).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('the rule the control is built on', () => {
  it.each([
    ['', 'proficient', null],
    ['proficient', 'proficient', { decision: 'confirmed' }],
    ['novice', 'proficient', { decision: 'overridden', band: 'novice' }],
    ['unassessed', 'proficient', { decision: 'unassessed' }],
    ['novice', null, { decision: 'overridden', band: 'novice' }],
    ['unassessed', null, { decision: 'unassessed' }],
  ] as const)('reads %s against a %s draft', (selection, draft, expected) => {
    expect(decisionFor(selection, draft)).toEqual(expected)
  })
})
