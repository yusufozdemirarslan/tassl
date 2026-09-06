import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DelegationLog } from '@/components/features/run/delegation-log'
import { enUS } from '@/lib/i18n/en-US'
import type { DelegationView } from '@/server/modules/assistant/schema'

// UI-023's Delegation Log (FR-060, FR-084, D-270, D-272). The two controls it carries are the two
// things a student does with a delegation after they have read it, and they are different kinds of
// act:
//
//   * the **why line** is their own sentence about their own request. It changes the row and
//     nothing else, and it can be rewritten while the run is open.
//   * the **used mark** is a statement that they leaned on a claim. It records reliance, which the
//     Decision Lock reads (FR-084), so it is a press rather than a toggle: a mark that could be
//     taken back would be a way past that gate rather than through it (D-270). The assertions below
//     pin that there is no control on screen that unmarks one.
//
// The log also has to render the reply as it was stored, which carries the `[[claim:<id>]]` markers
// the wire format uses. A student should never see one.

const RUN_ID = '9f6ab2f8-9f14-4f6f-a3a0-64f1f3a1a001'
const DELEGATION_ID = 'ac8f2f1e-6a3d-4a1f-8b62-2d0f5a9c7e31'
const CLAIM_ID = '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f'

const CLAIM_TEXT =
  'Month-three retention on the premium pilot is 78 percent, seven points above the value tier at the same age.'
const LEAD_IN = 'Here is what the room already says on that.'
const CLOSING = 'The Evidence Room has the documents behind this.'

const ENTRY: DelegationView = {
  id: DELEGATION_ID,
  seq: 1,
  requestText: 'What is the premium payback?',
  responseText: `${LEAD_IN} [[claim:${CLAIM_ID}]] ${CLAIM_TEXT}\n\n${CLOSING}`,
  claims: [{ id: CLAIM_ID, key: 'C3', text: CLAIM_TEXT, stance: null, usedMarked: false }],
  why: null,
  inTurnWindow: false,
  failed: false,
  createdAt: '2026-09-05T10:00:00.000Z',
}

const actions = vi.hoisted(() => ({ updateDelegationAction: vi.fn() }))

// The real modules drag the assistant and reliance services and the database into jsdom.
vi.mock('@/server/modules/reliance/actions', () => ({
  setStanceAction: vi.fn(),
  runActionAction: vi.fn(),
  escalateAction: vi.fn(),
}))

vi.mock('@/server/modules/assistant/actions', () => ({
  updateDelegationAction: actions.updateDelegationAction,
}))

const whyBox = (seq = 1) =>
  screen.getByRole('textbox', {
    name: enUS['workspace.logWhyLabelFor'].replace('{seq}', String(seq)),
  })

const saveButton = () => screen.getByRole('button', { name: enUS['workspace.logWhySave'] })

const markButton = (key: string) =>
  screen.getByRole('button', { name: enUS['workspace.logMarkUsedFor'].replace('{key}', key) })

function renderLog(entries: readonly DelegationView[] = [ENTRY], canWrite = true) {
  render(
    <DelegationLog
      runId={RUN_ID}
      delegations={entries}
      canWrite={canWrite}
      readOnlyNote={canWrite ? undefined : enUS['workspace.logPausedNote']}
    />,
  )
  return userEvent.setup()
}

describe('DelegationLog (UI-023, FR-060)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actions.updateDelegationAction.mockResolvedValue({ ok: true, data: ENTRY })
  })

  it('lists what was asked and what came back, without the wire format’s markers', () => {
    renderLog()

    expect(screen.getByRole('heading', { name: 'Delegation 1' })).toBeInTheDocument()
    expect(screen.getByText(ENTRY.requestText)).toBeInTheDocument()
    expect(screen.getByText(`${LEAD_IN} ${CLAIM_TEXT}`)).toBeInTheDocument()
    expect(screen.getByText(CLOSING)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('[[claim:')
  })

  /**
   * D-281: the log shows the reply the student saw, marks and all.
   *
   * `responseText` is `run_delegations.response_text` — the same string the `delegation` event
   * carries and the faculty seat's replay reads — so a mark the guard wrote into it is a mark
   * everybody who reads the record sees. The claim marker is a wire detail and comes out; the
   * figure marker is part of the reply and stays.
   */
  it('keeps the mark on a figure the room does not source, and drops only the claim marker', () => {
    renderLog([
      {
        ...ENTRY,
        responseText: `Blending the cohorts gives a payback of [[figure:14]] months. [[claim:${CLAIM_ID}]] ${CLAIM_TEXT}`,
      },
    ])

    const answered = screen.getByText(/Blending the cohorts gives a payback of/)
    expect(answered).toHaveTextContent('Blending the cohorts gives a payback of 14')
    expect(answered).toHaveTextContent('months.')
    expect(document.body.textContent).not.toContain('[[figure:')
    expect(document.body.textContent).not.toContain('[[claim:')
    expect(screen.getByText(enUS['workspace.unverifiedNumberLabel'])).toBeInTheDocument()
  })

  it('marks no figure in a reply the guard found nothing to mark in', () => {
    renderLog()

    // The stored reply carries the claim's own 78 percent and no marker. Authored figures are
    // sourced by definition — no guard reads a claim segment — so nothing is drawn round them.
    expect(screen.getByText(`${LEAD_IN} ${CLAIM_TEXT}`)).toBeInTheDocument()
    expect(screen.queryByText(enUS['workspace.unverifiedNumberLabel'])).not.toBeInTheDocument()
  })

  it('saves the why line the student writes', async () => {
    const user = renderLog()

    await user.type(whyBox(), 'To check the retention figure before I lean on it.')
    await user.click(saveButton())

    await waitFor(() => {
      expect(actions.updateDelegationAction).toHaveBeenCalledWith({
        runId: RUN_ID,
        delegationId: DELEGATION_ID,
        why: 'To check the retention figure before I lean on it.',
      })
    })
    expect(await screen.findByText(enUS['workspace.logWhySaved'])).toBeInTheDocument()
  })

  it('shows the why line the run already carries, and rewrites it', async () => {
    const user = renderLog([{ ...ENTRY, why: 'A first note.' }])

    expect(whyBox()).toHaveValue('A first note.')
    await user.clear(whyBox())
    await user.type(whyBox(), 'A second note.')
    await user.click(saveButton())

    await waitFor(() => {
      expect(actions.updateDelegationAction).toHaveBeenCalledWith({
        runId: RUN_ID,
        delegationId: DELEGATION_ID,
        why: 'A second note.',
      })
    })
  })

  it('refuses a why line over the limit rather than sending one the server will reject', async () => {
    const user = renderLog()

    // `fireEvent` rather than typing 201 characters one keystroke at a time.
    fireEvent.change(whyBox(), { target: { value: 'w'.repeat(201) } })
    await user.click(saveButton())

    expect(
      screen.getByText(enUS['workspace.logWhyTooLong'].replace('{limit}', '200')),
    ).toBeInTheDocument()
    expect(actions.updateDelegationAction).not.toHaveBeenCalled()
  })

  it('marks a claim used, and offers nothing that takes the mark back (D-270)', async () => {
    const user = renderLog()

    expect(screen.getByText(enUS['workspace.logUsedNote'])).toBeInTheDocument()
    await user.click(markButton('C3'))

    await waitFor(() => {
      expect(actions.updateDelegationAction).toHaveBeenCalledWith({
        runId: RUN_ID,
        delegationId: DELEGATION_ID,
        usedClaimIds: [CLAIM_ID],
      })
    })

    const claims = screen.getByRole('list', { name: enUS['workspace.logClaimsTitle'] })
    expect(within(claims).getByText(enUS['workspace.claimUsed'])).toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: enUS['workspace.logMarkUsedFor'].replace('{key}', 'C3'),
      }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('keeps a mark the run already carries, with no control to undo it', () => {
    renderLog([{ ...ENTRY, claims: [{ ...ENTRY.claims[0]!, usedMarked: true, stance: 'verify' }] }])

    expect(screen.getByText(enUS['workspace.claimUsed'])).toBeInTheDocument()
    expect(screen.getByText(enUS['stance.verify'])).toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: enUS['workspace.logMarkUsedFor'].replace('{key}', 'C3'),
      }),
    ).not.toBeInTheDocument()
  })

  it('says so in the log’s own words when a write does not land', async () => {
    actions.updateDelegationAction.mockResolvedValue({
      ok: false,
      error: { code: 'RUN_LOCKED', message: 'This run’s decision is locked.', requestId: 'req-1' },
    })
    const user = renderLog()

    await user.click(markButton('C3'))

    expect(await screen.findByRole('alert')).toHaveTextContent('This run’s decision is locked.')
  })

  it('names a delegation that was never answered rather than showing a gap', () => {
    renderLog([{ ...ENTRY, responseText: '', claims: [], failed: true }])

    expect(screen.getByText(enUS['workspace.logFailed'])).toBeInTheDocument()
    expect(screen.queryByText(enUS['workspace.logClaimsTitle'])).not.toBeInTheDocument()
  })

  it('keeps its controls reachable and says why while the run is paused', () => {
    renderLog([ENTRY], false)

    expect(screen.getByText(enUS['workspace.logPausedNote'])).toBeInTheDocument()
    expect(markButton('C3')).toHaveAttribute('aria-disabled', 'true')
    expect(saveButton()).toHaveAttribute('aria-disabled', 'true')
    expect(markButton('C3')).not.toBeDisabled()
  })

  it('says the log is empty before anything has been delegated', () => {
    renderLog([])

    expect(
      screen.getByRole('heading', { name: enUS['workspace.logEmptyTitle'] }),
    ).toBeInTheDocument()
    expect(screen.getByText(enUS['workspace.logEmptyBody'])).toBeInTheDocument()
  })
})
