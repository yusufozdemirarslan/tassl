import { RunFrame } from '@/components/features/run/run-frame'
import type { RunSummary } from '@/server/modules/runs/schema'
import { getRunView } from './run-view'

// The RunFrame layout (09 §1, UI-027). Every `/runs/[runId]` screen sits under this band, so the
// assignment, the state and the clock keep one place and one size for the whole run — and the band
// is sticky, because a student under a clock should never have to look for the clock (D-311).
//
// The frame and the declaration are not in it. Both are panels on the screens that carry them —
// `FramePanel` in the workspace's reference column and on `/locked`, `DeclarationControl` in the
// workspace's own panel, where FR-062's sentence can stand in front of the control — and the two
// slots that once described them here were never passed by any caller (D-312).
//
// It reads the run and draws it, and it decides nothing else. Two things it deliberately does not
// do:
//
// * It does not redirect. 09 §1 describes the redirect to `links.next` as the layout's, but a
//   layout is rendered for its children and does not know which of them it is rendering, so the
//   rule it would have to apply is "which state does this URL want", which is exactly what each
//   page already states in its own guard (`/start` wants `assigned`, `/work` wants the room open).
//   Putting it here would either duplicate that table or bounce a reviewer, who reads a run's
//   status and debrief without following the student's next step at all (D-254).
//
// * It does not hide the app rail. 09 §1 asks run pages to, and the rail is rendered by the
//   `(app)` layout above this one, which has no prop for it and no way to receive one from below.
//   Leaving it is also the kinder failure: the rail is how a student leaves a run they opened by
//   mistake, and the band below it is loud enough that the working period still reads as its own
//   place. Closing that gap is an `AppShell` change, and this build does not need one.
export default async function RunLayout({ children, params }: LayoutProps<'/runs/[runId]'>) {
  const { runId } = await params
  const { status, assignmentLabel } = await getRunView(runId)

  return (
    <RunFrame
      run={status.run}
      label={assignmentLabel}
      windowRemainingMs={turnWindowRemainingMs(status.run)}
    >
      {children}
    </RunFrame>
  )
}

/**
 * Milliseconds left in the Turn window, as a reading taken here on the server (D-042, D-346).
 *
 * `RunSummary.turn.windowEndsAt` is the *instant*; the band counts down from a reading, so the
 * subtraction happens once, here, where it is the server's own clock doing it — the same shape
 * `/runs/[runId]/readiness` gives `ReadinessView.expiresAt`. It answers only in `turn_open`: a run
 * paused inside the window has its window frozen and `runs/clock.ts` adds the open paused span back
 * from a column the summary does not carry, so guessing a number here would be a second, wrong
 * opinion about a clock this layout does not own. A paused run has the paused overlay on it, which
 * is what says the clock has stopped.
 */
function turnWindowRemainingMs(run: RunSummary): number | null {
  if (run.state !== 'turn_open' || run.turn?.windowEndsAt == null) return null
  return Math.max(0, new Date(run.turn.windowEndsAt).getTime() - Date.now())
}
