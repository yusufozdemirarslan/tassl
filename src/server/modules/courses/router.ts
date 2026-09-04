// Route handlers of the `courses` module (docs/tech/07-api-spec.md §5). Each one is exported by a
// thin `src/app/api/v1/**/route.ts`, which is what Next.js mounts and what `pnpm openapi:generate`
// reads. No business logic lives here: the wrapper validates and the service decides.
//
// The two rows that answer `204` are built the way `identity` builds `DELETE /me`: `Response.json`
// refuses a null-body status, so the handler wraps the 200 the wrapper produced.
import { z } from 'zod'
import { AppError } from '@/lib/errors'
import type { SessionUser } from '@/server/auth/types'
import { defineRoute, type RouteContext, type RouteHandler } from '@/server/http/define-route'
import { attachRouteSpec, getRouteSpec, type RegisteredRoute } from '@/server/http/openapi-registry'
import {
  addSectionMember,
  createAssignment,
  createCourse,
  createSection,
  deleteWalkthroughRun,
  getAssignment,
  getCourse,
  getPolicyDisplay,
  listCourses,
  listSectionMembers,
  removeSectionMember,
  updateAssignment,
  updateCoursePolicy,
} from './service'
import {
  AddSectionMemberSchema,
  AssignmentIdParamsSchema,
  AssignmentSchema,
  AssignmentViewSchema,
  CourseIdParamsSchema,
  CoursePageSchema,
  CourseSchema,
  CourseViewSchema,
  CreateAssignmentSchema,
  CreateCourseSchema,
  CreateSectionSchema,
  OrgIdParamsSchema,
  PageQuerySchema,
  PolicyDisplaySchema,
  RunIdParamsSchema,
  SectionIdParamsSchema,
  SectionMemberPageSchema,
  SectionMemberParamsSchema,
  SectionMemberSchema,
  SectionSchema,
  UpdateAssignmentSchema,
  UpdateCoursePolicySchema,
} from './schema'

const TAGS = ['courses']

/** `auth: 'session'` guarantees an actor; this turns the nullable context field into one. */
function actorOf<I>(ctx: RouteContext<I>): SessionUser {
  if (!ctx.actor) throw new AppError('UNAUTHENTICATED')
  return ctx.actor
}

/** The spec `defineRoute` attached, so a wrapped handler stays visible to the generator. */
function specOf(handler: RouteHandler): RegisteredRoute {
  const spec = getRouteSpec(handler)
  if (!spec) throw new AppError('INTERNAL_ERROR', 'Route spec missing.')
  return spec
}

/** 204 with no body (07 §5): the wrapper's 200 becomes an empty response, errors pass through. */
function noContent(handler: RouteHandler, description: string): RouteHandler {
  return attachRouteSpec(
    async (request, routeCtx) => {
      const response = await handler(request, routeCtx)
      if (response.status !== 200) return response
      const headers = new Headers(response.headers)
      headers.delete('content-type')
      return new Response(null, { status: 204, headers })
    },
    { ...specOf(handler), status: 204, description },
  )
}

// ---------------------------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------------------------

export const listCoursesRoute = defineRoute(
  {
    auth: 'session',
    input: { params: OrgIdParamsSchema, query: PageQuerySchema },
    output: CoursePageSchema,
    rateLimit: { bucket: 'read' },
    openapi: { operationId: 'listCourses', summary: 'Courses in an institution', tags: TAGS },
  },
  async (ctx) => listCourses(actorOf(ctx), ctx.input.params.orgId, ctx.input.query),
)

export const createCourseRoute = defineRoute(
  {
    auth: 'session',
    input: { params: OrgIdParamsSchema, body: CreateCourseSchema },
    output: CourseSchema,
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'createCourse',
      summary: 'Create a course',
      tags: TAGS,
      status: 201,
    },
  },
  async (ctx) => createCourse(actorOf(ctx), ctx.input.params.orgId, ctx.input.body),
)

export const getCourseRoute = defineRoute(
  {
    auth: 'session',
    input: { params: CourseIdParamsSchema },
    output: CourseViewSchema,
    rateLimit: { bucket: 'read' },
    openapi: { operationId: 'getCourse', summary: 'Course detail', tags: TAGS },
  },
  async (ctx) => getCourse(actorOf(ctx), ctx.input.params.courseId),
)

export const updateCoursePolicyRoute = defineRoute(
  {
    auth: 'session',
    input: { params: CourseIdParamsSchema, body: UpdateCoursePolicySchema },
    output: CourseSchema,
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'updateCoursePolicy',
      summary: 'Update policy, weights, taught concepts',
      tags: TAGS,
    },
  },
  async (ctx) => updateCoursePolicy(actorOf(ctx), ctx.input.params.courseId, ctx.input.body),
)

export const createSectionRoute = defineRoute(
  {
    auth: 'session',
    input: { params: CourseIdParamsSchema, body: CreateSectionSchema },
    output: SectionSchema,
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'createSection',
      summary: 'Create a section',
      tags: TAGS,
      status: 201,
    },
  },
  async (ctx) => createSection(actorOf(ctx), ctx.input.params.courseId, ctx.input.body),
)

// ---------------------------------------------------------------------------------------------
// Roster (SYS-005)
// ---------------------------------------------------------------------------------------------

export const listSectionMembersRoute = defineRoute(
  {
    auth: 'session',
    input: { params: SectionIdParamsSchema, query: PageQuerySchema },
    output: SectionMemberPageSchema,
    rateLimit: { bucket: 'read' },
    openapi: { operationId: 'listSectionMembers', summary: 'Roster', tags: TAGS },
  },
  async (ctx) => listSectionMembers(actorOf(ctx), ctx.input.params.sectionId, ctx.input.query),
)

export const addSectionMemberRoute = defineRoute(
  {
    auth: 'session',
    input: { params: SectionIdParamsSchema, body: AddSectionMemberSchema },
    output: SectionMemberSchema,
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'addSectionMember',
      summary: 'Add an institution member to the section',
      tags: TAGS,
      status: 201,
    },
  },
  async (ctx) => addSectionMember(actorOf(ctx), ctx.input.params.sectionId, ctx.input.body),
)

const removeSectionMemberJson = defineRoute(
  {
    auth: 'session',
    input: { params: SectionMemberParamsSchema },
    output: z.object({}),
    rateLimit: { bucket: 'write' },
    openapi: { operationId: 'removeSectionMember', summary: 'Remove a member', tags: TAGS },
  },
  async (ctx) => {
    await removeSectionMember(actorOf(ctx), ctx.input.params.sectionId, ctx.input.params.userId)
    return {}
  },
)

export const removeSectionMemberRoute = noContent(removeSectionMemberJson, 'Removed')

// ---------------------------------------------------------------------------------------------
// Assignments (FR-200, FR-201)
// ---------------------------------------------------------------------------------------------

export const createAssignmentRoute = defineRoute(
  {
    auth: 'session',
    input: { params: SectionIdParamsSchema, body: CreateAssignmentSchema },
    output: AssignmentSchema,
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'createAssignment',
      summary: 'Create an assignment',
      tags: TAGS,
      status: 201,
    },
  },
  async (ctx) => createAssignment(actorOf(ctx), ctx.input.params.sectionId, ctx.input.body),
)

export const getAssignmentRoute = defineRoute(
  {
    auth: 'session',
    input: { params: AssignmentIdParamsSchema },
    output: AssignmentViewSchema,
    rateLimit: { bucket: 'read' },
    openapi: {
      operationId: 'getAssignment',
      summary: 'Assignment with package and variant',
      tags: TAGS,
    },
  },
  async (ctx) => getAssignment(actorOf(ctx), ctx.input.params.assignmentId),
)

export const updateAssignmentRoute = defineRoute(
  {
    auth: 'session',
    input: { params: AssignmentIdParamsSchema, body: UpdateAssignmentSchema },
    output: AssignmentSchema,
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'updateAssignment',
      summary: 'Update configuration',
      tags: TAGS,
    },
  },
  async (ctx) => updateAssignment(actorOf(ctx), ctx.input.params.assignmentId, ctx.input.body),
)

export const getPolicyDisplayRoute = defineRoute(
  {
    auth: 'session',
    input: { params: AssignmentIdParamsSchema },
    output: PolicyDisplaySchema,
    rateLimit: { bucket: 'read' },
    openapi: {
      operationId: 'getPolicyDisplay',
      summary: 'Policy display values shown at run start',
      tags: TAGS,
    },
  },
  async (ctx) => getPolicyDisplay(actorOf(ctx), ctx.input.params.assignmentId),
)

// ---------------------------------------------------------------------------------------------
// Walkthrough runs (D-104)
// ---------------------------------------------------------------------------------------------

const deleteWalkthroughRunJson = defineRoute(
  {
    auth: 'session',
    input: { params: RunIdParamsSchema },
    output: z.object({}),
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'deleteWalkthroughRun',
      summary: 'Delete a walkthrough run',
      tags: TAGS,
    },
  },
  async (ctx) => {
    await deleteWalkthroughRun(actorOf(ctx), ctx.input.params.runId)
    return {}
  },
)

export const deleteWalkthroughRunRoute = noContent(deleteWalkthroughRunJson, 'Deleted')
