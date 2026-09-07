// generate_package_step handler: docs/tech/10-backend-spec.md §7 (`authoring.runGenerationStep`,
// singleton key `generate:<versionId>:<step>`) and 10 §5, AI-001, FR-191. One step of the seven
// that turn a licensed seed case into a draft scenario package.
//
// The handler is a few lines because the pipeline is the service's (10 §5). What it owns is the one
// decision a queue makes: what a throw means. A throw is the retry signal — three attempts, 30 s
// backoff, then the `generate_package_step_dead` queue — and `runGenerationStep` throws only when
// the version cannot be read at all. Every failure it *can* interpret it handles itself: a step
// that breaks its validation subset re-runs once with the rule restated and is then marked
// `failed` with a notice to the author, which is a completed job, because a failed step is a state
// UI-042 has a row for and a queue retry would only reach it again.
//
// A retry that *does* happen is safe by construction, and not because of the singleton key: pg-boss
// applies a key as a dedupe only under a `singleton`-family policy and every queue here is
// `standard`, so a second send makes a second job (D-400). What makes a duplicate harmless is the
// version row's write lock, which `runGenerationStep` takes before it claims the step's
// `generation_runs` row — the loser finds a row that is already `running` or `succeeded` and
// returns without calling the provider or writing an element.
import { registerHandler, type JobHandler } from '@/server/jobs/handlers'
// The registry (10 §7) names `authoring.runGenerationStep` as this queue's handler; the boundaries
// policy lets a job handler reach a module through its public index.ts (D-173).
import { runGenerationStep } from '@/server/modules/authoring'

export const generatePackageStepHandler: JobHandler<'generate_package_step'> = async (
  payload,
  ctx,
) => {
  const result = await runGenerationStep(payload)
  ctx.logger.info(
    {
      event: 'generate_package_step',
      packageVersionId: result.versionId,
      step: result.step,
      passNumber: result.passNumber,
      outcome: result.outcome,
      failedRules: result.failedRules,
      durationMs: result.durationMs,
    },
    'generation step finished',
  )
}

registerHandler('generate_package_step', generatePackageStepHandler)
