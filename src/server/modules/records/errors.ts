// Error codes of the `records` module (docs/tech/10-backend-spec-modules.md §14) and the throwers
// the service states its rules with. Both are registered in `src/lib/errors.ts`; the throwers
// return `never` and are function declarations, so TypeScript narrows after a call.
import { AppError, type ErrorCode } from '@/lib/errors'

/** The two codes 10 §14 names for this module. */
export const RECORDS_ERROR_CODES = [
  'RECORD_NOT_AVAILABLE',
  'EXPORT_NOT_FOUND',
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
