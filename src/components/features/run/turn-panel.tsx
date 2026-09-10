'use client'

import { useEffect, useId, useState } from 'react'
import { Loader2Icon, PencilLineIcon } from 'lucide-react'
import { FormAlert } from '@/components/features/account/form-feedback'
import { Panel } from '@/components/layout/panel'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/cn'
import { useDraft } from '@/lib/hooks/use-draft'
import { t } from '@/lib/i18n/messages/turn'
import { countWords } from '@/lib/words'
import { respondToTurnAction } from '@/server/modules/runs/actions'
import type { TurnResponseKindValue } from '@/server/modules/runs/schema'
import { useRunWork } from './run-work-context'
import { useRefresh } from '@/lib/hooks/use-refresh'

// UI-025: the response to the Turn (FR-112, FR-113).
//
// **The three options are defined and never ranked.** `scenario_turns.warrants_change` and
// `proportionate_response` are what this response is measured against, and no student payload
// carries either (D-336). So each radio gets one sentence saying what the word means — the same
// discipline `stance-control.tsx` keeps on its five chips, and for the same reason: a control that
// hinted would hand over the answer to the thing being assessed. Nothing is preselected either. A
// default would be a recommendation made by whichever option happened to be first.
//
// **The justification and the confidence are required, and the form says so before the press.**
// FR-112 asks for both, and `TurnResponseSchema` refuses without them; the one response with
// neither is the implicit hold the window's expiry writes, where nobody said anything because
// nobody was there (D-335). A student who files nothing gets that outcome by not filing, never by
// filing an empty form.
//
// **The word count is the server's count.** `countWords` is the function `wordLimit(150)` runs
// inside `TurnResponseSchema` (D-075), so the number under the box is the number the service
// refuses on. The limit is restated here rather than imported because a client component never
// imports a module schema (D-186); the action validates against the module's schema whatever this
// form believes.
//
// **`TURN_CLAIMS_UNSTANCED` is answered in the words the student already read.** FR-111's gate
// carries `details.claimIds` and nothing else — not what stance a claim deserves, not why the
// window raised it (D-306's discipline, one state on from the Decision Lock's). The screen is
// already showing those cards, so the refusal names the claim by its own text when it is one, says
// how many when it is several, and offers the way back to the card that can answer it. Nothing is
// lost by the refusal: `respondToTurn` reads the claims and writes nothing, so the transaction
// rolls back with the run exactly where it was and the justification is still in the box.
//
// **A reload does not take the response** (D-360). The window is running and the justification is
// a hundred and fifty words; losing them to a stray refresh would be Tassl penalising a student for
// Tassl's own gap. So the three fields are mirrored into the tab's `sessionStorage` as they are
// typed and put back on the next mount — a convenience belonging to one browser tab, never a record.
// Nothing about it reaches the server, the trace, or another viewer, and it changes nothing about
// what is filed: the response is what the student pressed submit on, and a restored draft is only a
// starting value in a form that has not been submitted. The restored *response* is the student's own
// earlier choice and not a default, which is the thing D-336 forbids. It is discarded the moment the
// response is filed, because a filed response is immutable and this screen never opens again.
//
// **No react-hook-form here.** Three fields, one of them a radio group with no default, and one
// refusal shape to bind: `addendum-form.tsx` already sets the precedent, and the Turn screen is
// carrying the assistant, the Evidence Room and the claim controls on the same route budget
// (B4 / NFR-013, 16 §3.2). A resolver and a schema runtime for three fields is weight this screen
// cannot spend.

/** FR-112's limit (`TURN_JUSTIFICATION_WORD_LIMIT`), for the counter and the message. */
const JUSTIFICATION_WORDS = 150

/** Confidence as it is typed: a whole number, no sign and no decimal point (0 to 100). */
const CONFIDENCE_PATTERN = /^\d{1,3}$/

/** The three, in the order 06 §3.4 declares them, on every Turn, always. */
const RESPONSES: readonly {
  value: TurnResponseKindValue
  label: () => string
  description: () => string
}[] = [
  {
    value: 'hold',
    label: () => t('turn.responseHold'),
    description: () => t('turn.responseHoldDescription'),
  },
  {
    value: 'revise',
    label: () => t('turn.responseRevise'),
    description: () => t('turn.responseReviseDescription'),
  },
  {
    value: 'reverse',
    label: () => t('turn.responseReverse'),
    description: () => t('turn.responseReverseDescription'),
  },
]

/** The claim a refusal can name, as the screen already holds it. */
export type TurnClaim = { id: string; text: string }

/**
 * The form as the tab holds it between mounts (D-360): every field exactly as it is typed.
 *
 * Strings, not the parsed values, because a draft is a copy of the boxes and not of the payload —
 * a half-typed "4" must come back as "4" rather than as a number the form would then have to
 * un-parse.
 */
type TurnDraft = { response: TurnResponseKindValue | ''; justification: string; confidence: string }

/**
 * What was on the shelf, narrowed to this form's shape, or null for anything not worth restoring.
 *
 * A response that is not one of the three is dropped rather than trusted: a stale key from an
 * older build must not be able to put a value into a radio group whose whole discipline is that
 * nothing is preselected (D-336). A draft with all three fields empty returns null, so the screen
 * never announces a restore of nothing.
 */
function reviveTurnDraft(held: unknown): TurnDraft | null {
  if (typeof held !== 'object' || held === null) return null
  const { response, justification, confidence } = held as Record<string, unknown>
  const draft: TurnDraft = {
    response: RESPONSES.some((option) => option.value === response)
      ? (response as TurnResponseKindValue)
      : '',
    justification: typeof justification === 'string' ? justification : '',
    confidence:
      typeof confidence === 'string' && CONFIDENCE_PATTERN.test(confidence) ? confidence : '',
  }
  return draft.response === '' && draft.justification === '' && draft.confidence === ''
    ? null
    : draft
}

/** One message per field, or none. `| undefined` because `exactOptionalPropertyTypes` is on. */
type FieldErrors = {
  response?: string | undefined
  justification?: string | undefined
  confidence?: string | undefined
}

/** `VALIDATION_ERROR`'s `details` on this endpoint (10 §6): which field, and which rule it broke. */
function fieldRefusal(
  details: unknown,
): { field: 'justification' | 'confidence'; message: string } | null {
  if (typeof details !== 'object' || details === null) return null
  const { field, reason } = details as { field?: unknown; reason?: unknown }
  if (field === 'confidence') return { field, message: t('turn.confidenceInvalid') }
  if (field !== 'justification') return null
  return {
    field,
    message:
      reason === 'word_limit'
        ? t('turn.justificationTooLong', { limit: JUSTIFICATION_WORDS })
        : t('turn.justificationRequired'),
  }
}

/** `TURN_CLAIMS_UNSTANCED`'s `details.claimIds` (10 §6). */
function unstancedClaimIds(details: unknown): readonly string[] {
  if (typeof details !== 'object' || details === null) return []
  const { claimIds } = details as { claimIds?: unknown }
  if (!Array.isArray(claimIds)) return []
  return claimIds.filter((id): id is string => typeof id === 'string')
}

export type TurnPanelProps = {
  runId: string
  /** The claims the window raised, so a refusal can name one in the words on the card. */
  claims: readonly TurnClaim[]
}

export function TurnPanel({ runId, claims }: TurnPanelProps) {
  const refresh = useRefresh()
  const fieldId = useId()
  const legendId = useId()
  const { announce } = useRunWork()

  // The Turn's arrival, said once, through the screen's one polite region (D-314, D-347).
  //
  // It is announced here rather than written into the page's markup because a live region that is
  // already populated in the HTML a screen reader loads is not a change, and a change is what a
  // polite region speaks. `/locked` cannot say it either — it redirects the instant the state moves,
  // so the arrival can only be spoken after the navigation, which is here. The message panel above
  // is what a sighted student is already looking at, so nothing visible is repeated.
  useEffect(() => {
    announce(t('turn.arrived'))
  }, [announce])

  const [response, setResponse] = useState<TurnResponseKindValue | ''>('')
  const [justification, setJustification] = useState('')
  const [confidence, setConfidence] = useState('')
  const [filing, setFiling] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [refusal, setRefusal] = useState<{
    message: string
    requestId?: string
    claimId?: string
  } | null>(null)

  // The tab's copy of the three fields (D-360). `restore` runs once, after mount, so the first
  // paint is still the server's empty form and hydration has nothing to disagree about.
  const draft = useDraft<TurnDraft>({
    key: `turn.${runId}`,
    revive: reviveTurnDraft,
    restore: (value) => {
      setResponse(value.response)
      setJustification(value.justification)
      setConfidence(value.confidence)
    },
  })

  /** The whole form as it stands after this keystroke; a draft is all three fields or none. */
  function keep(next: Partial<TurnDraft>): void {
    draft.save({ response, justification, confidence, ...next })
  }

  const words = countWords(justification)
  const over = words > JUSTIFICATION_WORDS

  function file(): void {
    if (filing) return

    // Checked here in the order FR-112 states them, so a student is told about the field they are
    // looking at rather than about the first one the server happened to reach.
    const next: FieldErrors = {}
    if (response === '') next.response = t('turn.responseRequired')
    if (justification.trim() === '') next.justification = t('turn.justificationRequired')
    else if (over)
      next.justification = t('turn.justificationTooLong', { limit: JUSTIFICATION_WORDS })
    const trimmedConfidence = confidence.trim()
    if (!CONFIDENCE_PATTERN.test(trimmedConfidence) || Number(trimmedConfidence) > 100) {
      next.confidence = t('turn.confidenceInvalid')
    }
    setErrors(next)
    if (Object.keys(next).length > 0 || response === '') return

    setRefusal(null)
    setFiling(true)
    void respondToTurnAction({
      runId,
      response,
      justification: justification.trim(),
      confidence: Number(trimmedConfidence),
    }).then(
      (result) => {
        if (result.ok) {
          // The response is filed and is immutable from here, so the tab's copy of it goes with it:
          // a draft of something already on the record is a draft of nothing (D-360).
          draft.discard()
          // The run is in `defense_pending` from here; the guard on this page sends the student on.
          // The sentence is said first, through the screen's one region, because the navigation
          // replaces this tree and a student working by screen reader would otherwise learn that
          // their response landed only from the heading of the screen after it.
          announce(t('turn.filed'))
          refresh()
          return
        }
        setFiling(false)

        const field = fieldRefusal(result.error.details)
        if (field !== null) {
          setErrors({ [field.field]: field.message })
          return
        }

        const ids = unstancedClaimIds(result.error.details)
        if (ids.length > 0) {
          const named = ids.length === 1 ? claims.find((claim) => claim.id === ids[0]) : undefined
          setRefusal({
            message:
              named !== undefined
                ? t('turn.claimsUnstancedOne', { text: named.text })
                : ids.length === 1
                  ? t('turn.claimsUnstanced')
                  : t('turn.claimsUnstancedMany', { count: ids.length }),
            requestId: result.error.requestId,
            ...(ids[0] === undefined ? {} : { claimId: ids[0] }),
          })
          return
        }

        setRefusal({
          message: result.error.message || t('turn.failed'),
          requestId: result.error.requestId,
        })
      },
      () => {
        setFiling(false)
        setRefusal({ message: t('turn.failed') })
      },
    )
  }

  return (
    <Panel
      id="turn-response"
      title={t('turn.responseTitle')}
      description={t('turn.responseDescription')}
      headingLevel={2}
      padding="reading"
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          file()
        }}
        className="flex flex-col gap-6"
      >
        {/* Only when something was actually put back, and only ever this once (D-360). It is a
            visible line rather than an announcement because the screen's one polite region is
            already saying the Turn arrived, and a second sentence on the same mount would silence
            the first; the justification box points at this one instead, so it is read on the way
            in. Amber is DESIGN.md's draft mark and appears here as the icon alone — the text is
            ink, never amber. */}
        {draft.restored && (
          <p
            id={`${fieldId}-draft`}
            className="text-ink text-meta max-w-measure flex items-start gap-2"
          >
            <PencilLineIcon aria-hidden="true" className="text-amber mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 flex-1">{t('turn.draftRestored')}</span>
          </p>
        )}

        <FieldSet>
          <FieldLegend id={legendId} variant="label">
            {t('turn.responseLegend')}
          </FieldLegend>
          <RadioGroup
            name="turn-response"
            value={response === '' ? null : response}
            aria-labelledby={legendId}
            aria-invalid={errors.response ? true : undefined}
            aria-describedby={errors.response ? `${fieldId}-response-error` : undefined}
            onValueChange={(next) => {
              setResponse(next as TurnResponseKindValue)
              keep({ response: next as TurnResponseKindValue })
              setErrors((held) => ({ ...held, response: undefined }))
            }}
            className="max-w-measure"
          >
            {RESPONSES.map((option) => {
              const itemId = `${fieldId}-${option.value}`
              return (
                <FieldLabel key={option.value} htmlFor={itemId}>
                  <Field orientation="horizontal">
                    <RadioGroupItem
                      id={itemId}
                      value={option.value}
                      aria-labelledby={`${itemId}-title`}
                      aria-describedby={`${itemId}-description`}
                    />
                    <FieldContent>
                      <FieldTitle id={`${itemId}-title`}>{option.label()}</FieldTitle>
                      <FieldDescription id={`${itemId}-description`}>
                        {option.description()}
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                </FieldLabel>
              )
            })}
          </RadioGroup>
          {errors.response !== undefined && (
            <FieldError id={`${fieldId}-response-error`}>{errors.response}</FieldError>
          )}
        </FieldSet>

        <Field data-invalid={errors.justification ? 'true' : undefined}>
          <FieldLabel htmlFor={`${fieldId}-justification`}>
            {t('turn.justificationLabel')}
          </FieldLabel>
          <Textarea
            id={`${fieldId}-justification`}
            rows={6}
            value={justification}
            onChange={(event) => {
              setJustification(event.target.value)
              keep({ justification: event.target.value })
              setErrors((held) => ({ ...held, justification: undefined }))
            }}
            aria-invalid={errors.justification ? true : undefined}
            aria-describedby={`${
              errors.justification
                ? `${fieldId}-justification-error`
                : `${fieldId}-justification-hint`
            } ${fieldId}-justification-count${draft.restored ? ` ${fieldId}-draft` : ''}`}
            className={cn('text-reading max-w-measure', over && 'border-red')}
          />
          <div className="max-w-measure flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div className="min-w-0 flex-1">
              {errors.justification !== undefined ? (
                <FieldError id={`${fieldId}-justification-error`}>
                  {errors.justification}
                </FieldError>
              ) : (
                <FieldDescription id={`${fieldId}-justification-hint`}>
                  {t('turn.justificationHint', { limit: JUSTIFICATION_WORDS })}
                </FieldDescription>
              )}
            </div>
            {/* Read on focus rather than announced: a counter in a live region would talk over the
                sentence being written (09 §6). */}
            <span
              id={`${fieldId}-justification-count`}
              className={cn(
                'text-mono-sm shrink-0 font-mono tabular-nums',
                over ? 'text-red' : 'text-ink-muted',
              )}
            >
              {t('turn.justificationWordCount', { count: words, limit: JUSTIFICATION_WORDS })}
            </span>
          </div>
        </Field>

        {/* The measure token, never a hand-written `[60ch]` (D-317): the cap belongs to the hint
            under the control, and one utility keeps it the same width as every other line the
            student reads on this screen. */}
        <Field className="max-w-measure" data-invalid={errors.confidence ? 'true' : undefined}>
          <FieldLabel htmlFor={`${fieldId}-confidence`}>{t('turn.confidenceLabel')}</FieldLabel>
          <div className="flex items-center gap-2">
            <Input
              id={`${fieldId}-confidence`}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={confidence}
              onChange={(event) => {
                // Digits only, as they are typed: a half-typed number is a string, and coercing on
                // every keystroke would fight the person typing "100".
                const typed = event.target.value.replace(/[^\d]/g, '').slice(0, 3)
                setConfidence(typed)
                keep({ confidence: typed })
                setErrors((held) => ({ ...held, confidence: undefined }))
              }}
              aria-invalid={errors.confidence ? true : undefined}
              aria-describedby={
                errors.confidence ? `${fieldId}-confidence-error` : `${fieldId}-confidence-hint`
              }
              className="max-w-24 font-mono tabular-nums"
            />
            <span aria-hidden="true" className="text-ink-muted text-mono font-mono tabular-nums">
              {t('turn.confidenceUnit')}
            </span>
          </div>
          {errors.confidence !== undefined ? (
            <FieldError id={`${fieldId}-confidence-error`}>{errors.confidence}</FieldError>
          ) : (
            <FieldDescription id={`${fieldId}-confidence-hint`}>
              {t('turn.confidenceHint')}
            </FieldDescription>
          )}
        </Field>

        <FormAlert
          message={refusal?.message ?? null}
          {...(refusal?.requestId === undefined
            ? {}
            : { reference: { label: t('turn.errorReference'), id: refusal.requestId } })}
          action={
            refusal?.claimId === undefined ? undefined : (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  const card = document.querySelector<HTMLElement>(
                    `[data-claim-id="${refusal.claimId ?? ''}"]`,
                  )
                  card?.scrollIntoView({ block: 'center' })
                  card?.focus({ preventScroll: true })
                }}
              >
                {t('turn.goToClaim')}
              </Button>
            )
          }
        />

        <div className="flex flex-col gap-3">
          <Button
            type="submit"
            aria-disabled={filing ? true : undefined}
            aria-busy={filing}
            className="w-fit"
          >
            {filing && <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />}
            {filing ? t('turn.submitting') : t('turn.submit')}
          </Button>

          {/* FR-113, beside the control rather than in the panel description (D-354): the window
              closing is the one outcome on this screen a student does not choose, and the band above
              is counting down to it in red. */}
          <p className="text-ink-muted text-meta max-w-measure">{t('turn.windowEndsNote')}</p>
        </div>
      </form>
    </Panel>
  )
}
