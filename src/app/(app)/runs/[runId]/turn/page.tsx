import type { Metadata } from 'next'
import type { Route } from 'next'
import { notFound, redirect } from 'next/navigation'
import {
  AssistantPanel,
  ClaimCard,
  ClaimControls,
  DeclarationControl,
  TurnPanel,
} from '@/components/features/run/deferred-panels'
import { EvidenceRoom } from '@/components/features/run/evidence-room'
import { PausedOverlay } from '@/components/features/run/paused-overlay'
import { RunWorkProvider } from '@/components/features/run/run-work-context'
import { FrameBesideDecision } from '@/components/graphs/frame-beside-decision'
import { EmptyState } from '@/components/layout/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { Panel } from '@/components/layout/panel'
import { Badge } from '@/components/ui/badge'
import { isAppError } from '@/lib/errors'
import { formatDateTime } from '@/lib/format/date-time'
import { t } from '@/lib/i18n/t'
import { effectiveAssistantMode } from '@/server/modules/admin'
import { listRunClaims, type ClaimView } from '@/server/modules/reliance'
import {
  getRunWorkspace,
  getTurn,
  type RunWorkspace,
  type TurnVoiceValue,
} from '@/server/modules/runs'
import { getViewer } from '../../../viewer'
import { getRunView } from '../run-view'

export const metadata: Metadata = { title: t('turn.metaTitle') }

// UI-025 `/runs/[runId]/turn` (FR-110 to FR-115): the Turn, the twelve minutes it opens, and the one
// response filed against it.
//
// **The screen is the shape of the act.** A student here has three things to do and they happen in
// this order: read what arrived, take a position on the claims it raised, and file the response.
// So that is the column — message, claims, response — and everything else is reference beside it:
// what they filed before the Turn came, the Evidence Room, and the assistant. UI-025's tree lists
// the reopened room between the claims and the form; it is drawn beside instead, because under
// `2xl` the screen is one column and a room between the gate and the act would put an entire
// assistant transcript between a student and the button they came to press.
//
// **The countdown is not on this page, and that is deliberate** (D-346). The window is a clock a
// student is under, its last minute is a red wash, and this screen is many viewports tall — so it
// is drawn in the sticky `RunFrame` band above, where the working clock already is and where a
// threshold cannot fire off-screen. One clock is running at a time, so the band shows one.
//
// **Three module reads, composed here** (D-268, D-336). `getTurn` answers the Turn, the window and
// the frozen record; `getRunWorkspace` answers the room, which reopens for the window
// (`WORKSPACE_STATES` includes `turn_open`); `reliance.listRunClaims` answers the claims, because
// the authored `window_claim_ids` reaches no student payload and `ClaimView.inTurnWindow` is how
// the window's own claims are marked. The `assistant` module imports `runs`, so folding either into
// the Turn read would close a cycle — composing them side by side is what an app page is for.
//
// **The claim cards are the workspace's, whole.** FR-111 reopens the interrogation actions and the
// escalation for the window, and a card that dropped them would be a different instrument in the
// same run. What the window changes is the clock they are charged against, which `chargeCost`
// already knows (D-132).
//
// **Nothing on this screen evaluates anything.** Not the decision that was filed, not the Turn
// itself, not which of hold, revise and reverse the news calls for: `warrants_change` and
// `proportionate_response` are the instrument this response is measured against and no student
// payload carries either (D-336, 12 §8.1).

/**
 * Whether this page is where the run currently belongs (09 §1, D-367).
 *
 * It asks the run's own `links.next` rather than reading `state` for itself, and that is the point:
 * two states draw this screen — `turn_open`, and `paused` from inside the window, which is the same
 * screen behind the modal `PausedOverlay` already rendered at the bottom of this tree — and the map
 * that knows which is `runs/summary.ts`. A second copy of the rule here is how the two came apart in
 * the first place: `NEXT_ROUTE.paused` sent a student answering the Turn to the locked workspace,
 * and a page that then hard-coded `turn_open` would bounce them straight back to it.
 */
const belongsHere = (next: string, runId: string): boolean => next === `/runs/${runId}/turn`

/** `scenario_turns.voice` (DATA-023) in the student's own language, as a chip on the message. */
const VOICE_LABELS: Record<TurnVoiceValue, string> = {
  stakeholder_message: t('turn.voiceStakeholderMessage'),
  corrected_number: t('turn.voiceCorrectedNumber'),
  supplier_notice: t('turn.voiceSupplierNotice'),
  competitor_move: t('turn.voiceCompetitorMove'),
  retracted_source: t('turn.voiceRetractedSource'),
  regulatory_note: t('turn.voiceRegulatoryNote'),
}

export default async function RunTurnPage({ params }: PageProps<'/runs/[runId]/turn'>) {
  const { runId } = await params
  const { status } = await getRunView(runId)
  const next = status.run.links.next as Route

  if (!belongsHere(status.run.links.next, runId)) redirect(next)

  const { actor } = await getViewer()
  let turn
  let workspace: RunWorkspace
  let claims: readonly ClaimView[] = []
  try {
    ;[turn, workspace, claims] = await Promise.all([
      getTurn(actor, runId),
      getRunWorkspace(actor, runId),
      listRunClaims(actor, runId),
    ])
  } catch (error) {
    if (!isAppError(error)) throw error
    // The window closed between the read above and this one, or the response landed in another
    // tab. The run's own next step is the answer, not an error boundary.
    // `ILLEGAL_TRANSITION` is what `workspaceNotOpen` raises, so the two reads answer the same
    // fact with two codes; both mean the same thing here, which is that the run has moved.
    if (
      error.code === 'TURN_NOT_OPEN' ||
      error.code === 'ILLEGAL_TRANSITION' ||
      error.code === 'RUN_LOCKED'
    ) {
      redirect(next)
    }
    if (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN') notFound()
    throw error
  }

  const windowClaims = claims.filter((claim) => claim.inTurnWindow)
  const arrivedAt = status.run.timestamps.turnDeliveredAt
  // Which assistant answers in the window (D-691), read once on the server as the workspace does.
  const assistantMode = await effectiveAssistantMode()

  return (
    <>
      <PageHeader title={t('turn.title')} description={t('turn.description')} />

      <RunWorkProvider>
        <div className="grid gap-6 2xl:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] 2xl:items-start">
          <div className="flex min-w-0 flex-col gap-6">
            <Panel
              id="turn-message"
              title={t('turn.messageTitle')}
              headingLevel={2}
              padding="reading"
              actions={
                // The voice is a fact about the form the news took, not a judgement of it. `Badge`
                // rather than `LabelChip`: LabelChip's ten kinds are product labels with fixed
                // wording and a semantic fill, and the voice is an ad-hoc tag, which is exactly what
                // DESIGN.md §Chips reserves Badge for. `secondary` is the sunken wash with ink text,
                // so it carries no semantic colour and spends none of the screen's one accent.
                <Badge variant="secondary">{VOICE_LABELS[turn.voice]}</Badge>
              }
            >
              <div className="flex flex-col gap-3">
                {/* The Turn verbatim, in the voice of the world (FR-110). Nothing frames it, nothing
                    summarizes it, and nothing says what it means. */}
                <p className="text-ink text-reading max-w-measure whitespace-pre-line">
                  {turn.text}
                </p>
                {arrivedAt !== null && (
                  <p className="text-ink-muted text-meta">
                    <time dateTime={arrivedAt}>
                      {t('turn.messageArrivedAt', { when: formatDateTime(arrivedAt) })}
                    </time>
                  </p>
                )}
              </div>
            </Panel>

            <Panel
              id="turn-claims"
              title={t('turn.claimsTitle')}
              {...(windowClaims.length === 0 ? {} : { description: t('turn.claimsDescription') })}
              headingLevel={2}
            >
              {windowClaims.length === 0 ? (
                <EmptyState
                  headingLevel={3}
                  title={t('turn.claimsNoneTitle')}
                  body={t('turn.claimsNoneBody')}
                />
              ) : (
                <ul className="flex flex-col gap-4">
                  {windowClaims.map((claim) => (
                    <li key={claim.id}>
                      <ClaimCard
                        claim={claim}
                        headingLevel={3}
                        stanceControl={
                          <ClaimControls
                            runId={turn.run.id}
                            claim={claim}
                            canWrite={workspace.capabilities.assistantUnlocked}
                            documents={workspace.documents}
                          />
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <TurnPanel
              runId={turn.run.id}
              claims={windowClaims.map((claim) => ({ id: claim.id, text: claim.text }))}
            />
          </div>

          {/* What the student may look at while they decide. An `aside` because it is reference
              rather than the work (09 §6), and it comes after the act in the reading order at every
              width — which is what one column under `2xl` makes literal (D-310). */}
          <aside aria-label={t('turn.referenceRegion')} className="flex min-w-0 flex-col gap-6">
            {/* The column's own caption, above the two panels it describes rather than under them:
                FR-111 reopens the room and the assistant for the window, and what changes is which
                clock a check spends. It is a line of prose on paper, not a third panel — DESIGN.md
                separates sections with whitespace, never with another container. */}
            <p className="text-ink-muted text-reading max-w-measure">{t('turn.reopenedNote')}</p>

            <Panel
              id="turn-frozen"
              title={t('turn.frozenTitle')}
              description={t('turn.frozenDescription')}
              headingLevel={2}
              padding="reading"
            >
              <FrameBesideDecision
                frame={turn.frozen.frame}
                brief={turn.frozen.brief}
                namedFields={turn.namedFields}
              />
            </Panel>

            <EvidenceRoom
              runId={turn.run.id}
              documents={workspace.documents}
              openDocuments={workspace.openDocuments}
              canOpen={workspace.capabilities.canOpenDocuments}
            />

            <AssistantPanel
              runId={turn.run.id}
              canDelegate={workspace.capabilities.assistantUnlocked}
              claims={claims}
              documents={workspace.documents}
              lockedReason={
                workspace.capabilities.assistantUnlocked
                  ? undefined
                  : t('workspace.assistantPaused')
              }
              submitVariant="secondary"
              assistantMode={assistantMode}
            />

            {/* FR-061 puts the outside-tool declaration on every working-period screen, and the
                Turn window is one: the room and the assistant are open again, and so is whatever
                else the student reaches for. The same control the workspace draws, under the
                assistant it sits beside there. */}
            <DeclarationControl runId={turn.run.id} />
          </aside>
        </div>
      </RunWorkProvider>

      {workspace.pause !== null && (
        <PausedOverlay runId={turn.run.id} cause={workspace.pause.cause} />
      )}
    </>
  )
}
