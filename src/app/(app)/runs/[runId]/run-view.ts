import { cache } from 'react'
import { notFound } from 'next/navigation'
import { isAppError } from '@/lib/errors'
import { getAssignment } from '@/server/modules/courses'
import { getRunStatus, type RunStatus } from '@/server/modules/runs'
import { RunIdParamsSchema } from '@/server/modules/runs/schema'
import { getViewer } from '../../viewer'

// The one run read of a `/runs/[runId]` request, shared by the layout and the page beneath it
// (the reasoning of `(app)/viewer.ts`, D-178). Both need the run — the layout for the band, the
// page for its own guard — and `getRunStatus` is not a free call: it materializes a timer that has
// fired, which takes the run's row lock. `cache()` makes the second caller read the first's answer,
// so a page load fires one timer rather than two.
//
// **`assignmentLabel` is a string, and the view it came from does not leave this function.**
// `courses.AssignmentView` carries `variantKey` — whether a defect was planted in this student's
// scenario — and every consumer of this module hands what it gets to a client component. A student
// never sees a planted flag before their run is scored (CLAUDE.md, 12 §8.1), so the label is picked
// off here, on the server, and the rest of the view is dropped on the floor.

export type RunView = {
  status: RunStatus
  /** The assignment's label: the student's name for this run, and nothing else about it. */
  assignmentLabel: string
}

/** A run the viewer may not see renders the not-found page, never the error boundary (08 §4). */
async function orNotFound<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (error) {
    if (isAppError(error) && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) notFound()
    throw error
  }
}

export const getRunView = cache(async (runId: string): Promise<RunView> => {
  // An id that is not a uuid never reaches the repository: a malformed address is a 404, not a
  // database cast error on the error boundary.
  if (!RunIdParamsSchema.safeParse({ runId }).success) notFound()

  const { actor } = await getViewer()
  const status = await orNotFound(() => getRunStatus(actor, runId))
  const assignment = await orNotFound(() => getAssignment(actor, status.run.assignmentId))

  return { status, assignmentLabel: assignment.label }
})
