import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VerifyEmailPanel } from '@/components/features/auth/verify-email-panel'
import { enUS } from '@/lib/i18n/en-US'

const auth = vi.hoisted(() => ({ sendVerificationEmail: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
  usePathname: () => '/verify-email',
}))

vi.mock('@/lib/auth-client', () => ({
  authClient: { sendVerificationEmail: auth.sendVerificationEmail },
}))

type FetchOptions = { onError?: (context: { response: Response }) => void }

function resendButton() {
  return screen.getByRole('button', { name: enUS['auth.verify.resend'] })
}

/** The countdown is its own line under the control, so the control keeps its label. */
const COOLDOWN_LINE = /You can ask for another link in \d+ s\./

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

describe('VerifyEmailPanel (UI-003)', () => {
  beforeEach(() => {
    auth.sendVerificationEmail.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('offers the way onward, and the way back, once the link has been spent', () => {
    render(<VerifyEmailPanel state="verified" email={null} />)

    expect(screen.getByRole('link', { name: enUS['auth.verify.continue'] })).toHaveAttribute(
      'href',
      '/home',
    )
    // A terminal state still carries the same "Back to sign in" link as every other state.
    expect(screen.getByRole('link', { name: enUS['auth.verify.backToSignIn'] })).toHaveAttribute(
      'href',
      '/sign-in',
    )
    expect(
      screen.queryByRole('button', { name: enUS['auth.verify.resend'] }),
    ).not.toBeInTheDocument()
  })

  it('asks for the address when nothing has been sent yet (a bare /verify-email)', () => {
    render(<VerifyEmailPanel state="idle" email={null} />)

    expect(screen.getByLabelText(enUS['auth.email'])).toBeInTheDocument()
    expect(resendButton()).toBeEnabled()
  })

  it('resends with the address sign-up carried over and then holds for 60 seconds', async () => {
    vi.useFakeTimers()
    auth.sendVerificationEmail.mockResolvedValue({ data: { status: true }, error: null })
    render(<VerifyEmailPanel state="sent" email="lena@example.edu" />)

    // fireEvent rather than userEvent: userEvent's own inter-event delay runs on the clock this
    // test has frozen, and the cooldown is what is under test here.
    fireEvent.click(screen.getByRole('button', { name: enUS['auth.verify.resend'] }))
    // Fake timers are in play, so the resolved call is flushed by advancing zero milliseconds
    // rather than by waitFor, which would spin against a clock that never moves on its own.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(auth.sendVerificationEmail).toHaveBeenCalledWith(
      { email: 'lena@example.edu', callbackURL: '/verify-email?verified=1' },
      expect.anything(),
    )
    expect(screen.getByRole('status')).toHaveTextContent(enUS['auth.verify.resendSent'])
    // The control keeps its label and its place in the Tab order: aria-disabled, not disabled,
    // so the focus that pressed it survives and it can still be read.
    expect(resendButton()).toHaveAttribute('aria-disabled', 'true')
    expect(resendButton()).not.toBeDisabled()
    expect(resendButton()).toHaveAttribute('aria-busy', 'false')
    expect(screen.getByText(COOLDOWN_LINE)).toBeInTheDocument()
    expect(resendButton()).toHaveAttribute(
      'aria-describedby',
      screen.getByText(COOLDOWN_LINE).getAttribute('id'),
    )

    // Pressing it again during the wait is a no-op rather than a second request.
    fireEvent.click(resendButton())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(auth.sendVerificationEmail).toHaveBeenCalledTimes(1)

    // Each second is its own timeout, scheduled by the effect that runs after the previous tick
    // re-rendered, so the clock is walked forward a second at a time rather than in one jump.
    for (let second = 0; second < 60; second += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
    }
    expect(resendButton()).not.toHaveAttribute('aria-disabled')
    expect(screen.queryByText(COOLDOWN_LINE)).not.toBeInTheDocument()
  })

  it('keeps the keyboard on the screen when the resend is pressed', async () => {
    auth.sendVerificationEmail.mockResolvedValue({ data: { status: true }, error: null })
    const user = userEvent.setup()
    render(<VerifyEmailPanel state="sent" email="lena@example.edu" />)

    await user.click(resendButton())
    await screen.findByRole('status')

    // A `disabled` control drops focus to the body; this one hands it to the confirmation.
    expect(document.activeElement).not.toBe(document.body)
    expect(screen.getByText(enUS['auth.verify.resendSent'])).toHaveFocus()
  })

  it('asks for the address when a spent link is opened in a fresh browser', async () => {
    auth.sendVerificationEmail.mockResolvedValue({ data: { status: true }, error: null })
    const user = userEvent.setup()
    render(<VerifyEmailPanel state="invalid" email={null} />)

    await user.click(screen.getByRole('button', { name: enUS['auth.verify.resend'] }))
    expect(await screen.findByText(enUS['auth.validation.email'])).toBeInTheDocument()
    expect(auth.sendVerificationEmail).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText(enUS['auth.email']), 'lena@example.edu')
    await user.click(screen.getByRole('button', { name: enUS['auth.verify.resend'] }))

    await waitFor(() =>
      expect(auth.sendVerificationEmail).toHaveBeenCalledWith(
        { email: 'lena@example.edu', callbackURL: '/verify-email?verified=1' },
        expect.anything(),
      ),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(enUS['auth.verify.resendSent'])
  })

  it('disables the resend button while the call is in flight', async () => {
    let release: (value: { data: unknown; error: null }) => void = () => {}
    auth.sendVerificationEmail.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const user = userEvent.setup()
    render(<VerifyEmailPanel state="invalid" email="lena@example.edu" />)

    await user.click(resendButton())

    // The label swaps while the call is in flight, so the state reads without the spinner too.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: enUS['auth.verify.resendPending'] }),
      ).toBeDisabled(),
    )
    expect(screen.getByRole('button', { name: enUS['auth.verify.resendPending'] })).toHaveAttribute(
      'aria-busy',
      'true',
    )

    release({ data: { status: true }, error: null })
    await screen.findByText(enUS['auth.verify.resendSent'])
  })

  it('says nothing reassuring, and starts no wait, when the server itself failed', async () => {
    auth.sendVerificationEmail.mockResolvedValue({
      data: null,
      error: { status: 500, statusText: 'Internal Server Error' },
    })
    const user = userEvent.setup()
    render(<VerifyEmailPanel state="sent" email="lena@example.edu" />)

    await user.click(resendButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(enUS['auth.error.generic'])
    expect(screen.queryByText(enUS['auth.verify.resendSent'])).not.toBeInTheDocument()
    // Nothing was sent, so there is nothing to wait for: the control stays pressable.
    expect(screen.queryByText(COOLDOWN_LINE)).not.toBeInTheDocument()
    expect(resendButton()).not.toHaveAttribute('aria-disabled')
  })

  it('renders the generic message, and starts no wait, when the request never lands', async () => {
    auth.sendVerificationEmail.mockRejectedValue(new TypeError('Failed to fetch'))
    const user = userEvent.setup()
    render(<VerifyEmailPanel state="sent" email="lena@example.edu" />)

    await user.click(resendButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(enUS['auth.error.generic'])
    expect(screen.queryByText(COOLDOWN_LINE)).not.toBeInTheDocument()
    expect(resendButton()).not.toHaveAttribute('aria-disabled')
  })

  it('keeps saying the same thing for a refusal that would name the address', async () => {
    auth.sendVerificationEmail.mockResolvedValue({
      data: null,
      error: { code: 'USER_NOT_FOUND', status: 400, statusText: 'Bad Request' },
    })
    const user = userEvent.setup()
    render(<VerifyEmailPanel state="sent" email="stranger@example.edu" />)

    await user.click(resendButton())

    // Identical to the success case, cooldown included, or the wait itself would answer the probe.
    expect(await screen.findByRole('status')).toHaveTextContent(enUS['auth.verify.resendSent'])
    expect(screen.getByRole('alert')).toBeEmptyDOMElement()
    expect(screen.getByText(COOLDOWN_LINE)).toBeInTheDocument()
  })

  it('renders the retry-after seconds when the rate limiter refuses', async () => {
    auth.sendVerificationEmail.mockImplementation(rateLimitedOnce('20'))
    const user = userEvent.setup()
    render(<VerifyEmailPanel state="sent" email="lena@example.edu" />)

    await user.click(resendButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('Try again in 20 seconds.')
    expect(screen.queryByText(COOLDOWN_LINE)).not.toBeInTheDocument()
  })

  it('never offers the Google button', () => {
    render(<VerifyEmailPanel state="sent" email="lena@example.edu" />)
    expect(
      screen.queryByRole('button', { name: enUS['auth.signIn.google'] }),
    ).not.toBeInTheDocument()
  })
})
