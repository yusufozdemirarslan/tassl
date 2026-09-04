import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SignInForm } from '@/components/features/auth/sign-in-form'
import { enUS } from '@/lib/i18n/en-US'

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
const auth = vi.hoisted(() => ({
  signInEmail: vi.fn(),
  signInSocial: vi.fn(),
  sendVerificationEmail: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: router.push,
    refresh: router.refresh,
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
  usePathname: () => '/sign-in',
}))

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    signIn: { email: auth.signInEmail, social: auth.signInSocial },
    sendVerificationEmail: auth.sendVerificationEmail,
  },
}))

type FetchOptions = { onError?: (context: { response: Response }) => void }

/** The rate limiter answers 429 with no code and puts the wait in the X-Retry-After header. */
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

async function fillCredentials() {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText(enUS['auth.email']), 'lena@example.edu')
  await user.type(screen.getByLabelText(enUS['auth.password']), 'a-long-password')
  return user
}

function submitButton() {
  return screen.getByRole('button', { name: enUS['auth.signIn.submit'] })
}

/** While the call is in flight the label swaps, so the pending control has its own name. */
function pendingButton() {
  return screen.getByRole('button', { name: enUS['auth.signIn.submitPending'] })
}

describe('SignInForm (UI-001)', () => {
  beforeEach(() => {
    router.push.mockReset()
    router.refresh.mockReset()
    auth.signInEmail.mockReset()
    auth.signInSocial.mockReset()
    auth.sendVerificationEmail.mockReset()
  })

  it('shows a message under each field and never calls the API when the form is empty', async () => {
    const user = userEvent.setup()
    render(<SignInForm next="/home" googleEnabled={false} />)

    await user.click(submitButton())

    expect(await screen.findByText(enUS['auth.validation.email'])).toBeInTheDocument()
    expect(screen.getByText(enUS['auth.validation.password'])).toBeInTheDocument()
    expect(auth.signInEmail).not.toHaveBeenCalled()
  })

  it('ties each message to its field with aria-describedby', async () => {
    const user = userEvent.setup()
    render(<SignInForm next="/home" googleEnabled={false} />)

    await user.type(screen.getByLabelText(enUS['auth.email']), 'not-an-address')
    await user.click(submitButton())

    const email = await screen.findByLabelText(enUS['auth.email'])
    expect(email).toHaveAttribute('aria-invalid', 'true')
    expect(email).toHaveAttribute('aria-describedby', 'sign-in-email-error')
    expect(document.getElementById('sign-in-email-error')).toHaveTextContent(
      enUS['auth.validation.email'],
    )
  })

  it('disables the submit button while the call is in flight', async () => {
    let release: (value: { data: unknown; error: null }) => void = () => {}
    auth.signInEmail.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    render(<SignInForm next="/home" googleEnabled={false} />)
    const user = await fillCredentials()

    await user.click(submitButton())

    // The label says what the spinner says, so the state survives prefers-reduced-motion.
    await waitFor(() => expect(pendingButton()).toBeDisabled())
    expect(pendingButton()).toHaveAttribute('aria-busy', 'true')

    release({ data: { user: {} }, error: null })
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/home'))
  })

  it('sends the visitor to `next` and refreshes the tree on success', async () => {
    auth.signInEmail.mockResolvedValue({ data: { user: {} }, error: null })
    render(<SignInForm next="/runs/abc" googleEnabled={false} />)
    const user = await fillCredentials()

    await user.click(submitButton())

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/runs/abc'))
    expect(router.refresh).toHaveBeenCalled()
    expect(auth.signInEmail).toHaveBeenCalledWith(
      { email: 'lena@example.edu', password: 'a-long-password', rememberMe: true },
      expect.anything(),
    )
  })

  it('renders one message for INVALID_EMAIL_OR_PASSWORD that names neither field', async () => {
    auth.signInEmail.mockResolvedValue({
      data: null,
      error: { code: 'INVALID_EMAIL_OR_PASSWORD', status: 401, statusText: 'Unauthorized' },
    })
    render(<SignInForm next="/home" googleEnabled={false} />)
    const user = await fillCredentials()

    await user.click(submitButton())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(enUS['auth.error.invalidEmailOrPassword'])
    expect(alert.textContent).not.toMatch(/password is|email is|wrong password/i)
    expect(router.push).not.toHaveBeenCalled()
  })

  it('offers a resend action for EMAIL_NOT_VERIFIED', async () => {
    auth.signInEmail.mockResolvedValue({
      data: null,
      error: { code: 'EMAIL_NOT_VERIFIED', status: 403, statusText: 'Forbidden' },
    })
    auth.sendVerificationEmail.mockResolvedValue({ data: { status: true }, error: null })
    render(<SignInForm next="/home" googleEnabled={false} />)
    const user = await fillCredentials()

    await user.click(submitButton())

    expect(await screen.findByText(enUS['auth.error.emailNotVerified'])).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: enUS['auth.error.resendVerification'] }))

    await waitFor(() =>
      expect(auth.sendVerificationEmail).toHaveBeenCalledWith({
        email: 'lena@example.edu',
        callbackURL: '/verify-email?verified=1',
      }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(enUS['auth.verify.resendSent'])
  })

  it('renders the retry-after seconds when the rate limiter refuses', async () => {
    auth.signInEmail.mockImplementation(rateLimitedOnce('42'))
    render(<SignInForm next="/home" googleEnabled={false} />)
    const user = await fillCredentials()

    await user.click(submitButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('Try again in 42 seconds.')
  })

  it('renders the generic message when the request never reaches the server', async () => {
    auth.signInEmail.mockRejectedValue(new TypeError('Failed to fetch'))
    render(<SignInForm next="/home" googleEnabled={false} />)
    const user = await fillCredentials()

    await user.click(submitButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(enUS['auth.error.generic'])
    expect(submitButton()).toBeEnabled()
    expect(router.push).not.toHaveBeenCalled()
  })

  it('puts the form-level message above the fields, not above the submit', async () => {
    auth.signInEmail.mockResolvedValue({
      data: null,
      error: { code: 'INVALID_EMAIL_OR_PASSWORD', status: 401, statusText: 'Unauthorized' },
    })
    render(<SignInForm next="/home" googleEnabled={false} />)
    const user = await fillCredentials()

    await user.click(submitButton())

    const alert = await screen.findByRole('alert')
    const email = screen.getByLabelText(enUS['auth.email'])
    // The alert precedes the first field, so the submit never moves under the pointer.
    expect(alert.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('hides the Google button unless the page enables it', () => {
    const { unmount } = render(<SignInForm next="/home" googleEnabled={false} />)
    expect(
      screen.queryByRole('button', { name: enUS['auth.signIn.google'] }),
    ).not.toBeInTheDocument()
    unmount()

    render(<SignInForm next="/home" googleEnabled />)
    expect(screen.getByRole('button', { name: enUS['auth.signIn.google'] })).toBeInTheDocument()
  })
})
