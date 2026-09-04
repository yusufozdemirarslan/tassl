import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CourseForm } from '@/components/features/courses/course-form'
import {
  DeferredFormFallback,
  useDeferredModule,
} from '@/components/features/courses/deferred-form'
import { SectionsList } from '@/components/features/courses/sections-list'
import { enUS } from '@/lib/i18n/en-US'

// B4 (16 §3.2). The two dialog forms on UI-030 are downloaded when the dialog opens, not when the
// route paints. What has to survive that: the trigger is a real control from the first paint, the
// dialog announces itself by its own title before the form lands, and an import that never arrives
// says so instead of leaving an empty dialog behind a working button.

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
const actions = vi.hoisted(() => ({ createCourseAction: vi.fn(), createSectionAction: vi.fn() }))
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
  usePathname: () => '/courses',
}))

vi.mock('@/server/modules/courses/actions', () => ({
  createCourseAction: actions.createCourseAction,
  createSectionAction: actions.createSectionAction,
}))

vi.mock('sonner', () => ({ toast: { success: toasts.success, error: toasts.error } }))

const SECTIONS = [{ id: 's1', name: 'Section A', memberCount: 24, assignmentCount: 2 }]

describe('deferred dialog forms (UI-030, B4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actions.createCourseAction.mockResolvedValue({
      ok: true,
      data: { id: 'c1', name: 'Marketing Analytics' },
    })
    actions.createSectionAction.mockResolvedValue({ ok: true, data: { id: 's2', name: 'B' } })
  })

  it('paints the "New course" trigger without the form behind it', () => {
    render(<CourseForm orgId="org1" />)
    expect(screen.getByRole('button', { name: enUS['courses.newCourse'] })).toBeInTheDocument()
    expect(screen.queryByLabelText(enUS['courses.nameLabel'])).not.toBeInTheDocument()
  })

  it('announces the new-course dialog and then brings its fields in', async () => {
    const user = userEvent.setup()
    render(<CourseForm orgId="org1" />)

    await user.click(screen.getByRole('button', { name: enUS['courses.newCourse'] }))
    const dialog = await screen.findByRole('dialog', { name: enUS['courses.newCourse'] })
    expect(dialog).toHaveTextContent(enUS['courses.newCourseDescription'])

    await waitFor(() => expect(screen.getByLabelText(enUS['courses.nameLabel'])).toBeVisible())
    expect(screen.getByLabelText(enUS['courses.termLabel'])).toBeVisible()
    expect(screen.getByRole('button', { name: enUS['courses.createSubmit'] })).toBeInTheDocument()
  })

  it('creates the course from the deferred form and lands on it', async () => {
    const user = userEvent.setup()
    render(<CourseForm orgId="org1" />)

    await user.click(screen.getByRole('button', { name: enUS['courses.newCourse'] }))
    await screen.findByLabelText(enUS['courses.nameLabel'])
    await user.type(screen.getByLabelText(enUS['courses.nameLabel']), 'Marketing Analytics')
    await user.type(screen.getByLabelText(enUS['courses.termLabel']), 'Fall 2026')
    await user.click(screen.getByRole('button', { name: enUS['courses.createSubmit'] }))

    await waitFor(() =>
      expect(actions.createCourseAction).toHaveBeenCalledWith({
        orgId: 'org1',
        name: 'Marketing Analytics',
        term: 'Fall 2026',
      }),
    )
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/courses/c1'))
  })

  it('paints the sections table and the "New section" trigger without the form', () => {
    render(<SectionsList courseId="c1" sections={SECTIONS} canManage canViewRosters={false} />)
    expect(screen.getByText('Section A')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: enUS['courses.newSection'] })).toBeInTheDocument()
    expect(screen.queryByLabelText(enUS['courses.sectionNameLabel'])).not.toBeInTheDocument()
  })

  it('announces the new-section dialog and then brings its field in', async () => {
    const user = userEvent.setup()
    render(<SectionsList courseId="c1" sections={SECTIONS} canManage canViewRosters={false} />)

    await user.click(screen.getByRole('button', { name: enUS['courses.newSection'] }))
    const dialog = await screen.findByRole('dialog', { name: enUS['courses.newSection'] })
    expect(dialog).toHaveTextContent(enUS['courses.newSectionDescription'])
    await waitFor(() =>
      expect(screen.getByLabelText(enUS['courses.sectionNameLabel'])).toBeVisible(),
    )
  })

  it('offers no trigger at all to someone who may not manage the course', () => {
    render(<SectionsList courseId="c1" sections={SECTIONS} canManage={false} canViewRosters />)
    expect(
      screen.queryByRole('button', { name: enUS['courses.newSection'] }),
    ).not.toBeInTheDocument()
  })
})

describe('useDeferredModule (B4)', () => {
  function Harness({ load }: { load: () => Promise<{ ok: true }> }) {
    const { loaded, status, request } = useDeferredModule(load)
    return (
      <>
        <button type="button" onClick={request}>
          {enUS['ui.more']}
        </button>
        {loaded ? <p>{enUS['courses.nameLabel']}</p> : <DeferredFormFallback status={status} />}
      </>
    )
  }

  it('states the failure where the form would have been, and retries on the next request', async () => {
    const user = userEvent.setup()
    const load = vi
      .fn<() => Promise<{ ok: true }>>()
      .mockRejectedValueOnce(new Error('chunk unavailable'))
      .mockResolvedValueOnce({ ok: true })

    render(<Harness load={load} />)
    // Idle and loading both say "Loading"; nothing claims the form is there.
    expect(screen.getByRole('status')).toHaveTextContent(enUS['ui.loading'])

    await user.click(screen.getByRole('button', { name: enUS['ui.more'] }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(enUS['ui.formLoadFailed']),
    )

    await user.click(screen.getByRole('button', { name: enUS['ui.more'] }))
    await waitFor(() => expect(screen.getByText(enUS['courses.nameLabel'])).toBeInTheDocument())
    expect(load).toHaveBeenCalledTimes(2)
  })
})
