import { RunFrame } from '@/components/features/run/run-frame'
import { getRunView } from './run-view'

// The RunFrame layout (09 §1, UI-027). Every `/runs/[runId]` screen sits under this band, so the
// assignment, the state, the clock, the frame and the declaration keep one place and one size for
// the whole run — a student under a clock should never have to look for the clock.
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
    <RunFrame run={status.run} label={assignmentLabel}>
      {children}
    </RunFrame>
  )
}
