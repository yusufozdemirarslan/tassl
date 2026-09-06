import type { Metadata } from 'next'
import type { Route } from 'next'
import { notFound, redirect } from 'next/navigation'
import { BriefPanel } from '@/components/features/run/brief-panel'
import {
  AssistantPanel,
  BriefEditor,
  DeclarationControl,
  DelegationLog,
  FrameForm,
} from '@/components/features/run/deferred-panels'
import { EvidenceRoom } from '@/components/features/run/evidence-room'
import { FramePanel } from '@/components/features/run/frame-panel'
import { PausedOverlay } from '@/components/features/run/paused-overlay'
import { RunWorkProvider } from '@/components/features/run/run-work-context'
import { PageHeader } from '@/components/layout/page-header'
import { Panel } from '@/components/layout/panel'
import { isAppError } from '@/lib/errors'
import { t } from '@/lib/i18n/t'
import { listDelegations, type DelegationView } from '@/server/modules/assistant'
import { listRunClaims, type ClaimView } from '@/server/modules/reliance'
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
// **The columns split at `2xl` and at no width below it** (D-310). 09 §5 asked for three columns
// from `lg`, and the arithmetic never worked: at 1024 the content is 752 px, and a 4/5/4 split of
// it leaves the Decision Brief — a 250-word rationale, the artefact being handed in — 216 px of
// column and about 20 characters a line, narrower than the same editor gets on a phone. Dragging
// the window from 1023 to 1024 *shrank* it, because under `lg` the third column ran full width.
// Every ratio was tried against the measure: the brief needs ~650 px of column to hold DESIGN.md's
// 72-character measure, and 1536 is the first width at which a two-column split still gives it
// that. So below `2xl` the screen is one column with the writing at full measure, and from `2xl`
// the reference and the assistant take the left column while the brief and the log take the right.
// The measure never shrinks as the window grows, at any width.
//
// **The reference column is an `aside`** (09 §6). The scenario brief, the frozen frame and the
// Evidence Room are what the student reads *while* working rather than the work itself, and on the
// tallest screen in the product landmark navigation offered only `main`.
//
// **The screen composes three module reads rather than one** (D-268, D-303). `getRunWorkspace`
// answers the room, the frame, the brief draft and the pause; the Delegation Log is
// `assistant.listDelegations` and the claims are `reliance.listRunClaims`. They are not one call
// because the `assistant` module imports `runs`, so a workspace that built either would close the
// two into a cycle — and composing them side by side is what an app page is for. The claim list
// goes to *both* panels below: a claim is drawn twice on this screen, and a stance taken on one of
// them is one act on one record, so the copy that did not take it learns from this render.
//
// **The five state-specific panels are reached through `deferred-panels.tsx`** (D-282). A run is on
// one of these screens, never both, but `entryJSFiles` is a static union — so `framing` was paying
// for the assistant and the log and `working` for react-hook-form and its resolver, and the route
// stood at 172,773 bytes against B4's 130,000. Those five now arrive in async chunks and the route
// adds 101,128. They are still server-rendered (`ssr` stays on), so the JSX below, the markup, the
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
  let claims: readonly ClaimView[] = []
  try {
    workspace = await getRunWorkspace(actor, runId)
    // The log and the claims are read for every state but `framing`, where there is nothing to have
    // delegated to and nothing surfaced but what a document opened. Both are their own module's
    // read rather than fields on the workspace, for the reason the log already was (D-268): the
    // `assistant` module imports `runs`, so a workspace that built either would close the two into
    // a cycle — and composing them side by side is what an app page is for.
    if (!workspace.capabilities.canLockFrame) {
      ;[delegations, claims] = await Promise.all([
        listDelegations(actor, runId),
        listRunClaims(actor, runId),
      ])
    }
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
    <aside aria-label={t('workspace.referenceRegion')} className="flex min-w-0 flex-col gap-6">
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
    </aside>
  )

  // FR-084's gate, counted from the student's own record so the lock can say what it will ask for
  // before it is pressed (D-319). `reliedOn` is set by their acts alone — a used mark, a figure of
  // theirs matching a claim's at the lock, a claim the Turn put in front of them — so nothing
  // authored is disclosed by counting it.
  const unstancedRelied = claims.filter((claim) => claim.reliedOn && claim.stance === null).length

  return (
    <>
      <PageHeader title={t('workspace.title')} description={descriptionOf(run.state)} />

      {framing ? (
        // One column until the frame form can hold its own measure beside the room, and two from
        // there: the room on the left, and what the student is writing on the right (D-310). The
        // assistant's panel arrives with the assistant.
        <div className="grid gap-6 2xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] 2xl:items-start">
          {room}

          <div className="flex min-w-0 flex-col gap-6">
            <FrameForm runId={run.id} />

            {/* Both panels keep their name and their place from the first minute of the run. What
                they say is what Tassl can do, not which release does it. */}
            <Panel id="assistant-panel" title={t('workspace.assistantTitle')} headingLevel={2}>
              <p className="text-ink-muted text-reading max-w-measure">
                {t('workspace.assistantLockedBody')}
              </p>
            </Panel>

            <Panel id="brief-editor-panel" title={t('workspace.briefEditorTitle')} headingLevel={2}>
              <p className="text-ink-muted text-reading max-w-measure">
                {t('workspace.briefEditorLockedBody')}
              </p>
            </Panel>
          </div>
        </div>
      ) : (
        // Two columns from `2xl` and one below it (D-310): the reference and the assistant on the
        // left, the brief and the record of the work on the right. The reading order is the same at
        // every width — read the room, work with the assistant, write the brief, keep the log — so
        // the visual order and the focus order never disagree, and the writing surface holds its
        // full measure from 1024 px upward instead of being squeezed into a third of the screen.
        <RunWorkProvider>
          <div className="grid gap-6 2xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] 2xl:items-start">
            <div className="flex min-w-0 flex-col gap-6">
              {room}

              <AssistantPanel
                runId={run.id}
                canDelegate={capabilities.assistantUnlocked}
                claims={claims}
                documents={workspace.documents}
                lockedReason={
                  capabilities.assistantUnlocked ? undefined : t('workspace.assistantPaused')
                }
              />
            </div>

            <div className="flex min-w-0 flex-col gap-6">
              <BriefEditor
                runId={run.id}
                draft={workspace.briefDraft}
                namedFields={workspace.namedFields}
                canWrite={capabilities.canWriteBrief}
                unstancedRelied={unstancedRelied}
              />

              <DelegationLog
                runId={run.id}
                delegations={delegations}
                claims={claims}
                documents={workspace.documents}
                canWrite={capabilities.assistantUnlocked}
                readOnlyNote={
                  capabilities.assistantUnlocked ? undefined : t('workspace.logPausedNote')
                }
              />

              <DeclarationControl runId={run.id} />
            </div>
          </div>
        </RunWorkProvider>
      )}

      {workspace.pause !== null && <PausedOverlay runId={run.id} cause={workspace.pause.cause} />}
    </>
  )
}
