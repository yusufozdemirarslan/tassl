import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ForgotPasswordForm } from '@/components/features/auth/forgot-password-form'
import { enUS } from '@/lib/i18n/en-US'

const auth = vi.hoisted(() => ({ requestPasswordReset: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
  usePathname: () => '/forgot-password',
}))

vi.mock('@/lib/auth-client', () => ({
  authClient: { requestPasswordReset: auth.requestPasswordReset },
}))

type FetchOptions = { onError?: (context: { response: Response }) => void }

function rateLimitedOnce(seconds: string) {
  return (_body: unknown, options?: FetchOptions) => {
    options?.onError?.({
      response: {
        headers: { get: (name: string) => (name === 'X-Retry-After' ? seconds : null) },
      } as unknown as Response,
    })
    return Promise.resolve({
      data: null,
      error: { status: 429, statusText: 'Too Many Requests', message: 'Too many requests.' },
    })
  }
}

function submitButton() {
  return screen.getByRole('button', { name: enUS['auth.forgot.submit'] })
}

/** While the call is in flight the label swaps, so the pending control has its own name. */
function pendingButton() {
  return screen.getByRole('button', { name: enUS['auth.forgot.submitPending'] })
}

describe('ForgotPasswordForm (UI-004, request half)', () => {
  beforeEach(() => {
    auth.requestPasswordReset.mockReset()
  })

  it('shows the email message and calls nothing when the address is malformed', async () => {
    const user = userEvent.setup()
    render(<ForgotPasswordForm />)

    await user.type(screen.getByLabelText(enUS['auth.email']), 'not-an-address')
    await user.click(submitButton())

    expect(await screen.findByText(enUS['auth.validation.email'])).toBeInTheDocument()
    expect(screen.getByLabelText(enUS['auth.email'])).toHaveAttribute(
      'aria-describedby',
      'forgot-email-error',
    )
    expect(auth.requestPasswordReset).not.toHaveBeenCalled()
  })

  it('disables the submit button while the call is in flight', async () => {
    let release: (value: { data: unknown; error: null }) => void = () => {}
    auth.requestPasswordReset.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const user = userEvent.setup()
    render(<ForgotPasswordForm />)

    await user.type(screen.getByLabelText(enUS['auth.email']), 'lena@example.edu')
    await user.click(submitButton())

    await waitFor(() => expect(pendingButton()).toBeDisabled())
    expect(pendingButton()).toHaveAttribute('aria-busy', 'true')

    release({ data: { status: true }, error: null })
    await screen.findByText(enUS['auth.forgot.sent'])
  })

  it('says the same thing for an address that exists', async () => {
    auth.requestPasswordReset.mockResolvedValue({ data: { status: true }, error: null })
    const user = userEvent.setup()
    render(<ForgotPasswordForm />)

    await user.type(screen.getByLabelText(enUS['auth.email']), 'lena@example.edu')
    await user.click(submitButton())

    expect(await screen.findByRole('status')).toHaveTextContent(enUS['auth.forgot.sent'])
    expect(auth.requestPasswordReset).toHaveBeenCalledWith(
      { email: 'lena@example.edu', redirectTo: '/reset-password' },
      expect.anything(),
    )
  })

  it('says the same thing when Better Auth refuses, so nobody can probe for accounts', async () => {
    auth.requestPasswordReset.mockResolvedValue({
      data: null,
      error: { code: 'USER_NOT_FOUND', status: 400, statusText: 'Bad Request' },
    })
    const user = userEvent.setup()
    render(<ForgotPasswordForm />)

    await user.type(screen.getByLabelText(enUS['auth.email']), 'stranger@example.edu')
    await user.click(submitButton())

    expect(await screen.findByRole('status')).toHaveTextContent(enUS['auth.forgot.sent'])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does surface the rate limiter, which is about this browser and not about the address', async () => {
    auth.requestPasswordReset.mockImplementation(rateLimitedOnce('15'))
    const user = userEvent.setup()
    render(<ForgotPasswordForm />)

    await user.type(screen.getByLabelText(enUS['auth.email']), 'lena@example.edu')
    await user.click(submitButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('Try again in 15 seconds.')
    expect(screen.queryByText(enUS['auth.forgot.sent'])).not.toBeInTheDocument()
  })

  it('says nothing reassuring when the server itself failed', async () => {
    auth.requestPasswordReset.mockResolvedValue({
      data: null,
      error: { status: 500, statusText: 'Internal Server Error' },
    })
    const user = userEvent.setup()
    render(<ForgotPasswordForm />)

    await user.type(screen.getByLabelText(enUS['auth.email']), 'lena@example.edu')
    await user.click(submitButton())

    // Nothing was sent, so the person may not be left waiting for a link that never comes.
    expect(await screen.findByRole('alert')).toHaveTextContent(enUS['auth.error.generic'])
    expect(screen.queryByText(enUS['auth.forgot.sent'])).not.toBeInTheDocument()
    expect(submitButton()).toBeEnabled()
  })

  it('renders the generic message when the request never reaches the server', async () => {
    auth.requestPasswordReset.mockRejectedValue(new TypeError('Failed to fetch'))
    const user = userEvent.setup()
    render(<ForgotPasswordForm />)

    await user.type(screen.getByLabelText(enUS['auth.email']), 'lena@example.edu')
    await user.click(submitButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(enUS['auth.error.generic'])
    expect(screen.queryByText(enUS['auth.forgot.sent'])).not.toBeInTheDocument()
  })

  it('puts the form-level message above the field, not above the submit', async () => {
    auth.requestPasswordReset.mockImplementation(rateLimitedOnce('15'))
    const user = userEvent.setup()
    render(<ForgotPasswordForm />)

    await user.type(screen.getByLabelText(enUS['auth.email']), 'lena@example.edu')
    await user.click(submitButton())

    const alert = await screen.findByRole('alert')
    const email = screen.getByLabelText(enUS['auth.email'])
    expect(alert.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('never offers the Google button', () => {
    render(<ForgotPasswordForm />)
    expect(
      screen.queryByRole('button', { name: enUS['auth.signIn.google'] }),
    ).not.toBeInTheDocument()
  })
})
