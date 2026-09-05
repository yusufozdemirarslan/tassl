import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PausedOverlay } from '@/components/features/run/paused-overlay'
import { enUS } from '@/lib/i18n/en-US'

// UI-023's paused state (FR-001). A component of Tassl failed, so the run stopped; the overlay has
// one job and one control, and the assertions below are that there is not a second way out of it.
// A student who could dismiss their way back into a run that is not running would be looking at a
// screen of controls that all refuse, under a clock that is not counting.

const RUN_ID = '9f6ab2f8-9f14-4f6f-a3a0-64f1f3a1a001'

const router = vi.hoisted(() => ({ refresh: vi.fn() }))
const actions = vi.hoisted(() => ({ resumeRunAction: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: router.refresh,
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
}))

// The real module drags the runs service and the database into jsdom.
vi.mock('@/server/modules/runs/actions', () => ({ resumeRunAction: actions.resumeRunAction }))

const resumeButton = () => screen.getByRole('button', { name: enUS['workspace.pausedResume'] })

describe('PausedOverlay (UI-023, FR-001)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actions.resumeRunAction.mockResolvedValue({ ok: true, data: { id: RUN_ID, state: 'working' } })
  })

  it('says what happened, what it cost, and offers the one control that changes it', () => {
    render(<PausedOverlay runId={RUN_ID} cause="assistant_failure" />)

    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText(enUS['workspace.pausedTitle'])).toBeInTheDocument()
    expect(dialog).toHaveTextContent(enUS['workspace.pausedCauseAssistantFailure'])
    expect(dialog).toHaveTextContent(enUS['workspace.pausedBody'])
    // One control: nothing dismisses the overlay, and nothing offers to work around the outage.
    expect(within(dialog).getAllByRole('button')).toHaveLength(1)
    expect(resumeButton()).toBeInTheDocument()
  })

  it('names each cause in the student’s own language, and no internals', () => {
    render(<PausedOverlay runId={RUN_ID} cause="document_failure" />)

    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      enUS['workspace.pausedCauseDocumentFailure'],
    )
    expect(screen.getByRole('alertdialog').textContent).not.toContain('delegation')
  })

  it('resumes the run and lets the server render decide what stands next', async () => {
    const user = userEvent.setup()
    render(<PausedOverlay runId={RUN_ID} cause="assistant_failure" />)

    await user.click(resumeButton())

    await waitFor(() => {
      expect(actions.resumeRunAction).toHaveBeenCalledWith({ runId: RUN_ID })
    })
    expect(router.refresh).toHaveBeenCalled()
  })

  it('keeps the overlay up when the resume does not land', async () => {
    actions.resumeRunAction.mockResolvedValue({
      ok: false,
      error: { code: 'ILLEGAL_TRANSITION', message: 'That is not possible.', requestId: 'req-1' },
    })
    const user = userEvent.setup()
    render(<PausedOverlay runId={RUN_ID} cause="connection" />)

    await user.click(resumeButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('That is not possible.')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(resumeButton()).toBeInTheDocument()
  })
})
