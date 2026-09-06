'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2Icon, TriangleAlertIcon } from 'lucide-react'
import { FormAlert } from '@/components/features/account/form-feedback'
import { EmptyState } from '@/components/layout/empty-state'
import { Panel } from '@/components/layout/panel'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/cn'
import { useDelegation } from '@/lib/hooks/use-delegation'
import { t } from '@/lib/i18n/messages/workspace'
import { stripMarkup } from '@/lib/words'
import type { ClaimView } from '@/server/modules/reliance/schema'
import type { TracedDocument } from './action-result-sheet'
import { ClaimCard, ClaimControls } from './claim-card'
import { useRunWork } from './run-work-context'

// UI-023, middle column in `working`: the AI assistant (FR-050 to FR-053, FR-056, AI-002).
//
// The panel is labelled "AI assistant" because that is what it is, and because a student is being
// assessed on how they worked with an AI rather than on whether they noticed one was there.
//
// **What arrives, arrives in pieces, and the pieces are not the same kind of thing.** A reply is
// connective prose from the model interleaved with claim objects the author wrote (`segments.ts`,
// D-264). The prose carries no stance and is never scored; a claim is the thing the student takes a
// position on. So they are drawn as different objects: paragraphs, and `ClaimCard`s. Nothing here
// re-orders, ranks, or annotates them — the reply is shown in the order the reply was assembled in.
//
// **One announcement, at the end.** UI-023 asks the reply to be a live region that says "Reply
// complete, N claims surfaced". It is one `role="status"` line rather than a live region around the
// reply itself: a live region wrapped around the segments would announce each one as it landed and
// read the whole reply aloud twice — once in pieces as it arrived, once when the student navigated
// into it. The line below says the two facts a non-visual reader needs at the end of a stream —
// that it is over, and how many claims it produced — and the reply beneath it is ordinary content,
// navigable by heading. It is one of only two regions on the working screen that is not the
// screen's own announcer (`run-work-context.tsx`, D-314): it speaks about the *reply* rather than
// about a claim, so it keeps its id and its place.
//
// **A request that failed is still in the box.** The text used to be cleared at the press and the
// student had to copy it back out of the echo above the reply, under a clock, to try again — so it
// is cleared when the stream *completes* instead (D-324). ⌘ or Ctrl with Enter sends it, which is
// what a multi-line box in a form with one submit owes a keyboard.
//
// **The panel holds the claims its reply is drawing, and says so.** The same claim is listed again
// in the Delegation Log, and only one of the two copies carries the instrument: this one while the
// reply is on screen, the log's the rest of the time (D-313).
//
// **Nothing on screen says whether a claim is reliable.** No hedge, no warning, no ordering by
// trust, no marker on one claim and not another: the assistant never reveals defect status
// (FR-056), and the panel cannot leak what it is never handed — the payload carries a claim's text,
// key, stance and used mark, and nothing authored *about* the claim (12 §8.1).
//
// **The one thing that is marked is a figure with no source, and it is marked in the prose**
// (D-068, D-281). The numeric guard wraps it server-side in `[[figure:…]]`, the same shape the claim
// marker takes, so it survives into `response_text` and the Delegation Log and the replay show the
// reply the student saw. It is not a mark on a claim and cannot become one: a claim's figures are in
// the claim's own text, which no guard reads, so only the assistant's own connective prose is ever
// marked and a defective claim looks exactly like a sound one either way.

/**
 * 11 §3's request limit, restated rather than imported: a client component never imports a module's
 * `schema.ts` for a value (D-186), and the count under the box has to be the count the service
 * refuses on. `stripMarkup` is the same function `DelegationRequestSchema` measures after, so the
 * two agree on a pasted request character for character (10 §5).
 */
const REQUEST_MAX_CHARS = 2000

/**
 * The marker the numeric guard puts round a figure no claim, document or request sourced (D-068,
 * D-281), restated here because a component cannot import from `src/server` (the `boundaries`
 * policy) — and because it is a fact about the wire format this file reads.
 *
 * The capture group is what makes it usable with `String.split`: the pieces come back as text,
 * payload, text, payload, … so an odd index is a marked figure and an even one is prose. The payload
 * is the figure as the assistant wrote it, and an empty payload is `ASSISTANT_NUMERIC_GUARD=block`,
 * where the digits were taken out and only the mark is left.
 */
const FIGURE_MARKER = /\[\[figure:([^\]]*)\]\]/g

/** The panel's one copy of the stance hint; every radio group inside it points here (D-314). */
const STANCE_HINT_ID = 'assistant-stance-hint'

/**
 * A figure the assistant used that no claim, document or request put in front of the student (D-068).
 *
 * The wording is the whole of the care here. It is a statement about *provenance* — this figure has
 * no source in the room — and never about correctness, because the assistant does not tell a
 * student which of its sentences to distrust (FR-056). It cannot amount to one either: the figures
 * a claim carries are in the claim's own text, which no guard reads, so a marked figure says nothing
 * about whether any claim is sound. What it does say is what FR-025 makes the student answerable
 * for — a number from nowhere is an assumption, and defending it is theirs.
 *
 * The mark is amber as a border and an icon with ink text, never amber text (DESIGN.md's
 * Amber-Is-Not-Text rule), and it is reachable by keyboard: the tooltip opens on focus as well as
 * hover, and the sr-only note says the same thing for a reader who never sees the tooltip.
 */
function UnverifiedFigure({ figure }: { figure: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            className="bg-amber-soft border-amber text-ink text-meta focus-visible:outline-focus inline-flex items-center gap-1 rounded-sm border px-1.5 align-baseline focus-visible:outline-2 focus-visible:outline-offset-2"
          />
        }
      >
        <TriangleAlertIcon aria-hidden="true" className="text-amber size-3.5" />
        {figure === '' ? t('workspace.unverifiedNumberWithheld') : figure}
        <span className="sr-only"> {t('workspace.unverifiedNumberLabel')}</span>
      </TooltipTrigger>
      <TooltipContent>{t('workspace.unverifiedNumberTooltip')}</TooltipContent>
    </Tooltip>
  )
}

/** The assistant's own prose, cut into paragraphs, with every marked figure drawn in place. */
function proseParts(paragraph: string): ReactNode[] {
  return paragraph
    .split(FIGURE_MARKER)
    .map((part, index) =>
      index % 2 === 0 ? part : <UnverifiedFigure key={`figure-${String(index)}`} figure={part} />,
    )
}

export type AssistantProseProps = {
  /** One text segment, or a whole stored reply with its claim markers already removed. */
  text: string
  className?: string
}

/**
 * The model's connective writing, as both the panel and the Delegation Log render it.
 *
 * Blank-line-separated paragraphs, kept in the order they were written and trimmed at the edges:
 * the assembler puts a paragraph break between the pieces it joins (`assembleReply`), so a segment
 * routinely arrives with leading or trailing whitespace that is a join rather than the author's.
 */
export function AssistantProse({ text, className }: AssistantProseProps) {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '')

  if (paragraphs.length === 0) return null

  return (
    <div className={cn('max-w-measure flex flex-col gap-3', className)}>
      {paragraphs.map((paragraph, index) => (
        <p
          key={`${paragraph.slice(0, 48)}-${String(index)}`}
          className="text-ink text-reading whitespace-pre-line"
        >
          {proseParts(paragraph)}
        </p>
      ))}
    </div>
  )
}

export type AssistantPanelProps = {
  runId: string
  /** `capabilities.assistantUnlocked` (10 §6): false while the run is paused. */
  canDelegate: boolean
  /**
   * `GET /runs/{runId}/claims` (07 §7): the run's claims as the server now holds them (D-303).
   *
   * A reply's claim arrives on the stream and is a snapshot of the instant it was surfaced. The
   * same claim is drawn again in the Delegation Log, which the server renders, and a stance taken
   * there has to reach the card up here — so a card prefers the server's own view of its claim when
   * the page has one, and falls back to the streamed snapshot for the moment between `done` and the
   * render that follows it.
   */
  claims?: readonly ClaimView[]
  /** The Evidence Room's documents, so a Source Trace can name the document it leads to. */
  documents?: readonly TracedDocument[]
  /** Why it cannot be used, when it cannot. Shown beside the control that is refusing. */
  lockedReason?: string | undefined
}

export function AssistantPanel({
  runId,
  canDelegate,
  claims = [],
  documents = [],
  lockedReason,
}: AssistantPanelProps) {
  const router = useRouter()
  const { setWorked } = useRunWork()
  const [request, setRequest] = useState('')
  const [invalid, setInvalid] = useState<string | null>(null)

  const { state, send } = useDelegation<ClaimView>(runId, t('workspace.assistantFailed'), {
    // The delegation wrote a row, surfaced claims and appended an event. The Delegation Log and the
    // claim list beside this panel are read on the server, so the page is asked for them again —
    // this panel's own reply is client state and survives the refresh.
    onComplete: () => {
      // The request the student typed has landed and been echoed above the reply; the box is theirs
      // again. It is cleared here rather than at the press so a failed request is still in it.
      setRequest('')
      router.refresh()
    },
    onFailed: (failure) => {
      // `ASSISTANT_UNAVAILABLE` means the run is now paused and the clock is stopped (FR-001), and
      // `ASSISTANT_LOCKED` means this screen is behind the run. Both are answered by the server
      // render: the first draws the paused overlay, the second sends the student where they belong.
      if (failure.code === 'ASSISTANT_UNAVAILABLE' || failure.code === 'ASSISTANT_LOCKED') {
        router.refresh()
      }
    },
  })

  const streaming = state.status === 'streaming'
  const characters = stripMarkup(request).length
  const over = characters > REQUEST_MAX_CHARS
  const message =
    invalid ?? (over ? t('workspace.assistantRequestTooLong', { limit: REQUEST_MAX_CHARS }) : null)

  function ask(): void {
    if (streaming || !canDelegate) return
    const stripped = stripMarkup(request)
    if (stripped.length === 0) {
      setInvalid(t('workspace.assistantRequestRequired'))
      return
    }
    if (stripped.length > REQUEST_MAX_CHARS) {
      setInvalid(t('workspace.assistantRequestTooLong', { limit: REQUEST_MAX_CHARS }))
      return
    }
    setInvalid(null)
    // The stripped text is what the service stores and what the log will show, so it is what the
    // reply above is captioned with as well: one request, one record of it. The box keeps it until
    // the stream completes, so a refusal leaves the student's words where they typed them (D-324).
    send(stripped)
  }

  // The claims this reply is drawing with controls. Reported to the screen so the Delegation Log's
  // copy of each of them draws the record instead of a second identical instrument (D-313).
  const replyClaimIds = state.segments
    .filter((segment) => segment.type === 'claim')
    .map((segment) => (segment.type === 'claim' ? segment.claim.id : ''))
  const replyClaimKey = replyClaimIds.join('|')
  useEffect(() => {
    setWorked(replyClaimKey === '' ? [] : replyClaimKey.split('|'))
  }, [replyClaimKey, setWorked])

  const failure =
    state.error === null
      ? null
      : state.error.code === 'RATE_LIMITED' && state.error.retryAfterSeconds !== null
        ? t('workspace.assistantRateLimited', { seconds: state.error.retryAfterSeconds })
        : state.error.message

  /** The one thing announced, and only when the stream is over (UI-023 A11y). */
  const announcement =
    state.status === 'complete'
      ? state.claimCount === 0
        ? t('workspace.assistantReplyCompleteNone')
        : state.claimCount === 1
          ? t('workspace.assistantReplyCompleteOne')
          : t('workspace.assistantReplyComplete', { count: state.claimCount })
      : streaming
        ? t('workspace.assistantStreaming')
        : null

  return (
    <Panel
      id="assistant-panel"
      title={t('workspace.assistantTitle')}
      description={t('workspace.assistantDescription')}
      headingLevel={2}
      padding="reading"
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          ask()
        }}
        className="flex flex-col gap-3"
      >
        <Field data-invalid={message ? 'true' : undefined}>
          <FieldLabel htmlFor="assistant-request">
            {t('workspace.assistantRequestLabel')}
          </FieldLabel>
          <Textarea
            id="assistant-request"
            rows={3}
            value={request}
            onChange={(event) => {
              setRequest(event.target.value)
              if (invalid !== null) setInvalid(null)
            }}
            onKeyDown={(event) => {
              // A textarea takes Enter for a newline, so the send shortcut is the one every editor
              // in a form uses: the platform modifier with Enter. It is named in the hint below.
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                ask()
              }
            }}
            aria-invalid={message ? true : undefined}
            aria-describedby={`${message ? 'assistant-request-error' : 'assistant-request-hint'} assistant-request-count`}
            className={cn('text-reading max-w-measure', over && 'border-red')}
          />
          <div className="max-w-measure flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div className="min-w-0 flex-1">
              {message ? (
                <FieldError id="assistant-request-error">{message}</FieldError>
              ) : (
                <FieldDescription id="assistant-request-hint">
                  {t('workspace.assistantRequestHint', { limit: REQUEST_MAX_CHARS })}
                </FieldDescription>
              )}
            </div>
            {/* Read on focus rather than announced: a counter in a live region would talk over the
                request being written (09 §6). */}
            <span
              id="assistant-request-count"
              className={cn(
                'text-mono-sm shrink-0 font-mono tabular-nums',
                over ? 'text-red' : 'text-ink-muted',
              )}
            >
              {t('workspace.assistantCharCount', {
                count: characters,
                limit: REQUEST_MAX_CHARS,
              })}
            </span>
          </div>
        </Field>

        <div className="flex flex-wrap items-center gap-3">
          {/* `aria-disabled`, never `disabled`: the control keeps its focus and its reason while it
              is refusing, which is DESIGN.md's rule for a control that must stay reachable. */}
          <Button
            type="submit"
            aria-disabled={streaming || !canDelegate ? true : undefined}
            aria-busy={streaming}
            aria-describedby={!canDelegate && lockedReason ? 'assistant-locked' : undefined}
          >
            {streaming && <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />}
            {streaming ? t('workspace.assistantSending') : t('workspace.assistantSend')}
          </Button>
          {!canDelegate && lockedReason !== undefined && (
            <p id="assistant-locked" className="text-ink-muted text-body min-w-0 flex-1">
              {lockedReason}
            </p>
          )}
        </div>
      </form>

      {failure !== null && (
        <div className="mt-4">
          <FormAlert
            message={failure}
            reference={
              state.error === null || state.error.requestId === undefined
                ? undefined
                : { label: t('workspace.errorReference'), id: state.error.requestId }
            }
          />
        </div>
      )}

      <section aria-labelledby="assistant-reply-title" className="border-line mt-6 border-t pt-4">
        <h3 id="assistant-reply-title" className="text-h4">
          {t('workspace.assistantReplyLabel')}
        </h3>

        {/* The panel's own live region, and the only one that speaks about the *reply*. It stays
            mounted and collapses when empty, so the announcement fires on the sentence changing
            rather than on the region appearing. Everything a claim *act* produces goes to the
            screen's one announcer instead (`run-work-context.tsx`, D-314), which is why this one
            keeps its id: it is about the stream, not about a claim. */}
        <p
          id="assistant-reply-status"
          role="status"
          className="text-ink-muted text-meta mt-1 empty:hidden"
        >
          {announcement}
        </p>

        {state.request === null ? (
          <EmptyState
            title={t('workspace.assistantEmptyTitle')}
            body={t('workspace.assistantEmptyBody')}
            headingLevel={4}
          />
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <p className="text-ink-muted text-meta font-medium">
                {t('workspace.assistantAsked')}
              </p>
              <p className="text-ink text-body max-w-measure whitespace-pre-line">
                {state.request}
              </p>
            </div>

            {/* FR-080 and FR-085, once for the panel rather than under every claim: a reply with
                three claims drew three copies of a sentence that never changes (D-314). Every
                stance group below points at this paragraph. */}
            <p id={STANCE_HINT_ID} className="text-ink-muted text-meta max-w-measure">
              {t('workspace.stanceHint')}
            </p>

            {state.segments.map((segment, index) => {
              if (segment.type === 'text') {
                return <AssistantProse key={`text-${String(index)}`} text={segment.text} />
              }
              // The controls are the same ones the Delegation Log draws, on the same claim — but
              // never at the same time: while this reply is on screen it is the copy that carries
              // them and the log's copy draws the record (D-313). A stance taken here and a stance
              // taken there are one act on one record (FR-080), so the card reads the server's view
              // of the claim as soon as the page has one.
              const claim = claims.find((held) => held.id === segment.claim.id) ?? segment.claim
              return (
                <ClaimCard
                  key={claim.id}
                  claim={claim}
                  headingLevel={4}
                  stanceControl={
                    <ClaimControls
                      runId={runId}
                      claim={claim}
                      canWrite={canDelegate}
                      documents={documents}
                      stanceHintId={STANCE_HINT_ID}
                    />
                  }
                />
              )
            })}
          </div>
        )}
      </section>
    </Panel>
  )
}
