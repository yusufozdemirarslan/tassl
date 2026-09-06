// score_run handler: docs/tech/10-backend-spec.md §7 (`scoring.scoreRun`, singleton key
// `score_run:<runId>`) and D-046. The run's defense is finished, so the trace becomes four graphs,
// seven draft bands and a set of points — or the run is held for a faculty seat (FR-140).
//
// The handler is four lines because the pipeline is the service's (10 §11). What it owns is the one
// decision a queue makes: what a throw means. A throw is the retry signal — three attempts, 30 s
// backoff, then the `score_run_dead` queue — and `scoreRun` throws only when the run cannot be read
// at all. Every failure it *can* interpret it handles itself: a read that did not come back holds
// the run and returns, which is a completed job, because a held run is a state the product has a
// screen for and a retry would only hold it again.
import { registerHandler, type JobHandler } from '@/server/jobs/handlers'
// The registry (10 §7) names `scoring.scoreRun` as this queue's handler; the boundaries policy lets
// a job handler reach a module through its public index.ts (D-173).
import { scoreRun } from '@/server/modules/scoring'

export const scoreRunHandler: JobHandler<'score_run'> = async (payload, ctx) => {
  const result = await scoreRun(payload.runId)
  ctx.logger.info(
    {
      event: 'score_run',
      runId: result.runId,
      outcome: result.outcome,
      holdReason: result.holdReason,
      durationMs: result.durationMs,
      provider: result.provider,
    },
    'scoring finished',
  )
}

registerHandler('score_run', scoreRunHandler)
