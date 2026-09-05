import type { Metadata } from 'next'
import type { Route } from 'next'
import { notFound, redirect } from 'next/navigation'
import { BriefPanel } from '@/components/features/run/brief-panel'
import { EvidenceRoom } from '@/components/features/run/evidence-room'
import { FrameForm } from '@/components/features/run/frame-form'
import { FramePanel } from '@/components/features/run/frame-panel'
import { PageHeader } from '@/components/layout/page-header'
import { Panel } from '@/components/layout/panel'
import { isAppError } from '@/lib/errors'
import { t } from '@/lib/i18n/t'
import { getRunWorkspace, type RunStateValue, type RunWorkspace } from '@/server/modules/runs'
import { getRunView } from '../run-view'
import { getViewer } from '../../../viewer'

export const metadata: Metadata = { title: t('workspace.metaTitle') }

// UI-023 (FR-020 to FR-024, FR-040 to FR-044): the run workspace, in the state Phase 6 ends in.
//
// The room and the frame are the whole of the screen at this point. The assistant and the decision
// brief have their panels and their names, because the workspace a student learns in `framing` is
// the one they come back to for the rest of the run — but they carry a sentence and no control.
// A button that cannot act is a promise the screen cannot keep (the reading UI-041 gives its own
// disabled control), so there is not one here.
//
// **The state decides which screen a student is on, never this page.** `/work` is the route for
// `framing`, `working` and `paused` (09 §1); a run anywhere else follows its own `links.next`,
// which is what moves a student whose working clock ran out while they were reading — the poll in
// the `RunFrame` band refreshes this tree, `getRunStatus` materializes the auto-lock on the read,
// and the redirect below takes them to `/locked` without them pressing anything (D-042).
//
// The three columns of 09 §5 are two here, because in `framing` the third holds a sentence: the
// room and the brief on the left, and what the student is writing on the right. The assistant's
// column arrives with the assistant.

/** The states `/runs/[runId]/work` draws (09 §1). `turn_open` is the Turn's own screen. */
const WORK_STATES: readonly RunStateValue[] = ['framing', 'working', 'paused']

/** What the screen is for, in the state the student is in. */
function descriptionOf(state: RunStateValue): string {
  if (state === 'framing') return t('workspace.descriptionFraming')
  if (state === 'paused') return t('workspace.descriptionPaused')
  return t('workspace.descriptionWorking')
}

export default async function RunWorkPage({ params }: PageProps<'/runs/[runId]/work'>) {
  const { runId } = await params
  const { status } = await getRunView(runId)
  const next = status.run.links.next as Route

  if (!WORK_STATES.includes(status.run.state)) redirect(next)

  const { actor } = await getViewer()
  let workspace: RunWorkspace
  try {
    workspace = await getRunWorkspace(actor, runId)
  } catch (error) {
    if (!isAppError(error)) throw error
    // The run moved between the read above and this one — the clock ran out, or another tab
    // locked the decision. The run's own next step is the answer, not an error boundary.
    if (error.code === 'ILLEGAL_TRANSITION' || error.code === 'RUN_LOCKED') redirect(next)
    // A reviewer may read this run's status; nobody but its owner may stand in its room (08 §4).
    if (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN') notFound()
    throw error
  }

  const { run, capabilities, frame } = workspace
  const framed = frame !== null

  return (
    <>
      <PageHeader title={t('workspace.title')} description={descriptionOf(run.state)} />

      <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <BriefPanel text={workspace.brief.text} />
          <EvidenceRoom
            runId={run.id}
            documents={workspace.documents}
            openDocuments={workspace.openDocuments}
            canOpen={capabilities.canOpenDocuments}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          {capabilities.canLockFrame ? (
            <FrameForm runId={run.id} />
          ) : (
            frame !== null && (
              <Panel
                id="locked-frame"
                title={t('workspace.framePanelTitle')}
                headingLevel={2}
                padding="reading"
              >
                <FramePanel frame={frame} />
              </Panel>
            )
          )}

          {/* Both panels keep their name and their place from the first minute of the run. What
              they say is what Tassl can do, not which release does it. */}
          <Panel id="assistant-panel" title={t('workspace.assistantTitle')} headingLevel={2}>
            <p className="text-ink-muted text-reading max-w-[72ch]">
              {framed ? t('workspace.assistantUnlockedBody') : t('workspace.assistantLockedBody')}
            </p>
          </Panel>

          <Panel id="brief-editor-panel" title={t('workspace.briefEditorTitle')} headingLevel={2}>
            <p className="text-ink-muted text-reading max-w-[72ch]">
              {framed
                ? t('workspace.briefEditorUnlockedBody')
                : t('workspace.briefEditorLockedBody')}
            </p>
          </Panel>
        </div>
      </div>
    </>
  )
}
