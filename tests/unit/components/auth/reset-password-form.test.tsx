import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ResetPasswordForm } from '@/components/features/auth/reset-password-form'
import { enUS } from '@/lib/i18n/en-US'

const auth = vi.hoisted(() => ({ resetPassword: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
  usePathname: () => '/reset-password',
}))

vi.mock('@/lib/auth-client', () => ({
  authClient: { resetPassword: auth.resetPassword },
}))

async function fillPasswords(password: string, confirmation = password) {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText(enUS['auth.newPassword']), password)
  await user.type(screen.getByLabelText(enUS['auth.confirmPassword']), confirmation)
  return user
}

function submitButton() {
  return screen.getByRole('button', { name: enUS['auth.reset.submit'] })
}

/** While the call is in flight the label swaps, so the pending control has its own name. */
function pendingButton() {
  return screen.getByRole('button', { name: enUS['auth.reset.submitPending'] })
}

describe('ResetPasswordForm (UI-004, reset half)', () => {
  beforeEach(() => {
    auth.resetPassword.mockReset()
  })

  it('refuses a password outside 12 to 128 characters', async () => {
    render(<ResetPasswordForm token="reset-token" />)
    const user = await fillPasswords('short')

    await user.click(submitButton())

    expect(await screen.findByText(enUS['auth.validation.passwordLength'])).toBeInTheDocument()
    expect(auth.resetPassword).not.toHaveBeenCalled()
  })

  it('refuses a confirmation that does not match, and names the confirmation field', async () => {
    render(<ResetPasswordForm token="reset-token" />)
    const user = await fillPasswords('a-very-long-password', 'a-different-password')

    await user.click(submitButton())

    expect(await screen.findByText(enUS['auth.validation.passwordMismatch'])).toBeInTheDocument()
    expect(screen.getByLabelText(enUS['auth.confirmPassword'])).toHaveAttribute(
      'aria-describedby',
      'reset-password-confirm-error',
    )
    expect(auth.resetPassword).not.toHaveBeenCalled()
  })

  it('disables the submit button while the call is in flight', async () => {
    let release: (value: { data: unknown; error: null }) => void = () => {}
    auth.resetPassword.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    render(<ResetPasswordForm token="reset-token" />)
    const user = await fillPasswords('a-very-long-password')

    await user.click(submitButton())

    await waitFor(() => expect(pendingButton()).toBeDisabled())
    expect(pendingButton()).toHaveAttribute('aria-busy', 'true')

    release({ data: { status: true }, error: null })
    await screen.findByText(enUS['auth.reset.successTitle'])
  })

  it('sends the token with the new password and then points at sign-in', async () => {
    auth.resetPassword.mockResolvedValue({ data: { status: true }, error: null })
    render(<ResetPasswordForm token="reset-token" />)
    const user = await fillPasswords('a-very-long-password')

    await user.click(submitButton())

    await waitFor(() =>
      expect(auth.resetPassword).toHaveBeenCalledWith(
        { newPassword: 'a-very-long-password', token: 'reset-token' },
        expect.anything(),
      ),
    )
    expect(
      await screen.findByRole('heading', { name: enUS['auth.reset.successTitle'] }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: enUS['auth.reset.signIn'] })).toHaveAttribute(
      'href',
      '/sign-in',
    )
  })

  it('reports a token that died between the redirect and the submit', async () => {
    auth.resetPassword.mockResolvedValue({
      data: null,
      error: { code: 'INVALID_TOKEN', status: 400, statusText: 'Bad Request' },
    })
    render(<ResetPasswordForm token="stale-token" />)
    const user = await fillPasswords('a-very-long-password')

    await user.click(submitButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(enUS['auth.error.linkExpired'])
  })

  it('moves focus onto the confirmation that replaced the form', async () => {
    auth.resetPassword.mockResolvedValue({ data: { status: true }, error: null })
    render(<ResetPasswordForm token="reset-token" />)
    const user = await fillPasswords('a-very-long-password')

    await user.click(submitButton())

    const confirmation = await screen.findByRole('status')
    // Without this the keyboard falls back to the top of the document (WCAG 2.4.3).
    await waitFor(() => expect(confirmation).toHaveFocus())
    expect(confirmation).toHaveAttribute('tabindex', '-1')
  })

  it('renders the generic message when the request never reaches the server', async () => {
    auth.resetPassword.mockRejectedValue(new TypeError('Failed to fetch'))
    render(<ResetPasswordForm token="reset-token" />)
    const user = await fillPasswords('a-very-long-password')

    await user.click(submitButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(enUS['auth.error.generic'])
    expect(screen.queryByText(enUS['auth.reset.successTitle'])).not.toBeInTheDocument()
    expect(submitButton()).toBeEnabled()
  })

  it('puts the form-level message above the fields, not above the submit', async () => {
    auth.resetPassword.mockResolvedValue({
      data: null,
      error: { code: 'INVALID_TOKEN', status: 400, statusText: 'Bad Request' },
    })
    render(<ResetPasswordForm token="stale-token" />)
    const user = await fillPasswords('a-very-long-password')

    await user.click(submitButton())

    const alert = await screen.findByRole('alert')
    const password = screen.getByLabelText(enUS['auth.newPassword'])
    expect(alert.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('never offers the Google button', () => {
    render(<ResetPasswordForm token="reset-token" />)
    expect(
      screen.queryByRole('button', { name: enUS['auth.signIn.google'] }),
    ).not.toBeInTheDocument()
  })
})
