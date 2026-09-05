'use server'
// Server Actions of the `runs` module: the mirror of every mutation in 07-api-spec.md §7 (07 §11).
// Each one validates with the same Zod schema as its route and calls the same service function, so
// the screens and `/api/v1` cannot drift apart. `defineAction` runs `requireSession()`, maps errors
// to the envelope, and never throws to the client.
//
// `revalidate` names the screens whose server render the write invalidates. Both writes here move
// the run's state, and every run screen is addressed under `/runs/[runId]`, so the run's own routes
// and the list that links to them are what has to be re-rendered.
import { defineAction } from '@/server/http/define-action'
import {
  AnswerReadinessItemSchema,
  AssignmentIdParamsSchema,
  DocumentOpenParamsSchema,
  DocumentParamsSchema,
  LockFrameInputSchema,
  ReadinessItemParamsSchema,
  RunIdParamsSchema,
} from './schema'
import {
  acknowledgePolicy,
  answerReadinessItem,
  closeDocument,
  lockFrame,
  openDocument,
  skipReadiness,
  startRun,
  submitReadiness,
} from './service'

const RUNS = '/runs'
const runRoot = (runId: string): string => `/runs/${runId}`
const readinessRoot = (runId: string): string => `${runRoot(runId)}/readiness`
const workRoot = (runId: string): string => `${runRoot(runId)}/work`

export const startRunAction = defineAction(
  AssignmentIdParamsSchema,
  async ({ assignmentId }, ctx) => {
    const run = await startRun(ctx.actor, assignmentId)
    return { data: run, revalidate: [RUNS, `/assignments/${assignmentId}`] }
  },
  { name: 'startRunAction' },
)

export const acknowledgePolicyAction = defineAction(
  RunIdParamsSchema,
  async ({ runId }, ctx) => ({
    data: await acknowledgePolicy(ctx.actor, runId),
    revalidate: [RUNS, runRoot(runId)],
  }),
  { name: 'acknowledgePolicyAction' },
)

// ---------------------------------------------------------------------------------------------
// The Readiness Check (07 §7, FR-010 to FR-018)
//
// Three writes, and each is the same call the matching route makes. The input schema of the answer
// is the route's two schemas composed — the item this answer is on, and the answer itself — so the
// screen and `PUT /runs/{runId}/readiness/answers/{itemId}` validate against one definition rather
// than two that agree today (the shape `scenarios/actions.ts` already uses).
// ---------------------------------------------------------------------------------------------

/** One item of one run's check, plus the key the student chose. */
const AnswerReadinessItemActionSchema = ReadinessItemParamsSchema.extend(
  AnswerReadinessItemSchema.shape,
)

/**
 * Records one answer, and answers nothing.
 *
 * No `revalidate`: an answer is a scratchpad row until the check closes (`readiness.ts`), it moves
 * no state, and it writes no trace event — re-rendering the screen on every radio press would throw
 * away the sixteen answers the student is holding in the browser and re-fetch a page that has not
 * changed. The screen shows the answer it sent and puts it back if the write is refused.
 */
export const answerReadinessItemAction = defineAction(
  AnswerReadinessItemActionSchema,
  async ({ runId, itemId, ...input }, ctx) => ({
    data: await answerReadinessItem(ctx.actor, runId, itemId, input),
  }),
  { name: 'answerReadinessItemAction' },
)

/** Closes the check and answers the concept map (FR-012). The run moves to `framing` with it. */
export const submitReadinessAction = defineAction(
  RunIdParamsSchema,
  async ({ runId }, ctx) => ({
    data: await submitReadiness(ctx.actor, runId),
    revalidate: [RUNS, runRoot(runId), readinessRoot(runId)],
  }),
  { name: 'submitReadinessAction' },
)

/**
 * Closes the check without a result, after a submission has failed (FR-018).
 *
 * The service refuses this unless `flags.readiness_submit_failed` is set, so the screen offers it
 * only where that flag has just been armed — a submit that failed on our side — and never as a way
 * past a check that is working.
 */
export const skipReadinessAction = defineAction(
  RunIdParamsSchema,
  async ({ runId }, ctx) => ({
    data: await skipReadiness(ctx.actor, runId),
    revalidate: [RUNS, runRoot(runId), readinessRoot(runId)],
  }),
  { name: 'skipReadinessAction' },
)

// ---------------------------------------------------------------------------------------------
// The Evidence Room (07 §7, FR-022, FR-024, FR-117)
//
// An open and a close are the two halves of one recorded reading, and neither revalidates anything.
// The open *is* the response — the body arrives with it, and the `document_open` event is written in
// the same transaction — so there is no server render to invalidate; re-rendering the workspace on
// every open would throw away the document the student is reading and the frame they are half-way
// through writing. The close is bookkeeping about a reading that has ended and changes nothing on
// screen at all.
//
// The close is idempotent by design (`closeDocument`): the reader sends one on unmount, one when the
// tab is hidden and one when the page goes away, and two of the three arriving is the normal case
// rather than an error. The unload paths cannot use this action — a Server Action's request is
// abandoned when the document is discarded — so the reader posts to
// `/api/v1/runs/{runId}/document-opens/{openId}/close` with `keepalive` there. Both reach this same
// service function; this is the path for a close the student is present for.
// ---------------------------------------------------------------------------------------------

/** Opens one document, hands over its body, and records that it was opened (FR-022). */
export const openDocumentAction = defineAction(
  DocumentParamsSchema,
  async ({ runId, documentId }, ctx) => ({
    data: await openDocument(ctx.actor, runId, documentId),
  }),
  { name: 'openDocumentAction' },
)

/** Ends one reading, capped at the clock it ran against and marked `skim` by D-082. */
export const closeDocumentAction = defineAction(
  DocumentOpenParamsSchema,
  async ({ runId, openId }, ctx) => {
    await closeDocument(ctx.actor, runId, openId)
    return { data: null }
  },
  { name: 'closeDocumentAction' },
)

// ---------------------------------------------------------------------------------------------
// The frame (07 §7, FR-040, FR-041)
// ---------------------------------------------------------------------------------------------

/** One run, and the four fields of its frame; the route's two schemas composed. */
const LockFrameActionSchema = RunIdParamsSchema.extend(LockFrameInputSchema.shape)

/**
 * Locks the frame permanently and starts the working clock.
 *
 * This is the one write on the workspace that moves the run, so it is the one that revalidates: the
 * screen the student is standing on changes from a form into a locked frame, the RunFrame's band
 * gains a clock, and the runs list gains a "Continue". `FRAME_INVALID` comes back with
 * `details.field` naming the control that caused it (10 §6), which is what the form binds its
 * refusal to.
 */
export const lockFrameAction = defineAction(
  LockFrameActionSchema,
  async ({ runId, ...frame }, ctx) => ({
    data: await lockFrame(ctx.actor, runId, frame),
    revalidate: [RUNS, runRoot(runId), workRoot(runId)],
  }),
  { name: 'lockFrameAction' },
)
