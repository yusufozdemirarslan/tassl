'use server'
// Server Actions of the `reliance` module: the mirror of 07-api-spec.md §7's three claim mutations
// (07 §11). Each one validates with the same Zod schema as its route and calls the same service
// function, so the screens and `/api/v1` cannot drift apart. `defineAction` runs `requireSession()`,
// maps errors to the envelope, and never throws to the client.
//
// None of the three revalidates a path. The workspace is client state under a clock — the request
// the student is typing, the reply they are reading, the brief they are half-way through — and
// re-rendering the whole screen because a stance changed would throw all of it away (D-268). Each
// action answers with the thing that changed: the claim as it now stands, the result the action
// bought, the reply the escalation returned.
import { defineAction } from '@/server/http/define-action'
import { ClaimParamsSchema, EscalateSchema, RunActionSchema, SetStanceSchema } from './schema'
import { escalate, runAction, setStance } from './service'

/** One claim of one run, plus the stance the student took on it (FR-080). */
const SetStanceActionSchema = ClaimParamsSchema.extend(SetStanceSchema.shape)

/**
 * Takes a position on a surfaced claim (FR-080, FR-085).
 *
 * It costs nothing and can be changed for as long as the run is open; both stances are kept, which
 * is what makes "traced it, then changed my mind" a thing the record can show (FR-085).
 */
export const setStanceAction = defineAction(
  SetStanceActionSchema,
  async ({ runId, claimId, stance }, ctx) => ({
    data: await setStance(ctx.actor, runId, claimId, stance),
  }),
  { name: 'setStanceAction' },
)

/** One claim of one run, plus which of its authored checks to run (FR-070, FR-071). */
const RunActionActionSchema = ClaimParamsSchema.extend(RunActionSchema.shape)

/**
 * Runs an interrogation action and charges its cost to the clock (FR-070 to FR-072).
 *
 * The cost is taken when the action starts, so the clock in the frame moves before the result
 * arrives; the screen re-reads the run beside this rather than being told the new reading here,
 * because the clock is materialized on read and one poll is the truth for every surface at once.
 */
export const runActionAction = defineAction(
  RunActionActionSchema,
  async ({ runId, claimId, type }, ctx) => ({
    data: await runAction(ctx.actor, runId, claimId, type),
  }),
  { name: 'runActionAction' },
)

/** One claim of one run, plus the one sentence the student cannot evaluate (FR-090, D-089). */
const EscalateActionSchema = ClaimParamsSchema.extend(EscalateSchema.shape)

/**
 * Escalates a claim to a colleague and returns their authored reply (FR-090 to FR-092).
 *
 * The result carries the reply, its cost, and how many escalations the run has left — and neither
 * which reply answered nor whether it counted against the limit (D-116).
 */
export const escalateAction = defineAction(
  EscalateActionSchema,
  async ({ runId, claimId, ...input }, ctx) => ({
    data: await escalate(ctx.actor, runId, claimId, input),
  }),
  { name: 'escalateAction' },
)
