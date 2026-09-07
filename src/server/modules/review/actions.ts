'use server'
// Server Actions of the `review` module: the mirror of 07-api-spec.md §8's mutations (07 §11). Each
// one validates with the same Zod schema as its route and calls the same service function, so UI-033
// and `/api/v1` cannot drift apart. `defineAction` runs `requireSession()`, maps errors to the
// envelope, and never throws to the client.
//
// Every one of them revalidates the replay, and that is the difference from the run screens: a
// decision, a correction, a void or a hand-banding changes what every other panel of UI-033 shows —
// the progress counter, the points sentence, the export list, the state chip — so the page is
// re-rendered rather than patched. There is no clock running and nothing half-typed to lose, which
// is what makes that safe here and not on the workspace (D-268).
import { revalidatePath } from 'next/cache'
import { defineAction } from '@/server/http/define-action'
import { VoidRunSchema, voidRun } from '@/server/modules/runs'
import { flagDelegation } from '@/server/modules/assistant'
import {
  BandDecisionInputSchema,
  BandParamsSchema,
  ClaimParamsSchema,
  DelegationParamsSchema,
  FlagDelegationInputSchema,
  ManualBandsInputSchema,
  NeutralizeInputSchema,
  RunIdParamsSchema,
} from './schema'
import { bandHeldRunManually, confirmRemaining, decideBand, neutralizeClaim } from './service'

/** Every action on this surface redraws one page: the replay of the run it acted on. */
function revalidateReplay(runId: string): void {
  revalidatePath(`/review/runs/${runId}`)
}

const DecideBandActionSchema = BandParamsSchema.extend(BandDecisionInputSchema.shape)

/** Confirms, overrides, or sets one dimension unassessed (FR-181). */
export const decideBandAction = defineAction(
  DecideBandActionSchema,
  async ({ runId, dimension, ...input }, ctx) => {
    const data = await decideBand(ctx.actor, runId, dimension, input)
    revalidateReplay(runId)
    return { data }
  },
  { name: 'decideBandAction' },
)

/** Confirms every dimension nobody has decided yet with its draft (10 §12). */
export const confirmRemainingAction = defineAction(
  RunIdParamsSchema,
  async ({ runId }, ctx) => {
    const data = await confirmRemaining(ctx.actor, runId)
    revalidateReplay(runId)
    return { data }
  },
  { name: 'confirmRemainingAction' },
)

const ManualBandsActionSchema = RunIdParamsSchema.extend(ManualBandsInputSchema.shape)

/** Bands a held run by hand and carries it through to confirmed (FR-140). */
export const bandHeldRunManuallyAction = defineAction(
  ManualBandsActionSchema,
  async ({ runId, ...input }, ctx) => {
    const data = await bandHeldRunManually(ctx.actor, runId, input)
    revalidateReplay(runId)
    return { data }
  },
  { name: 'bandHeldRunManuallyAction' },
)

const NeutralizeActionSchema = ClaimParamsSchema.extend(NeutralizeInputSchema.shape)

/** Neutralizes one claim in both directions and recomputes (FR-003, FR-005). Instructor only. */
export const neutralizeClaimAction = defineAction(
  NeutralizeActionSchema,
  async ({ runId, claimId, ...input }, ctx) => {
    const data = await neutralizeClaim(ctx.actor, runId, claimId, input)
    revalidateReplay(runId)
    return { data }
  },
  { name: 'neutralizeClaimAction' },
)

const VoidRunActionSchema = RunIdParamsSchema.extend(VoidRunSchema.shape)

/**
 * Voids a run and, when asked, offers the student another (FR-002, FR-008).
 *
 * It revalidates the student's run list as well as the replay: the re-offer is a run they can start
 * now, and a stale list would hide it behind a refresh nobody knows to make.
 */
export const voidRunAction = defineAction(
  VoidRunActionSchema,
  async ({ runId, ...input }, ctx) => {
    const data = await voidRun(ctx.actor, runId, input)
    revalidateReplay(runId)
    revalidatePath('/runs')
    return { data }
  },
  { name: 'voidRunAction' },
)

const FlagDelegationActionSchema = DelegationParamsSchema.extend(FlagDelegationInputSchema.shape)

/** Flags out-of-scenario content in the Delegation Log (FR-055). */
export const flagDelegationAction = defineAction(
  FlagDelegationActionSchema,
  async ({ runId, delegationId, flag }, ctx) => {
    const data = await flagDelegation(ctx.actor, runId, delegationId, flag)
    revalidateReplay(runId)
    return { data }
  },
  { name: 'flagDelegationAction' },
)
