// Route handlers of the `review` module (docs/tech/07-api-spec.md §8). Each one is exported by a
// thin `src/app/api/v1/**/route.ts`, which is what Next.js mounts and what `pnpm openapi:generate`
// reads. No business logic lives here: the wrapper validates and the service decides.
//
// Two rows are answered by another module's service, and both are deliberate. FR-118's
// forced-failure control belongs to `runs`, because what it writes is a `runs.flags` key and what it
// causes is a pause of the run's own clock; the void and the re-offer belong there for the same
// reason, because what they write is the run's state and a second run beside it. 10 §12 lists both
// among *this* module's responsibilities because the seat that presses them is the faculty one and
// the path is `/review`. Both readings are right, and the split is the ordinary one: the endpoint
// belongs to the reviewer's surface, the rule belongs to the module that owns the column. Every such
// import is through the module's public index, the door every cross-module call goes through
// (CLAUDE.md, D-290).
//
// FR-055's delegation flag is the third of those, and belongs to `assistant` for the same reason.
import { AppError } from '@/lib/errors'
import type { SessionUser } from '@/server/auth/types'
import { defineRoute, type RouteContext } from '@/server/http/define-route'
import { DelegationViewSchema, flagDelegation } from '@/server/modules/assistant'
import {
  RunSummarySchema,
  VoidRunResultSchema,
  VoidRunSchema,
  voidRun,
  forceAssistantFailure,
} from '@/server/modules/runs'
import {
  bandHeldRunManually,
  confirmRemaining,
  decideBand,
  getQueue,
  getReplay,
  listSectionRunsForReview,
  neutralizeClaim,
} from './service'
import {
  BandDecisionInputSchema,
  BandDecisionResultSchema,
  BandParamsSchema,
  ClaimParamsSchema,
  DelegationParamsSchema,
  FlagDelegationInputSchema,
  ForcedFailureSchema,
  ManualBandsInputSchema,
  NeutralizeInputSchema,
  NeutralizeResultSchema,
  ReplayBundleSchema,
  ReviewQueueSchema,
  RunIdParamsSchema,
  SectionIdParamsSchema,
} from './schema'

const TAGS = ['review']

/** `auth: 'session'` guarantees an actor; this turns the nullable context field into one. */
function actorOf<I>(ctx: RouteContext<I>): SessionUser {
  if (!ctx.actor) throw new AppError('UNAUTHENTICATED')
  return ctx.actor
}

/**
 * `GET /review/queue` (07 §8, FR-186, D-096): the labelled illustrative rows, and the real runs of
 * this reviewer's own sections under their own heading. The two are never mixed.
 */
export const getReviewQueueRoute = defineRoute(
  {
    auth: 'session',
    output: ReviewQueueSchema,
    rateLimit: { bucket: 'read' },
    openapi: {
      operationId: 'getReviewQueue',
      summary: 'Illustrative queue plus real runs awaiting review',
      tags: TAGS,
    },
  },
  async (ctx) => getQueue(actorOf(ctx)),
)

/** `GET /review/sections/{sectionId}/runs` (07 §8): a section's runs with decision progress. */
export const listSectionRunsForReviewRoute = defineRoute(
  {
    auth: 'session',
    input: { params: SectionIdParamsSchema },
    output: ReviewQueueSchema.shape.runs,
    rateLimit: { bucket: 'read' },
    openapi: {
      operationId: 'listSectionRunsForReview',
      summary: 'Runs in a section with decision progress',
      tags: TAGS,
    },
  },
  async (ctx) => listSectionRunsForReview(actorOf(ctx), ctx.input.params.sectionId),
)

/**
 * `GET /review/runs/{runId}` (07 §8, FR-180): the replay bundle.
 *
 * A `read` bucket, and it does write one thing — `flags.replay_first_opened_at` on the first open
 * (D-120). That is a record of the fact that somebody looked, not a change to the run.
 *
 * **A student is refused here outright.** `requireRunReviewer` answers NOT_FOUND for a run outside
 * the actor's sections and the service turns a section member with the wrong role into the same
 * answer, so a classmate learns nothing; the run's *own* student is a section member holding
 * `student` and is refused with FORBIDDEN. Either way none of what this bundle carries — warranted
 * stances, evidence status, failure families, the probe, the expected-answer notes — reaches them.
 */
export const getReplayRoute = defineRoute(
  {
    auth: 'session',
    input: { params: RunIdParamsSchema },
    output: ReplayBundleSchema,
    rateLimit: { bucket: 'read' },
    openapi: { operationId: 'getReplay', summary: 'Faculty replay bundle', tags: TAGS },
  },
  async (ctx) => getReplay(actorOf(ctx), ctx.input.params.runId),
)

/** `PUT /review/runs/{runId}/bands/{dimension}` (07 §8, FR-181). */
export const decideBandRoute = defineRoute(
  {
    auth: 'session',
    input: { params: BandParamsSchema, body: BandDecisionInputSchema },
    output: BandDecisionResultSchema,
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'decideBand',
      summary: 'Confirm, override, or set a dimension unassessed',
      tags: TAGS,
    },
  },
  async (ctx) =>
    decideBand(actorOf(ctx), ctx.input.params.runId, ctx.input.params.dimension, ctx.input.body),
)

/** `POST /review/runs/{runId}/confirm-remaining` (07 §8). */
export const confirmRemainingBandsRoute = defineRoute(
  {
    auth: 'session',
    input: { params: RunIdParamsSchema },
    output: RunSummarySchema,
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'confirmRemainingBands',
      summary: 'Confirm every undecided dimension with its draft',
      tags: TAGS,
    },
  },
  async (ctx) => confirmRemaining(actorOf(ctx), ctx.input.params.runId),
)

/** `POST /review/runs/{runId}/manual-bands` (07 §8, FR-140). */
export const bandHeldRunManuallyRoute = defineRoute(
  {
    auth: 'session',
    input: { params: RunIdParamsSchema, body: ManualBandsInputSchema },
    output: RunSummarySchema,
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'bandHeldRunManually',
      summary: 'Band a held run by hand',
      tags: TAGS,
    },
  },
  async (ctx) => bandHeldRunManually(actorOf(ctx), ctx.input.params.runId, ctx.input.body),
)

/** `POST /review/runs/{runId}/claims/{claimId}/neutralize` (07 §8, FR-003). Instructor only. */
export const neutralizeClaimRoute = defineRoute(
  {
    auth: 'session',
    input: { params: ClaimParamsSchema, body: NeutralizeInputSchema },
    output: NeutralizeResultSchema,
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'neutralizeClaim',
      summary: 'Neutralize a claim in both directions and recompute',
      tags: TAGS,
    },
  },
  async (ctx) =>
    neutralizeClaim(actorOf(ctx), ctx.input.params.runId, ctx.input.params.claimId, ctx.input.body),
)

/**
 * `POST /review/runs/{runId}/void` (07 §8, FR-002, FR-008). The section's instructor alone.
 *
 * The service is `runs.voidRun`: the state machine and the second run a re-offer creates are that
 * module's, and this is the seat that presses the button.
 */
export const voidRunRoute = defineRoute(
  {
    auth: 'session',
    input: { params: RunIdParamsSchema, body: VoidRunSchema },
    output: VoidRunResultSchema,
    rateLimit: { bucket: 'write' },
    openapi: { operationId: 'voidRun', summary: 'Void a run and optionally re-offer', tags: TAGS },
  },
  async (ctx) => voidRun(actorOf(ctx), ctx.input.params.runId, ctx.input.body),
)

/** `POST /review/runs/{runId}/delegations/{delegationId}/flag` (07 §8, FR-055). */
export const flagDelegationRoute = defineRoute(
  {
    auth: 'session',
    input: { params: DelegationParamsSchema, body: FlagDelegationInputSchema },
    output: DelegationViewSchema,
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'flagDelegation',
      summary: 'Flag out-of-scenario content in the Delegation Log',
      tags: TAGS,
    },
  },
  async (ctx) =>
    flagDelegation(
      actorOf(ctx),
      ctx.input.params.runId,
      ctx.input.params.delegationId,
      ctx.input.body.flag,
    ),
)

/**
 * `POST /review/runs/{runId}/test-controls/force-assistant-failure` (07 §8, FR-118).
 *
 * The section's instructor alone, and only where `FEATURE_TEST_CONTROLS` is on: the service applies
 * both gates in that order, so a student on the section is refused before the environment is
 * consulted (08 §4, 12 §4 A04). A `write`: it changes the run, and the next delegation the student
 * makes will pause it.
 */
export const forceAssistantFailureRoute = defineRoute(
  {
    auth: 'session',
    input: { params: RunIdParamsSchema },
    output: ForcedFailureSchema,
    rateLimit: { bucket: 'write' },
    openapi: {
      operationId: 'forceAssistantFailure',
      summary: 'Arm the build-phase forced assistant failure',
      tags: TAGS,
    },
  },
  async (ctx) => forceAssistantFailure(actorOf(ctx), ctx.input.params.runId),
)
