import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotificationList } from '@/components/features/notifications/notification-list'
import { formatDateTime } from '@/lib/format/date-time'
import { enUS } from '@/lib/i18n/en-US'
import { t } from '@/lib/i18n/t'
import type { NotificationPage, NotificationView } from '@/server/modules/notifications/schema'

// UI-011's list. The first page is server-rendered and handed in, so what this component owns is
// everything after that: append the next page by cursor, mark one row read, mark everything read.
//
// Both marks are optimistic, which is the thing worth protecting. A row that greys itself and then
// finds the service refused has told the reader something untrue about their own record, so a
// refusal puts the row back exactly as it was and says why — and neither mark refreshes the shell
// unless the write actually happened, because the unread count in the rail is drawn from that.
//
// A notification carries no band, no count and no placement (D-015): it is delivered by e-mail as
// well as in the app. Nothing here asserts on those, because the row is only ever a title, a
// sentence, and the moment it arrived — which is exactly what the fixtures below are.

const router = vi.hoisted(() => ({ refresh: vi.fn() }))
const actions = vi.hoisted(() => ({
  listNotificationsAction: vi.fn(),
  markNotificationReadAction: vi.fn(),
  markAllNotificationsReadAction: vi.fn(),
}))
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
  usePathname: () => '/notifications',
  useParams: () => ({}),
}))

// All three are Server Actions: importing the real module would pull the notifications service,
// the database client and `server-only` into jsdom.
vi.mock('@/server/modules/notifications/actions', () => ({
  listNotificationsAction: actions.listNotificationsAction,
  markNotificationReadAction: actions.markNotificationReadAction,
  markAllNotificationsReadAction: actions.markAllNotificationsReadAction,
}))

// `useActionErrorToast` reports the refusal it shows as an `error_shown` event (17 §3.6). Analytics
// never changes control flow, and this keeps the suite from depending on whether a key is set.
vi.mock('@/lib/analytics/client', () => ({ trackClient: vi.fn(async () => {}) }))

vi.mock('sonner', () => ({ toast: { success: toasts.success, error: toasts.error } }))

const SCORED: NotificationView = {
  id: 'b1f0c4de-1f7a-4f2a-9c1a-0a2b3c4d5e01',
  type: 'run_scored',
  title: enUS['notifications.runScored.title'],
  body: enUS['notifications.runScored.body'],
  link: '/runs/9f6ab2f8-9f14-4f6f-a3a0-64f1f3a1a034/debrief',
  readAt: null,
  createdAt: '2026-09-08T14:15:00.000Z',
}

const HELD: NotificationView = {
  id: 'b1f0c4de-1f7a-4f2a-9c1a-0a2b3c4d5e02',
  type: 'run_held',
  title: enUS['notifications.runHeld.title'],
  body: enUS['notifications.runHeld.body'],
  link: null,
  readAt: null,
  createdAt: '2026-09-07T09:00:00.000Z',
}

const CONFIRMED: NotificationView = {
  id: 'b1f0c4de-1f7a-4f2a-9c1a-0a2b3c4d5e03',
  type: 'bands_confirmed',
  title: enUS['notifications.bandsConfirmed.title'],
  body: enUS['notifications.bandsConfirmed.body'],
  link: '/runs/9f6ab2f8-9f14-4f6f-a3a0-64f1f3a1a034/debrief',
  readAt: '2026-09-06T11:30:00.000Z',
  createdAt: '2026-09-06T11:00:00.000Z',
}

/** The row the second page brings. */
const EXPORTED: NotificationView = {
  id: 'b1f0c4de-1f7a-4f2a-9c1a-0a2b3c4d5e04',
  type: 'export_ready',
  title: enUS['notifications.exportReady.title'],
  body: enUS['notifications.exportReady.body'],
  link: null,
  readAt: null,
  createdAt: '2026-09-05T08:00:00.000Z',
}

const refused = (message: string) => ({
  ok: false as const,
  error: { code: 'NOT_FOUND', message, requestId: 'req_1' },
})

const page = (items: readonly NotificationView[], nextCursor: string | null) => ({
  ok: true as const,
  data: { items: [...items], nextCursor },
})

function renderList(
  items: readonly NotificationView[] = [SCORED, HELD, CONFIRMED],
  cursor: string | null = null,
): ReturnType<typeof userEvent.setup> {
  render(<NotificationList initial={[...items]} initialCursor={cursor} />)
  return userEvent.setup()
}

/** The row a notice is drawn on, found the way a reader finds it: by what it says. */
const row = (item: NotificationView): HTMLElement => {
  const found = screen
    .getAllByRole('listitem')
    .find((candidate) => within(candidate).queryByText(item.title) !== null)
  if (found === undefined) throw new Error(`No row for "${item.title}".`)
  return found
}

const markRead = (item: NotificationView) =>
  screen.getByRole('button', { name: t('notifications.markReadLabel', { title: item.title }) })

const markAllRead = () => screen.getByRole('button', { name: enUS['notifications.markAllRead'] })

const loadMore = () => screen.getByRole('button', { name: enUS['notifications.loadMore'] })

describe('NotificationList (UI-011)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actions.markNotificationReadAction.mockResolvedValue({
      ok: true,
      data: { ...SCORED, readAt: '2026-09-09T10:00:00.000Z' },
    })
    actions.markAllNotificationsReadAction.mockResolvedValue({ ok: true, data: { marked: 2 } })
    actions.listNotificationsAction.mockResolvedValue(page([EXPORTED], null))
  })

  it('draws every notice the server sent, with its sentence and the moment it arrived', () => {
    renderList()

    expect(screen.getByRole('list', { name: enUS['notifications.listLabel'] })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    for (const item of [SCORED, HELD, CONFIRMED]) {
      const line = row(item)
      expect(within(line).getByText(item.body)).toBeInTheDocument()
      // One fixed UTC format for every timestamp in the product (D-177).
      expect(within(line).getByText(formatDateTime(item.createdAt))).toBeInTheDocument()
    }
    expect(row(SCORED)).toHaveTextContent('Sep 8, 2026')
  })

  // The icon in front of a row is decorative, so the kind of notice is carried in text a screen
  // reader can reach rather than in the picture alone.
  it('names the kind of each notice in text', () => {
    renderList()

    expect(within(row(SCORED)).getByText(enUS['notifications.type.run_scored'])).toBeInTheDocument()
    expect(within(row(HELD)).getByText(enUS['notifications.type.run_held'])).toBeInTheDocument()
    expect(
      within(row(CONFIRMED)).getByText(enUS['notifications.type.bands_confirmed']),
    ).toBeInTheDocument()
  })

  // Unread is a border on the left and a heavier title, neither of which a screen reader has; the
  // word is what carries the state, and a read row must not carry it or every row reads as new.
  it('says which notices are unread, and offers the mark only on those', () => {
    renderList()

    expect(within(row(SCORED)).getByText(enUS['notifications.unread'])).toBeInTheDocument()
    expect(within(row(CONFIRMED)).queryByText(enUS['notifications.unread'])).not.toBeInTheDocument()
    expect(within(row(SCORED)).getByRole('button')).toBeInTheDocument()
    expect(within(row(CONFIRMED)).queryByRole('button')).not.toBeInTheDocument()
  })

  it('offers a way into what a notice is about, and nothing where the notice has no link', () => {
    renderList()

    expect(
      within(row(SCORED)).getByRole('link', { name: enUS['notifications.open'] }),
    ).toHaveAttribute('href', SCORED.link)
    expect(within(row(HELD)).queryByRole('link')).not.toBeInTheDocument()
  })

  it('says nothing has arrived rather than drawing an empty list', () => {
    renderList([])

    expect(
      screen.getByRole('heading', { name: enUS['notifications.emptyTitle'] }),
    ).toBeInTheDocument()
    expect(screen.getByText(enUS['notifications.emptyBody'])).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('marks one notice read, leaves the row where it is, and catches the shell up', async () => {
    const user = renderList()

    await user.click(markRead(SCORED))

    await waitFor(() => {
      expect(actions.markNotificationReadAction).toHaveBeenCalledWith({ id: SCORED.id })
    })
    // The row stays in place and only loses what said it was new; the rest of the list is untouched.
    await waitFor(() => {
      expect(within(row(SCORED)).queryByText(enUS['notifications.unread'])).not.toBeInTheDocument()
    })
    expect(within(row(HELD)).getByText(enUS['notifications.unread'])).toBeInTheDocument()
    // The rail's unread count is server-rendered, so it only moves on a refresh (D-709).
    await waitFor(() => expect(router.refresh).toHaveBeenCalled())
  })

  // The optimistic mark is a promise about the record, and a refused write means the promise was
  // wrong: the row goes back to unread rather than leaving the reader believing they have read it.
  it('puts the row back and says why when the mark is refused', async () => {
    actions.markNotificationReadAction.mockResolvedValue(refused(enUS['notifications.notFound']))
    const user = renderList()

    await user.click(markRead(SCORED))

    await waitFor(() => {
      expect(toasts.error).toHaveBeenCalledWith(enUS['notifications.notFound'])
    })
    expect(within(row(SCORED)).getByText(enUS['notifications.unread'])).toBeInTheDocument()
    expect(markRead(SCORED)).toBeInTheDocument()
    expect(router.refresh).not.toHaveBeenCalled()
  })

  // One write at a time: the marks all run in the same transition, so a second press while the
  // first is with the service would be a second write against a list that is already changing.
  it('holds the other marks while one is in flight', async () => {
    let release: (result: { ok: true; data: NotificationView }) => void = () => {}
    actions.markNotificationReadAction.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    const user = renderList()

    await user.click(markRead(SCORED))

    await waitFor(() => expect(markRead(HELD)).toBeDisabled())
    expect(markAllRead()).toBeDisabled()

    await user.click(markRead(HELD))
    expect(actions.markNotificationReadAction).toHaveBeenCalledTimes(1)

    release({ ok: true, data: { ...SCORED, readAt: '2026-09-09T10:00:00.000Z' } })
    await waitFor(() => expect(router.refresh).toHaveBeenCalled())
  })

  it('marks everything read in one act, and confirms it without interrupting', async () => {
    const user = renderList()

    await user.click(markAllRead())

    await waitFor(() => expect(actions.markAllNotificationsReadAction).toHaveBeenCalledWith({}))
    await waitFor(() => {
      expect(toasts.success).toHaveBeenCalledWith(enUS['notifications.markedAllRead'])
    })
    expect(screen.queryByText(enUS['notifications.unread'])).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: t('notifications.markReadLabel', { title: SCORED.title }),
      }),
    ).not.toBeInTheDocument()
    await waitFor(() => expect(router.refresh).toHaveBeenCalled())
  })

  it('puts every row back and says why when marking everything read is refused', async () => {
    actions.markAllNotificationsReadAction.mockResolvedValue(refused('Nothing could be marked.'))
    const user = renderList()

    await user.click(markAllRead())

    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('Nothing could be marked.'))
    expect(within(row(SCORED)).getByText(enUS['notifications.unread'])).toBeInTheDocument()
    expect(within(row(HELD)).getByText(enUS['notifications.unread'])).toBeInTheDocument()
    expect(toasts.success).not.toHaveBeenCalled()
    expect(router.refresh).not.toHaveBeenCalled()
  })

  // A control that would mark nothing is not offered as one: the list is already all read.
  it('offers nothing to mark when every notice has been read already', () => {
    renderList([CONFIRMED])

    expect(markAllRead()).toBeDisabled()
  })

  it('offers no next page when the server sent the last one', () => {
    renderList()

    expect(
      screen.queryByRole('button', { name: enUS['notifications.loadMore'] }),
    ).not.toBeInTheDocument()
  })

  it('appends the next page and drops the control once the last page has arrived', async () => {
    const user = renderList([SCORED, HELD, CONFIRMED], 'cursor-2')

    await user.click(loadMore())

    await waitFor(() => {
      expect(actions.listNotificationsAction).toHaveBeenCalledWith({ cursor: 'cursor-2' })
    })
    expect(await screen.findByText(EXPORTED.title)).toBeInTheDocument()
    // The rows already on the screen stay on it: this is a page appended, not a page replaced.
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: enUS['notifications.loadMore'] }),
      ).not.toBeInTheDocument()
    })
  })

  // A notice marked read between the two requests shifts the window, so the second page can carry a
  // row the first one already had. It is one notice either way, and it is drawn once.
  it('draws a notice the first page already carried only once', async () => {
    actions.listNotificationsAction.mockResolvedValue(page([SCORED, EXPORTED], null))
    const user = renderList([SCORED, HELD, CONFIRMED], 'cursor-2')

    await user.click(loadMore())

    expect(await screen.findByText(EXPORTED.title)).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    expect(screen.getAllByText(SCORED.title)).toHaveLength(1)
  })

  it('says the page is on its way, and asks for it once', async () => {
    let release: (result: { ok: true; data: NotificationPage }) => void = () => {}
    actions.listNotificationsAction.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    const user = renderList([SCORED, HELD, CONFIRMED], 'cursor-2')

    await user.click(loadMore())

    await waitFor(() => expect(loadMore()).toBeDisabled())
    expect(loadMore()).toHaveAttribute('aria-busy', 'true')

    await user.click(loadMore())
    expect(actions.listNotificationsAction).toHaveBeenCalledTimes(1)

    release(page([EXPORTED], null))
    await screen.findByText(EXPORTED.title)
  })

  it('keeps the page it has and says why when the next page is refused', async () => {
    actions.listNotificationsAction.mockResolvedValue(refused('The page could not be read.'))
    const user = renderList([SCORED, HELD, CONFIRMED], 'cursor-2')

    await user.click(loadMore())

    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('The page could not be read.'))
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    // The cursor is untouched, so the same page can be asked for again.
    expect(loadMore()).toBeEnabled()
  })
})
