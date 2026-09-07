import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MappingEditor } from '@/components/features/courses/mapping-editor'
import { enUS } from '@/lib/i18n/en-US'

// UI-030 → Mapping, in the two steps FR-206 takes it in (PRD §7.19, D-095, D-472).
//
// The editor writes nothing until an instructor has seen what applying would do and ticked the box
// that says what it does. Four properties are what this suite holds:
//
//   1. **The four numbers are validated before anything is asked of the server** — the same three
//      messages the field-level rules produced before the preview existed.
//   2. **Preview writes nothing.** It calls `previewMappingChange` and never `changeMapping`.
//   3. **Apply is refused without the acknowledgement**, and the refusal is at the checkbox rather
//      than in a toast: it is the one sentence that says what applying does.
//   4. **A preview belongs to the numbers it was taken of.** Editing a field after previewing
//      clears the table, so an Apply can never ship numbers the table was not about.

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }))
const actions = vi.hoisted(() => ({
  previewMappingChangeAction: vi.fn(),
  changeMappingAction: vi.fn(),
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

// The actions are Server Actions: importing the real module drags the courses service, the database
// client, and `server-only` into jsdom.
vi.mock('@/server/modules/courses/actions', () => ({
  previewMappingChangeAction: actions.previewMappingChangeAction,
  changeMappingAction: actions.changeMappingAction,
}))

vi.mock('sonner', () => ({ toast: { success: toasts.success, error: toasts.error } }))

const MAPPING = { novice: 1, developing: 2, proficient: 3, professional: 4 }

const AFFECTED = [
  {
    runId: '11111111-1111-4111-8111-111111111111',
    assignmentId: '22222222-2222-4222-8222-222222222222',
    assignmentLabel: 'Decision Run 1',
    studentId: 'user_1',
    pointsNow: 2.571,
    pointsAfter: 3.142,
    changed: true,
  },
  {
    runId: '33333333-3333-4333-8333-333333333333',
    assignmentId: '22222222-2222-4222-8222-222222222222',
    assignmentLabel: 'Decision Run 1',
    studentId: 'user_2',
    pointsNow: 2.0,
    pointsAfter: 2.0,
    changed: false,
  },
]

const previewed = (changedCount = 1) => ({
  ok: true,
  data: {
    current: MAPPING,
    proposed: { ...MAPPING, novice: 1.5 },
    affected: AFFECTED,
    changedCount,
  },
})

const applied = (mapping: typeof MAPPING) => ({
  ok: true,
  data: {
    id: 'c1',
    organizationId: 'org1',
    name: 'Marketing Analytics',
    term: 'Fall 2026',
    outsideAiPolicy: 'declared',
    mapping,
    defaultRunWeight: 2.5,
    critiqueWeightFactor: 0.5,
    taughtConcepts: [],
  },
})

function renderEditor(readOnly = false) {
  render(<MappingEditor courseId="c1" mapping={MAPPING} readOnly={readOnly} />)
  return userEvent.setup()
}

const field = (label: string) => screen.getByLabelText(label)
const novice = () => field(enUS['courses.mappingNovice'])
const previewButton = () => screen.getByRole('button', { name: enUS['courses.mappingSubmit'] })
const applyButton = () => screen.getByRole('button', { name: enUS['courses.mappingApply'] })
const acknowledge = () => screen.getByRole('checkbox', { name: enUS['courses.mappingAcknowledge'] })

/** Type a new novice value and take the preview it produces. */
async function toPreview(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.clear(novice())
  await user.type(novice(), '1.5')
  await user.click(previewButton())
  await screen.findByText(enUS['courses.mappingPreviewTitle'])
}

describe('MappingEditor (UI-030 → Mapping)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actions.previewMappingChangeAction.mockResolvedValue(previewed())
    actions.changeMappingAction.mockResolvedValue(applied({ ...MAPPING, novice: 1.5 }))
  })

  it('shows one input per band, carrying the course mapping', () => {
    renderEditor()
    expect(novice()).toHaveValue('1')
    expect(field(enUS['courses.mappingDeveloping'])).toHaveValue('2')
    expect(field(enUS['courses.mappingProficient'])).toHaveValue('3')
    expect(field(enUS['courses.mappingProfessional'])).toHaveValue('4')
  })

  it('refuses zero with an inline message wired to the field', async () => {
    const user = renderEditor()
    await user.clear(novice())
    await user.type(novice(), '0')
    await user.click(previewButton())

    expect(await screen.findByText(enUS['courses.validation.pointPositive'])).toBeInTheDocument()
    expect(novice()).toHaveAttribute('aria-invalid', 'true')
    const describedBy = novice().getAttribute('aria-describedby')
    expect(describedBy).not.toBeNull()
    expect(document.getElementById(describedBy as string)).toHaveTextContent(
      enUS['courses.validation.pointPositive'],
    )
    expect(actions.previewMappingChangeAction).not.toHaveBeenCalled()
  })

  it('refuses a negative number with the same rule', async () => {
    const user = renderEditor()
    await user.clear(field(enUS['courses.mappingDeveloping']))
    await user.type(field(enUS['courses.mappingDeveloping']), '-2')
    await user.click(previewButton())

    expect(await screen.findByText(enUS['courses.validation.pointPositive'])).toBeInTheDocument()
    expect(actions.previewMappingChangeAction).not.toHaveBeenCalled()
  })

  it('refuses a value that is not a number, and says that rather than "not positive"', async () => {
    const user = renderEditor()
    await user.clear(field(enUS['courses.mappingProficient']))
    await user.type(field(enUS['courses.mappingProficient']), 'three')
    await user.click(previewButton())

    expect(await screen.findByText(enUS['courses.validation.point'])).toBeInTheDocument()
    expect(screen.queryByText(enUS['courses.validation.pointPositive'])).not.toBeInTheDocument()
    expect(actions.previewMappingChangeAction).not.toHaveBeenCalled()
  })

  it('refuses an empty field', async () => {
    const user = renderEditor()
    await user.clear(field(enUS['courses.mappingProfessional']))
    await user.click(previewButton())

    expect(await screen.findByText(enUS['courses.validation.point'])).toBeInTheDocument()
    expect(actions.previewMappingChangeAction).not.toHaveBeenCalled()
  })

  it('offers no Apply control until a preview has been taken', () => {
    renderEditor()
    expect(screen.queryByRole('button', { name: enUS['courses.mappingApply'] })).toBeNull()
    expect(screen.getByText(enUS['courses.mappingApplyNote'])).toBeInTheDocument()
  })

  it('previews the four numbers without writing anything, and lists every affected run', async () => {
    const user = renderEditor()
    await toPreview(user)

    expect(actions.previewMappingChangeAction).toHaveBeenCalledWith({
      courseId: 'c1',
      mapping: { novice: 1.5, developing: 2, proficient: 3, professional: 4 },
    })
    expect(actions.changeMappingAction).not.toHaveBeenCalled()

    // FR-206's sentence is about which exported points will change, and a reader can only see that
    // against the ones that will not: both rows are listed, with both numbers on each.
    expect(screen.getByText('2.571')).toBeInTheDocument()
    expect(screen.getByText('3.142')).toBeInTheDocument()
    expect(screen.getByText(enUS['courses.mappingPreviewChanged'])).toBeInTheDocument()
    expect(screen.getByText(enUS['courses.mappingPreviewUnchanged'])).toBeInTheDocument()
  })

  it('refuses to apply until the re-export acknowledgement is ticked, and says so at the box', async () => {
    const user = renderEditor()
    await toPreview(user)
    await user.click(applyButton())

    expect(await screen.findByText(enUS['courses.mappingAcknowledgeRequired'])).toBeInTheDocument()
    expect(acknowledge()).toHaveAttribute('aria-invalid', 'true')
    expect(actions.changeMappingAction).not.toHaveBeenCalled()
  })

  it('applies with confirm: true once the box is ticked, and names the recompute count', async () => {
    const user = renderEditor()
    await toPreview(user)
    await user.click(acknowledge())
    await user.click(applyButton())

    await waitFor(() => {
      expect(actions.changeMappingAction).toHaveBeenCalledWith({
        courseId: 'c1',
        mapping: { novice: 1.5, developing: 2, proficient: 3, professional: 4 },
        confirm: true,
      })
    })
    expect(toasts.success).toHaveBeenCalledWith(
      enUS['courses.mappingApplied'].replace('{changed}', '1'),
    )
    expect(router.refresh).toHaveBeenCalled()
  })

  it('drops the preview when a number changes after it, so Apply can never ship untabled numbers', async () => {
    const user = renderEditor()
    await toPreview(user)

    await user.clear(field(enUS['courses.mappingProfessional']))
    await user.type(field(enUS['courses.mappingProfessional']), '5')

    expect(screen.queryByText(enUS['courses.mappingPreviewTitle'])).toBeNull()
    expect(screen.queryByRole('button', { name: enUS['courses.mappingApply'] })).toBeNull()
    expect(actions.changeMappingAction).not.toHaveBeenCalled()
  })

  it('renders a refusal from the envelope, verbatim', async () => {
    actions.previewMappingChangeAction.mockResolvedValue({
      ok: false,
      error: {
        code: 'MAPPING_INVALID',
        message: 'A band mapping needs four positive numbers.',
        requestId: 'req_1',
      },
    })
    const user = renderEditor()
    await user.click(previewButton())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('A band mapping needs four positive numbers.')
    expect(toasts.success).not.toHaveBeenCalled()
  })

  it('shows the values without a way to change them when the reader may not manage the course', () => {
    renderEditor(true)
    expect(novice()).toBeDisabled()
    expect(screen.queryByRole('button', { name: enUS['courses.mappingSubmit'] })).toBeNull()
    expect(screen.queryByRole('button', { name: enUS['courses.mappingApply'] })).toBeNull()
    expect(screen.getByText(enUS['courses.readOnlyNote'])).toBeInTheDocument()
  })
})
