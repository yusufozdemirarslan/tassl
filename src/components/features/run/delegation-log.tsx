'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2Icon } from 'lucide-react'
import { FormAlert } from '@/components/features/account/form-feedback'
import { EmptyState } from '@/components/layout/empty-state'
import { Panel } from '@/components/layout/panel'
import { LabelChip } from '@/components/layout/label-chip'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/cn'
import { t } from '@/lib/i18n/messages/workspace'
import type { DelegationClaim, DelegationView } from '@/server/modules/assistant/schema'
import { updateDelegationAction } from '@/server/modules/assistant/actions'
import type { ClaimView } from '@/server/modules/reliance/schema'
import { AssistantProse } from './assistant-panel'
import type { TracedDocument } from './action-result-sheet'
import { ClaimCard, ClaimControls } from './claim-card'
import { useRunWork } from './run-work-context'
import { StanceChip } from './stance-chip'
import { useRefresh } from '@/lib/hooks/use-refresh'

// UI-023: the Delegation Log (FR-060, FR-063, FR-084).
//
// One entry per request, as a unit of work: what was asked, what came back, which claims resulted,
// which of them the student marked used, and the one line they write about why they asked. It is
// the record their instructor reads beside the rest of the run, and it is the only place in the
// product where reliance is declared by hand.
//
// Three rules the controls here follow, and each is a product rule rather than a UI preference.
//
//   * **A used mark is permanent** (D-270). FR-084 refuses the Decision Lock when a claim the
//     student relied on carries no stance, so a control that took a mark back would be a way past
//     that gate rather than through it. The mark is therefore a press, not a toggle, and the
//     sentence beside it says so *before* it is pressed.
//   * **A used mark is additive, so this screen never has to reconcile.** What was marked in this
//     session is unioned with what the server sent; a mark cannot disappear from either side, so
//     the two can never disagree in a way a refresh would have to settle.
//   * **The why line is the student's own and changes nothing else.** It writes no trace event —
//     the `delegation` event was written when the reply landed and is immutable, and carries the
//     why line as it stood then (D-272). Editing it here edits the row the log reads.
//
// **A claim is worked in one place at a time** (D-313). Every claim of every delegation used to
// carry the full instrument here *and* in the assistant's reply — nine affordances twice over on
// one claim, with nothing to say which copy counted. While the reply is holding a claim, this log
// draws it as the record and says where it is being worked; the moment the reply moves on or the
// page is reloaded, this is the instrument again, which is the durability D-303 put the controls
// here for.
//
// The two sentences that never change are drawn once for the panel rather than once per claim: the
// stance hint and the used note (D-314). Three delegations of three claims each carried nine copies
// of the first and three of the second.
//
// The log shows the reply as it was stored: the guarded prose with the claim objects in place. The
// `[[claim:<id>]]` markers that separate the two are a wire detail and are taken out for reading —
// the claim's own text stays exactly where the assistant put it, and the claims list beneath is
// about marking them, not re-reading them.
//
// The other marker in a stored reply is **kept**. `[[figure:…]]` is where the numeric guard found a
// number no claim, document or request sourced (D-068, D-281), and `AssistantProse` draws it here
// exactly as the assistant panel drew it live — which is the point of storing it in `response_text`
// rather than beside it: the log, and the faculty seat's replay of the same row, show the reply the
// student read rather than a tidier one. It is not a mark on a claim (a claim's own figures are in
// its own text, which no guard reads), and the reviewer's list of the same figures still travels
// where D-269 put it, in `unverifiedNumbers`, which a student's payload does not carry.

/** 10 §7's limit on the why line, restated: a client component imports no module schema value. */
const WHY_MAX_CHARS = 200

/**
 * The marker `assistant-reply@5` writes around a claim object (11 §2.1), removed for reading.
 *
 * It is restated here rather than imported because `src/server/llm` is not reachable from a
 * component (the `boundaries` policy) — and because it is a fact about the wire format the log
 * receives, which is exactly the kind of thing a reader of this file needs in front of them.
 *
 * Only this one is removed. `[[figure:…]]` is left in the text for `AssistantProse` to draw.
 */
const CLAIM_MARKER = /\[\[claim:[^\]]+\]\] ?/g

/** The panel's one copy of the stance hint; every radio group inside it points here (D-314). */
const STANCE_HINT_ID = 'delegation-log-stance-hint'

export type DelegationLogProps = {
  runId: string
  /** `GET /runs/{runId}/delegations` (07 §7), in the order the run made them. */
  delegations: readonly DelegationView[]
  /**
   * `GET /runs/{runId}/claims` (07 §7): every claim this run has surfaced, as its own student
   * reads it (D-303).
   *
   * The log is where a stance survives a reload. The assistant panel draws the reply it is holding
   * right now and holds one at a time, so the cards in it are gone the moment the next request is
   * sent — while this list is read on the server for every render and carries every claim the run
   * has ever surfaced. A claim with a `ClaimView` here gets the same controls it had in the reply;
   * one without keeps the read-only row, which is what a claim of a *failed* delegation is.
   *
   * It is also what the Decision Lock's "Go to the claim" reaches: the refusal names a claim that
   * may have been surfaced twenty minutes ago, and this is the copy that is still on the page.
   */
  claims?: readonly ClaimView[]
  /** The Evidence Room's documents, so a Source Trace can name the document it leads to. */
  documents?: readonly TracedDocument[]
  /** The log is written to in `working` and `turn_open` alone (10 §7); false while paused. */
  canWrite: boolean
  /** Why it cannot be written to, when it cannot. */
  readOnlyNote?: string | undefined
}

export function DelegationLog({
  runId,
  delegations,
  claims = [],
  documents = [],
  canWrite,
  readOnlyNote,
}: DelegationLogProps) {
  // The why lines the student has touched in this session, and the claims they have marked used.
  // Both are keyed by id and both only ever grow, so a fresh server render can be rendered against
  // them without either side having to win.
  const refresh = useRefresh()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [marked, setMarked] = useState<readonly string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [failed, setFailed] = useState<{ message: string; requestId?: string } | null>(null)
  const { worked, announce } = useRunWork()

  // Where the caret goes when a "Mark used" removes itself (D-500). The mark is drawn by the claim
  // itself from `usedMarked`, so this control is the one that has not been pressed yet and nothing
  // once it has — which left a keyboard user on `document.body`, and from there WebKit's Tab moves
  // nothing at all while the other two engines restart at the top of a workspace many viewports
  // tall. The claim's own card is the destination: it already carries `tabIndex={-1}` and the
  // `data-claim-id` anchor the Decision Lock's "Go to the claim" lands on, it is where the `used`
  // chip has just appeared, and its heading names the claim that was marked.
  //
  // Only when the caret was actually dropped, so an engine that put it somewhere real is not
  // fought and a student who moved on while the write was in flight keeps their place.
  const homeTo = useRef<string | null>(null)
  useEffect(() => {
    const claimId = homeTo.current
    if (claimId === null) return
    homeTo.current = null
    if (document.activeElement !== null && document.activeElement !== document.body) return
    document.querySelector<HTMLElement>(`[data-claim-id="${CSS.escape(claimId)}"]`)?.focus()
  }, [marked])

  function markUsed(delegationId: string, claimId: string): void {
    if (busy !== null || !canWrite) return
    setBusy(`used:${claimId}`)
    setFailed(null)
    void updateDelegationAction({ runId, delegationId, usedClaimIds: [claimId] }).then(
      (result) => {
        setBusy(null)
        if (!result.ok) {
          const message = result.error.message || t('workspace.logWriteFailed')
          setFailed({ message, requestId: result.error.requestId })
          announce(message)
          return
        }
        homeTo.current = claimId
        setMarked((held) => (held.includes(claimId) ? held : [...held, claimId]))
        announce(t('workspace.claimUsedExplain'))
        // A used mark is one of FR-084's three routes into `relied_on_via`, so it changes what the
        // Decision Lock will ask for — and the screen now says that before the press: the claim
        // wears "No stance yet" and the lock carries a count (D-319). Both are read on the server,
        // so this write asks for the page again. The why line does not: it changes no rule, and the
        // reason the actions revalidate nothing is that a workspace re-render should be earned.
        refresh()
      },
      () => {
        setBusy(null)
        setFailed({ message: t('workspace.logWriteFailed') })
        announce(t('workspace.logWriteFailed'))
      },
    )
  }

  function saveWhy(delegationId: string, why: string): void {
    if (busy !== null || !canWrite) return
    setBusy(`why:${delegationId}`)
    setFailed(null)
    setSaved(null)
    void updateDelegationAction({ runId, delegationId, why }).then(
      (result) => {
        setBusy(null)
        if (!result.ok) {
          const message = result.error.message || t('workspace.logWriteFailed')
          setFailed({ message, requestId: result.error.requestId })
          announce(message)
          return
        }
        setSaved(delegationId)
        announce(t('workspace.logWhySaved'))
      },
      () => {
        setBusy(null)
        setFailed({ message: t('workspace.logWriteFailed') })
        announce(t('workspace.logWriteFailed'))
      },
    )
  }

  return (
    <Panel
      id="delegation-log"
      title={t('workspace.logTitle')}
      description={t('workspace.logDescription')}
      headingLevel={2}
    >
      {!canWrite && readOnlyNote !== undefined && (
        <p id="delegation-log-readonly" className="text-ink-muted text-body mb-3">
          {readOnlyNote}
        </p>
      )}

      {/* The two sentences every claim in this panel is governed by, said once (D-314). D-270's is
          here rather than under each delegation's claims because a mark is permanent and the
          sentence has to be read *before* a press, which is what putting it at the head does. */}
      {delegations.length > 0 && (
        <div className="mb-4 flex flex-col gap-1">
          <p className="text-ink-muted text-meta max-w-measure">{t('workspace.logUsedNote')}</p>
          <p id={STANCE_HINT_ID} className="text-ink-muted text-meta max-w-measure">
            {t('workspace.stanceHint')}
          </p>
        </div>
      )}

      {failed !== null && (
        <div className="mb-3">
          <FormAlert
            message={failed.message}
            reference={
              failed.requestId === undefined
                ? undefined
                : { label: t('workspace.errorReference'), id: failed.requestId }
            }
          />
        </div>
      )}

      {delegations.length === 0 ? (
        <EmptyState
          title={t('workspace.logEmptyTitle')}
          body={t('workspace.logEmptyBody')}
          headingLevel={3}
        />
      ) : (
        <ol className="flex flex-col">
          {delegations.map((entry) => (
            <li
              key={entry.id}
              className="border-line border-t py-4 first:border-t-0 first:pt-0 last:pb-0"
            >
              <LogEntry
                entry={entry}
                runId={runId}
                claims={claims}
                documents={documents}
                worked={worked}
                canWrite={canWrite}
                readOnlyId={
                  !canWrite && readOnlyNote !== undefined ? 'delegation-log-readonly' : undefined
                }
                marked={marked}
                draft={drafts[entry.id]}
                onDraft={(why) => {
                  setDrafts((held) => ({ ...held, [entry.id]: why }))
                  if (saved === entry.id) setSaved(null)
                }}
                busy={busy}
                saved={saved === entry.id}
                onMarkUsed={(claimId) => {
                  markUsed(entry.id, claimId)
                }}
                onSaveWhy={(why) => {
                  saveWhy(entry.id, why)
                }}
              />
            </li>
          ))}
        </ol>
      )}
    </Panel>
  )
}

type LogEntryProps = {
  entry: DelegationView
  runId: string
  claims: readonly ClaimView[]
  documents: readonly TracedDocument[]
  /** Claim ids the assistant's reply is currently drawing with controls (D-313). */
  worked: readonly string[]
  canWrite: boolean
  readOnlyId: string | undefined
  marked: readonly string[]
  draft: string | undefined
  onDraft: (why: string) => void
  busy: string | null
  saved: boolean
  onMarkUsed: (claimId: string) => void
  onSaveWhy: (why: string) => void
}

function LogEntry({
  entry,
  runId,
  claims,
  documents,
  worked,
  canWrite,
  readOnlyId,
  marked,
  draft,
  onDraft,
  busy,
  saved,
  onMarkUsed,
  onSaveWhy,
}: LogEntryProps) {
  const headingId = `delegation-${entry.id}-title`
  const claimsId = `delegation-${entry.id}-claims`
  const whyId = `delegation-${entry.id}-why`
  const why = draft ?? entry.why ?? ''
  const over = why.length > WHY_MAX_CHARS
  const savingWhy = busy === `why:${entry.id}`
  const answer = entry.responseText.replace(CLAIM_MARKER, '')

  return (
    <article aria-labelledby={headingId} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id={headingId} className="text-h4">
          {t('workspace.logEntryTitle', { seq: entry.seq })}
        </h3>
        {entry.inTurnWindow && <Badge variant="secondary">{t('workspace.logInTurnWindow')}</Badge>}
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-ink-muted text-meta font-medium">{t('workspace.logAsked')}</p>
        <p className="text-ink text-body max-w-measure whitespace-pre-line">{entry.requestText}</p>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-ink-muted text-meta font-medium">{t('workspace.logAnswered')}</p>
        {entry.failed ? (
          <p className="text-ink-muted text-body max-w-measure">{t('workspace.logFailed')}</p>
        ) : (
          <AssistantProse text={answer} />
        )}
      </div>

      {!entry.failed && (
        <div className="flex flex-col gap-2">
          <h4 id={claimsId} className="text-ink-muted text-meta font-medium">
            {t('workspace.logClaimsTitle')}
          </h4>
          {entry.claims.length === 0 ? (
            <p className="text-ink-muted text-body">{t('workspace.logNoClaims')}</p>
          ) : (
            <ul aria-labelledby={claimsId} className="flex flex-col gap-3">
              {entry.claims.map((claim) => (
                <ClaimRow
                  key={claim.id}
                  claim={claim}
                  runId={runId}
                  documents={documents}
                  view={claims.find((candidate) => candidate.id === claim.id)}
                  workedInReply={worked.includes(claim.id)}
                  used={claim.usedMarked || marked.includes(claim.id)}
                  canWrite={canWrite}
                  readOnlyId={readOnlyId}
                  busy={busy === `used:${claim.id}`}
                  onMarkUsed={() => {
                    onMarkUsed(claim.id)
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      <Field data-invalid={over ? 'true' : undefined}>
        <FieldLabel htmlFor={whyId}>{t('workspace.logWhyLabel')}</FieldLabel>
        <Textarea
          id={whyId}
          rows={2}
          value={why}
          aria-label={t('workspace.logWhyLabelFor', { seq: entry.seq })}
          aria-invalid={over ? true : undefined}
          aria-describedby={`${over ? `${whyId}-error` : `${whyId}-hint`} ${whyId}-count`}
          onChange={(event) => {
            onDraft(event.target.value)
          }}
          className={cn('max-w-measure', over && 'border-red')}
        />
        <div className="max-w-measure flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="min-w-0 flex-1">
            {over ? (
              <FieldError id={`${whyId}-error`}>
                {t('workspace.logWhyTooLong', { limit: WHY_MAX_CHARS })}
              </FieldError>
            ) : (
              <FieldDescription id={`${whyId}-hint`}>
                {t('workspace.logWhyHint', { limit: WHY_MAX_CHARS })}
              </FieldDescription>
            )}
          </div>
          <span
            id={`${whyId}-count`}
            className={cn(
              'text-mono-sm shrink-0 font-mono tabular-nums',
              over ? 'text-red' : 'text-ink-muted',
            )}
          >
            {t('workspace.assistantCharCount', { count: why.length, limit: WHY_MAX_CHARS })}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            aria-disabled={savingWhy || over || !canWrite ? true : undefined}
            aria-busy={savingWhy}
            aria-describedby={!canWrite ? readOnlyId : undefined}
            onClick={() => {
              if (over) return
              onSaveWhy(why)
            }}
          >
            {savingWhy && <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />}
            {savingWhy ? t('workspace.logWhySaving') : t('workspace.logWhySave')}
          </Button>
          {/* The save's own line, on screen beside the control it belongs to. It is not a live
              region: the screen has one and this sentence was already said into it (D-314). */}
          <p id={`${whyId}-status`} className="text-ink-muted text-meta empty:hidden">
            {saved && !savingWhy ? t('workspace.logWhySaved') : null}
          </p>
        </div>
      </Field>
    </article>
  )
}

type ClaimRowProps = {
  claim: DelegationClaim
  runId: string
  documents: readonly TracedDocument[]
  /** The run's own view of this claim, when it has one: the stance, the checks, the escalation. */
  view: ClaimView | undefined
  /** The assistant's reply is holding this claim, so it carries the instrument and this does not. */
  workedInReply: boolean
  used: boolean
  canWrite: boolean
  readOnlyId: string | undefined
  busy: boolean
  onMarkUsed: () => void
}

/**
 * One claim of one delegation: which claim it is, what it says, the used mark, and — when the run's
 * claim list carries it — the stance, the checks and the escalation.
 *
 * The controls are here as well as in the assistant's reply because this is the copy that lasts. A
 * reply is client state and there is one at a time, so the cards in the panel are gone as soon as
 * the next request is sent; the log is read from the server on every render and holds every claim
 * the run has surfaced. It is also the anchor `data-claim-id` gives the Decision Lock's refusal.
 *
 * A claim with no `ClaimView` keeps the plain row it always had. That is not a fallback so much as
 * the honest rendering of the one case it happens in: a delegation whose reply never landed still
 * lists what it would have raised, and there is nothing to take a position on.
 */
function ClaimRow({
  claim,
  runId,
  documents,
  view,
  workedInReply,
  used,
  canWrite,
  readOnlyId,
  busy,
  onMarkUsed,
}: ClaimRowProps) {
  // The mark itself is drawn by `ClaimCard` from the claim's own `usedMarked`; this seat carries
  // the control that has not been pressed yet, and nothing once it has.
  const mark = used ? null : (
    <Button
      type="button"
      variant="secondary"
      aria-label={t('workspace.logMarkUsedFor', { key: claim.key })}
      aria-disabled={busy || !canWrite ? true : undefined}
      aria-busy={busy}
      aria-describedby={!canWrite ? readOnlyId : undefined}
      onClick={onMarkUsed}
    >
      {busy && <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />}
      {t('workspace.logMarkUsed')}
    </Button>
  )

  if (view === undefined) {
    return (
      <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-48">
          <p className="text-mono-sm text-ink-muted font-mono">
            {t('workspace.claimHeading', { key: claim.key })}
          </p>
          <p className="text-ink text-body max-w-measure mt-0.5">{claim.text}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {claim.stance !== null && <StanceChip stance={claim.stance} />}
          {used && <LabelChip kind="used" />}
          {mark}
        </div>
      </li>
    )
  }

  // The reply above is holding this claim, so it is where the stance is taken and the checks are
  // run; this copy is the record, and says so rather than leaving a blank where controls were
  // (D-313). The used mark stays here in both cases: it is the log's own control (D-270).
  if (workedInReply) {
    return (
      <li>
        <ClaimCard
          claim={view}
          headingLevel={4}
          actions={mark}
          deferredNote={t('workspace.claimWorkedInReply')}
        />
      </li>
    )
  }

  return (
    <li>
      <ClaimCard
        claim={view}
        headingLevel={4}
        actions={mark}
        stanceControl={
          <ClaimControls
            runId={runId}
            claim={view}
            canWrite={canWrite}
            documents={documents}
            stanceHintId={STANCE_HINT_ID}
          />
        }
      />
    </li>
  )
}
