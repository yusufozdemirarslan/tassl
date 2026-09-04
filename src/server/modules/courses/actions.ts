'use server'
// Server Actions of the `courses` module: the mirror of every mutation in 07-api-spec.md §5
// (07 §11). Each one validates with the same Zod schema as its route and calls the same service
// function, so the screens and `/api/v1` cannot drift apart. `defineAction` runs `requireSession()`,
// maps errors to the envelope, and never throws to the client.
//
// `revalidate` names the screens whose server render the write invalidates: the courses list and
// the course detail (UI-030), the roster (UI-031), and the assignment configuration (UI-032).
import { defineAction } from '@/server/http/define-action'
import {
  addSectionMember,
  createAssignment,
  createCourse,
  createSection,
  deleteWalkthroughRun,
  removeSectionMember,
  updateAssignment,
  updateCoursePolicy,
} from './service'
import {
  AddSectionMemberActionSchema,
  CreateAssignmentActionSchema,
  CreateCourseActionSchema,
  CreateSectionActionSchema,
  DeleteWalkthroughRunActionSchema,
  RemoveSectionMemberActionSchema,
  UpdateAssignmentActionSchema,
  UpdateCoursePolicyActionSchema,
} from './schema'

const COURSES = '/courses'
const courseDetail = (courseId: string): string => `/courses/${courseId}`
const assignmentDetail = (assignmentId: string): string => `/assignments/${assignmentId}`

export const createCourseAction = defineAction(
  CreateCourseActionSchema,
  async ({ orgId, ...input }, ctx) => ({
    data: await createCourse(ctx.actor, orgId, input),
    revalidate: [COURSES],
  }),
  { name: 'createCourseAction' },
)

export const updateCoursePolicyAction = defineAction(
  UpdateCoursePolicyActionSchema,
  async ({ courseId, ...input }, ctx) => ({
    data: await updateCoursePolicy(ctx.actor, courseId, input),
    revalidate: [COURSES, courseDetail(courseId)],
  }),
  { name: 'updateCoursePolicyAction' },
)

export const createSectionAction = defineAction(
  CreateSectionActionSchema,
  async ({ courseId, ...input }, ctx) => ({
    data: await createSection(ctx.actor, courseId, input),
    revalidate: [COURSES, courseDetail(courseId)],
  }),
  { name: 'createSectionAction' },
)

export const addSectionMemberAction = defineAction(
  AddSectionMemberActionSchema,
  async ({ sectionId, ...input }, ctx) => ({
    data: await addSectionMember(ctx.actor, sectionId, input),
    revalidate: [COURSES],
  }),
  { name: 'addSectionMemberAction' },
)

export const removeSectionMemberAction = defineAction(
  RemoveSectionMemberActionSchema,
  async ({ sectionId, userId }, ctx) => {
    await removeSectionMember(ctx.actor, sectionId, userId)
    return { data: { removed: true } as const, revalidate: [COURSES] }
  },
  { name: 'removeSectionMemberAction' },
)

export const createAssignmentAction = defineAction(
  CreateAssignmentActionSchema,
  async ({ sectionId, ...input }, ctx) => {
    const assignment = await createAssignment(ctx.actor, sectionId, input)
    return { data: assignment, revalidate: [COURSES, assignmentDetail(assignment.id)] }
  },
  { name: 'createAssignmentAction' },
)

export const updateAssignmentAction = defineAction(
  UpdateAssignmentActionSchema,
  async ({ assignmentId, ...input }, ctx) => ({
    data: await updateAssignment(ctx.actor, assignmentId, input),
    revalidate: [COURSES, assignmentDetail(assignmentId)],
  }),
  { name: 'updateAssignmentAction' },
)

export const deleteWalkthroughRunAction = defineAction(
  DeleteWalkthroughRunActionSchema,
  async ({ runId }, ctx) => {
    await deleteWalkthroughRun(ctx.actor, runId)
    return { data: { deleted: true } as const, revalidate: [COURSES] }
  },
  { name: 'deleteWalkthroughRunAction' },
)
