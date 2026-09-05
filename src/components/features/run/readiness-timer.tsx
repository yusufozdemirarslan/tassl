'use client'

import { useEffect, useRef, useState } from 'react'
import { TimerIcon, TriangleAlertIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { clockSeconds, formatClock, useClock } from '@/lib/hooks/use-clock'
import { t } from '@/lib/i18n/messages/readiness'

// The eight-minute clock on UI-022. Mono with tabular figures, one step per second, no animation —
// the same instrument as the working `Clock`, with the one threshold this screen is given.
//
// **It counts down to the server's instant and decides nothing.** `getReadiness` answers
// `expiresAt`, the page turns that into a reading on the server, and `useClock` anchors the reading
// at the moment it reaches the browser (D-042, ADR-019). Nothing here computes eight minutes from
// a start time, and nothing here tells the server the check ran out: the expiry is materialized on
// the next read, which is what makes it identical whether the tab was open, asleep or closed. What
// `onExpire` does is ask for that read sooner — one `router.refresh()` on the second the digits
// reach zero, instead of waiting for the five-second poll in the RunFrame above.
//
// One threshold, not the working clock's two. 09 §UI-022 asks for a live region at 1:00, and eight
// minutes has no five-minute mark worth interrupting a student for; DESIGN.md's pair belongs to the
// working clock, which runs long enough for both to be news. The expiry is announced as well,
// because it takes the screen away from under them.
//
// Colour is never the only carrier: the digits say how long is left, the icon changes with them,
// and the announcement says it in words. The last minute is a red wash with ink text and a red
// icon, never red text on a fill.

/** The one threshold this clock marks, in whole seconds (09 §UI-022). */
const ONE_MINUTE = 60

export type ReadinessTimerProps = {
  /** Milliseconds left when the server answered, from `ReadinessView.expiresAt`. */
  remainingMs: number
  /** Called once, on the tick that reaches zero. */
  onExpire?: () => void
  className?: string
}

export function ReadinessTimer({ remainingMs, onExpire, className }: ReadinessTimerProps) {
  const remaining = useClock({ remainingMs, frozen: false })
  const seconds = remaining === null ? 0 : clockSeconds(remaining)
  const announcement = useThresholdAnnouncement(seconds)

  // Fired once for the life of the mounted screen: a second refresh a second later would be a
  // second load of a page the first one is already replacing.
  const expired = useRef(false)
  const expire = useRef(onExpire)
  useEffect(() => {
    expire.current = onExpire
  })
  useEffect(() => {
    if (seconds > 0 || expired.current) return
    expired.current = true
    expire.current?.()
  }, [seconds])

  const last = seconds <= ONE_MINUTE
  const Icon = last ? TriangleAlertIcon : TimerIcon

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        className={cn(
          'text-ink flex h-10 items-center gap-2 rounded-md border px-3',
          'transition-colors duration-150 ease-out',
          last ? 'border-red bg-red-soft [&_svg]:text-red' : 'border-line bg-paper-raised',
        )}
      >
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        <span
          role="timer"
          aria-label={t('readiness.timerLabel')}
          className="text-mono font-mono font-medium"
        >
          {formatClock(remaining ?? 0)}
        </span>
      </div>

      {/* Empty except on the tick that crosses a threshold, so what is announced is the event and
          not the second it happened on. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  )
}

/**
 * The sentence to announce, or the empty string.
 *
 * It fires on the *crossing*, which is why the previous reading is kept: a student who reloads with
 * forty seconds left is not told "one minute left", and a clock sitting at 00:00 while the page
 * navigates does not repeat itself.
 */
function useThresholdAnnouncement(seconds: number): string {
  const [announcement, setAnnouncement] = useState('')
  const previous = useRef<number | null>(null)

  useEffect(() => {
    const before = previous.current
    previous.current = seconds
    // The first reading is a starting point, never a crossing.
    if (before === null || before <= seconds) return

    if (before > 0 && seconds <= 0) setAnnouncement(t('readiness.timerExpired'))
    else if (before > ONE_MINUTE && seconds <= ONE_MINUTE) {
      setAnnouncement(t('readiness.timerOneMinute'))
    }
  }, [seconds])

  return announcement
}
