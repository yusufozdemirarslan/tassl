import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SignUpForm } from '@/components/features/auth/sign-up-form'
import { enUS } from '@/lib/i18n/en-US'

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
const auth = vi.hoisted(() => ({ signUpEmail: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: router.push,
    refresh: router.refresh,
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
  usePathname: () => '/sign-up',
}))

vi.mock('@/lib/auth-client', () => ({
  authClient: { signUp: { email: auth.signUpEmail } },
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

async function fillForm(password = 'a-very-long-password') {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText(enUS['auth.name']), 'Lena Ortiz')
  await user.type(screen.getByLabelText(enUS['auth.email']), 'lena@example.edu')
  await user.type(screen.getByLabelText(enUS['auth.password']), password)
  return user
}

function submitButton() {
  return screen.getByRole('button', { name: enUS['auth.signUp.submit'] })
}

/** While the call is in flight the label swaps, so the pending control has its own name. */
function pendingButton() {
  return screen.getByRole('button', { name: enUS['auth.signUp.submitPending'] })
}

describe('SignUpForm (UI-002)', () => {
  beforeEach(() => {
    router.push.mockReset()
    auth.signUpEmail.mockReset()
  })

  it('shows a message under every empty field', async () => {
    const user = userEvent.setup()
    render(<SignUpForm />)

    await user.click(submitButton())

    expect(await screen.findByText(enUS['auth.validation.name'])).toBeInTheDocument()
    expect(screen.getByText(enUS['auth.validation.email'])).toBeInTheDocument()
    expect(screen.getByText(enUS['auth.validation.passwordLength'])).toBeInTheDocument()
    expect(auth.signUpEmail).not.toHaveBeenCalled()
  })

  it('refuses a password under 12 characters and keeps the hint on the field', async () => {
    render(<SignUpForm />)
    const user = await fillForm('short')

    await user.click(submitButton())

    expect(await screen.findByText(enUS['auth.validation.passwordLength'])).toBeInTheDocument()
    expect(screen.getByLabelText(enUS['auth.password'])).toHaveAttribute(
      'aria-describedby',
      'sign-up-password-hint sign-up-password-error',
    )
    expect(screen.getByText(enUS['auth.signUp.passwordHint'])).toBeInTheDocument()
  })

  it('disables the submit button while the call is in flight', async () => {
    let release: (value: { data: unknown; error: null }) => void = () => {}
    auth.signUpEmail.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    render(<SignUpForm />)
    const user = await fillForm()

    await user.click(submitButton())

    await waitFor(() => expect(pendingButton()).toBeDisabled())
    expect(pendingButton()).toHaveAttribute('aria-busy', 'true')

    release({ data: { user: {} }, error: null })
    await waitFor(() => expect(router.push).toHaveBeenCalled())
  })

  it('lands on the same "check your email" screen for a new address', async () => {
    auth.signUpEmail.mockResolvedValue({ data: { user: {} }, error: null })
    render(<SignUpForm />)
    const user = await fillForm()

    await user.click(submitButton())

    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith('/verify-email?sent=1&email=lena%40example.edu'),
    )
    expect(auth.signUpEmail).toHaveBeenCalledWith(
      expect.objectContaining({ callbackURL: '/verify-email?verified=1' }),
      expect.anything(),
    )
  })

  it('lands on that same screen when the address is already in use (no enumeration)', async () => {
    auth.signUpEmail.mockResolvedValue({
      data: null,
      error: {
        code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
        status: 422,
        statusText: 'Unprocessable Entity',
      },
    })
    render(<SignUpForm />)
    const user = await fillForm()

    await user.click(submitButton())

    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith('/verify-email?sent=1&email=lena%40example.edu'),
    )
    expect(screen.getByRole('alert')).toBeEmptyDOMElement()
  })

  it('renders the retry-after seconds when the rate limiter refuses', async () => {
    auth.signUpEmail.mockImplementation(rateLimitedOnce('30'))
    render(<SignUpForm />)
    const user = await fillForm()

    await user.click(submitButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('Try again in 30 seconds.')
    expect(router.push).not.toHaveBeenCalled()
  })

  it('renders the generic message when the request never reaches the server', async () => {
    auth.signUpEmail.mockRejectedValue(new TypeError('Failed to fetch'))
    render(<SignUpForm />)
    const user = await fillForm()

    await user.click(submitButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(enUS['auth.error.generic'])
    expect(submitButton()).toBeEnabled()
    expect(router.push).not.toHaveBeenCalled()
  })

  it('puts the form-level message above the fields, not above the submit', async () => {
    auth.signUpEmail.mockImplementation(rateLimitedOnce('30'))
    render(<SignUpForm />)
    const user = await fillForm()

    await user.click(submitButton())

    const alert = await screen.findByRole('alert')
    const name = screen.getByLabelText(enUS['auth.name'])
    expect(alert.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('never offers the Google button: it belongs to sign-in only', () => {
    render(<SignUpForm />)
    expect(
      screen.queryByRole('button', { name: enUS['auth.signIn.google'] }),
    ).not.toBeInTheDocument()
  })
})
