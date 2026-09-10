import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TestControls } from '@/components/features/review/test-controls'
import { VoidDialog, type VoidDialogProps } from '@/components/features/review/void-dialog'
import { DEFAULT_MESSAGES } from '@/lib/errors'
import { enUS } from '@/lib/i18n/en-US'

// The two controls in UI-033's Actions view that reach outside the replay: the void (FR-002,
// FR-008, FR-183, D-120) and the forced-failure arming of walkthrough step 7 (FR-118, D-332).
//
//   * **A void keeps the record and re-offers the run; it never deletes one.** That is FR-002, and
//     it is what separates this control from the walkthrough delete beside it on the queue. What
//     is protected here is the shape of what the dialog sends: the reason is one of the four
//     values `runs.void_reason` holds and nothing else, and the sentence the instructor wants to
//     write travels separately as a note, because D-120 splits them — an aggregate groups by the
//     enum and only the replay reads the note.
//   * **A re-offer runs the other variant by default** (FR-183). The select is an override, so a
//     void asked for with the re-offer box ticked and the select untouched must send no variant at
//     all; a variant chosen and then withdrawn must send none either.
//   * **The forced failure is offered only where it can act.** `runs.forceAssistantFailure` arms
//     the *next* assistant call, so `working`, `turn_open` and `paused` are the whole of the list
//     (`runs/errors.ts`); anywhere else the control says why it cannot act rather than pressing
//     into a refusal.
//
// Both controls are held to the same disabling rule, and it is asserted on each: `aria-disabled`
// and never `disabled`, because the browser blurs a control the moment it is disabled — which on
// the void would drop a keyboard user out of the dialog while the request is in flight.

const RUN_ID = '2f6d1b84-4c31-4d0e-9a7b-8c1e5f0a3d21'

const VARIANTS: VoidDialogProps['variants'] = [
  { id: 'c0a1d9f2-6b44-4f0e-8b21-1d7c4e9a0b33', key: 'defective' },
  { id: 'd7b2e8a3-5c19-4a6d-9f02-7e3a1c8b4d55', key: 'sound' },
]

const router = vi.hoisted(() => ({ refresh: vi.fn() }))
const actions = vi.hoisted(() => ({
  voidRunAction: vi.fn(),
  forceAssistantFailureAction: vi.fn(),
}))
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: router.refresh,
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
  usePathname: () => '/review/runs/2f6d1b84-4c31-4d0e-9a7b-8c1e5f0a3d21',
}))

// Both are Server Actions: importing the real module would pull the review service, the runs
// service, the database client and `server-only` into jsdom.
vi.mock('@/server/modules/review/actions', () => ({
  voidRunAction: actions.voidRunAction,
  forceAssistantFailureAction: actions.forceAssistantFailureAction,
}))

// `@/lib/toast` reaches sonner through a dynamic import, which this mock answers as well.
vi.mock('sonner', () => ({ toast: { success: toasts.success, error: toasts.error } }))

/** What a void answers: the run that was voided, and the run offered in its place if one was. */
const voidedWith = (reoffered: { id: string } | null) => ({
  ok: true as const,
  data: { voided: { id: RUN_ID }, reoffered },
})

const REOFFERED = { id: 'f3c7a2b1-9d84-4e15-8c60-2b9f5d1a7e08' }

const refused = (message: string) => ({
  ok: false as const,
  error: { code: 'ILLEGAL_TRANSITION', message, requestId: 'req_7' },
})

const radio = (label: string) => screen.getByRole('radio', { name: label })
const reofferBox = () => screen.getByRole('checkbox', { name: enUS['review.voidReoffer'] })
const noteField = () => screen.getByLabelText(enUS['review.voidNoteLabel'])
const confirm = () => screen.getByRole('button', { name: enUS['review.voidConfirm'] })
/** The same control while the void is with the service; it renames itself rather than vanishing. */
const voiding = () => screen.getByRole('button', { name: enUS['review.voidPending'] })
const cancel = () => screen.getByRole('button', { name: enUS['review.voidCancel'] })

/** Opens the dialog, which is where every one of these assertions begins. */
async function openVoid(props: Partial<VoidDialogProps> = {}) {
  const user = userEvent.setup()
  render(<VoidDialog runId={RUN_ID} variants={VARIANTS} exported={false} {...props} />)
  await user.click(screen.getByRole('button', { name: enUS['review.voidOpen'] }))
  await screen.findByRole('dialog', { name: enUS['review.voidDialogTitle'] })
  return user
}

describe('VoidDialog (UI-033, FR-002)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actions.voidRunAction.mockResolvedValue(voidedWith(null))
  })

  it('asks in a dialog, so the press that opens it decides nothing', async () => {
    const user = userEvent.setup()
    render(<VoidDialog runId={RUN_ID} variants={VARIANTS} exported={false} />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: enUS['review.voidOpen'] }))

    expect(
      await screen.findByRole('dialog', { name: enUS['review.voidDialogTitle'] }),
    ).toBeInTheDocument()
    expect(actions.voidRunAction).not.toHaveBeenCalled()
  })

  // FR-002: the record is kept and the run is re-offered, never deleted. The walkthrough delete on
  // the queue is the control that removes a run; this one must neither do that nor say it does.
  it('offers another run in the voided run’s place, and never speaks of deleting one', async () => {
    await openVoid()

    expect(screen.getByText(enUS['review.voidDialogBody'])).toBeInTheDocument()
    expect(reofferBox()).toBeInTheDocument()
    expect(enUS['review.voidDialogBody']).not.toMatch(/delet|erase|remove/i)
    expect(enUS['review.voidConfirm']).not.toMatch(/delet/i)
  })

  // D-120: `runs.void_reason` holds one of four values, and the dialog is where they are chosen.
  // A fifth option here would be a value the column cannot take and no aggregate could group by.
  it('offers exactly the four reasons the column can hold, opening on the least presumptuous', async () => {
    await openVoid()

    const reasons = [
      enUS['review.voidReason.unscoreable'],
      enUS['review.voidReason.held'],
      enUS['review.voidReason.walkthrough'],
      enUS['review.voidReason.other'],
    ]
    for (const label of reasons) expect(radio(label)).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(reasons.length)
    expect(radio(enUS['review.voidReason.unscoreable'])).toBeChecked()
  })

  // The other half of D-120: the note is free text on the run's own record, and the hint says so
  // at the field rather than in a help page, because that is where the instructor decides what to
  // write into it.
  it('says where the note goes, at the field the note is written in', async () => {
    await openVoid()

    expect(noteField()).toHaveAccessibleDescription(enUS['review.voidNoteHint'])
    expect(noteField()).toHaveValue('')
  })

  // FR-008: voiding an exported run withdraws a figure an instructor may already have entered in
  // the gradebook of record, and the dialog says so at the press rather than in a banner after it.
  it('warns that an exported figure is being withdrawn, only when one has been exported', async () => {
    await openVoid({ exported: true })

    expect(screen.getByText(enUS['review.voidExportedWarning'])).toBeInTheDocument()
  })

  it('leaves the export warning out of a run no export names', async () => {
    await openVoid({ exported: false })

    expect(screen.queryByText(enUS['review.voidExportedWarning'])).not.toBeInTheDocument()
  })

  it('sends the opening reason, no note and no re-offer when it is confirmed as it stands', async () => {
    const user = await openVoid()

    await user.click(confirm())

    await waitFor(() => {
      expect(actions.voidRunAction).toHaveBeenCalledWith({
        runId: RUN_ID,
        reason: 'unscoreable',
        reoffer: false,
      })
    })
  })

  it('sends the reason that was chosen', async () => {
    const user = await openVoid()

    await user.click(radio(enUS['review.voidReason.walkthrough']))
    await user.click(confirm())

    await waitFor(() => {
      expect(actions.voidRunAction).toHaveBeenCalledWith({
        runId: RUN_ID,
        reason: 'walkthrough',
        reoffer: false,
      })
    })
  })

  // A note of nothing but spaces is not a note. Sending it would put an empty line on the
  // `run_voided` event where the replay expects the instructor's sentence.
  it('sends no note at all for a field holding only whitespace', async () => {
    const user = await openVoid()

    await user.type(noteField(), '   ')
    await user.click(confirm())

    await waitFor(() => expect(actions.voidRunAction).toHaveBeenCalledTimes(1))
    expect(actions.voidRunAction.mock.calls[0]?.[0]).not.toHaveProperty('note')
  })

  it('sends the note when one is written, trimmed to what was meant', async () => {
    const user = await openVoid()

    await user.type(noteField(), '  The evidence room served the wrong revision all morning. ')
    await user.click(radio(enUS['review.voidReason.other']))
    await user.click(confirm())

    await waitFor(() => {
      expect(actions.voidRunAction).toHaveBeenCalledWith({
        runId: RUN_ID,
        reason: 'other',
        reoffer: false,
        note: 'The evidence room served the wrong revision all morning.',
      })
    })
  })

  // FR-183: the re-offer runs the other variant of the family by default, so an instructor voiding
  // a run because the material misbehaved does not have to know which variant the student drew.
  it('keeps the variant out of sight until a re-offer is asked for', async () => {
    const user = await openVoid()

    expect(screen.queryByLabelText(enUS['review.voidVariantLabel'])).not.toBeInTheDocument()
    await user.click(reofferBox())

    expect(await screen.findByLabelText(enUS['review.voidVariantLabel'])).toBeInTheDocument()
    expect(reofferBox()).toHaveAccessibleDescription(enUS['review.voidReofferHint'])
  })

  it('asks for a re-offer without naming a variant when the select is left alone', async () => {
    const user = await openVoid()

    await user.click(reofferBox())
    await screen.findByLabelText(enUS['review.voidVariantLabel'])
    await user.click(confirm())

    await waitFor(() => {
      expect(actions.voidRunAction).toHaveBeenCalledWith({
        runId: RUN_ID,
        reason: 'unscoreable',
        reoffer: true,
      })
    })
  })

  it('names the variant when one is chosen over the default', async () => {
    const user = await openVoid()

    await user.click(reofferBox())
    await user.selectOptions(await screen.findByLabelText(enUS['review.voidVariantLabel']), [
      VARIANTS[1]!.id,
    ])
    await user.click(confirm())

    await waitFor(() => {
      expect(actions.voidRunAction).toHaveBeenCalledWith({
        runId: RUN_ID,
        reason: 'unscoreable',
        reoffer: true,
        variantId: VARIANTS[1]!.id,
      })
    })
  })

  // A variant chosen and then thought better of must not survive the change of mind: the service
  // would take it as an override on a void that asked for no run at all.
  it('sends no variant once the re-offer itself is withdrawn', async () => {
    const user = await openVoid()

    await user.click(reofferBox())
    await user.selectOptions(await screen.findByLabelText(enUS['review.voidVariantLabel']), [
      VARIANTS[0]!.id,
    ])
    await user.click(reofferBox())
    await user.click(confirm())

    await waitFor(() => {
      expect(actions.voidRunAction).toHaveBeenCalledWith({
        runId: RUN_ID,
        reason: 'unscoreable',
        reoffer: false,
      })
    })
  })

  it('offers no variant select for a family with no variant to name', async () => {
    const user = await openVoid({ variants: [] })

    await user.click(reofferBox())

    expect(screen.queryByLabelText(enUS['review.voidVariantLabel'])).not.toBeInTheDocument()
    expect(screen.queryByText(enUS['review.voidVariantAuto'])).not.toBeInTheDocument()
  })

  it('confirms the void alone when the service offered no second run', async () => {
    const user = await openVoid()

    await user.click(confirm())

    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith(enUS['review.voidDone']))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(router.refresh).toHaveBeenCalled()
  })

  // Two runs came back, so the confirmation says so: the student's next act is on the second one,
  // and an instructor who reads only "voided" has no way to know it exists.
  it('names the re-offer in the confirmation when a second run came back', async () => {
    actions.voidRunAction.mockResolvedValue(voidedWith(REOFFERED))
    const user = await openVoid()

    await user.click(reofferBox())
    await user.click(confirm())

    await waitFor(() => {
      expect(toasts.success).toHaveBeenCalledWith(enUS['review.voidDoneWithReoffer'])
    })
  })

  // A second void on a run answers ILLEGAL_TRANSITION. The dialog stays open on the refusal with
  // everything still in it, because the instructor's next act is to read the sentence and decide,
  // not to type the note again.
  it('shows the refusal under the form and keeps the dialog and what was typed into it', async () => {
    actions.voidRunAction.mockResolvedValue(refused(DEFAULT_MESSAGES.ILLEGAL_TRANSITION))
    const user = await openVoid()

    await user.type(noteField(), 'Voided at the student’s request.')
    await user.click(confirm())

    expect(await screen.findByText(DEFAULT_MESSAGES.ILLEGAL_TRANSITION)).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: enUS['review.voidDialogTitle'] })).toBeInTheDocument()
    expect(noteField()).toHaveValue('Voided at the student’s request.')
    expect(toasts.success).not.toHaveBeenCalled()
    expect(router.refresh).not.toHaveBeenCalled()
  })

  // `aria-disabled`, never `disabled`: a disabled control is blurred by the browser, which drops a
  // keyboard user out of the dialog exactly while the void they asked for is in flight. The early
  // return in the handler is what `disabled` used to do, and the dialog refuses to close under a
  // request it has already sent — the press that confirmed it is the last one that decides.
  it('stays reachable and shut while the void is with the service, and takes one press only', async () => {
    let release: (result: ReturnType<typeof voidedWith>) => void = () => {}
    actions.voidRunAction.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    const user = await openVoid()

    await user.click(confirm())

    await waitFor(() => expect(voiding()).toHaveAttribute('aria-disabled', 'true'))
    expect(voiding()).toHaveAttribute('aria-busy', 'true')
    expect(voiding()).not.toBeDisabled()
    expect(voiding()).toHaveFocus()
    expect(cancel()).toHaveAttribute('aria-disabled', 'true')
    expect(cancel()).not.toBeDisabled()

    await user.click(voiding())
    expect(actions.voidRunAction).toHaveBeenCalledTimes(1)

    await user.click(cancel())
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: enUS['review.voidDialogTitle'] })).toBeInTheDocument()

    release(voidedWith(null))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('closes on the cancel that is not fighting a request in flight', async () => {
    const user = await openVoid()

    await user.click(cancel())

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(actions.voidRunAction).not.toHaveBeenCalled()
  })
})

const armButton = () => screen.getByRole('button', { name: enUS['review.testForceButton'] })

function renderControls(props: { runState?: string; alreadyArmed?: boolean } = {}) {
  const user = userEvent.setup()
  render(
    <TestControls
      runId={RUN_ID}
      runState={props.runState ?? 'working'}
      alreadyArmed={props.alreadyArmed ?? false}
    />,
  )
  return user
}

describe('TestControls (UI-033, FR-118)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actions.forceAssistantFailureAction.mockResolvedValue({ ok: true, data: { armed: true } })
  })

  // Three sentences stand above the button and none of them is optional (D-332). This is the one
  // control in the product that reaches into a live run, and the third sentence is the one that
  // carries the invariant: the student is shown that the assistant did not answer, that the clock
  // stopped and that nothing is lost — never that a control did it.
  it('says what it does to the run, why it exists, and what the student is shown', () => {
    renderControls()

    expect(screen.getByRole('heading', { name: enUS['review.testForceTitle'] })).toBeInTheDocument()
    expect(screen.getByText(enUS['review.testForceWhatItDoes'])).toBeInTheDocument()
    expect(screen.getByText(enUS['review.testForceWhyItExists'])).toBeInTheDocument()
    expect(screen.getByText(enUS['review.testForceStudentSees'])).toBeInTheDocument()
  })

  // `runs/errors.ts` fixes the three states in which there is an assistant call to arm; the
  // control is offered whole in each of them, with nothing to explain away.
  it.each(['working', 'turn_open', 'paused'])(
    'offers the control unqualified while the run is %s',
    (runState) => {
      renderControls({ runState })

      expect(armButton()).not.toHaveAttribute('aria-disabled')
      expect(screen.queryByText(enUS['review.testForceNotArmable'])).not.toBeInTheDocument()
    },
  )

  // Anywhere else the service answers RUN_LOCKED or ILLEGAL_TRANSITION, so the screen says why it
  // cannot act instead of pressing into a refusal. `aria-disabled` rather than `disabled` keeps
  // the reason reachable by keyboard and announced with the control (DESIGN.md §Buttons).
  it.each(['assigned', 'decision_locked', 'scored', 'voided'])(
    'says why it cannot act, without leaving the reason behind, on a %s run',
    async (runState) => {
      const user = renderControls({ runState })

      expect(armButton()).toHaveAttribute('aria-disabled', 'true')
      expect(armButton()).not.toBeDisabled()
      expect(armButton()).toHaveAccessibleDescription(enUS['review.testForceNotArmable'])

      await user.click(armButton())
      expect(actions.forceAssistantFailureAction).not.toHaveBeenCalled()
    },
  )

  // A standing state rather than a confirmation of something just done: the run is carrying an
  // outage nobody has met yet, and an instructor arriving at the screen has to be told before they
  // arm a second one.
  it('says an outage is already waiting when the run carries the flag', () => {
    renderControls({ alreadyArmed: true })

    expect(screen.getByText(enUS['review.testForceArmed'])).toBeInTheDocument()
  })

  it('says nothing of the sort on a run that carries none', () => {
    renderControls()

    expect(screen.queryByText(enUS['review.testForceArmed'])).not.toBeInTheDocument()
  })

  it('arms the outage on the run it was given, and catches the replay up', async () => {
    const user = renderControls()

    await user.click(armButton())

    await waitFor(() => {
      expect(actions.forceAssistantFailureAction).toHaveBeenCalledWith({ runId: RUN_ID })
    })
    await waitFor(() => {
      expect(toasts.success).toHaveBeenCalledWith(enUS['review.testForceDone'])
    })
    expect(router.refresh).toHaveBeenCalled()
  })

  // The instructor pressed it on a state the screen believed was armable and the service disagreed
  // — the student may have finished the Turn in between. The refusal is shown where the press was,
  // and nothing is confirmed.
  it('shows the service’s refusal and confirms nothing', async () => {
    actions.forceAssistantFailureAction.mockResolvedValue(
      refused(enUS['run.forcedFailureNotArmable']),
    )
    const user = renderControls()

    await user.click(armButton())

    expect(await screen.findByText(enUS['run.forcedFailureNotArmable'])).toBeInTheDocument()
    expect(toasts.success).not.toHaveBeenCalled()
    expect(router.refresh).not.toHaveBeenCalled()
  })

  // One outage per press. A second press while the first is in flight would arm the flag twice on
  // a run that can only carry it once, and the guard is the handler rather than the browser so the
  // control keeps its focus.
  it('says it is arming, and swallows a second press while the first is in flight', async () => {
    let release: (result: { ok: true; data: { armed: boolean } }) => void = () => {}
    actions.forceAssistantFailureAction.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    const user = renderControls()

    await user.click(armButton())

    const busy = await screen.findByRole('button', { name: enUS['review.testForcePending'] })
    expect(busy).toHaveAttribute('aria-busy', 'true')
    expect(busy).toHaveAttribute('aria-disabled', 'true')
    expect(busy).not.toBeDisabled()

    await user.click(busy)
    expect(actions.forceAssistantFailureAction).toHaveBeenCalledTimes(1)

    release({ ok: true, data: { armed: true } })
    await waitFor(() => expect(armButton()).toBeInTheDocument())
  })
})
