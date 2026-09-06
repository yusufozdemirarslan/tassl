'use client'

import { useId, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { t } from '@/lib/i18n/messages/workspace'
import { setStanceAction } from '@/server/modules/reliance/actions'
import type { ClaimView } from '@/server/modules/reliance/schema'
import { useRunWork } from './run-work-context'
import { STANCE_ICONS, STANCE_LABELS, STANCE_ORDER, type StanceValue } from './stance-chip'

// UI-023: the stance control (FR-080, FR-085). Five chips, one of which is the student's position
// on one claim.
//
// **It says nothing about the claim.** There is no recommended stance, no default, no warning about
// accepting, no praise for verifying, and no ordering by anything the product knows — the five are
// in the order 06 §3.3 declares them, on every claim, always. What a claim deserved is the
// debrief's to say, after scoring (12 §8.1); a control that hinted at it would hand the student the
// answer to the thing being measured.
//
// **A stance is free and a stance is changeable, and the control says both.** FR-080 charges
// nothing, FR-085 keeps the previous stance beside the new one, and the sentence saying so is that
// fact rather than a caution — "both are kept" is what makes changing your mind a move the record
// can show rather than a confession. It is drawn **once for the panel** rather than under every
// group (`hintId`, D-314): a reply with three claims carried three copies of one sentence that
// never changes, and every radio group in the panel points at that one paragraph instead. The
// previous stance is drawn beside the group as soon as there is one, because a student coming back
// to a claim they re-thought should be able to see that they did.
//
// **The group is where the screen's accent goes** (D-323). DESIGN.md keeps one accent per screen —
// "teal for the action the visitor is there to take" — and the act being assessed on a claim is the
// stance, while the teal used to sit on the two controls that spend the clock. So until the claim
// has a stance the five chips wear the primary on their border and their icon, and once it has one
// they fall back to the control hairline with the chosen chip in its stance colour. The accent
// marks the open question and is spent by answering it.
//
// **A radio group by hand, and the reason is the chip.** DESIGN.md reserves pill geometry at 40 px
// for stance chips and requires the colour to arrive with its icon and its text label; a 16 px
// circle with a label beside it — which is what `RadioGroupItem` is, and rightly — is a different
// control. So this is the WAI-ARIA radio group pattern written out: one `radiogroup` named by its
// own legend, five `radio`s, roving tabindex so the group is one tab stop, and the arrow keys
// moving *and* selecting, which is what a radio group does everywhere. Home and End reach the ends,
// Space and Enter select without moving. Nothing here depends on hover.
//
// **The write is optimistic and the server's answer is what stands.** A student under a clock
// should see their stance land at the moment they press, and `setStanceAction` answers with the
// claim as it now stands — so the chip fills immediately and the server's own view replaces it when
// it arrives, which is also where `previousStance` comes from. A refusal puts the previous stance
// back and says so: the record is what the server holds, and this screen never claims otherwise.

export type StanceControlProps = {
  runId: string
  /** The claim as the page last read it; this control holds the changes it makes to it. */
  claim: ClaimView
  /** False while the run is paused: the control keeps its place and says why it is refusing. */
  canWrite: boolean
  /** The claim as the server now holds it, for a parent drawing the rest of the card. */
  onChanged?: (claim: ClaimView) => void
  /**
   * The id of the panel's one copy of the hint (D-314). Absent, the control draws its own — which
   * is what a claim outside a panel that hoists it needs.
   */
  hintId?: string | undefined
}

export function StanceControl({
  runId,
  claim,
  canWrite,
  onChanged,
  hintId: sharedHintId,
}: StanceControlProps) {
  const legendId = useId()
  const ownHintId = useId()
  const hintId = sharedHintId ?? ownHintId
  const { announce } = useRunWork()

  // The stance as this control knows it: what the server last answered here, or what the student
  // has just pressed. It is seeded from the prop, held here while the write is in flight, and
  // **re-seeded whenever the prop says something different** — the same claim is drawn twice on the
  // workspace, in the assistant's reply and in the Delegation Log, and a stance taken on one of them
  // is one act on one record. The one that did not take it learns from the server render that
  // follows, which is the adjusting-state-on-a-prop-change pattern `frame-form.tsx` uses for its
  // slider and the reason a `key` is not enough: the reply's card is client state and never gets a
  // new one.
  const [held, setHeld] = useState<{ stance: StanceValue | null; previous: StanceValue | null }>({
    stance: claim.stance,
    previous: claim.previousStance,
  })
  const incoming = `${claim.stance ?? ''}|${claim.previousStance ?? ''}`
  const [seededFrom, setSeededFrom] = useState(incoming)
  if (incoming !== seededFrom) {
    setSeededFrom(incoming)
    setHeld({ stance: claim.stance, previous: claim.previousStance })
  }

  const [pending, setPending] = useState<StanceValue | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  // Which chip the keyboard is standing on, which is not the same question as which stance is
  // taken: a refused write leaves the selection where it was while the focus stays where the
  // student put it, and an arrow from there must move from the chip they can see the ring on.
  const [focused, setFocused] = useState<StanceValue | null>(null)
  const chips = useRef<Map<StanceValue, HTMLButtonElement>>(new Map())

  const shown = pending ?? held.stance

  function choose(next: StanceValue): void {
    if (!canWrite || pending !== null || next === held.stance) return
    setPending(next)
    setFailed(null)
    void setStanceAction({ runId, claimId: claim.id, stance: next }).then(
      (result) => {
        setPending(null)
        if (!result.ok) {
          const message = result.error.message || t('workspace.stanceFailed')
          setFailed(message)
          announce(message)
          return
        }
        setHeld({ stance: result.data.stance, previous: result.data.previousStance })
        announce(t('workspace.stanceSaved', { key: claim.key, stance: STANCE_LABELS[next]() }))
        onChanged?.(result.data)
      },
      () => {
        setPending(null)
        setFailed(t('workspace.stanceFailed'))
        announce(t('workspace.stanceFailed'))
      },
    )
  }

  /** Arrow keys move and select, Home and End reach the ends: the radio-group pattern. */
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (!MOVE_KEYS.includes(event.key)) return
    event.preventDefault()
    const from = focused ?? shown
    const current = from === null ? 0 : STANCE_ORDER.indexOf(from)
    const last = STANCE_ORDER.length - 1
    const index =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? last
          : event.key === 'ArrowRight' || event.key === 'ArrowDown'
            ? (current + 1) % STANCE_ORDER.length
            : (current - 1 + STANCE_ORDER.length) % STANCE_ORDER.length
    const next = STANCE_ORDER[index] as StanceValue
    setFocused(next)
    chips.current.get(next)?.focus()
    choose(next)
  }

  // One chip is in the tab order: the chosen one, or the first when nothing is chosen yet.
  const tabbable = shown ?? (STANCE_ORDER[0] as StanceValue)

  return (
    <div className="flex flex-col gap-2">
      {/* Two names for one group. The visible one is short, because a card that carries the claim's
          key in its own heading does not need it again in the legend; the accessible one carries
          the key, so a screen-reader user moving between groups can tell which claim they are
          standing on and the lock's refusal names the same thing the control is called. */}
      <p id={legendId} aria-hidden="true" className="text-ink text-meta font-medium">
        {t('workspace.stanceLegend')}
      </p>

      <div
        role="radiogroup"
        aria-label={t('workspace.stanceLegendFor', { key: claim.key })}
        aria-describedby={hintId}
        onKeyDown={onKeyDown}
        className="flex flex-wrap gap-2"
      >
        {STANCE_ORDER.map((option) => {
          const Icon = STANCE_ICONS[option]
          const selected = shown === option
          return (
            <button
              key={option}
              type="button"
              role="radio"
              data-stance={option}
              aria-checked={selected}
              aria-disabled={canWrite ? undefined : true}
              tabIndex={option === tabbable ? 0 : -1}
              ref={(element) => {
                if (element === null) chips.current.delete(option)
                else chips.current.set(option, element)
              }}
              onFocus={() => {
                setFocused(option)
              }}
              onClick={() => {
                setFocused(option)
                choose(option)
              }}
              className={cn(
                'text-ink text-meta focus-visible:outline-focus inline-flex h-10 items-center gap-1.5 rounded-full border px-3.5 font-medium',
                'transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2',
                'aria-disabled:opacity-45',
                selected
                  ? SELECTED_TONE[option]
                  : shown === null
                    ? // The open question wears the screen's one accent (D-323).
                      'border-primary bg-paper-raised hover:bg-paper-sunken [&_svg]:text-primary'
                    : 'border-line-control bg-paper-raised hover:bg-paper-sunken [&_svg]:text-ink-muted',
              )}
            >
              <Icon aria-hidden="true" className="size-4" />
              {STANCE_LABELS[option]()}
            </button>
          )
        })}
      </div>

      {sharedHintId === undefined && (
        <p id={hintId} className="text-ink-muted text-meta max-w-measure">
          {t('workspace.stanceHint')}
        </p>
      )}

      {/* FR-085: the stance this one replaced, once there is one. A fact about the student's own
          record, never a comment on either stance. */}
      {held.previous !== null && (
        <p className="text-ink-muted text-meta">
          {t('workspace.stanceChanged', { stance: STANCE_LABELS[held.previous]() })}
        </p>
      )}

      {!canWrite && <p className="text-ink-muted text-meta">{t('workspace.stanceClosed')}</p>}

      {/* A refusal stays on screen beside the control that refused. It is not a live region of its
          own: the screen has one, and this sentence was already said into it (D-314). */}
      {failed !== null && <p className="text-red text-meta max-w-measure">{failed}</p>}
    </div>
  )
}

/** The keys that move the selection inside a radio group. */
const MOVE_KEYS = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End']

/**
 * The selected chip: the stance colour on the border and the icon, ink text, and the sunken wash
 * DESIGN.md gives a highlight.
 *
 * The colour is never the only carrier — the icon is the stance's own, the label is beside it, and
 * the fill changes lightness, so the selection reads in greyscale and reaches a screen reader
 * through `aria-checked` (DESIGN.md §The Labelled-Stance Rule).
 */
const SELECTED_TONE: Record<StanceValue, string> = {
  accept: 'bg-paper-sunken border-stance-accept [&_svg]:text-stance-accept',
  verify: 'bg-paper-sunken border-stance-verify [&_svg]:text-stance-verify',
  challenge: 'bg-paper-sunken border-stance-challenge [&_svg]:text-stance-challenge',
  reject: 'bg-paper-sunken border-stance-reject [&_svg]:text-stance-reject',
  escalate: 'bg-paper-sunken border-stance-escalate [&_svg]:text-stance-escalate',
}
