'use server'
// Server Actions of the `assistant` module: the mirror of 07-api-spec.md §7's mutations (07 §11).
// Each one validates with the same Zod schema as its route and calls the same service function, so
// the screens and `/api/v1` cannot drift apart. `defineAction` runs `requireSession()`, maps errors
// to the envelope, and never throws to the client.
//
// **There is no `delegateAction`, and 07 §11 says why**: "the delegation stream is consumed from the
// client through the route (`fetch` + `EventSource`-style reader), not an action." A Server Action
// answers once, when it is finished; the assistant panel draws the reply as it arrives, and a claim
// card is a segment of that arrival rather than a field of a result. `use-delegation.ts` reads
// `POST /api/v1/runs/{runId}/delegations` directly.
//
// Neither of the two below revalidates a path. The Delegation Log and the assistant panel are
// client state under a clock — the request the student is typing, the reply they are reading, the
// brief they are half-way through — and re-rendering the workspace on a why line would throw all of
// it away to redraw a page that changed in one field. Both actions answer with the entry as it now
// stands, which is what the log renders.
import { defineAction } from '@/server/http/define-action'
import {
  DeclareOutsideToolSchema,
  DelegationParamsSchema,
  RunIdParamsSchema,
  UpdateDelegationSchema,
} from './schema'
import { declareOutsideTool, updateDelegation } from './service'

/** One delegation of one run, plus the two fields the log's controls write (FR-060). */
const UpdateDelegationActionSchema = DelegationParamsSchema.extend(UpdateDelegationSchema.shape)

/**
 * Saves the why line, marks claims used, or both (FR-060, FR-084).
 *
 * A used mark is the one half that changes the run: it records reliance, which is what the Decision
 * Lock's gate reads (FR-084). The why line is the student's own note and changes nothing but itself.
 */
export const updateDelegationAction = defineAction(
  UpdateDelegationActionSchema,
  async ({ runId, delegationId, ...input }, ctx) => ({
    data: await updateDelegation(ctx.actor, runId, delegationId, input),
  }),
  { name: 'updateDelegationAction' },
)

/** One run, and what the student says they used a tool outside Tassl for. */
const DeclareOutsideToolActionSchema = RunIdParamsSchema.extend(DeclareOutsideToolSchema.shape)

/**
 * Records a declaration of outside-tool use (FR-061), and does nothing else with it.
 *
 * The screen states the no-penalty sentence beside the control; this is the half that makes it true.
 * Nothing here reads the course's policy, sets a flag, or counts anything — FR-062 forbids
 * detection, inference and enforcement, and FR-006 forbids treating anything Tassl observes as
 * misconduct.
 */
export const declareOutsideToolAction = defineAction(
  DeclareOutsideToolActionSchema,
  async ({ runId, ...input }, ctx) => {
    await declareOutsideTool(ctx.actor, runId, input)
    return { data: null }
  },
  { name: 'declareOutsideToolAction' },
)
