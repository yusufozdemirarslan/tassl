import type { Metadata } from 'next'
import type { Route } from 'next'
import { notFound, redirect } from 'next/navigation'
import { BriefPanel } from '@/components/features/run/brief-panel'
import {
  AssistantPanel,
  DeclarationControl,
  DelegationLog,
  FrameForm,
} from '@/components/features/run/deferred-panels'
import { EvidenceRoom } from '@/components/features/run/evidence-room'
import { FramePanel } from '@/components/features/run/frame-panel'
import { PausedOverlay } from '@/components/features/run/paused-overlay'
import { PageHeader } from '@/components/layout/page-header'
import { Panel } from '@/components/layout/panel'
import { isAppError } from '@/lib/errors'
import { t } from '@/lib/i18n/t'
import { listDelegations, type DelegationView } from '@/server/modules/assistant'
import { getRunWorkspace, type RunStateValue, type RunWorkspace } from '@/server/modules/runs'
import { getRunView } from '../run-view'
import { getViewer } from '../../../viewer'

export const metadata: Metadata = { title: t('workspace.metaTitle') }

// UI-023 (FR-020 to FR-024, FR-040 to FR-044, FR-050 to FR-061): the run workspace.
//
// Two screens under one route, because the run has two working periods and they are not the same
// job. In `framing` the student reads the room and writes their own position, with no assistant in
// it; from the frame lock they work with the assistant, and the screen opens into the three columns
// of 09 §5 — the Evidence Room, the assistant, and what they are building beside it.
//
// **The state decides which screen a student is on, never this page.** `/work` is the route for
// `framing`, `working` and `paused` (09 §1); a run anywhere else follows its own `links.next`,
// which is what moves a student whose working clock ran out while they were reading — the poll in
// the `RunFrame` band refreshes this tree, `getRunStatus` materializes the auto-lock on the read,
// and the redirect below takes them to `/locked` without them pressing anything (D-042).
//
// **The screen composes three module reads rather than one** (D-268). `getRunWorkspace` answers the
// room, the frame and the pause; the Delegation Log is `assistant.listDelegations`. They are not
// one call because the `assistant` module imports `runs`, so a workspace that built the log would
// close the two into a cycle — and composing them side by side is what an app page is for.
//
// **The four state-specific panels are reached through `deferred-panels.tsx`** (D-282). A run is on
// one of these screens, never both, but `entryJSFiles` is a static union — so `framing` was paying
// for the assistant and the log and `working` for react-hook-form and its resolver, and the route
// stood at 172,773 bytes against B4's 130,000. Those four now arrive in async chunks and the route
// adds 98,501. They are still server-rendered (`ssr` stays on), so the JSX below, the markup, the
// reading order and the a11y tree are exactly what they were; only their hydration waits.
//
// The paused overlay is rendered from the server, when and only when there is an open pause. That
// is also what keeps its weight off a working run: a Client Component a Server Component does not
// render has no reference in the payload, so Base UI's dialog is downloaded by the run that is
// paused and by no other (16 §3.2). Its *import* stays static for the opposite reason to the four
// above: the dialog is portalled, so it renders nothing until hydration, and a chunk fetch in front
// of it would put a round trip between a student and the news that their clock stopped (FR-001).

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
  let delegations: readonly DelegationView[] = []
  try {
    workspace = await getRunWorkspace(actor, runId)
    // The log is read for every state but `framing`, where there is nothing to have delegated to.
    if (!workspace.capabilities.canLockFrame) delegations = await listDelegations(actor, runId)
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
  const framing = capabilities.canLockFrame

  const room = (
    <>
      <BriefPanel text={workspace.brief.text} />
      {!framing && frame !== null && (
        <Panel
          id="locked-frame"
          title={t('workspace.framePanelTitle')}
          headingLevel={2}
          padding="reading"
        >
          <FramePanel frame={frame} />
        </Panel>
      )}
      <EvidenceRoom
        runId={run.id}
        documents={workspace.documents}
        openDocuments={workspace.openDocuments}
        canOpen={capabilities.canOpenDocuments}
      />
    </>
  )

  return (
    <>
      <PageHeader title={t('workspace.title')} description={descriptionOf(run.state)} />

      {framing ? (
        // Two columns while the frame is being written: the room on the left, and what the student
        // is writing on the right. The assistant's column arrives with the assistant.
        <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="flex min-w-0 flex-col gap-6">{room}</div>

          <div className="flex min-w-0 flex-col gap-6">
            <FrameForm runId={run.id} />

            {/* Both panels keep their name and their place from the first minute of the run. What
                they say is what Tassl can do, not which release does it. */}
            <Panel id="assistant-panel" title={t('workspace.assistantTitle')} headingLevel={2}>
              <p className="text-ink-muted text-reading max-w-[72ch]">
                {t('workspace.assistantLockedBody')}
              </p>
            </Panel>

            <Panel id="brief-editor-panel" title={t('workspace.briefEditorTitle')} headingLevel={2}>
              <p className="text-ink-muted text-reading max-w-[72ch]">
                {t('workspace.briefEditorLockedBody')}
              </p>
            </Panel>
          </div>
        </div>
      ) : (
        // 09 §5: three columns from `lg` — the Evidence Room, the assistant and its claims, and the
        // brief with the log beside it. At `md` the first two share the row and the third takes a
        // row of its own beneath them; under `md` everything is one column, in the reading order the
        // markup already has, so the visual order and the focus order never disagree.
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-[minmax(0,4fr)_minmax(0,5fr)_minmax(0,4fr)]">
          <div className="flex min-w-0 flex-col gap-6">{room}</div>

          <div className="flex min-w-0 flex-col gap-6">
            <AssistantPanel
              runId={run.id}
              canDelegate={capabilities.assistantUnlocked}
              lockedReason={
                capabilities.assistantUnlocked ? undefined : t('workspace.assistantPaused')
              }
            />
          </div>

          <div className="flex min-w-0 flex-col gap-6 md:col-span-2 lg:col-span-1">
            <Panel id="brief-editor-panel" title={t('workspace.briefEditorTitle')} headingLevel={2}>
              <p className="text-ink-muted text-reading max-w-[72ch]">
                {t('workspace.briefEditorUnlockedBody')}
              </p>
            </Panel>

            <DelegationLog
              runId={run.id}
              delegations={delegations}
              canWrite={capabilities.assistantUnlocked}
              readOnlyNote={
                capabilities.assistantUnlocked ? undefined : t('workspace.logPausedNote')
              }
            />

            <DeclarationControl runId={run.id} />
          </div>
        </div>
      )}

      {workspace.pause !== null && <PausedOverlay runId={run.id} cause={workspace.pause.cause} />}
    </>
  )
}
