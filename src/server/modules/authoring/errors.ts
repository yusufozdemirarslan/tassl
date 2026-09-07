// Error codes of the `authoring` module (docs/tech/10-backend-spec-modules.md §5) and the throwers
// its service and its job runner state their rules with. Every code is already in the registry
// (`src/lib/errors.ts`), which owns the status and the default message; this file names the three
// that belong to this module and gives each rule one call site, exactly as `scenarios/errors.ts`
// does for its six.
//
// The throwers return `never` and are function declarations, so TypeScript narrows after them:
// `if (!version.seedRecord) seedMissing()` leaves a version with a seed behind it.
//
// `VERSION_FROZEN` is deliberately *not* here. A confirmed version is the `scenarios` module's rule
// (10 §4, NFR-004) and this module refuses with the same code from the same registry, because an
// author who asked to regenerate an element of a frozen version has to read one sentence, not two.
import { AppError, type ErrorCode } from '@/lib/errors'

/** The codes 10 §5 names for this module. */
export const AUTHORING_ERROR_CODES = [
  'GENERATION_ALREADY_RUNNING',
  'SEED_MISSING',
  'GENERATION_STEP_FAILED',
] as const satisfies readonly ErrorCode[]

/**
 * A step of this version is queued or running (10 §5). The refusal is decided under the version
 * row's lock, not by the queue: pg-boss applies a singleton key as a dedupe only under a
 * `singleton`-family policy and every queue here is `standard`, so a second send makes a second job
 * (D-400). What makes a second start harmless is this check and the lock it is taken under.
 */
export function generationAlreadyRunning(details?: unknown): never {
  throw new AppError('GENERATION_ALREADY_RUNNING', undefined, { details })
}

/** Step 1 is the only step given the seed case (11 §2.1); without one there is nothing to re-skin. */
export function seedMissing(): never {
  throw new AppError('SEED_MISSING')
}

/**
 * The step's validation subset failed. Never reaches a client: the job runner catches it, and the
 * rules travel in `details.failedRules` so the retry can restate them in the prompt input, which is
 * the whole point of the channel 10 §5 asks for.
 */
export function generationStepFailed(failedRules: readonly string[]): never {
  throw new AppError('GENERATION_STEP_FAILED', undefined, { details: { failedRules } })
}

/** The rules out of a `GENERATION_STEP_FAILED`, or an empty list when it was any other failure. */
export function failedRulesOf(error: unknown): string[] {
  const details = (error as { details?: { failedRules?: unknown } } | null)?.details
  const rules = details?.failedRules
  return Array.isArray(rules)
    ? rules.filter((rule): rule is string => typeof rule === 'string')
    : []
}
