import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SectionRoster } from '@/components/features/courses/section-roster'
import { enUS } from '@/lib/i18n/en-US'

// UI-031. Two consequential actions on this screen used to happen on a single press: "Remove"
// unseated somebody with no confirmation and no undo, and "Invite to institution" sent mail. Both
// now open an overlay, and neither overlay is part of the first paint — the module they live in is
// fetched on the press that needs it (B4, ./roster-dialogs).
//
// The invitations panel is server data as well: it used to be React state seeded empty, so a
// reload lost it and "expired" could never render at all.

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }))
const actions = vi.hoisted(() => ({
  addSectionMemberAction: vi.fn(),
  removeSectionMemberAction: vi.fn(),
  inviteMemberAction: vi.fn(),
}))
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
  usePathname: () => '/courses/c1/sections/s1/roster',
}))

// Server Actions: importing the real modules would pull the services, the database client and
// `server-only` into jsdom.
vi.mock('@/server/modules/courses/actions', () => ({
  addSectionMemberAction: actions.addSectionMemberAction,
  removeSectionMemberAction: actions.removeSectionMemberAction,
}))
vi.mock('@/server/modules/tenancy/actions', () => ({
  inviteMemberAction: actions.inviteMemberAction,
}))
vi.mock('sonner', () => ({ toast: { success: toasts.success, error: toasts.error } }))

const MEMBERS = [
  { userId: 'u1', name: 'Lena Ortiz', email: 'lena@example.edu', role: 'student' as const },
  { userId: 'u2', name: 'Marc Vidal', email: 'marc@example.edu', role: 'instructor' as const },
]

const INVITATIONS = [
  {
    id: 'i1',
    organizationId: 'org1',
    email: 'new@example.edu',
    role: 'student' as const,
    status: 'pending',
    expiresAt: '2026-09-11T12:00:00.000Z',
  },
  {
    id: 'i2',
    organizationId: 'org1',
    email: 'stale@example.edu',
    role: 'teaching_assistant' as const,
    status: 'expired',
    expiresAt: '2026-08-01T12:00:00.000Z',
  },
]

function renderRoster(invitations = INVITATIONS) {
  render(
    <SectionRoster
      sectionId="11111111-1111-4111-8111-111111111111"
      sectionName="Section A"
      organizationId="org1"
      members={MEMBERS}
      invitations={invitations}
      truncated={false}
    />,
  )
  return userEvent.setup()
}

const removeButton = (name: string) =>
  screen.getByRole('button', { name: enUS['roster.removeLabel'].replace('{name}', name) })

describe('SectionRoster removal (UI-031, SYS-005)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actions.removeSectionMemberAction.mockResolvedValue({ ok: true, data: {} })
    actions.addSectionMemberAction.mockResolvedValue({
      ok: true,
      data: { email: 'lena@example.edu' },
    })
  })

  it('paints the row control without the confirmation behind it', () => {
    renderRoster()
    expect(removeButton('Lena Ortiz')).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('asks before unseating anyone, and names the person it is about', async () => {
    const user = renderRoster()
    await user.click(removeButton('Lena Ortiz'))

    const dialog = await screen.findByRole('alertdialog', {
      name: enUS['roster.removeConfirmTitle'],
    })
    expect(dialog).toHaveTextContent('Lena Ortiz')
    expect(dialog).toHaveTextContent('lena@example.edu')
    expect(dialog).toHaveTextContent('Section A')
    expect(actions.removeSectionMemberAction).not.toHaveBeenCalled()
  })

  it('cancels without calling the action and hands focus back to the row', async () => {
    const user = renderRoster()
    await user.click(removeButton('Lena Ortiz'))
    await screen.findByRole('alertdialog')

    await user.click(screen.getByRole('button', { name: enUS['roster.cancel'] }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(actions.removeSectionMemberAction).not.toHaveBeenCalled()
    await waitFor(() => expect(removeButton('Lena Ortiz')).toHaveFocus())
  })

  it('removes only once the confirmation is pressed', async () => {
    const user = renderRoster()
    await user.click(removeButton('Marc Vidal'))
    await screen.findByRole('alertdialog')

    await user.click(screen.getByRole('button', { name: enUS['roster.removeConfirmAction'] }))

    await waitFor(() =>
      expect(actions.removeSectionMemberAction).toHaveBeenCalledWith({
        sectionId: '11111111-1111-4111-8111-111111111111',
        userId: 'u2',
      }),
    )
    await waitFor(() => expect(router.refresh).toHaveBeenCalled())
  })

  it('keeps a refusal on the row it refuses and closes the confirmation', async () => {
    actions.removeSectionMemberAction.mockResolvedValue({
      ok: false,
      error: {
        code: 'MEMBER_HAS_RUNS',
        message: 'Marc has runs on this section.',
        requestId: 'r1',
      },
    })
    const user = renderRoster()
    await user.click(removeButton('Marc Vidal'))
    await screen.findByRole('alertdialog')
    await user.click(screen.getByRole('button', { name: enUS['roster.removeConfirmAction'] }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(await screen.findByText('Marc has runs on this section.')).toBeInTheDocument()
    expect(router.refresh).not.toHaveBeenCalled()
  })
})

describe('SectionRoster invitations (UI-031)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actions.addSectionMemberAction.mockResolvedValue({
      ok: false,
      error: {
        code: 'NOT_SECTION_MEMBER',
        message: 'Nobody in this institution uses that address.',
        requestId: 'r1',
      },
    })
    actions.inviteMemberAction.mockResolvedValue({
      ok: true,
      data: {
        id: 'i3',
        organizationId: 'org1',
        email: 'newcomer@example.edu',
        role: 'student',
        status: 'pending',
        expiresAt: '2026-09-11T12:00:00.000Z',
      },
    })
  })

  it('renders the invitations the page read, pending and expired', () => {
    renderRoster()
    const panel = screen.getByRole('region', { name: enUS['roster.invitationsCaption'] })
    expect(within(panel).getByText('new@example.edu')).toBeInTheDocument()
    expect(within(panel).getByText(enUS['roster.invitationPending'])).toBeInTheDocument()
    expect(within(panel).getByText('stale@example.edu')).toBeInTheDocument()
    expect(within(panel).getByText(enUS['roster.invitationExpired'])).toBeInTheDocument()
  })

  it('states the empty case rather than an empty table', () => {
    renderRoster([])
    expect(screen.getByText(enUS['roster.invitationsEmptyTitle'])).toBeInTheDocument()
  })

  it('opens the invitation form instead of sending on the press', async () => {
    const user = renderRoster()
    await user.type(screen.getByLabelText(enUS['roster.addEmail']), 'newcomer@example.edu')
    await user.click(screen.getByRole('button', { name: enUS['roster.addSubmit'] }))

    const invite = await screen.findByRole('button', { name: enUS['roster.inviteAction'] })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(invite)
    const dialog = await screen.findByRole('dialog', { name: enUS['roster.inviteTitle'] })
    expect(actions.inviteMemberAction).not.toHaveBeenCalled()
    expect(within(dialog).getByLabelText(enUS['roster.inviteEmail'])).toHaveValue(
      'newcomer@example.edu',
    )
    expect(within(dialog).getByLabelText(enUS['roster.inviteRole'])).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: enUS['roster.cancel'] })).toBeInTheDocument()
  })

  it('sends only from the form, and shows the new invitation in the list', async () => {
    const user = renderRoster()
    await user.type(screen.getByLabelText(enUS['roster.addEmail']), 'newcomer@example.edu')
    await user.click(screen.getByRole('button', { name: enUS['roster.addSubmit'] }))
    await user.click(await screen.findByRole('button', { name: enUS['roster.inviteAction'] }))
    await screen.findByRole('dialog', { name: enUS['roster.inviteTitle'] })

    await user.click(screen.getByRole('button', { name: enUS['roster.inviteSubmit'] }))

    await waitFor(() =>
      expect(actions.inviteMemberAction).toHaveBeenCalledWith({
        orgId: 'org1',
        email: 'newcomer@example.edu',
        role: 'student',
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText('newcomer@example.edu')).toBeInTheDocument()
    expect(router.refresh).toHaveBeenCalled()
  })
})
