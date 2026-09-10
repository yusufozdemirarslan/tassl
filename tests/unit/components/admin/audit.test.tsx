import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ALL_INSTITUTIONS, AuditFilter } from '@/components/features/admin/audit-filter'
import { AuditTable } from '@/components/features/admin/audit-table'
import { formatDateTime } from '@/lib/format/date-time'
import { enUS } from '@/lib/i18n/en-US'
import { t } from '@/lib/i18n/t'
import type { AuditEntry, AuditEntryPage, InstitutionRef } from '@/server/modules/admin/schema'

// UI-050's audit log, both halves of it (DATA-048). What the e2e suite proves is that the screen
// exists and that a role change lands on it; what this file protects is the rules the two controls
// keep between them. The table shows the record a row was written with rather than swallowing it
// (D-576), and it names the system and the platform where a row has neither actor nor institution
// instead of drawing a blank cell. The filter puts the institution in the address as a GET query,
// so a filtered log can be reloaded and linked to — and the table carries that same institution
// into every "show more", because paging that dropped it would append the rows it excluded.

const actions = vi.hoisted(() => ({ listAuditLogAction: vi.fn() }))
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

// The action is a Server Action: importing the real module would pull the admin service, the
// database client, and `server-only` into jsdom.
vi.mock('@/server/modules/admin/actions', () => ({
  listAuditLogAction: actions.listAuditLogAction,
}))

// `@/lib/toast` reaches sonner through a dynamic import, which this mock answers as well.
vi.mock('sonner', () => ({ toast: { success: toasts.success, error: toasts.error } }))

const KEPLER: InstitutionRef = { id: 'org_kepler', name: 'Kepler University' }
const MERIDIAN: InstitutionRef = { id: 'org_meridian', name: 'Meridian College' }
const ADMIN_ACTOR = 'usr_admin01'

// A platform act by a person: a role change, whose metadata is the only place the log records what
// the role was changed *from*.
const ROLE_CHANGE: AuditEntry = {
  id: '11111111-1111-4111-8111-111111111111',
  action: 'role.set',
  targetType: 'user',
  targetId: 'usr_9f2ad4',
  actorId: ADMIN_ACTOR,
  organizationId: null,
  requestId: 'req_7c1e',
  metadata: { from: 'user', to: 'admin', sessionsRevoked: 3 },
  createdAt: '2026-09-04T14:15:00.000Z',
}

// An act inside one institution with no actor behind it and nothing recorded: a job, or the seed.
const EXPORT_BUILT: AuditEntry = {
  id: '22222222-2222-4222-8222-222222222222',
  action: 'export.created',
  targetType: 'run',
  targetId: 'run_31ab',
  actorId: null,
  organizationId: KEPLER.id,
  requestId: 'req_002f',
  metadata: {},
  createdAt: '2026-09-04T09:00:00.000Z',
}

const NEXT_ROW: AuditEntry = {
  id: '33333333-3333-4333-8333-333333333333',
  action: 'band.confirmed',
  targetType: 'run',
  targetId: 'run_004c',
  actorId: 'usr_instructor',
  organizationId: KEPLER.id,
  requestId: 'req_003a',
  metadata: {},
  createdAt: '2026-09-03T08:00:00.000Z',
}

const page = (items: readonly AuditEntry[], nextCursor: string | null): AuditEntryPage => ({
  items: [...items],
  nextCursor,
})

const showMore = () => screen.getByRole('button', { name: enUS['admin.audit.loadMore'] })

/** The row an entry was drawn as, found by the instant that heads it. */
function rowFor(entry: AuditEntry): HTMLElement {
  const row = screen.getByRole('rowheader', { name: formatDateTime(entry.createdAt) }).closest('tr')
  if (row === null) throw new Error('an audit entry is drawn as a table row')
  return row
}

describe('AuditTable (UI-050)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actions.listAuditLogAction.mockResolvedValue({ ok: true, data: page([NEXT_ROW], null) })
  })

  it('draws one row per entry, headed by the instant it happened', () => {
    render(<AuditTable initial={page([ROLE_CHANGE, EXPORT_BUILT], null)} orgId="" />)

    expect(screen.getByRole('table', { name: enUS['admin.audit.caption'] })).toBeInTheDocument()
    for (const column of [
      enUS['admin.audit.columnTime'],
      enUS['admin.audit.columnAction'],
      enUS['admin.audit.columnTarget'],
      enUS['admin.audit.columnActor'],
      enUS['admin.audit.columnOrg'],
      enUS['admin.audit.columnRequest'],
      enUS['admin.audit.columnRecord'],
    ]) {
      expect(screen.getByRole('columnheader', { name: column })).toBeInTheDocument()
    }
    // Two entries and the header row, in the order the page handed them down: newest first.
    expect(screen.getAllByRole('row')).toHaveLength(3)

    const row = rowFor(ROLE_CHANGE)
    expect(row).toHaveTextContent(ROLE_CHANGE.action)
    expect(row).toHaveTextContent(`${ROLE_CHANGE.targetType} ${ROLE_CHANGE.targetId}`)
    expect(row).toHaveTextContent(ROLE_CHANGE.requestId)
  })

  // The rendered time is a person's, the `datetime` is a machine's; a row read next to a log line
  // needs the instant itself, not a formatted approximation of it.
  it('keeps the machine-readable instant beside the one it renders', () => {
    render(<AuditTable initial={page([ROLE_CHANGE], null)} orgId="" />)

    const stamp = screen.getByText(formatDateTime(ROLE_CHANGE.createdAt))
    expect(stamp).toHaveAttribute('datetime', ROLE_CHANGE.createdAt)
  })

  // A row with no actor is the system — a job or the seed — and a row with no institution is a
  // platform act, which is what a role change is. Neither is an empty cell the reader must guess at.
  it('names the system and the platform where a row has neither actor nor institution', () => {
    render(<AuditTable initial={page([ROLE_CHANGE, EXPORT_BUILT], null)} orgId="" />)

    const platformAct = rowFor(ROLE_CHANGE)
    expect(platformAct).toHaveTextContent(ADMIN_ACTOR)
    expect(platformAct).toHaveTextContent(enUS['admin.audit.platformOrg'])

    const systemAct = rowFor(EXPORT_BUILT)
    expect(systemAct).toHaveTextContent(enUS['admin.audit.systemActor'])
    expect(systemAct).toHaveTextContent(KEPLER.id)
  })

  // D-576: `metadata` is where a role change says what it changed from, and a log that records that
  // and does not show it answers the only question an incident asks with a shrug.
  it('shows the record the row was written with, and says when there is none', () => {
    render(<AuditTable initial={page([ROLE_CHANGE, EXPORT_BUILT], null)} orgId="" />)

    const withRecord = rowFor(ROLE_CHANGE)
    expect(within(withRecord).getByText(enUS['admin.audit.openRecord'])).toBeVisible()
    expect(withRecord).toHaveTextContent('"from": "user"')
    expect(withRecord).toHaveTextContent('"to": "admin"')
    expect(withRecord).toHaveTextContent('"sessionsRevoked": 3')

    const withoutRecord = rowFor(EXPORT_BUILT)
    expect(withoutRecord).toHaveTextContent(enUS['admin.audit.noRecord'])
    expect(
      within(withoutRecord).queryByText(enUS['admin.audit.openRecord']),
    ).not.toBeInTheDocument()
  })

  it('says nothing has been audited yet when the whole log is empty', () => {
    render(<AuditTable initial={page([], null)} orgId="" />)

    expect(
      screen.getByRole('heading', { level: 2, name: enUS['admin.audit.empty'] }),
    ).toBeInTheDocument()
    expect(screen.getByText(enUS['admin.audit.emptyBody'])).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    // There is no filter to drop, so nothing offers to drop one.
    expect(
      screen.queryByRole('link', { name: enUS['admin.audit.emptyFilteredAction'] }),
    ).not.toBeInTheDocument()
  })

  // An empty *filtered* log is a different fact from an empty log, and reading the first as the
  // second would tell an admin the product has never audited anything. The way out is offered.
  it('distinguishes an empty filter from an empty log, and offers the way back', () => {
    render(<AuditTable initial={page([], null)} orgId={KEPLER.id} />)

    expect(
      screen.getByRole('heading', { level: 2, name: enUS['admin.audit.emptyFiltered'] }),
    ).toBeInTheDocument()
    expect(screen.getByText(enUS['admin.audit.emptyFilteredBody'])).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: enUS['admin.audit.emptyFilteredAction'] }),
    ).toHaveAttribute('href', '/admin/audit')
  })

  it('offers no "show more" when the first page is the whole log', () => {
    render(<AuditTable initial={page([ROLE_CHANGE], null)} orgId="" />)

    expect(
      screen.queryByRole('button', { name: enUS['admin.audit.loadMore'] }),
    ).not.toBeInTheDocument()
  })

  it('appends the next page and stops offering more once the log runs out', async () => {
    render(<AuditTable initial={page([ROLE_CHANGE], 'cur_2')} orgId="" />)
    const user = userEvent.setup()

    await user.click(showMore())

    expect(await screen.findByText(formatDateTime(NEXT_ROW.createdAt))).toBeInTheDocument()
    expect(actions.listAuditLogAction).toHaveBeenCalledWith({ cursor: 'cur_2' })
    // The rows already read are kept; the log is append-only and so is this table.
    expect(screen.getByText(formatDateTime(ROLE_CHANGE.createdAt))).toBeInTheDocument()
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: enUS['admin.audit.loadMore'] }),
      ).not.toBeInTheDocument()
    })
  })

  // The filter lives in the address, and the page hands it down; a "show more" that forgot it would
  // append rows from institutions the reader has excluded.
  it('carries the institution filter into every "show more"', async () => {
    render(<AuditTable initial={page([EXPORT_BUILT], 'cur_2')} orgId={KEPLER.id} />)
    const user = userEvent.setup()

    await user.click(showMore())

    await waitFor(() => {
      expect(actions.listAuditLogAction).toHaveBeenCalledWith({
        cursor: 'cur_2',
        orgId: KEPLER.id,
      })
    })
  })

  it('says why the next page did not arrive and keeps the rows it already has', async () => {
    actions.listAuditLogAction.mockResolvedValue({
      ok: false,
      error: {
        code: 'FORBIDDEN',
        message: 'That seat cannot read the audit log.',
        requestId: 'r1',
      },
    })
    render(<AuditTable initial={page([ROLE_CHANGE], 'cur_2')} orgId="" />)
    const user = userEvent.setup()

    await user.click(showMore())

    await waitFor(() => {
      expect(toasts.error).toHaveBeenCalledWith('That seat cannot read the audit log.')
    })
    expect(screen.getByText(formatDateTime(ROLE_CHANGE.createdAt))).toBeInTheDocument()
    // The cursor is kept, so a refusal that was transient can be pressed through.
    expect(showMore()).toBeEnabled()
  })

  // The rows are appended, so a double press would append the same page twice; the control shuts
  // for the flight and says it is working while it does.
  it('marks the control busy in flight and takes no second press', async () => {
    let release: (value: unknown) => void = () => {}
    actions.listAuditLogAction.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    render(<AuditTable initial={page([ROLE_CHANGE], 'cur_2')} orgId="" />)
    const user = userEvent.setup()

    await user.click(showMore())

    const busy = await screen.findByRole('button', { name: enUS['admin.audit.loadMoreBusy'] })
    expect(busy).toBeDisabled()
    expect(busy).toHaveAttribute('aria-busy', 'true')

    await user.click(busy)
    expect(actions.listAuditLogAction).toHaveBeenCalledTimes(1)

    release({ ok: true, data: page([NEXT_ROW], null) })
    await waitFor(() => {
      expect(screen.getByText(formatDateTime(NEXT_ROW.createdAt))).toBeInTheDocument()
    })
  })
})

/** The GET form the filter is; `document`, because a form with no name has no role to find it by. */
function filterForm(): HTMLFormElement {
  const form = document.querySelector('form')
  if (form === null) throw new Error('AuditFilter renders a form')
  return form
}

/** What pressing "Apply" would put in the address. */
const submittedOrgId = () => new FormData(filterForm()).get('orgId')

const institutionControl = () =>
  screen.getByRole('combobox', { name: enUS['admin.audit.filterLabel'] })

describe('AuditFilter (UI-050)', () => {
  it('is a GET form to the audit log, so a filtered log can be reloaded and linked to', () => {
    render(<AuditFilter institutions={[KEPLER, MERIDIAN]} orgId="" limit={200} />)

    const form = filterForm()
    expect(form.method).toBe('get')
    expect(form.getAttribute('action')).toBe('/admin/audit')
    expect(screen.getByRole('button', { name: enUS['admin.audit.filterSubmit'] })).toHaveAttribute(
      'type',
      'submit',
    )
  })

  // `ALL_INSTITUTIONS` is a sentinel rather than an empty value: an empty option is a hole a reader
  // cannot tell from an unset control. The page strips it before the service sees it (07 §9).
  it('stands unfiltered on a named sentinel rather than an empty value', () => {
    render(<AuditFilter institutions={[KEPLER, MERIDIAN]} orgId="" limit={200} />)

    expect(institutionControl()).toHaveTextContent(enUS['admin.audit.filterAll'])
    expect(submittedOrgId()).toBe(ALL_INSTITUTIONS)
    expect(submittedOrgId()).not.toBe('')
  })

  it('starts on the institution the address named', () => {
    render(<AuditFilter institutions={[KEPLER, MERIDIAN]} orgId={MERIDIAN.id} limit={200} />)

    expect(institutionControl()).toHaveTextContent(MERIDIAN.name)
    expect(submittedOrgId()).toBe(MERIDIAN.id)
  })

  it('offers every institution it was given, under "every institution"', async () => {
    render(<AuditFilter institutions={[KEPLER, MERIDIAN]} orgId="" limit={200} />)
    const user = userEvent.setup()

    await user.click(institutionControl())

    const options = await screen.findAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      enUS['admin.audit.filterAll'],
      KEPLER.name,
      MERIDIAN.name,
    ])
  })

  // The institution is chosen by name and submitted as an id: the reader picks "Kepler University"
  // and the address carries `orgId=org_kepler`, which is what the service takes.
  it("puts the chosen institution's id in the query", async () => {
    render(<AuditFilter institutions={[KEPLER, MERIDIAN]} orgId="" limit={200} />)
    const user = userEvent.setup()

    await user.click(institutionControl())
    await user.click(await screen.findByRole('option', { name: KEPLER.name }))

    await waitFor(() => {
      expect(submittedOrgId()).toBe(KEPLER.id)
    })
    expect(institutionControl()).toHaveTextContent(KEPLER.name)
  })

  // D-572: the list is capped. An instrument that silently drops the row you are looking for is
  // worse than one that admits its range, so a full list says so rather than reading complete.
  it('admits its range when it has shown as many institutions as it offers', () => {
    render(<AuditFilter institutions={[KEPLER, MERIDIAN]} orgId="" limit={2} />)

    expect(screen.getByText(t('admin.audit.filterTruncated', { count: 2 }))).toBeInTheDocument()
  })

  it('says nothing about the cap when every institution fits under it', () => {
    render(<AuditFilter institutions={[KEPLER, MERIDIAN]} orgId="" limit={200} />)

    expect(
      screen.queryByText(t('admin.audit.filterTruncated', { count: 200 })),
    ).not.toBeInTheDocument()
  })
})
