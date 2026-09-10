import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminNav } from '@/components/features/admin/admin-nav'
import { SentryTestForm } from '@/components/features/admin/sentry-test-form'
import { UserSearch } from '@/components/features/admin/user-search'
import { enUS } from '@/lib/i18n/en-US'
import { t } from '@/lib/i18n/t'

// The three pieces of chrome UI-050 is assembled from: the nav across its sections, the search over
// the accounts, and the one button on the flags screen that proves events still leave this
// deployment (13 §4, D-708). The e2e suite walks the screens; what is worth pinning here is the
// promise each of them makes on its own — a section a person can link to, a search that lives in
// the address, and a control that refuses in a way somebody can still read.

const actions = vi.hoisted(() => ({ sendSentryTestAction: vi.fn() }))
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

// The action is a Server Action: importing the real module would pull the admin service, the
// database client, and `server-only` into jsdom.
vi.mock('@/server/modules/admin/actions', () => ({
  sendSentryTestAction: actions.sendSentryTestAction,
}))

// `@/lib/toast` reaches sonner through a dynamic import, which this mock answers as well.
vi.mock('sonner', () => ({ toast: { success: toasts.success, error: toasts.error } }))

describe('AdminNav (UI-050)', () => {
  const SECTIONS = [
    { current: 'users', label: enUS['admin.tabUsers'], href: '/admin/users' },
    { current: 'flags', label: enUS['admin.tabFlags'], href: '/admin/flags' },
    { current: 'audit', label: enUS['admin.tabAudit'], href: '/admin/audit' },
  ] as const satisfies ReadonlyArray<{
    current: 'users' | 'flags' | 'audit'
    label: string
    href: string
  }>

  /** The sections marked as the one showing; there is never more than one of them. */
  const showing = (): string[] =>
    screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')
      .map((link) => link.textContent ?? '')

  it('names the three sections in order and points each at its own route', () => {
    render(<AdminNav current="users" />)

    // The nav carries a name of its own: a screen reader listing the landmarks of an admin screen
    // finds this one beside the app rail, and the two are not the same thing.
    const nav = screen.getByRole('navigation', { name: enUS['admin.tabsLabel'] })
    const links = within(nav).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(SECTIONS.map((section) => section.label))
    expect(links.map((link) => link.getAttribute('href'))).toEqual(
      SECTIONS.map((section) => section.href),
    )
  })

  it.each([...SECTIONS])('marks $label as the section showing, and nothing else', (section) => {
    render(<AdminNav current={section.current} />)
    expect(showing()).toEqual([section.label])
  })

  // The three sections are three routes, not a client tab widget: the section showing keeps its
  // href, so it can be linked to, reloaded and gone back from like any other address. A `tab` here
  // would be a promise the component cannot keep — nothing on this screen holds tab panels.
  it('leaves the section showing a link, not a tab', () => {
    render(<AdminNav current="flags" />)

    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    expect(screen.getByRole('link', { name: enUS['admin.tabFlags'] })).toHaveAttribute(
      'href',
      '/admin/flags',
    )
  })
})

describe('UserSearch (UI-050)', () => {
  const searchBox = () => screen.getByRole('searchbox', { name: enUS['admin.users.searchLabel'] })
  const clearLink = () => screen.queryByRole('link', { name: enUS['admin.users.searchClear'] })

  /** The form a control belongs to; for this search, the form is the whole of the mechanism. */
  function formOf(control: HTMLElement): HTMLFormElement {
    const form = control.closest('form')
    if (form === null) throw new Error('The search control is not inside a form.')
    return form
  }

  /**
   * The address a browser asks for when this form is submitted: a GET form replaces the query
   * string of its action with the fields it carries.
   */
  function submittedAddress(form: HTMLFormElement): string {
    const params = new URLSearchParams()
    for (const [name, value] of new FormData(form)) params.append(name, String(value))
    return `${form.getAttribute('action') ?? ''}?${params.toString()}`
  }

  it('starts from the search the address is already carrying', () => {
    render(<UserSearch query="lena@" />)

    expect(searchBox()).toHaveValue('lena@')
    // Asking for the box by the label's own words is the assertion: were the label missing, the
    // placeholder would be standing in as the name of the control, which DESIGN.md §Inputs refuses.
    expect(searchBox()).toHaveAttribute('placeholder', enUS['admin.users.searchPlaceholder'])
  })

  it('puts what was typed into the address, so a filtered list can be reloaded and linked to', async () => {
    const user = userEvent.setup()
    render(<UserSearch query="" />)

    await user.type(searchBox(), 'lena')

    expect(submittedAddress(formOf(searchBox()))).toBe('/admin/users?q=lena')
  })

  // A GET form and no script (D-575): the admin screens are the ones somebody reaches on a bad day,
  // and a search that only works once the page has hydrated is one more thing to have gone wrong.
  it('searches by submitting the form itself, with nothing that has to hydrate first', () => {
    render(<UserSearch query="" />)

    expect(formOf(searchBox()).method).toBe('get')
    expect(screen.getByRole('button', { name: enUS['admin.users.searchSubmit'] })).toHaveAttribute(
      'type',
      'submit',
    )
  })

  // "Clear" on an unfiltered list is a control that does nothing: the whole list is already what is
  // showing, so the way back only exists while there is something to come back from.
  it('offers the way back to every account only while the list is filtered', () => {
    const { rerender } = render(<UserSearch query="" />)
    expect(clearLink()).not.toBeInTheDocument()

    rerender(<UserSearch query="lena" />)
    expect(clearLink()).toHaveAttribute('href', '/admin/users')
  })
})

describe('SentryTestForm (UI-050, D-708)', () => {
  const EVENT_ID = '7c1f0f3a9b0d4e2f8a6c5b4d3e2f1a09'
  const sent = {
    ok: true,
    data: { eventId: EVENT_ID, environment: 'production', dsnConfigured: true },
  }
  const sentLine = t('admin.flags.sentrySent', { id: EVENT_ID, environment: 'production' })

  const sendButton = () => screen.getByRole('button', { name: enUS['admin.flags.sentrySend'] })

  beforeEach(() => {
    vi.clearAllMocks()
    actions.sendSentryTestAction.mockResolvedValue(sent)
  })

  // The whole point of the button is the id: an operator reads it off this screen and looks for the
  // same id in Sentry, which is the only proof that the last hop out of the deployment works. The
  // environment travels with it because production and preview send to the same project.
  it('sends one event and prints the id and environment the server answered with', async () => {
    const user = userEvent.setup()
    render(<SentryTestForm dsnConfigured />)

    await user.click(sendButton())

    await waitFor(() => {
      expect(actions.sendSentryTestAction).toHaveBeenCalledWith({})
    })
    expect(await screen.findByRole('status')).toHaveTextContent(sentLine)
    // The same sentence is toasted: the press is confirmed where it was made, for a reader whose
    // eyes are on the button rather than on the paragraph beneath it.
    await waitFor(() => {
      expect(toasts.success).toHaveBeenCalledWith(sentLine)
    })
  })

  // `aria-disabled`, not `disabled`: the browser blurs a control the moment it is disabled, and the
  // early return in the handler is what `disabled` used to do (DESIGN.md §Buttons, ./form-feedback).
  it('says it is working while the event is in flight, and swallows a second press', async () => {
    let release: (value: unknown) => void = () => {}
    actions.sendSentryTestAction.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    const user = userEvent.setup()
    render(<SentryTestForm dsnConfigured />)

    await user.click(sendButton())

    const sending = await screen.findByRole('button', { name: enUS['admin.flags.sentrySending'] })
    expect(sending).toHaveAttribute('aria-disabled', 'true')
    expect(sending).toHaveAttribute('aria-busy', 'true')
    expect(sending).not.toBeDisabled()

    await user.click(sending)
    expect(actions.sendSentryTestAction).toHaveBeenCalledTimes(1)

    release(sent)
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(sentLine)
    })
  })

  it('renders the message from the action error envelope, and claims nothing was sent', async () => {
    actions.sendSentryTestAction.mockResolvedValue({
      ok: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Only a platform admin can send a test event.',
        requestId: 'req_9',
      },
    })
    const user = userEvent.setup()
    render(<SentryTestForm dsnConfigured />)

    await user.click(sendButton())

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Only a platform admin can send a test event.',
      )
    })
    // No id was minted, so there is no id to print and nothing to confirm.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(toasts.success).not.toHaveBeenCalled()

    // The refusal belongs to the press that raised it: the next press starts from a clean form,
    // rather than leaving a red box above a line saying the event went.
    actions.sendSentryTestAction.mockResolvedValue(sent)
    await user.click(sendButton())

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(sentLine)
    })
    expect(screen.getByRole('alert')).toBeEmptyDOMElement()
  })

  // D-708: the SDK mints an id even when it has nowhere to send it, so a deployment with no DSN
  // would otherwise print a perfectly convincing id for an event that never left. The button is
  // held shut before it can, and the sentence says which environment variable is missing.
  it('cannot be pressed on a deployment with no DSN, and carries the reason with the control', async () => {
    const user = userEvent.setup()
    render(<SentryTestForm dsnConfigured={false} />)

    expect(sendButton()).toHaveAttribute('aria-disabled', 'true')
    // Still a control a keyboard reaches, so the reason it names is announced with it rather than
    // sitting unread beside a control the tab order skips.
    expect(sendButton()).not.toBeDisabled()
    expect(sendButton()).toHaveAccessibleDescription(enUS['admin.flags.sentryNoDsn'])
    sendButton().focus()
    expect(sendButton()).toHaveFocus()

    await user.click(sendButton())

    expect(actions.sendSentryTestAction).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('says nothing about a DSN on a deployment that has one', () => {
    render(<SentryTestForm dsnConfigured />)

    expect(screen.queryByText(enUS['admin.flags.sentryNoDsn'])).not.toBeInTheDocument()
    expect(sendButton()).toHaveAttribute('aria-disabled', 'false')
    expect(sendButton()).not.toHaveAccessibleDescription()
  })
})
