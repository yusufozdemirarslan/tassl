import type { StudentAssignment } from '@/server/modules/courses/schema'
import type { RunStateValue, RunSummary } from '@/server/modules/runs/schema'

// The join behind UI-020 and the "Your runs" panel of UI-009: the student's assignments and the
// attempts they have made on them, in the order a person reads them.
//
// It lives beside the table rather than inside either page because both screens show the same list
// — the runs list is all of it, home is the top of it — and a second implementation of "which
// attempt is the re-offer of which" would be free to disagree with the first.
//
// Pure, and typed by the two module schemas rather than by the database: give it the two lists and
// it answers. Nothing here reads a run's variant, its package or its scenario, because none of them
// is on the shapes it is given — the student view is what the services return, and this only
// rearranges it (12 §8).

export type RunListRow = {
  /** Stable across re-renders: the attempt's id, or the assignment's when there is no attempt. */
  key: string
  assignmentId: string
  assignmentLabel: string
  isWalkthrough: boolean
  /** An instant in the future while the assignment has not opened; null once it has (FR-233). */
  opensAt: string | null
  /** Null on an assignment with no attempt yet — the row that offers Start. */
  run: {
    id: string
    attemptNo: number
    state: RunStateValue
    /** `scoring_status = 'held'`: the one thing about scoring a student is told (FR-140). */
    underReview: boolean
    /** Where this attempt continues, or null when there is nowhere to go (a voided attempt). */
    nextHref: string | null
  } | null
  /** The later attempt that replaced this one, when it was voided and re-offered (FR-183). */
  reoffer: { attemptNo: number; href: string } | null
}

function isFuture(instant: string | null, now: number): boolean {
  if (instant === null) return false
  const at = Date.parse(instant)
  return !Number.isNaN(at) && at > now
}

/**
 * One row per attempt, oldest attempt first, plus one row for each assignment nobody has attempted.
 *
 * The re-offer is read off the list rather than from a column: a re-offer is a new run on the same
 * assignment (FR-183), so the attempt that follows a voided one *is* the re-offer, and an
 * assignment whose last attempt is voided simply has nothing after it yet.
 */
export function toRunListRows(
  assignments: readonly StudentAssignment[],
  runs: readonly RunSummary[],
  now: number = Date.now(),
): RunListRow[] {
  const byAssignment = new Map<string, RunSummary[]>()
  for (const run of runs) {
    const attempts = byAssignment.get(run.assignmentId)
    if (attempts) attempts.push(run)
    else byAssignment.set(run.assignmentId, [run])
  }
  for (const attempts of byAssignment.values()) attempts.sort((a, b) => a.attemptNo - b.attemptNo)

  const rows: RunListRow[] = []
  for (const assignment of assignments) {
    const attempts = byAssignment.get(assignment.assignmentId) ?? []
    const shared = {
      assignmentId: assignment.assignmentId,
      assignmentLabel: assignment.label,
      isWalkthrough: assignment.isWalkthrough,
    }

    if (attempts.length === 0) {
      rows.push({
        ...shared,
        key: assignment.assignmentId,
        opensAt: isFuture(assignment.opensAt, now) ? assignment.opensAt : null,
        run: null,
        reoffer: null,
      })
      continue
    }

    attempts.forEach((run, index) => {
      const later = attempts[index + 1]
      rows.push({
        ...shared,
        key: run.id,
        opensAt: null,
        run: {
          id: run.id,
          attemptNo: run.attemptNo,
          state: run.state,
          underReview: run.scoringStatus === 'held',
          nextHref: run.state === 'voided' ? null : run.links.next,
        },
        reoffer:
          run.state === 'voided' && later !== undefined
            ? { attemptNo: later.attemptNo, href: later.links.next }
            : null,
      })
    })
  }
  return rows
}
