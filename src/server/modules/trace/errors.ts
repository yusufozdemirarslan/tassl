// Error codes of the `trace` module (docs/tech/10-backend-spec-modules.md §10) and the throwers the
// service states its rules with. Both are 500s, which is unusual and deliberate: nothing a client
// sends can reach either. The payloads are built by our own services, and the sequence is allocated
// under a lock our own transaction was supposed to be holding. A reader can do nothing about
// either, so neither carries a message worth reading — the details are for the log and for Sentry.
//
// The throwers return `never` and are function declarations, so TypeScript narrows after a call.
import { AppError, type ErrorCode } from '@/lib/errors'
import type { RunEventTypeValue } from './schema'

/** The code 10 §10 names for this module. */
export const TRACE_ERROR_CODES = ['SEQUENCE_CONFLICT'] as const satisfies readonly ErrorCode[]

/**
 * The run's allocator had moved since the caller read it, so the sequence this append would have
 * taken is already someone else's. It means one of two things, both defects: the mutation did not
 * lock the run row with `findRunForUpdate` before appending, or it appended twice from a stale copy
 * of the row.
 *
 * It is not retried. 10 §10 used to call it "retryable once inside the transaction wrapper", which
 * described a retry `withTransaction` has never had; the sentence is corrected rather than
 * implemented, because a mutation that locked the run row cannot reach this (a contender blocks in
 * `findRunForUpdate` and reads a fresh allocator), so every case that does reach it is a caller
 * defect that a blanket re-run of an arbitrary side-effecting callback would hide instead of fix.
 * It is a 500 so it lands in Sentry and gets read.
 */
export function sequenceConflict(runId: string, expected: number): never {
  throw new AppError('SEQUENCE_CONFLICT', undefined, { details: { runId, expected } })
}

/**
 * A run the actor neither owns nor reviews. It answers NOT_FOUND rather than FORBIDDEN even when
 * the actor can see the section the run belongs to: a classmate holds a `student` membership there,
 * and 08 §4 gives a student no read of another student's run at all, so telling them the id resolves
 * to something is already more than they may know.
 */
export function runNotFound(): never {
  throw new AppError('NOT_FOUND')
}

/**
 * The run's own student asked for their trace in a state where it is closed to them
 * (`owner-view.ts`): the defense, where the whole exercise is what they can say with nothing in
 * front of them but their own frame, brief, addendum and Turn response (UI-026), and any state a
 * run reaches that will never be scored.
 *
 * FORBIDDEN rather than NOT_FOUND: they own the run, they can see its state on their own screen,
 * and pretending it does not exist would be a lie they can already disprove. It is one of the
 * global codes 07 §1 lists, so the endpoint's contract is unchanged. `details.state` is the state
 * their own status poll is already showing them.
 */
export function traceSealed(state: string): never {
  throw new AppError('FORBIDDEN', 'This run’s trace is not open to you yet.', {
    details: { state },
  })
}

/**
 * The payload did not match the schema its event type declares. The trace is the record every
 * graph, band and export is computed from, so a payload nobody checked is worse than a failed
 * write: the write is refused, and the flattened issues name the fields at fault.
 */
export function payloadInvalid(type: RunEventTypeValue, details: unknown): never {
  throw new AppError('INTERNAL_ERROR', 'A trace payload did not match its event type.', {
    details: { type, issues: details },
  })
}
