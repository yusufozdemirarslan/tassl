import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MappingEditor } from '@/components/features/courses/mapping-editor'
import { enUS } from '@/lib/i18n/en-US'

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }))
const actions = vi.hoisted(() => ({ updateCoursePolicyAction: vi.fn() }))
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

// The action is a Server Action: importing the real module drags the courses service, the database
// client, and `server-only` into jsdom.
vi.mock('@/server/modules/courses/actions', () => ({
  updateCoursePolicyAction: actions.updateCoursePolicyAction,
}))

vi.mock('sonner', () => ({ toast: { success: toasts.success, error: toasts.error } }))

const MAPPING = { novice: 1, developing: 2, proficient: 3, professional: 4 }

const saved = (mapping: typeof MAPPING) => ({
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
const save = () => screen.getByRole('button', { name: enUS['courses.mappingSubmit'] })
const apply = () => screen.getByRole('button', { name: enUS['courses.mappingApply'] })

describe('MappingEditor (UI-030 → Mapping)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actions.updateCoursePolicyAction.mockResolvedValue(saved(MAPPING))
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
    await user.click(save())

    expect(await screen.findByText(enUS['courses.validation.pointPositive'])).toBeInTheDocument()
    expect(novice()).toHaveAttribute('aria-invalid', 'true')
    const describedBy = novice().getAttribute('aria-describedby')
    expect(describedBy).not.toBeNull()
    expect(document.getElementById(describedBy as string)).toHaveTextContent(
      enUS['courses.validation.pointPositive'],
    )
    expect(actions.updateCoursePolicyAction).not.toHaveBeenCalled()
  })

  it('refuses a negative number with the same rule', async () => {
    const user = renderEditor()
    await user.clear(field(enUS['courses.mappingDeveloping']))
    await user.type(field(enUS['courses.mappingDeveloping']), '-2')
    await user.click(save())

    expect(await screen.findByText(enUS['courses.validation.pointPositive'])).toBeInTheDocument()
    expect(actions.updateCoursePolicyAction).not.toHaveBeenCalled()
  })

  it('refuses a value that is not a number, and says that rather than "not positive"', async () => {
    const user = renderEditor()
    await user.clear(field(enUS['courses.mappingProficient']))
    await user.type(field(enUS['courses.mappingProficient']), 'three')
    await user.click(save())

    expect(await screen.findByText(enUS['courses.validation.point'])).toBeInTheDocument()
    expect(screen.queryByText(enUS['courses.validation.pointPositive'])).not.toBeInTheDocument()
    expect(actions.updateCoursePolicyAction).not.toHaveBeenCalled()
  })

  it('refuses an empty field', async () => {
    const user = renderEditor()
    await user.clear(field(enUS['courses.mappingProfessional']))
    await user.click(save())

    expect(await screen.findByText(enUS['courses.validation.point'])).toBeInTheDocument()
    expect(actions.updateCoursePolicyAction).not.toHaveBeenCalled()
  })

  it('offers Apply but never lets it act, and says when recomputation arrives', async () => {
    const user = renderEditor()
    const button = apply()

    expect(button).toHaveAttribute('aria-disabled', 'true')
    const note = button.getAttribute('aria-describedby')
    expect(note).not.toBeNull()
    expect(document.getElementById(note as string)).toHaveTextContent(
      'Recomputation of confirmed runs arrives with review',
    )

    await user.click(button)
    expect(actions.updateCoursePolicyAction).not.toHaveBeenCalled()
  })

  it('sends the four numbers as numbers and confirms with a toast', async () => {
    const user = renderEditor()
    await user.clear(novice())
    await user.type(novice(), '1.5')
    await user.click(save())

    await waitFor(() => {
      expect(actions.updateCoursePolicyAction).toHaveBeenCalledWith({
        courseId: 'c1',
        mapping: { novice: 1.5, developing: 2, proficient: 3, professional: 4 },
      })
    })
    expect(toasts.success).toHaveBeenCalledWith(enUS['courses.mappingSaved'])
    expect(router.refresh).toHaveBeenCalled()
  })

  it('renders the MAPPING_CHANGE_UNCONFIRMED refusal from the envelope, verbatim', async () => {
    actions.updateCoursePolicyAction.mockResolvedValue({
      ok: false,
      error: {
        code: 'MAPPING_CHANGE_UNCONFIRMED',
        message: 'This course has confirmed runs, so its mapping cannot change yet.',
        requestId: 'req_1',
      },
    })
    const user = renderEditor()
    await user.click(save())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      'This course has confirmed runs, so its mapping cannot change yet.',
    )
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
