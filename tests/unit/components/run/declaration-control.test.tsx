import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeclarationControl } from '@/components/features/run/declaration-control'
import { enUS } from '@/lib/i18n/en-US'

// UI-023's outside-tool declaration (FR-061, FR-062, FR-006).
//
// The control is one field and one press, and what matters about it is as much what is absent as
// what is there: no question about whether the tool was allowed, no list to pick from, no
// acknowledgement to tick, no warning, and no report of what happens next — because nothing
// happens next. The no-penalty sentence is on screen before the control is opened, because it is
// the reason the control is safe to use.

const RUN_ID = '9f6ab2f8-9f14-4f6f-a3a0-64f1f3a1a001'

const actions = vi.hoisted(() => ({ declareOutsideToolAction: vi.fn() }))

// The real module drags the assistant service and the database into jsdom.
vi.mock('@/server/modules/assistant/actions', () => ({
  declareOutsideToolAction: actions.declareOutsideToolAction,
}))

const openButton = () => screen.getByRole('button', { name: enUS['workspace.declarationOpen'] })
const purposeBox = () => screen.getByLabelText(enUS['workspace.declarationPurposeLabel'])
const submitButton = () => screen.getByRole('button', { name: enUS['workspace.declarationSubmit'] })
const cancelButton = () => screen.getByRole('button', { name: enUS['workspace.declarationCancel'] })
/** Somewhere else on the workspace, for the student who moved on while the write was in flight. */
const elsewhere = () => screen.getByRole('button', { name: 'Somewhere else on the screen' })

function renderControl() {
  render(
    <>
      <DeclarationControl runId={RUN_ID} />
      <button type="button">Somewhere else on the screen</button>
    </>,
  )
  return userEvent.setup()
}

describe('DeclarationControl (UI-023, FR-061)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actions.declareOutsideToolAction.mockResolvedValue({ ok: true, data: null })
  })

  it('states the no-penalty sentence beside the control, before it is opened', () => {
    renderControl()

    expect(screen.getByText(enUS['workspace.declarationNoPenalty'])).toBeInTheDocument()
    expect(openButton()).toHaveAttribute('aria-expanded', 'false')
    // Nothing on this panel asks whether the tool was allowed or names the course's policy.
    const panel = screen.getByRole('region', { name: enUS['workspace.declarationTitle'] })
    for (const word of ['policy', 'allowed', 'permitted', 'misconduct', 'cheat']) {
      expect(panel.textContent?.toLowerCase().split('nothing it records')[0]).not.toContain(word)
    }
  })

  it('records what the student says they used, and reports no other effect', async () => {
    const user = renderControl()

    await user.click(openButton())
    await user.type(purposeBox(), 'Used a spreadsheet to recompute payback')
    await user.click(submitButton())

    await waitFor(() => {
      expect(actions.declareOutsideToolAction).toHaveBeenCalledWith({
        runId: RUN_ID,
        purpose: 'Used a spreadsheet to recompute payback',
      })
    })
    expect(await screen.findByText(enUS['workspace.declarationRecorded'])).toBeInTheDocument()
    expect(openButton()).toHaveAttribute('aria-expanded', 'false')
  })

  it('asks for the purpose rather than sending an empty declaration', async () => {
    const user = renderControl()

    await user.click(openButton())
    await user.click(submitButton())

    expect(screen.getByText(enUS['workspace.declarationRequired'])).toBeInTheDocument()
    expect(actions.declareOutsideToolAction).not.toHaveBeenCalled()
  })

  // FR-210, WCAG 2.2 AA §2.4.3, D-500. Closing the region unmounts the form, and with it the
  // control the student just pressed. A browser whose focused element is removed drops the caret on
  // `document.body`; Chromium and Firefox restart Tab at the top of the document from there and
  // WebKit moves nothing at all, so a keyboard user who declared an outside tool was stranded on the
  // screen that files an irreversible decision under a clock. The disclosure puts the caret back on
  // the control the region was opened from — and only when it was still inside the region.
  describe('the caret, when the region closes', () => {
    it('comes back to the control the region was opened from after a declaration lands', async () => {
      const user = renderControl()

      await user.click(openButton())
      await user.type(purposeBox(), 'A spreadsheet, to recompute the payback myself')
      await user.click(submitButton())

      expect(await screen.findByText(enUS['workspace.declarationRecorded'])).toBeInTheDocument()
      await waitFor(() => {
        expect(openButton()).toHaveFocus()
      })
    })

    it('comes back to it when the region is closed with Cancel', async () => {
      const user = renderControl()

      await user.click(openButton())
      await user.click(cancelButton())

      expect(openButton()).toHaveFocus()
      expect(actions.declareOutsideToolAction).not.toHaveBeenCalled()
    })

    it('stays where the student put it when they moved on while the write was in flight', async () => {
      let land: (result: unknown) => void = () => undefined
      actions.declareOutsideToolAction.mockReturnValue(
        new Promise((resolve) => {
          land = resolve
        }),
      )
      const user = renderControl()

      await user.click(openButton())
      await user.type(purposeBox(), 'A spreadsheet, to recompute the payback myself')
      await user.click(submitButton())

      // The student did not wait: they tabbed on to the rest of the workspace.
      elsewhere().focus()
      expect(elsewhere()).toHaveFocus()

      land({ ok: true, data: null })

      expect(await screen.findByText(enUS['workspace.declarationRecorded'])).toBeInTheDocument()
      expect(elsewhere()).toHaveFocus()
    })
  })

  it('says so in the server’s own words when the declaration does not land', async () => {
    actions.declareOutsideToolAction.mockResolvedValue({
      ok: false,
      error: { code: 'ASSISTANT_LOCKED', message: 'Not at this point in the run.', requestId: 'r' },
    })
    const user = renderControl()

    await user.click(openButton())
    await user.type(purposeBox(), 'Asked a classmate to sanity-check my arithmetic')
    await user.click(submitButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('Not at this point in the run.')
  })
})
