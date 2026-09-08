// Route handlers of the `authoring` module (docs/tech/07-api-spec.md §6, rows
// `POST/GET /package-versions/{versionId}/generation` and
// `POST /package-versions/{versionId}/elements/{elementType}/{elementId}/regenerate`).
//
// Thin, like every router here: the wrapper authenticates, validates and rate-limits, and the
// service decides — including who may do what, because a version id does not name its institution
// and only the service can resolve one to the other (08 §5).
//
// The start is on the `llm` rate-limit bucket and its route file carries `maxDuration = 300`
// (07 §1 "Timeouts"): the enqueue itself is instant, but `JOBS_DRAIN_ON_ENQUEUE` lets the same
// invocation drain the queue it just wrote to, and a generation step is a model call.
import { z } from 'zod'
import { AppError } from '@/lib/errors'
import type { SessionUser } from '@/server/auth/types'
import { defineRoute, type RouteContext } from '@/server/http/define-route'
import { ElementParamsSchema, VersionIdParamsSchema } from '@/server/modules/scenarios/schema'
import { getGenerationStatus, regenerateElement, startGeneration } from './service'
import {
  GenerationRunStatusSchema,
  GenerationStepSchema,
  RegenerateElementSchema,
  StartGenerationViewSchema,
} from './schema'

const TAGS = ['packages']

/** `auth: 'session'` guarantees an actor; this turns the nullable context field into one. */
function actorOf<I>(ctx: RouteContext<I>): SessionUser {
  if (!ctx.actor) throw new AppError('UNAUTHENTICATED')
  return ctx.actor
}

/**
 * `GenerationStatus` as 07 §6 names it, written out here rather than imported from `schema.ts`
 * because the wire shape and the service's own view are the same object and the generator reads
 * whatever the route declares.
 */
const GenerationStatusResponseSchema = z.object({
  packageVersionId: z.uuid(),
  packageId: z.uuid(),
  version: z.int(),
  state: z.enum(['not_started', 'running', 'failed', 'complete']),
  steps: z.array(
    z.object({
      step: GenerationStepSchema,
      status: GenerationRunStatusSchema,
      passNumber: z.int(),
      inputTokens: z.int().nullable(),
      outputTokens: z.int().nullable(),
      costEstimateUsd: z.number().nullable(),
      failedRules: z.array(z.string()),
      error: z.string().nullable(),
      startedAt: z.string().nullable(),
      finishedAt: z.string().nullable(),
    }),
  ),
  runs: z.array(
    z.object({
      id: z.uuid(),
      step: GenerationStepSchema,
      passNumber: z.int(),
      status: GenerationRunStatusSchema,
      provider: z.string().nullable(),
      model: z.string().nullable(),
      promptVersion: z.string().nullable(),
      inputTokens: z.int().nullable(),
      outputTokens: z.int().nullable(),
      costEstimateUsd: z.number().nullable(),
      failedRules: z.array(z.string()),
      error: z.string().nullable(),
      startedAt: z.string().nullable(),
      finishedAt: z.string().nullable(),
    }),
  ),
  validation: z.object({ ok: z.boolean(), failures: z.array(z.string()) }),
})

const RegenerateElementResponseSchema = z.object({
  jobId: z.string(),
  step: GenerationStepSchema,
})

export const startGenerationRoute = defineRoute(
  {
    auth: 'session',
    input: { params: VersionIdParamsSchema },
    output: StartGenerationViewSchema,
    rateLimit: { bucket: 'llm' },
    openapi: {
      operationId: 'startGeneration',
      summary: 'Start AI-assisted generation',
      tags: TAGS,
      status: 202,
    },
  },
  async (ctx) => startGeneration(actorOf(ctx), ctx.input.params.versionId),
)

export const getGenerationStatusRoute = defineRoute(
  {
    auth: 'session',
    input: { params: VersionIdParamsSchema },
    output: GenerationStatusResponseSchema,
    rateLimit: { bucket: 'read' },
    openapi: {
      operationId: 'getGenerationStatus',
      summary: 'Generation status',
      tags: TAGS,
    },
  },
  async (ctx) => getGenerationStatus(actorOf(ctx), ctx.input.params.versionId),
)

export const regenerateElementRoute = defineRoute(
  {
    auth: 'session',
    input: { params: ElementParamsSchema, body: RegenerateElementSchema },
    output: RegenerateElementResponseSchema,
    rateLimit: { bucket: 'llm' },
    openapi: {
      operationId: 'regenerateElement',
      summary: 'Regenerate an element or element set',
      tags: TAGS,
      status: 202,
    },
  },
  async (ctx) =>
    regenerateElement(
      actorOf(ctx),
      ctx.input.params.versionId,
      ctx.input.params.elementType,
      ctx.input.params.elementId,
      ctx.input.body,
    ),
)
