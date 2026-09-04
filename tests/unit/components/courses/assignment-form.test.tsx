import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AssignmentForm,
  type EditableAssignment,
  type PackageVersionOption,
} from '@/components/features/courses/assignment-form'
import { enUS } from '@/lib/i18n/en-US'
import { t } from '@/lib/i18n/t'

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }))
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
  usePathname: () => '/assignments/a1',
}))

// The actions are Server Actions: importing the real module would pull the courses service, the
// database client, and `server-only` into jsdom.
vi.mock('@/server/modules/courses/actions', () => ({
  createAssignmentAction: actions.createAssignmentAction,
  updateAssignmentAction: actions.updateAssignmentAction,
}))

vi.mock('sonner', () => ({ toast: { success: toasts.success, error: toasts.error } }))

const VERSION: PackageVersionOption = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Meridian Roast',
  version: 3,
  variants: [
    { id: '22222222-2222-4222-8222-222222222222', key: 'defective' },
    { id: '33333333-3333-4333-8333-333333333333', key: 'sound' },
  ],
  defaultWorkingClockSeconds: 1500,
}

const ASSIGNMENT: EditableAssignment = {
  id: '44444444-4444-4444-8444-444444444444',
  label: 'Decision Run 1',
  packageVersionId: VERSION.id,
  variantId: VERSION.variants[0]!.id,
  workingClockSeconds: null,
  weight: null,
  isWalkthrough: false,
  opensAt: null,
  inUse: false,
}

function renderForm(
  overrides: Partial<EditableAssignment> = {},
  version: PackageVersionOption = VERSION,
) {
  render(
    <AssignmentForm
      packageVersions={[version]}
      courseDefaultWeight={1}
      assignment={{ ...ASSIGNMENT, ...overrides }}
    />,
  )
  return userEvent.setup()
}

const clockField = () => screen.getByLabelText(enUS['assignment.clockLabel'])
const weightField = () => screen.getByLabelText(enUS['assignment.weightLabel'])
const submit = () => screen.getByRole('button', { name: enUS['assignment.saveSubmit'] })

describe('AssignmentForm (UI-032)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actions.updateAssignmentAction.mockResolvedValue({
      ok: true,
      data: { id: ASSIGNMENT.id, label: ASSIGNMENT.label },
    })
  })

  it('shows the clock the package sets and the weight the course sets', () => {
    renderForm()

    expect(screen.getByText(t('assignment.clockDefault', { seconds: 1500 }))).toBeInTheDocument()
    expect(screen.getByText(t('assignment.weightDefault', { weight: 1 }))).toBeInTheDocument()
    // Neither field overrides its default, so both are empty and follow what is stated above.
    expect(clockField()).toHaveValue(null)
    expect(weightField()).toHaveValue(null)
  })

  it('shows the assignment’s own clock when it overrides the package', () => {
    // What the assignment screen hands the form in this case: the override in the field, and no
    // package default, because `AssignmentView` only resolves the package's own value when the
    // assignment does not override it.
    renderForm({ workingClockSeconds: 900 }, { ...VERSION, defaultWorkingClockSeconds: null })

    expect(clockField()).toHaveValue(900)
    // With no default to name, the field states the rule instead.
    expect(screen.getByText(enUS['assignment.clockHint'])).toBeInTheDocument()
    expect(screen.queryByText(t('assignment.clockDefault', { seconds: 1500 }))).toBeNull()
  })

  it('refuses a working clock under 60 seconds with an inline message', async () => {
    const user = renderForm()

    await user.type(clockField(), '30')
    await user.click(submit())

    expect(await screen.findByText(enUS['assignment.validation.clock'])).toBeInTheDocument()
    expect(clockField()).toHaveAttribute('aria-invalid', 'true')
    expect(clockField()).toHaveAttribute('aria-describedby', 'assignment-clock-error')
    expect(actions.updateAssignmentAction).not.toHaveBeenCalled()
  })

  it('accepts a working clock of exactly 60 seconds', async () => {
    const user = renderForm()

    await user.type(clockField(), '60')
    await user.click(submit())

    await waitFor(() => expect(actions.updateAssignmentAction).toHaveBeenCalled())
    expect(actions.updateAssignmentAction.mock.calls[0]?.[0]).toMatchObject({
      workingClockSeconds: 60,
    })
    expect(screen.queryByText(enUS['assignment.validation.clock'])).not.toBeInTheDocument()
  })

  it('locks the structural fields once a run has started and explains why', () => {
    renderForm({ inUse: true })

    expect(screen.getByText(enUS['assignment.lockedTitle'])).toBeInTheDocument()
    expect(screen.getByText(enUS['assignment.lockedBody'])).toBeInTheDocument()

    expect(screen.getByLabelText(enUS['assignment.packageLabel'])).toBeDisabled()
    expect(clockField()).toBeDisabled()
    expect(weightField()).toBeDisabled()
    expect(
      screen.getByRole('radio', { name: enUS['assignment.variantDefective'] }),
    ).toHaveAttribute('aria-disabled', 'true')

    // The three fields a started run does not fix stay open.
    expect(screen.getByLabelText(enUS['assignment.labelLabel'])).toBeEnabled()
    expect(screen.getByLabelText(enUS['assignment.opensAtLabel'])).toBeEnabled()
    expect(
      screen.getByRole('switch', { name: enUS['assignment.walkthroughLabel'] }),
    ).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('omits every structural key from the patch while the assignment is in use', async () => {
    const user = renderForm({ inUse: true })

    await user.clear(screen.getByLabelText(enUS['assignment.labelLabel']))
    await user.type(screen.getByLabelText(enUS['assignment.labelLabel']), 'Decision Run 1 (rerun)')
    await user.click(submit())

    await waitFor(() => expect(actions.updateAssignmentAction).toHaveBeenCalled())
    // `updateAssignment` refuses the *presence* of a structural key once a run exists, so the
    // locked form sends only the three it may still change.
    expect(actions.updateAssignmentAction).toHaveBeenCalledWith({
      assignmentId: ASSIGNMENT.id,
      label: 'Decision Run 1 (rerun)',
      isWalkthrough: false,
      opensAt: null,
    })
  })

  it('states what to do when the institution has no confirmed package version', () => {
    render(<AssignmentForm packageVersions={[]} courseDefaultWeight={1} sectionId="s1" />)

    expect(screen.getByText(enUS['assignment.noPackagesTitle'])).toBeInTheDocument()
    expect(screen.getByText(enUS['assignment.noPackagesBody'])).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: enUS['assignment.createSubmit'] })).toBeNull()
  })
})
