import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UserTable } from '@/components/features/admin/user-table'
import { PLATFORM_ROLES, PLATFORM_ROLE_LABELS } from '@/components/features/admin/platform-roles'
import { formatDateTime } from '@/lib/format/date-time'
import { enUS } from '@/lib/i18n/en-US'
import { t } from '@/lib/i18n/t'
import type { AdminUser, AdminUserPage } from '@/server/modules/admin/schema'

// UI-050's users table, and the platform-role vocabulary it and its dialog both read. The screen is
// walked end to end by tests/e2e/admin/admin.spec.ts; what is protected here is the table's own
// judgement — which row gets a control at all, what a change costs before it is accepted, and what
// happens to the row when the service refuses.

const router = vi.hoisted(() => ({ refresh: vi.fn() }))
const actions = vi.hoisted(() => ({ listUsersAction: vi.fn(), setPlatformRoleAction: vi.fn() }))
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
  usePathname: () => '/admin/users',
}))

// Both are Server Actions: importing the real module would pull the admin service, the database
// client and `server-only` into jsdom.
vi.mock('@/server/modules/admin/actions', () => ({
  listUsersAction: actions.listUsersAction,
  setPlatformRoleAction: actions.setPlatformRoleAction,
}))

// `@/lib/toast` reaches sonner through a dynamic import, which this mock answers as well.
vi.mock('sonner', () => ({ toast: { success: toasts.success, error: toasts.error } }))

const SELF: AdminUser = {
  id: 'user-self',
  name: 'Rae Whitlock',
  email: 'rae@tassl.example',
  platformRole: 'admin',
  deletedAt: null,
  createdAt: '2026-09-01T09:15:00.000Z',
}

const OPEN: AdminUser = {
  id: 'user-open',
  name: 'Ada Okafor',
  email: 'ada@example.edu',
  platformRole: 'none',
  deletedAt: null,
  createdAt: '2026-08-28T14:00:00.000Z',
}

const CLOSED: AdminUser = {
  id: 'user-closed',
  name: 'Ben Iversen',
  email: 'ben@example.edu',
  platformRole: 'tassl_scenario_editor',
  deletedAt: '2026-09-02T10:00:00.000Z',
  createdAt: '2026-08-01T08:00:00.000Z',
}

const NEXT_PAGE: AdminUser = {
  id: 'user-next',
  name: 'Cleo Marsh',
  email: 'cleo@example.edu',
  platformRole: 'none',
  deletedAt: null,
  createdAt: '2026-07-14T11:30:00.000Z',
}

function renderTable(
  page: Partial<AdminUserPage> = {},
  query = '',
): ReturnType<typeof userEvent.setup> {
  const initial: AdminUserPage = {
    items: page.items ?? [SELF, OPEN, CLOSED],
    nextCursor: page.nextCursor ?? null,
  }
  render(<UserTable initial={initial} query={query} selfId={SELF.id} />)
  return userEvent.setup()
}

const roleControl = (name: string) =>
  screen.getByRole('combobox', { name: t('admin.users.roleLabel', { name }) })

const loadMore = () => screen.getByRole('button', { name: enUS['admin.users.loadMore'] })

/** Opens the row's control and chooses a role, which is what raises the confirmation. */
async function chooseRole(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  label: string,
): Promise<void> {
  await user.click(roleControl(name))
  await user.click(await screen.findByRole('option', { name: label }))
}

const refused = (message: string) => ({
  ok: false as const,
  error: { code: 'FORBIDDEN', message, requestId: 'req_1' },
})

describe('UserTable (UI-050)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actions.setPlatformRoleAction.mockResolvedValue({
      ok: true,
      data: { ...OPEN, platformRole: 'tassl_scenario_editor' },
    })
    actions.listUsersAction.mockResolvedValue({
      ok: true,
      data: { items: [NEXT_PAGE], nextCursor: null },
    })
  })

  it('draws a row for every account the server sent, with the role and the join date on it', () => {
    renderTable()

    expect(screen.getByText(enUS['admin.users.caption'])).toBeInTheDocument()
    for (const row of [SELF, OPEN, CLOSED]) {
      expect(screen.getByRole('rowheader', { name: new RegExp(row.name) })).toBeInTheDocument()
      expect(screen.getByText(row.email)).toBeInTheDocument()
      expect(screen.getByText(formatDateTime(row.createdAt))).toBeInTheDocument()
    }
    // The date is the product's one fixed UTC format (D-177), not a locale-dependent rendering.
    expect(screen.getByText(formatDateTime(SELF.createdAt))).toHaveTextContent('Sep 1, 2026')
  })

  // The service refuses a self-change — a demotion would revoke the sessions it is being made from
  // — so the row carries no control that would only be refused, and says why instead.
  it('gives the actor their own row as a label and a reason, never a control', () => {
    renderTable()

    expect(screen.getByText(enUS['admin.users.selfLabel'])).toBeInTheDocument()
    expect(screen.getByText(enUS['admin.users.roleSelfNote'])).toBeInTheDocument()
    expect(screen.getByText(PLATFORM_ROLE_LABELS.admin)).toBeInTheDocument()
    expect(
      screen.queryByRole('combobox', { name: t('admin.users.roleLabel', { name: SELF.name }) }),
    ).not.toBeInTheDocument()
  })

  // A closed account holds no seat to give (D-577). It is marked and explained, and the marking is
  // the secondary badge rather than the refusal red, which belongs to a refusal or a defect.
  it('gives a closed account the same treatment, and says a closed account holds no role', () => {
    renderTable()

    expect(screen.getByText(enUS['admin.users.deletedLabel'])).toBeInTheDocument()
    expect(screen.getByText(enUS['admin.users.roleDeletedNote'])).toBeInTheDocument()
    expect(
      screen.queryByRole('combobox', { name: t('admin.users.roleLabel', { name: CLOSED.name }) }),
    ).not.toBeInTheDocument()
  })

  it('names the person in the control, so a dense table stays unambiguous', () => {
    renderTable()

    expect(roleControl(OPEN.name)).toHaveTextContent(PLATFORM_ROLE_LABELS.none)
  })

  // `platform-roles.ts` fixes the order least to most (08 §3, D-007); the select offers it whole.
  it('offers the three platform roles in order, least right to most', async () => {
    const user = renderTable()

    await user.click(roleControl(OPEN.name))
    const options = await screen.findAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual(
      PLATFORM_ROLES.map((value) => PLATFORM_ROLE_LABELS[value]),
    )
  })

  // A role change is not only a role change: it revokes every session the person holds. The
  // sentence a person reads before they confirm says so, and names both ends of the change.
  it('asks before it changes anything, naming the role it is leaving and the one it is taking', async () => {
    const user = renderTable()

    await chooseRole(user, OPEN.name, PLATFORM_ROLE_LABELS.tassl_scenario_editor)

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(enUS['admin.users.confirmTitle'])
    expect(dialog).toHaveTextContent(
      t('admin.users.confirmBody', {
        name: OPEN.name,
        from: PLATFORM_ROLE_LABELS.none,
        role: PLATFORM_ROLE_LABELS.tassl_scenario_editor,
      }),
    )
    expect(actions.setPlatformRoleAction).not.toHaveBeenCalled()
  })

  it('changes the role on confirmation, updates the row in place, and catches the audit tab up', async () => {
    const user = renderTable()

    await chooseRole(user, OPEN.name, PLATFORM_ROLE_LABELS.tassl_scenario_editor)
    const dialog = await screen.findByRole('alertdialog')
    await user.click(
      within(dialog).getByRole('button', { name: enUS['admin.users.confirmSubmit'] }),
    )

    await waitFor(() => {
      expect(actions.setPlatformRoleAction).toHaveBeenCalledWith({
        userId: OPEN.id,
        role: 'tassl_scenario_editor',
      })
    })
    // The row takes the account the service returned rather than the table reloading, so an admin
    // working down a list does not lose their position.
    await waitFor(() => {
      expect(roleControl(OPEN.name)).toHaveTextContent(PLATFORM_ROLE_LABELS.tassl_scenario_editor)
    })
    await waitFor(() => {
      expect(toasts.success).toHaveBeenCalledWith(
        t('admin.users.roleSaved', {
          name: OPEN.name,
          role: PLATFORM_ROLE_LABELS.tassl_scenario_editor,
        }),
      )
    })
    expect(router.refresh).toHaveBeenCalled()
  })

  // Leaving it alone is the cheap half of a consequential confirmation, and the half a hesitant
  // admin reaches for, so it has to actually leave the role where it was.
  it('changes nothing when the confirmation is dismissed', async () => {
    const user = renderTable()

    await chooseRole(user, OPEN.name, PLATFORM_ROLE_LABELS.admin)
    const dialog = await screen.findByRole('alertdialog')
    await user.click(
      within(dialog).getByRole('button', { name: enUS['admin.users.confirmCancel'] }),
    )

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(actions.setPlatformRoleAction).not.toHaveBeenCalled()
    expect(roleControl(OPEN.name)).toHaveTextContent(PLATFORM_ROLE_LABELS.none)
  })

  // Re-choosing the role the account already holds is not a change, and must not raise a dialog
  // that offers to sign somebody out for nothing.
  it('does not ask about a choice that leaves the role where it was', async () => {
    const user = renderTable()

    await chooseRole(user, OPEN.name, PLATFORM_ROLE_LABELS.none)

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(actions.setPlatformRoleAction).not.toHaveBeenCalled()
  })

  it('keeps the row as it was and says why when the service refuses the change', async () => {
    actions.setPlatformRoleAction.mockResolvedValue(refused(enUS['admin.roleSelfRefused']))
    const user = renderTable()

    await chooseRole(user, OPEN.name, PLATFORM_ROLE_LABELS.admin)
    const dialog = await screen.findByRole('alertdialog')
    await user.click(
      within(dialog).getByRole('button', { name: enUS['admin.users.confirmSubmit'] }),
    )

    await waitFor(() => {
      expect(toasts.error).toHaveBeenCalledWith(enUS['admin.roleSelfRefused'])
    })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(roleControl(OPEN.name)).toHaveTextContent(PLATFORM_ROLE_LABELS.none)
    expect(toasts.success).not.toHaveBeenCalled()
    expect(router.refresh).not.toHaveBeenCalled()
  })

  // The dialog cannot be dismissed out from under a change that is already with the service: the
  // press that confirmed it is the last one that decides anything.
  it('refuses to close the confirmation while the change is in flight', async () => {
    let release: (result: { ok: true; data: AdminUser }) => void = () => {}
    actions.setPlatformRoleAction.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    const user = renderTable()

    await chooseRole(user, OPEN.name, PLATFORM_ROLE_LABELS.tassl_scenario_editor)
    const dialog = await screen.findByRole('alertdialog')
    const submit = within(dialog).getByRole('button', {
      name: enUS['admin.users.confirmSubmit'],
    })
    await user.click(submit)

    await waitFor(() => expect(submit).toHaveAttribute('aria-busy', 'true'))
    expect(submit).toBeDisabled()
    expect(
      within(dialog).getByRole('button', { name: enUS['admin.users.confirmCancel'] }),
    ).toBeDisabled()

    await user.keyboard('{Escape}')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()

    release({ ok: true, data: { ...OPEN, platformRole: 'tassl_scenario_editor' } })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('offers no "show more" when the server sent the last page', () => {
    renderTable()

    expect(
      screen.queryByRole('button', { name: enUS['admin.users.loadMore'] }),
    ).not.toBeInTheDocument()
  })

  it('appends the next page and drops the control once the last page has arrived', async () => {
    const user = renderTable({ nextCursor: 'cursor-2' })

    await user.click(loadMore())

    await waitFor(() => {
      expect(actions.listUsersAction).toHaveBeenCalledWith({ cursor: 'cursor-2' })
    })
    expect(await screen.findByText(NEXT_PAGE.email)).toBeInTheDocument()
    // The rows already on the screen stay on it: this is a page appended, not a page replaced.
    expect(screen.getByText(OPEN.email)).toBeInTheDocument()
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: enUS['admin.users.loadMore'] }),
      ).not.toBeInTheDocument()
    })
  })

  // The search the page was rendered with is the search the next page must be drawn from, or
  // "show more" would quietly widen a filtered table to the whole platform.
  it('carries the email search into every page after the first', async () => {
    const user = renderTable({ nextCursor: 'cursor-2' }, 'ada@')

    await user.click(loadMore())

    await waitFor(() => {
      expect(actions.listUsersAction).toHaveBeenCalledWith({ cursor: 'cursor-2', q: 'ada@' })
    })
  })

  it('marks the control busy while the page is on its way, and asks for it once', async () => {
    let release: (result: { ok: true; data: AdminUserPage }) => void = () => {}
    actions.listUsersAction.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    const user = renderTable({ nextCursor: 'cursor-2' })

    await user.click(loadMore())

    const busy = await screen.findByRole('button', { name: enUS['admin.users.loadMoreBusy'] })
    expect(busy).toHaveAttribute('aria-busy', 'true')
    expect(busy).toBeDisabled()

    await user.click(busy)
    expect(actions.listUsersAction).toHaveBeenCalledTimes(1)

    release({ ok: true, data: { items: [NEXT_PAGE], nextCursor: null } })
    await screen.findByText(NEXT_PAGE.email)
  })

  it('keeps the page it has and says why when the next page is refused', async () => {
    actions.listUsersAction.mockResolvedValue(refused('The page could not be read.'))
    const user = renderTable({ nextCursor: 'cursor-2' })

    await user.click(loadMore())

    await waitFor(() => {
      expect(toasts.error).toHaveBeenCalledWith('The page could not be read.')
    })
    expect(screen.getByText(OPEN.email)).toBeInTheDocument()
    // The cursor is untouched, so the same page can be asked for again.
    expect(loadMore()).toBeEnabled()
  })

  it('says the platform has no accounts rather than drawing an empty table', () => {
    renderTable({ items: [] })

    expect(screen.getByRole('heading', { name: enUS['admin.users.empty'] })).toBeInTheDocument()
    expect(screen.getByText(enUS['admin.users.emptyBody'])).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  // An empty search is a different fact from an empty platform, and the way out of it is different
  // too: the body says the search matches the start of an address and can be cleared.
  it('says the search matched nothing when the emptiness belongs to the search', () => {
    renderTable({ items: [] }, 'zz@')

    expect(
      screen.getByRole('heading', { name: enUS['admin.users.emptySearch'] }),
    ).toBeInTheDocument()
    expect(screen.getByText(enUS['admin.users.emptySearchBody'])).toBeInTheDocument()
  })
})
