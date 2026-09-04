import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeleteAccountDialog } from '@/components/features/account/delete-account-dialog'
import { enUS } from '@/lib/i18n/en-US'
import { t } from '@/lib/i18n/t'

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
const actions = vi.hoisted(() => ({ requestAccountDeletionAction: vi.fn() }))
const auth = vi.hoisted(() => ({ signOut: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: router.push,
    refresh: router.refresh,
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
  usePathname: () => '/settings/data',
}))

vi.mock('@/server/modules/identity/actions', () => ({
  requestAccountDeletionAction: actions.requestAccountDeletionAction,
}))

vi.mock('@/lib/auth-client', () => ({ authClient: { signOut: auth.signOut } }))

const EMAIL = 'lena@example.edu'

async function openDialog() {
  const user = userEvent.setup()
  render(<DeleteAccountDialog email={EMAIL} />)
  await user.click(screen.getByRole('button', { name: enUS['settings.data.deleteSubmit'] }))
  await screen.findByRole('alertdialog', { name: enUS['settings.data.deleteDialogTitle'] })
  return user
}

const confirmButton = () =>
  screen.getByRole('button', { name: enUS['settings.data.deleteConfirm'] })

const confirmField = () =>
  screen.getByLabelText(t('settings.data.deleteConfirmLabel', { email: EMAIL }))

describe('DeleteAccountDialog (UI-010, SYS-004)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actions.requestAccountDeletionAction.mockResolvedValue({ ok: true, data: { deleted: true } })
    auth.signOut.mockResolvedValue({ data: null, error: null })
  })

  it('states the 30-day purge and the pseudonymous course record before it will act', async () => {
    await openDialog()
    expect(screen.getByText(enUS['settings.data.deleteDialogBody'])).toBeInTheDocument()
    expect(enUS['settings.data.deleteDialogBody']).toMatch(/30 days/)
    expect(enUS['settings.data.deleteDialogBody']).toMatch(/pseudonymous/)
  })

  it('keeps the confirm button disabled until the exact address is typed', async () => {
    const user = await openDialog()
    expect(confirmButton()).toBeDisabled()

    await user.type(confirmField(), 'lena@example.ed')
    expect(confirmButton()).toBeDisabled()

    await user.type(confirmField(), 'u')
    await waitFor(() => expect(confirmButton()).not.toBeDisabled())
  })

  it('accepts the address whatever its case and ignores surrounding space', async () => {
    const user = await openDialog()
    await user.type(confirmField(), '  Lena@Example.EDU  ')
    await waitFor(() => expect(confirmButton()).not.toBeDisabled())
  })

  it('requests the deletion with the typed address, then signs the person out', async () => {
    const user = await openDialog()
    await user.type(confirmField(), EMAIL)
    await user.click(confirmButton())

    await waitFor(() => {
      expect(actions.requestAccountDeletionAction).toHaveBeenCalledWith({ email: EMAIL })
    })
    await waitFor(() => expect(auth.signOut).toHaveBeenCalled())
    expect(router.push).toHaveBeenCalledWith('/sign-in')
  })

  it('renders the message from the error envelope and stays signed in', async () => {
    actions.requestAccountDeletionAction.mockResolvedValue({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: enUS['identity.confirmEmailMismatch'],
        requestId: 'req_9',
      },
    })
    const user = await openDialog()
    await user.type(confirmField(), EMAIL)
    await user.click(confirmButton())

    expect(await screen.findByText(enUS['identity.confirmEmailMismatch'])).toBeInTheDocument()
    expect(auth.signOut).not.toHaveBeenCalled()
    expect(router.push).not.toHaveBeenCalled()
  })
})
