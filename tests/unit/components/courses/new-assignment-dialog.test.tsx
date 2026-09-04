import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AssignmentsList,
  type AssignmentsListProps,
} from '@/components/features/courses/assignments-list'
import type { PackageVersionOption } from '@/components/features/courses/package-version-option'
import { enUS } from '@/lib/i18n/en-US'
import { t } from '@/lib/i18n/t'

// UI-030 → Assignments → "New assignment" (step 4.4). Without it UI-032's screen is reachable only
// through the API, so what this file protects is that the control exists, that it is offered to the
// instructor and to nobody else, that the form behind it arrives with the dialog rather than with
// the route (B4), and that the two states where it cannot act say so instead of failing silently.

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
const actions = vi.hoisted(() => ({
  createAssignmentAction: vi.fn(),
  updateAssignmentAction: vi.fn(),
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
  usePathname: () => '/courses/c1',
}))

vi.mock('@/server/modules/courses/actions', () => ({
  createAssignmentAction: actions.createAssignmentAction,
  updateAssignmentAction: actions.updateAssignmentAction,
}))

vi.mock('sonner', () => ({ toast: { success: toasts.success, error: toasts.error } }))

const VERSION: PackageVersionOption = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Meridian Roast',
  version: 3,
  calibrationStatus: 'uncalibrated',
  variants: [
    { id: '22222222-2222-4222-8222-222222222222', key: 'defective' },
    { id: '33333333-3333-4333-8333-333333333333', key: 'sound' },
  ],
  defaultWorkingClockSeconds: 1500,
}

const SECTIONS = [{ id: 's1', name: 'Section A' }]

function renderList(overrides: Partial<AssignmentsListProps> = {}) {
  render(
    <AssignmentsList
      assignments={[]}
      canConfigure
      canCreate
      sections={SECTIONS}
      packageVersions={[VERSION]}
      courseDefaultWeight={2}
      {...overrides}
    />,
  )
  return userEvent.setup()
}

const trigger = () => screen.getByRole('button', { name: enUS['courses.newAssignment'] })

describe('AssignmentsList → New assignment (UI-030, step 4.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actions.createAssignmentAction.mockResolvedValue({
      ok: true,
      data: { id: 'a1', label: 'Decision Run 1' },
    })
  })

  it('paints the trigger without the configuration form behind it', () => {
    renderList()
    expect(trigger()).toBeInTheDocument()
    expect(screen.queryByLabelText(enUS['assignment.labelLabel'])).not.toBeInTheDocument()
  })

  it('offers no trigger at all to someone who may not manage the course', () => {
    renderList({ canCreate: false })
    expect(
      screen.queryByRole('button', { name: enUS['courses.newAssignment'] }),
    ).not.toBeInTheDocument()
  })

  it('announces the dialog, names the only section, and then brings the form in', async () => {
    const user = renderList()

    await user.click(trigger())
    const dialog = await screen.findByRole('dialog', { name: enUS['courses.newAssignment'] })
    expect(dialog).toHaveTextContent(enUS['courses.newAssignmentDescription'])

    await waitFor(() => expect(screen.getByLabelText(enUS['assignment.labelLabel'])).toBeVisible())
    expect(
      screen.getByText(t('courses.assignmentSectionOne', { name: 'Section A' })),
    ).toBeInTheDocument()
    // One section is stated, never asked for.
    expect(screen.queryByLabelText(enUS['courses.assignmentSectionLabel'])).not.toBeInTheDocument()
  })

  it('asks which section when the course has several', async () => {
    const user = renderList({
      sections: [...SECTIONS, { id: 's2', name: 'Section B' }],
    })

    await user.click(trigger())
    await waitFor(() =>
      expect(screen.getByLabelText(enUS['courses.assignmentSectionLabel'])).toBeVisible(),
    )
  })

  it('creates the assignment on the section and lands on its configuration screen', async () => {
    const user = renderList()

    await user.click(trigger())
    await screen.findByLabelText(enUS['assignment.labelLabel'])
    await user.type(screen.getByLabelText(enUS['assignment.labelLabel']), 'Decision Run 1')
    await user.click(screen.getByRole('button', { name: enUS['assignment.createSubmit'] }))

    await waitFor(() =>
      expect(actions.createAssignmentAction).toHaveBeenCalledWith({
        sectionId: 's1',
        label: 'Decision Run 1',
        isWalkthrough: false,
        opensAt: null,
        packageVersionId: VERSION.id,
        variantId: VERSION.variants[0]!.id,
        workingClockSeconds: null,
        weight: null,
      }),
    )
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/assignments/a1'))
  })

  it('keeps the control and says why while the institution has confirmed no package version', async () => {
    const user = renderList({ packageVersions: [] })

    const button = trigger()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    const reason = button.getAttribute('aria-describedby')
    expect(reason).not.toBeNull()
    expect(document.getElementById(reason as string)).toHaveTextContent(
      enUS['assignment.noPackagesBody'],
    )

    await user.click(button)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps the control and says why while the course has no section', async () => {
    const user = renderList({ sections: [] })

    const button = trigger()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    const reason = button.getAttribute('aria-describedby')
    expect(document.getElementById(reason as string)).toHaveTextContent(
      enUS['courses.newAssignmentNoSections'],
    )

    await user.click(button)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
