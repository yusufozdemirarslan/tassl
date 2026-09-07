// Error codes of the `records` module (docs/tech/10-backend-spec-modules.md §14) and the throwers
// the service states its rules with. Both are registered in `src/lib/errors.ts`; the throwers
// return `never` and are function declarations, so TypeScript narrows after a call.
import { AppError, type ErrorCode } from '@/lib/errors'

/** The two codes 10 §14 names for this module. */
export const RECORDS_ERROR_CODES = [
  'RECORD_NOT_AVAILABLE',
  'EXPORT_NOT_FOUND',
  // 07 §8 gives this one to `GET /runs/{runId}/exports`, whose list exists only once a run's bands
  // are confirmed — and never for a voided run, whose bands are absent from any export (FR-002).
  'RUN_NOT_CONFIRMED',
] as const satisfies readonly ErrorCode[]

/**
 * The Judgment Record, or the record copy of the trace, asked for before it exists.
 *
 * The record is the artifact of a *finished* assessment: it holds confirmed bands, and a band the
 * instructor has not decided is a draft (FR-170, PRD §7.13 "only confirmed bands enter the
 * mapping"). So the record opens at `confirmed` and stays open at `recorded`, and every earlier
 * state — including `scored`, where the student already has their draft debrief — is refused here.
 *
 * `details.state` is the state the student's own status poll is already showing them, so a screen
 * can say what they are waiting for rather than only that they cannot have it.
 */
export function recordNotAvailable(state: string): never {
  throw new AppError('RECORD_NOT_AVAILABLE', undefined, { details: { state } })
}

/** A course export version that names no row: no export at all yet, or a version past the last. */
export function exportNotFound(runId: string, version: number | 'latest'): never {
  throw new AppError('EXPORT_NOT_FOUND', undefined, { details: { runId, version } })
}

/**
 * The export history of a run that has none (07 §8, FR-002, FR-184).
 *
 * Two runs reach it and both are honest answers to "where are the files": one whose bands nobody has
 * confirmed, and one an instructor voided — a voided run contributes nothing to a gradebook, which
 * is FR-002's "no partial score and no points recorded" applied at the read, because the ledger
 * itself is append-only and nothing may unwrite a file that was handed over (D-434).
 *
 * `details.state` names the step the run is at, so the screen can say which of the two it is.
 */
export function runNotConfirmed(state: string): never {
  throw new AppError('RUN_NOT_CONFIRMED', undefined, { details: { state } })
}
