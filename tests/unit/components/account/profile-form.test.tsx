import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProfileForm } from '@/components/features/account/profile-form'
import { enUS } from '@/lib/i18n/en-US'

const router = vi.hoisted(() => ({ refresh: vi.fn() }))
const actions = vi.hoisted(() => ({ updateProfileAction: vi.fn() }))
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
  usePathname: () => '/settings',
}))

// The action is a Server Action: importing the real module would pull the identity service, the
// database client, and `server-only` into jsdom.
vi.mock('@/server/modules/identity/actions', () => ({
  updateProfileAction: actions.updateProfileAction,
}))

vi.mock('sonner', () => ({ toast: { success: toasts.success, error: toasts.error } }))

const ok = (name: string) => ({ ok: true, data: { name } })

function renderForm() {
  render(<ProfileForm name="Lena Ortiz" email="lena@example.edu" />)
  return userEvent.setup()
}

const nameField = () => screen.getByLabelText(enUS['auth.name'])
const submit = () => screen.getByRole('button', { name: enUS['settings.profileSave'] })

describe('ProfileForm (UI-010)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actions.updateProfileAction.mockResolvedValue(ok('Lena Ortiz'))
  })

  it('starts from the current profile and shows the email as an unchangeable field', () => {
    render(<ProfileForm name="Lena Ortiz" email="lena@example.edu" />)
    expect(nameField()).toHaveValue('Lena Ortiz')
    const email = screen.getByLabelText(enUS['auth.email'])
    expect(email).toHaveValue('lena@example.edu')
    expect(email).toBeDisabled()
    expect(screen.getByText(enUS['settings.emailFixed'])).toBeInTheDocument()
  })

  it('refuses an empty name with an inline message and never calls the action', async () => {
    const user = renderForm()
    await user.clear(nameField())
    await user.click(submit())

    expect(await screen.findByText(enUS['auth.validation.name'])).toBeInTheDocument()
    expect(nameField()).toHaveAttribute('aria-invalid', 'true')
    expect(nameField()).toHaveAttribute('aria-describedby', 'profile-name-error')
    expect(actions.updateProfileAction).not.toHaveBeenCalled()
  })

  it('refuses a name over 120 characters with the length message', async () => {
    const user = renderForm()
    await user.clear(nameField())
    await user.type(nameField(), 'a'.repeat(121))
    await user.click(submit())

    expect(await screen.findByText(enUS['auth.validation.nameTooLong'])).toBeInTheDocument()
    expect(actions.updateProfileAction).not.toHaveBeenCalled()
  })

  it('saves the name, confirms with a toast, and refreshes the shell', async () => {
    actions.updateProfileAction.mockResolvedValue(ok('Lena O.'))
    const user = renderForm()
    await user.clear(nameField())
    await user.type(nameField(), 'Lena O.')
    await user.click(submit())

    await waitFor(() => {
      expect(actions.updateProfileAction).toHaveBeenCalledWith({ name: 'Lena O.' })
    })
    expect(toasts.success).toHaveBeenCalledWith(enUS['settings.profileSaved'])
    expect(router.refresh).toHaveBeenCalled()
  })

  // `aria-disabled`, not `disabled`: the browser blurs a control the moment it is disabled, which
  // dropped the keyboard to <body> on every submit (SubmitButton, ./form-feedback).
  it('marks the submit button unavailable while the action is in flight, without losing focus', async () => {
    let release: (value: unknown) => void = () => {}
    actions.updateProfileAction.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    const user = renderForm()
    await user.click(submit())

    await waitFor(() => expect(submit()).toHaveAttribute('aria-disabled', 'true'))
    expect(submit()).toHaveAttribute('aria-busy', 'true')
    expect(submit()).not.toBeDisabled()
    expect(submit()).toHaveFocus()

    release(ok('Lena Ortiz'))
    await waitFor(() => expect(submit()).not.toHaveAttribute('aria-disabled'))
  })

  it('swallows a second press while the first submission is still running', async () => {
    let release: (value: unknown) => void = () => {}
    actions.updateProfileAction.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    const user = renderForm()
    await user.click(submit())
    await waitFor(() => expect(submit()).toHaveAttribute('aria-disabled', 'true'))

    await user.click(submit())
    expect(actions.updateProfileAction).toHaveBeenCalledTimes(1)

    release(ok('Lena Ortiz'))
    await waitFor(() => expect(submit()).not.toHaveAttribute('aria-disabled'))
  })

  it('renders the message from the action error envelope', async () => {
    actions.updateProfileAction.mockResolvedValue({
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'That name is not allowed.',
        requestId: 'req_1',
      },
    })
    const user = renderForm()
    await user.click(submit())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('That name is not allowed.')
    expect(toasts.success).not.toHaveBeenCalled()
  })
})
