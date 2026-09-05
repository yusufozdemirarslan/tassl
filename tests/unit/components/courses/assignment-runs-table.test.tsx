import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AssignmentRunsTable,
  type AssignmentRunRow,
} from '@/components/features/courses/assignment-runs-table'
import { enUS } from '@/lib/i18n/en-US'
import { t } from '@/lib/i18n/t'

// UI-032's runs half. The confirmation behind "Delete" arrives on the press that opens it (B4), so
// what this file protects is that deferring it changed nothing a reviewer can see: the table paints
// without it, the press still asks before anything is removed, the removal still goes through
// `deleteWalkthroughRunAction`, and the control is offered on a walkthrough assignment alone.

const router = vi.hoisted(() => ({ refresh: vi.fn() }))
const actions = vi.hoisted(() => ({ deleteWalkthroughRunAction: vi.fn() }))
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
}))

// The real module drags the courses service and the database into jsdom.
vi.mock('@/server/modules/courses/actions', () => ({
  deleteWalkthroughRunAction: actions.deleteWalkthroughRunAction,
}))

vi.mock('sonner', () => ({ toast: { success: toasts.success, error: toasts.error } }))

const ROWS: AssignmentRunRow[] = [
  {
    id: 'run-1',
    studentName: 'Ada Okafor',
    attemptNo: 1,
    state: 'framing',
    underReview: false,
    decisionsMade: 0,
    latestExportVersion: null,
  },
  {
    id: 'run-2',
    studentName: 'Ben Iversen',
    attemptNo: 2,
    state: 'scored',
    underReview: false,
    decisionsMade: 7,
    latestExportVersion: 3,
  },
]

function renderTable(canDelete = true) {
  render(<AssignmentRunsTable runs={ROWS} canDelete={canDelete} />)
  return userEvent.setup()
}

const deleteButton = (name: string) =>
  screen.getByRole('button', { name: t('run.reviewWalkthroughDeleteName', { name }) })

describe('AssignmentRunsTable (UI-032)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actions.deleteWalkthroughRunAction.mockResolvedValue({ ok: true, data: { id: 'run-1' } })
  })

  it('paints every run without the confirmation behind the delete', () => {
    renderTable()

    expect(screen.getByText('Ada Okafor')).toBeInTheDocument()
    expect(screen.getByText('Ben Iversen')).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.queryByText(enUS['run.reviewDeleteTitle'])).not.toBeInTheDocument()
  })

  // D-104: a run that counts is voided rather than deleted, so the control is not offered at all.
  it('offers no delete on an assignment that is not a walkthrough', () => {
    renderTable(false)

    expect(screen.queryByText(enUS['run.reviewColumnActions'])).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: t('run.reviewWalkthroughDeleteName', { name: 'Ada Okafor' }),
      }),
    ).not.toBeInTheDocument()
  })

  it('asks before it removes anything, and names what removal costs', async () => {
    const user = renderTable()

    await user.click(deleteButton('Ada Okafor'))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(enUS['run.reviewDeleteTitle'])
    expect(dialog).toHaveTextContent(enUS['run.reviewDeleteBody'])
    expect(actions.deleteWalkthroughRunAction).not.toHaveBeenCalled()
  })

  it('deletes the run the row belongs to, and catches the screen up', async () => {
    const user = renderTable()

    await user.click(deleteButton('Ben Iversen'))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: enUS['run.reviewDeleteConfirm'] }))

    await waitFor(() => {
      expect(actions.deleteWalkthroughRunAction).toHaveBeenCalledWith({ runId: 'run-2' })
    })
    await waitFor(() => {
      expect(router.refresh).toHaveBeenCalled()
    })
  })

  it('keeps the run and says why when the service refuses', async () => {
    actions.deleteWalkthroughRunAction.mockResolvedValue({
      ok: false,
      error: { code: 'RUN_NOT_DELETABLE', message: 'That run counts.', requestId: 'r1' },
    })

    const user = renderTable()
    await user.click(deleteButton('Ada Okafor'))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: enUS['run.reviewDeleteConfirm'] }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('That run counts.')
    })
    expect(router.refresh).not.toHaveBeenCalled()
  })

  // Keeping the run is the cheap half of a destructive confirmation, so it has to actually work.
  it('removes nothing when the confirmation is dismissed', async () => {
    const user = renderTable()

    await user.click(deleteButton('Ada Okafor'))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: enUS['run.reviewDeleteCancel'] }))

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    expect(actions.deleteWalkthroughRunAction).not.toHaveBeenCalled()
  })
})
