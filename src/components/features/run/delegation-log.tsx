'use client'

import { useState } from 'react'
import { Loader2Icon } from 'lucide-react'
import { FormAlert } from '@/components/features/account/form-feedback'
import { EmptyState } from '@/components/layout/empty-state'
import { Panel } from '@/components/layout/panel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/cn'
import { t } from '@/lib/i18n/messages/workspace'
import { updateDelegationAction } from '@/server/modules/assistant/actions'
import type { DelegationClaim, DelegationView } from '@/server/modules/assistant/schema'
import { AssistantProse } from './assistant-panel'
import { StanceChip } from './stance-chip'

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
 * The marker `assistant-reply@1` writes around a claim object (11 §2.1), removed for reading.
 *
 * It is restated here rather than imported because `src/server/llm` is not reachable from a
 * component (the `boundaries` policy) — and because it is a fact about the wire format the log
 * receives, which is exactly the kind of thing a reader of this file needs in front of them.
 *
 * Only this one is removed. `[[figure:…]]` is left in the text for `AssistantProse` to draw.
 */
const CLAIM_MARKER = /\[\[claim:[^\]]+\]\] ?/g

export type DelegationLogProps = {
  runId: string
  /** `GET /runs/{runId}/delegations` (07 §7), in the order the run made them. */
  delegations: readonly DelegationView[]
  /** The log is written to in `working` and `turn_open` alone (10 §7); false while paused. */
  canWrite: boolean
  /** Why it cannot be written to, when it cannot. */
  readOnlyNote?: string | undefined
}

export function DelegationLog({ runId, delegations, canWrite, readOnlyNote }: DelegationLogProps) {
  // The why lines the student has touched in this session, and the claims they have marked used.
  // Both are keyed by id and both only ever grow, so a fresh server render can be rendered against
  // them without either side having to win.
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [marked, setMarked] = useState<readonly string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  function markUsed(delegationId: string, claimId: string): void {
    if (busy !== null || !canWrite) return
    setBusy(`used:${claimId}`)
    setFailed(null)
    void updateDelegationAction({ runId, delegationId, usedClaimIds: [claimId] }).then(
      (result) => {
        setBusy(null)
        if (!result.ok) {
          setFailed(result.error.message || t('workspace.logWriteFailed'))
          return
        }
        setMarked((held) => (held.includes(claimId) ? held : [...held, claimId]))
      },
      () => {
        setBusy(null)
        setFailed(t('workspace.logWriteFailed'))
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
          setFailed(result.error.message || t('workspace.logWriteFailed'))
          return
        }
        setSaved(delegationId)
      },
      () => {
        setBusy(null)
        setFailed(t('workspace.logWriteFailed'))
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

      {failed !== null && (
        <div className="mb-3">
          <FormAlert message={failed} />
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
        <p className="text-ink text-body max-w-[72ch] whitespace-pre-line">{entry.requestText}</p>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-ink-muted text-meta font-medium">{t('workspace.logAnswered')}</p>
        {entry.failed ? (
          <p className="text-ink-muted text-body max-w-[72ch]">{t('workspace.logFailed')}</p>
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
            <>
              <ul aria-labelledby={claimsId} className="flex flex-col gap-3">
                {entry.claims.map((claim) => (
                  <ClaimRow
                    key={claim.id}
                    claim={claim}
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
              <p className="text-ink-muted text-meta">{t('workspace.logUsedNote')}</p>
            </>
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
          className={cn('max-w-[72ch]', over && 'border-red')}
        />
        <div className="flex max-w-[72ch] flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
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
            size="sm"
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
          {/* Stays mounted and collapses when empty, so the announcement fires on the sentence
              rather than on the region being inserted. */}
          <p role="status" className="text-ink-muted text-meta empty:hidden">
            {saved && !savingWhy ? t('workspace.logWhySaved') : null}
          </p>
        </div>
      </Field>
    </article>
  )
}

type ClaimRowProps = {
  claim: DelegationClaim
  used: boolean
  canWrite: boolean
  readOnlyId: string | undefined
  busy: boolean
  onMarkUsed: () => void
}

/** One claim of one delegation: which claim it is, the stance it carries now, and the used mark. */
function ClaimRow({ claim, used, canWrite, readOnlyId, busy, onMarkUsed }: ClaimRowProps) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-mono-sm text-ink-muted font-mono">
          {t('workspace.claimHeading', { key: claim.key })}
        </p>
        <p className="text-ink text-body mt-0.5 max-w-[72ch]">{claim.text}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {claim.stance !== null && <StanceChip stance={claim.stance} />}
        {used ? (
          <Badge variant="secondary">
            {t('workspace.claimUsed')}
            <span className="sr-only"> {t('workspace.claimUsedExplain')}</span>
          </Badge>
        ) : (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-label={t('workspace.logMarkUsedFor', { key: claim.key })}
            aria-disabled={busy || !canWrite ? true : undefined}
            aria-busy={busy}
            aria-describedby={!canWrite ? readOnlyId : undefined}
            onClick={onMarkUsed}
          >
            {busy && <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />}
            {t('workspace.logMarkUsed')}
          </Button>
        )}
      </div>
    </li>
  )
}
