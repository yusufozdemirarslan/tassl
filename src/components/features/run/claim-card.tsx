'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { FormAlert } from '@/components/features/account/form-feedback'
import { LabelChip } from '@/components/layout/label-chip'
import { Button } from '@/components/ui/button'
import { t } from '@/lib/i18n/messages/workspace'
import { runActionAction } from '@/server/modules/reliance/actions'
import type {
  ActionResult,
  ActionTypeValue,
  ClaimView,
  EscalationResult,
} from '@/server/modules/reliance/schema'
import {
  ACTION_LABELS,
  ActionResultSheet,
  ActionsMenu,
  type TracedDocument,
} from './action-result-sheet'
import { EscalationDialog } from './escalation-dialog'
import { useRunWork } from './run-work-context'
import { StanceControl } from './stance-control'
import { StanceChip } from './stance-chip'
import { useRefresh } from '@/lib/hooks/use-refresh'

// UI-023: one claim object, as the student meets it (FR-051, FR-052, DATA-033).
//
// **The card says nothing about the claim.** It carries the author's text, character for character,
// and around it: which claim it is, the stance the student has taken on it, and whether they marked
// it used. There is no reliability mark, no source badge, no "verified" tick, no confidence, and no
// ordering by anything the product knows — the evidence status, the failure family, the warranted
// stance and the planted flag are not in the payload that reaches this file and are not shown to a
// student before their run is scored (12 §8.1, CLAIM invariants in CLAUDE.md). What a claim
// deserved is the debrief's to say, afterwards.
//
// **The one mark it does draw is about the student's own record** (D-319). `reliedOn` is set by
// their acts and by nothing an author wrote — a used mark in the log, a figure of theirs matching a
// claim's at the lock, a claim the Turn put in front of them — so a claim they leaned on with no
// stance on it wears "No stance yet". It is the same fact FR-084's refusal carries, said where it
// can still be acted on cheaply instead of at the irreversible press.
//
// It is an `article` with a heading because that is what it is: a discrete object a student reads,
// positions themselves on, and comes back to. UI-023 asks for exactly that, and it is what lets a
// screen-reader user step through a reply by heading and land on each claim rather than on one wall
// of prose. `data-claim-id` and a `-1` tabindex go on the copy that carries the controls and on no
// other: the Decision Lock's refusal names a claim and offers "Go to the claim" (UI-024, D-306),
// and that control must land on the card that can answer it rather than on whichever copy the
// document happened to reach first.
//
// **It is not a card inside a card.** DESIGN.md's One-Layer Rule keeps raised, bordered surfaces
// from nesting, and this always renders inside a `Panel`. So the claim object reads as a sunken
// well — the same paper the product uses for a highlight — with no border and no shadow.
//
// The stance control is a *slot*, and `ClaimControls` below is what fills it. The two are separate
// because a claim is drawn in two places: inside the assistant's live reply, and in the Delegation
// Log, which is server-rendered and therefore the copy that survives a reload. Only one of them
// carries the instrument at a time — the reply while it is holding the claim, the log otherwise
// (`run-work-context.tsx`, D-313) — and a card with no controls passed still draws, which is also
// the Turn's read-only record and the reviewer's replay.

export type ClaimCardProps = {
  claim: Pick<ClaimView, 'id' | 'key' | 'text' | 'stance' | 'usedMarked' | 'reliedOn'>
  /** `ClaimControls`, or a mark control a caller supplies. Absent, the seat draws nothing. */
  stanceControl?: ReactNode
  /** Controls that belong to the card's own header rather than to the claim: the used mark. */
  actions?: ReactNode
  /** Where the claim is worked, when it is not worked here (`workspace.claimWorkedInReply`). */
  deferredNote?: string
  /** A card under a panel's h2 is an h3; a card nested inside another section is an h4. */
  headingLevel?: 3 | 4
}

export function ClaimCard({
  claim,
  stanceControl,
  actions,
  deferredNote,
  headingLevel = 3,
}: ClaimCardProps) {
  const headingId = useId()
  const Heading = `h${headingLevel}` as const
  // The copy that can answer the Decision Lock's refusal is the copy that carries the controls.
  const anchored = stanceControl !== undefined

  return (
    <article
      aria-labelledby={headingId}
      {...(anchored ? { 'data-claim-id': claim.id, tabIndex: -1 } : {})}
      className="bg-paper-sunken focus-visible:outline-focus flex flex-col gap-3 rounded-md p-4 focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Heading id={headingId} className="text-mono-sm text-ink-muted font-mono">
          {t('workspace.claimHeading', { key: claim.key })}
        </Heading>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {/* The read-only mark, and only where there is no control: a card carrying both would
              show the stance twice, and the chip is the copy that goes stale. */}
          {stanceControl === undefined && claim.stance !== null && (
            <StanceChip stance={claim.stance} />
          )}
          {/* The student's own record, drawn before the lock rather than by it (FR-084, D-319).
              The amber warning chip is DESIGN.md's provisional mark and takes its own wording. */}
          {claim.reliedOn && claim.stance === null && (
            <span className="inline-flex items-center">
              <LabelChip kind="warning" label={t('workspace.claimNeedsStance')} />
              <span className="sr-only"> {t('workspace.claimNeedsStanceExplain')}</span>
            </span>
          )}
          {claim.usedMarked && (
            <span className="inline-flex items-center">
              <LabelChip kind="used" />
              <span className="sr-only"> {t('workspace.claimUsedExplain')}</span>
            </span>
          )}
          {actions}
        </div>
      </div>

      {/* The author's words, and the one thing on this screen a student may treat as evidence. */}
      <p className="text-ink text-reading max-w-measure">{claim.text}</p>

      {deferredNote !== undefined && (
        <p className="text-ink-muted text-meta max-w-measure">{deferredNote}</p>
      )}

      {stanceControl}
    </article>
  )
}

// ---------------------------------------------------------------------------------------------
// The three acts a student performs on a claim (FR-070 to FR-073, FR-080, FR-090 to FR-092)
// ---------------------------------------------------------------------------------------------

/**
 * What an escalation took, read off the charge that was applied rather than off the price list.
 *
 * Five minutes in every ordinary case, and not when the clock had less than five left: `chargeCost`
 * applies what there was and the escalation still completes (FR-072). What the student is told is
 * what came off their clock.
 */
function escalationCostSentence(clockCostMs: number): string {
  const minutes = Math.round(clockCostMs / 60_000)
  if (minutes === 0) return t('workspace.escalationCostPartial')
  if (minutes === 1) return t('workspace.escalationCostOne')
  return t('workspace.escalationCost', { minutes })
}

/**
 * The two clock-spending controls, in the register DESIGN.md's accent rule leaves them.
 *
 * "Keep one accent per screen: teal for the action the visitor is there to take." The act being
 * assessed on a claim is the stance, and the teal used to sit on the two controls that *spend* the
 * clock while the five stance chips sat in ink on white — the screen was pointing at its costs
 * (D-323). So the checks and the escalation take the ghost treatment with a control hairline: they
 * keep their target, their boundary and their focus ring, and the accent goes to the stance group,
 * where an unanswered claim now wears it. The hover lifts to raised paper rather than to the sunken
 * wash, because the claim card *is* the sunken wash.
 */
const WELL_CONTROL = 'border-line-control bg-transparent hover:bg-paper-raised'

export type ClaimControlsProps = {
  runId: string
  /** The claim as the page last read it; the controls hold the changes they make to it. */
  claim: ClaimView
  /** `capabilities.assistantUnlocked` in practice: false while the run is paused (10 §8). */
  canWrite: boolean
  /**
   * The Evidence Room's documents, so a Source Trace can name the document it leads to.
   *
   * The stored result points at it by id, and a uuid is not an answer to "where did this come
   * from": the room already lists every document by key and title, and this is the same list.
   */
  documents?: readonly TracedDocument[]
  /**
   * The id of the panel's one copy of the stance hint (D-314).
   *
   * The sentence under the chips never changes, and a reply with three claims drew it three times
   * while the log drew it once per claim of every delegation. The panel draws it once and every
   * radio group in the panel points at that one paragraph; a control drawn outside a panel that
   * hoists it keeps its own.
   */
  stanceHintId?: string | undefined
}

/**
 * The stance, the checks and the escalation, under one claim.
 *
 * **The claim is held here, and re-seeded whenever the page hands over a different one.** The same
 * claim is drawn twice on this workspace — inside the assistant's live reply, which is client state,
 * and in the Delegation Log, which the server renders — and a stance taken on one of them is one act
 * on one record. So each write updates what is on screen at once and then asks for the page again
 * (`refresh()`), and the copy that did not take the act learns from that render. Holding the
 * prop identity as the seed is what makes the second half work: a server render hands over a new
 * object, this resets to it, and a re-render caused by anything else does not.
 *
 * The refresh is also how the clock stays honest. A check costs a minute and an escalation five, and
 * the number in the RunFrame is materialized on read from the server's own timestamps (D-042) — so
 * asking the page for the reading is the rule for every timer in the product, and doing the
 * arithmetic here would be a second opinion about it.
 *
 * **Nothing here announces on its own.** Every sentence a claim act produces goes to the screen's
 * one polite region (`run-work-context.tsx`, D-314); a busy reply used to carry a live region per
 * claim, and three of them could speak at once with nobody owning the order.
 */
export function ClaimControls({
  runId,
  claim,
  canWrite,
  documents = [],
  stanceHintId,
}: ClaimControlsProps) {
  const refresh = useRefresh()
  const spentId = useId()
  const { announce } = useRunWork()
  const [held, setHeld] = useState<ClaimView>(claim)
  const [seed, setSeed] = useState<ClaimView>(claim)
  if (seed !== claim) {
    setSeed(claim)
    setHeld(claim)
  }

  const [reading, setReading] = useState<ActionResult | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [running, setRunning] = useState(false)
  const [escalating, setEscalating] = useState(false)
  const [failed, setFailed] = useState<{ message: string; requestId?: string } | null>(null)

  const actions: readonly ActionResult[] = held.actions
  const escalation: EscalationResult | null = held.escalation
  const remaining = held.remainingEscalations

  // Where the caret goes when the escalation lands (D-500). Sending it closes the dialog *and*
  // removes the "Escalate" control the dialog would otherwise hand focus back to — the trigger is
  // drawn only while `escalation === null` — so the student was left on `document.body`, from which
  // WebKit's Tab moves nothing at all. The answer they just paid five minutes of clock for is the
  // honest destination: it is what the press produced, it carries its own accessible name, and it
  // is where a sighted student's eye goes anyway.
  //
  // The move is made only when the caret has actually been dropped. That is one test for two rules:
  // an engine that put focus somewhere real is not fought, and a student who moved on while the
  // colleague was answering keeps the place they chose.
  const answer = useRef<HTMLElement>(null)
  const hadEscalation = useRef(escalation !== null)
  useEffect(() => {
    const before = hadEscalation.current
    hadEscalation.current = escalation !== null
    if (before || escalation === null) return
    if (document.activeElement !== null && document.activeElement !== document.body) return
    answer.current?.focus()
  }, [escalation])

  function run(type: ActionTypeValue): void {
    if (running || !canWrite) return
    setRunning(true)
    setFailed(null)
    void runActionAction({ runId, claimId: claim.id, type }).then(
      (result) => {
        setRunning(false)
        if (!result.ok) {
          setFailed({
            message: result.error.message || t('workspace.actionFailed'),
            requestId: result.error.requestId,
          })
          return
        }
        setHeld((current) => ({ ...current, actions: [...current.actions, result.data] }))
        setReading(result.data)
        setSheetOpen(true)
        announce(
          t('workspace.actionRan', {
            action: ACTION_LABELS[result.data.type](),
            key: claim.key,
          }),
        )
        // The charge landed on the clock; the band above reads it from the server (D-042).
        refresh()
      },
      () => {
        setRunning(false)
        setFailed({ message: t('workspace.actionFailed') })
      },
    )
  }

  return (
    <div className="border-line flex flex-col gap-4 border-t pt-3">
      <StanceControl
        runId={runId}
        claim={held}
        canWrite={canWrite}
        hintId={stanceHintId}
        onChanged={(next) => {
          setHeld(next)
          // The same claim is drawn in the assistant's reply and in the log; the copy that did not
          // take the stance learns from this render (see the header).
          refresh()
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        {held.availableActions.length > 0 ? (
          <ActionsMenu
            claimKey={claim.key}
            available={held.availableActions}
            canWrite={canWrite}
            running={running}
            onRun={run}
            className={WELL_CONTROL}
          />
        ) : (
          <p className="text-ink-muted text-meta">{t('workspace.actionsNone')}</p>
        )}

        {/* The last check, reopened without paying for it again: the result is stored on the run
            and re-reading it costs nothing (FR-070 charges the check, not the reading). */}
        {actions.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            className={WELL_CONTROL}
            onClick={() => {
              setReading(actions[actions.length - 1] ?? null)
              setSheetOpen(true)
            }}
          >
            {t('workspace.actionsReadAgain')}
          </Button>
        )}

        {/* `canEscalate` is the run's remaining escalations and never the claim's authored
            `escalatable`, which no student view carries (D-244). It is therefore the same on every
            card in the run, which is what keeps it from saying anything about this claim. */}
        {escalation === null && (
          <Button
            type="button"
            variant="ghost"
            className={WELL_CONTROL}
            aria-label={t('workspace.escalateFor', { key: claim.key })}
            aria-disabled={canWrite && remaining > 0 ? undefined : true}
            // A control that stays reachable says why it is refusing (DESIGN.md §Buttons): the run
            // has spent both of its escalations, which is a fact about the run and not about this
            // claim.
            aria-describedby={remaining === 0 ? spentId : undefined}
            onClick={() => {
              if (!canWrite || remaining === 0) return
              setEscalating(true)
            }}
          >
            {t('workspace.escalate')}
          </Button>
        )}
      </div>

      {escalation === null && remaining === 0 && (
        <p id={spentId} className="text-ink-muted text-meta">
          {t('workspace.escalateNoneLeft')}
        </p>
      )}

      {failed !== null && (
        <FormAlert
          message={failed.message}
          reference={
            failed.requestId === undefined
              ? undefined
              : { label: t('workspace.errorReference'), id: failed.requestId }
          }
        />
      )}

      {escalation !== null && (
        <section
          ref={answer}
          tabIndex={-1}
          aria-label={t('workspace.escalationTitle')}
          className="border-line focus-visible:outline-focus flex flex-col gap-2 border-t pt-3 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {/* Labelled paragraphs rather than headings: the section is already named, and
              DESIGN.md's Descending-Heading Rule puts the rung below h5 in bold body rather than
              in a heading set smaller than the prose it introduces. */}
          <p className="text-ink-muted text-meta font-medium">
            {t('workspace.escalationYouWrote')}
          </p>
          {/* Their own sentence, kept beside the answer it bought (D-318). */}
          <p className="text-ink text-reading max-w-measure">{escalation.statement}</p>
          <p className="text-ink-muted text-meta font-medium">
            {t('workspace.escalationAnswered')}
          </p>
          <p className="text-ink text-reading max-w-measure whitespace-pre-line">
            {escalation.responseText}
          </p>
          <p className="text-ink-muted text-meta">
            {escalationCostSentence(escalation.clockCostMs)}
          </p>
        </section>
      )}

      <ActionResultSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        claimKey={claim.key}
        action={reading}
        documents={documents}
      />

      {escalating && (
        <EscalationDialog
          open={escalating}
          onOpenChange={setEscalating}
          runId={runId}
          claimId={claim.id}
          claimKey={claim.key}
          remainingEscalations={remaining}
          canWrite={canWrite}
          onEscalated={(result) => {
            setHeld((current) => ({
              ...current,
              escalation: result,
              remainingEscalations: result.remainingEscalations,
              canEscalate: result.remainingEscalations > 0,
              // `escalate` sets the stance where the student had not already (D-285), so the
              // control beside this reads the same record the server now holds.
              stance: current.stance === 'escalate' ? current.stance : 'escalate',
              previousStance:
                current.stance === 'escalate' ? current.previousStance : current.stance,
            }))
            announce(t('workspace.escalationDone', { key: claim.key }))
            // Five minutes came off the clock; the band above reads it from the server.
            refresh()
          }}
        />
      )}
    </div>
  )
}
