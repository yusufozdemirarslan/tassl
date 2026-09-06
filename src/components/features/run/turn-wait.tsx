'use client'

import { useEffect, useRef, useState } from 'react'
import { Clock } from './clock'
import { clockSeconds, useClock } from '@/lib/hooks/use-clock'
import { t } from '@/lib/i18n/messages/decision'

// UI-024, the wait for the Turn (FR-110), and the A11y line UI-024 asks for.
//
// **The countdown is a plain reading.** `Clock` marks its last five minutes amber and its last
// minute red for the *working* clock, because that is time being spent; the wait for the Turn is
// time passing, so this one is drawn without thresholds (D-307).
//
// **What is announced is the Turn falling due, and the focus moves to the panel when it does**
// (D-321). The page has no control on it and nothing to press, so a student working by screen
// reader would otherwise sit in silence while the run moved underneath them; at zero this says the
// Turn is due and puts the focus on the panel that is about to become the Turn's own screen.
//
// It does not announce the Turn's *arrival*, because this page cannot see one. `/locked` redirects
// to `links.next` for any state but `decision_locked`, so it never renders while the Turn is open —
// the arrival is a navigation, which is where UI-024's own wording puts it ("focus moved to the
// Turn panel after navigation") and where UI-025 will say it. Nothing here polls either: the
// `RunFrame` band above polls `GET /runs/{runId}` every five seconds and refreshes the tree, and
// the page's guard does the rest (D-042).

export type TurnWaitProps = {
  /** `DecisionRecord.turnRemainingMs`: a reading taken on the server, never `Date.now()` here. */
  remainingMs: number | null
  /** The panel the focus moves to when the Turn falls due. */
  panelId: string
}

export function TurnWait({ remainingMs, panelId }: TurnWaitProps) {
  const remaining = useClock(remainingMs === null ? null : { remainingMs, frozen: false })
  const seconds = remaining === null ? null : clockSeconds(remaining)
  const [due, setDue] = useState(false)
  const announced = useRef(false)

  useEffect(() => {
    if (seconds === null || seconds > 0 || announced.current) return
    announced.current = true
    setDue(true)
    // The panel carries `tabIndex={-1}` for this and for nothing else: a student who cannot see the
    // countdown reach zero is put on the thing that is about to change.
    document.getElementById(panelId)?.focus({ preventScroll: true })
  }, [seconds, panelId])

  return (
    <div className="flex flex-col gap-3">
      {remainingMs !== null && (
        <Clock
          clock={{ remainingMs, paused: false }}
          label={t('decision.turnCountdownLabel')}
          thresholds={false}
          className="w-fit"
        />
      )}

      {/* Stays mounted and collapses when empty, so the announcement fires on the sentence
          appearing rather than on the region being inserted. */}
      <p role="status" className="text-ink text-body empty:hidden">
        {due ? t('decision.turnDue') : null}
      </p>
    </div>
  )
}
