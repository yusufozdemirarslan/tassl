'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Clock } from './clock'
import { clockSeconds, useClock } from '@/lib/hooks/use-clock'
import { t } from '@/lib/i18n/messages/decision'
import { useRefresh } from '@/lib/hooks/use-refresh'

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
// Turn panel after navigation") and where UI-025 says it (`turn-panel.tsx`, D-347).
//
// **What it does at zero is ask for the page again.** Nothing here decides that the Turn has
// arrived: `materializeTimers` delivers it on the next read, which is exactly what a server render
// is (D-042). The `RunFrame` band above polls every five seconds and would get there on its own, so
// this is not the mechanism — it is the difference between opening the Turn on the second it fell
// due and opening it up to five seconds later, on the one screen in the run whose whole content is
// a countdown to that instant. It fires once for the life of the mounted screen, the way
// `ReadinessTimer.onExpire` does, because a second refresh a second later would be a second load of
// a page the first one is already replacing.

export type TurnWaitProps = {
  /** `DecisionRecord.turnRemainingMs`: a reading taken on the server, never `Date.now()` here. */
  remainingMs: number | null
  /** The panel the focus moves to when the Turn falls due. */
  panelId: string
}

export function TurnWait({ remainingMs, panelId }: TurnWaitProps) {
  const router = useRouter()
  const refresh = useRefresh()
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
    // And the page is asked for again, which is the read that delivers the Turn and the render that
    // redirects to it (see the header).
    refresh()
  }, [seconds, panelId, router, refresh])

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
