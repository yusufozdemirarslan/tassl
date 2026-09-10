import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AcceptInvitationButton,
  SwitchAccountButton,
} from '@/components/features/invitations/accept-invitation'
import { enUS } from '@/lib/i18n/en-US'
import { t } from '@/lib/i18n/t'

// UI-005's two controls. The page around them decides which one a person sees — a valid invitation
// gets the accept button, a link addressed to somebody else gets the way out — so what is protected
// here is what each control does once it is pressed.
//
// Accepting writes a membership, and the tenancy action is where the invited address is checked
// against the session again (08 §2.5). The button therefore has to be narrower than it looks: send
// once, say what came back, and land on /home only when the membership exists. A refusal that
// navigated anyway would drop a person on a home page that does not yet hold the institution they
// were told they had joined.

const INVITATION_ID = 'a5a6f0c9-1c7e-4f0e-9c2f-2f1b8a10d201'
const ORGANIZATION = 'Northfield College'

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
const actions = vi.hoisted(() => ({ acceptInvitationAction: vi.fn() }))
const auth = vi.hoisted(() => ({ signOut: vi.fn() }))
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: router.push,
    refresh: router.refresh,
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
  usePathname: () => '/invitations/a5a6f0c9-1c7e-4f0e-9c2f-2f1b8a10d201',
}))

// A Server Action: importing the real module would pull the tenancy service, the database client
// and `server-only` into jsdom.
vi.mock('@/server/modules/tenancy/actions', () => ({
  acceptInvitationAction: actions.acceptInvitationAction,
}))

// `useSignOut` revokes the session through Better Auth and resets the analytics identity before it
// does (17 §5.5); neither belongs in a component test, and both reach the network.
vi.mock('@/lib/auth-client', () => ({ authClient: { signOut: auth.signOut } }))
vi.mock('@/lib/analytics/client', () => ({ resetClient: vi.fn(async () => {}) }))

// `@/lib/toast` reaches sonner through a dynamic import, which this mock answers as well.
vi.mock('sonner', () => ({ toast: { success: toasts.success, error: toasts.error } }))

/** The membership Better Auth hands back, which is what puts the institution in the switcher. */
const MEMBERSHIP = { organizationId: 'org-1', name: ORGANIZATION, role: 'student' }

const accepted = () => ({ ok: true as const, data: MEMBERSHIP })

const refused = (message: string) => ({
  ok: false as const,
  error: { code: 'INVITATION_EMAIL_MISMATCH', message, requestId: 'req_1' },
})

const accept = () => screen.getByRole('button', { name: enUS['invitation.accept'] })
const switchAccount = () => screen.getByRole('button', { name: enUS['invitation.switchAccount'] })

function renderAccept(): ReturnType<typeof userEvent.setup> {
  render(<AcceptInvitationButton invitationId={INVITATION_ID} organizationName={ORGANIZATION} />)
  return userEvent.setup()
}

describe('AcceptInvitationButton (UI-005)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actions.acceptInvitationAction.mockResolvedValue(accepted())
  })

  // An invitation is spent by accepting it (08 §2.5), so opening the page must not spend it: the
  // one control is the only thing that writes, and it writes when a person presses it.
  it('offers one control and writes nothing until it is pressed', () => {
    renderAccept()

    expect(accept()).toBeEnabled()
    expect(screen.getByRole('alert')).toBeEmptyDOMElement()
    expect(actions.acceptInvitationAction).not.toHaveBeenCalled()
  })

  it('writes the membership and lands on /home, where the institution is already in the switcher', async () => {
    const user = renderAccept()

    await user.click(accept())

    await waitFor(() => {
      expect(actions.acceptInvitationAction).toHaveBeenCalledWith({ invitationId: INVITATION_ID })
    })
    await waitFor(() => {
      expect(toasts.success).toHaveBeenCalledWith(t('invitation.accepted', { name: ORGANIZATION }))
    })
    expect(router.push).toHaveBeenCalledWith('/home')
    // The shell is server-rendered, so the switcher only holds the new institution after a refresh.
    await waitFor(() => expect(router.refresh).toHaveBeenCalled())
  })

  // The action's message is written for the person holding the link — the address does not match,
  // the invitation has been spent — so it is shown where the press happened rather than swallowed
  // into a toast that a navigation would take away with it.
  it('says why under the control and goes nowhere when the service refuses', async () => {
    actions.acceptInvitationAction.mockResolvedValue(
      refused('This invitation was sent to another address.'),
    )
    const user = renderAccept()

    await user.click(accept())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('This invitation was sent to another address.')
    expect(router.push).not.toHaveBeenCalled()
    expect(router.refresh).not.toHaveBeenCalled()
    expect(toasts.success).not.toHaveBeenCalled()
    // A refusal is not the end of the screen: the same link may work on a second press.
    expect(accept()).toBeEnabled()
  })

  it('clears the earlier refusal when the invitation is tried again', async () => {
    actions.acceptInvitationAction.mockResolvedValueOnce(
      refused('The invitation could not be read.'),
    )
    const user = renderAccept()

    await user.click(accept())
    expect(await screen.findByRole('alert')).toHaveTextContent('The invitation could not be read.')

    await user.click(accept())

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/home'))
    expect(screen.getByRole('alert')).toBeEmptyDOMElement()
  })

  // Accepting twice is a second call against an invitation the first call has already spent, which
  // comes back as NOT_FOUND and reads to the person as a failure of something that worked.
  it('accepts once while the write is in flight, and says it is working', async () => {
    let release: (result: ReturnType<typeof accepted>) => void = () => {}
    actions.acceptInvitationAction.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    const user = renderAccept()

    await user.click(accept())

    await waitFor(() => expect(accept()).toBeDisabled())
    expect(accept()).toHaveAttribute('aria-busy', 'true')

    await user.click(accept())
    expect(actions.acceptInvitationAction).toHaveBeenCalledTimes(1)

    release(accepted())
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/home'))
  })
})

describe('SwitchAccountButton (UI-005)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.signOut.mockResolvedValue({ data: { success: true }, error: null })
  })

  // The email-mismatch state has exactly one way forward, and this is it: end the session here so
  // the invited address can sign in and open the link again.
  it('ends the session and sends the browser to the sign-in screen', async () => {
    render(<SwitchAccountButton />)
    const user = userEvent.setup()

    await user.click(switchAccount())

    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/sign-in'))
    expect(toasts.error).not.toHaveBeenCalled()
  })

  // Better Auth answers `{ error }` rather than throwing, and a still-signed-in person sent to
  // /sign-in is bounced straight back to /home — a round trip that looks like a sign-out and is not
  // one. The person stays on the invitation, and the toast is the only surface left to say so.
  it('stays on the invitation and says so when the sign-out is refused', async () => {
    auth.signOut.mockResolvedValue({
      data: null,
      error: { status: 500, message: 'upstream', statusText: 'Internal Server Error' },
    })
    render(<SwitchAccountButton />)
    const user = userEvent.setup()

    await user.click(switchAccount())

    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith(enUS['shell.signOutFailed']))
    expect(router.push).not.toHaveBeenCalled()
    expect(switchAccount()).toBeEnabled()
  })

  it('revokes the session once while the request is in flight', async () => {
    let release: (result: { data: { success: boolean }; error: null }) => void = () => {}
    auth.signOut.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    render(<SwitchAccountButton />)
    const user = userEvent.setup()

    await user.click(switchAccount())

    await waitFor(() => expect(switchAccount()).toBeDisabled())
    expect(switchAccount()).toHaveAttribute('aria-busy', 'true')

    await user.click(switchAccount())
    expect(auth.signOut).toHaveBeenCalledTimes(1)

    release({ data: { success: true }, error: null })
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/sign-in'))
  })
})
