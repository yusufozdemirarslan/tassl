'use client'

import { useEffect, useRef, useState } from 'react'
import { PauseCircleIcon, TriangleAlertIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { clockSeconds, formatClock, useClock } from '@/lib/hooks/use-clock'
import { t } from '@/lib/i18n/messages/run'

// The working clock (UI-023, UI-027; DESIGN.md §The clock). Mono with tabular figures, one step per
// second, no animation, and two thresholds that change how it looks and say so out loud.
//
// It counts down to a *deadline*, and `useClock` makes that deadline once, from the server's own
// reading (`RunSummary.clock.remainingMs`), at the instant the reading reaches the browser. The
// poll delivers a new reading every five seconds and each one replaces it, so the browser never
// owns the number for longer than that. On the server render and the paint that hydrates it the
// reading is shown as it stands and nothing ticks, which keeps the HTML and its hydration
// identical. A paused run is the same branch: the clock is stopped, so there is nothing to count
// down to (FR-001).
//
// Two live regions, deliberately: `role="timer"` is the digits, and its default `aria-live="off"`
// is what stops a screen reader reading a number aloud sixty times a minute. The polite region
// beside it is empty except at the moments 09 §6 names — five minutes, one minute, expired — and
// each is announced once, on the tick that crosses it, and never again.
//
// Colour is never the only carrier. The digits themselves say how long is left, the wash and the
// warning icon say that the run is in its last stretch, and the announcement says it in words.
// Amber is a fill with ink text and an amber icon, never amber text (DESIGN.md §The
// Amber-Is-Not-Text Rule).

/** The two thresholds, in whole seconds, that 09 §6 and DESIGN.md ask the clock to mark. */
const FIVE_MINUTES = 300
const ONE_MINUTE = 60

export type ClockProps = {
  /**
   * The run's clock as the server last reported it, or null when the run has none — there is no
   * working clock before the frame is locked or after the decision is (D-042). Every new reading
   * re-anchors the countdown; the poll delivers one every five seconds.
   */
  clock: { remainingMs: number; paused: boolean } | null
  /** What this clock measures; the timer's accessible name. */
  label?: string
  /**
   * Whether the last five minutes and the last minute are marked (09 §6, DESIGN.md §The clock).
   *
   * True for the working clock, which is time the student is spending and cannot get back. False
   * for a countdown to something *arriving* — the wait for the Turn on UI-024 — where nothing is
   * being lost as it runs and there is nothing for the student to do about it: amber is DESIGN.md's
   * colour for draft and provisional and red is for a refusal, and neither is what "four minutes
   * until a message reaches you" means. A clock that turned red for it would be an alarm about
   * waiting.
   */
  thresholds?: boolean
  /**
   * Which clock this is, and therefore what its thresholds *say* (D-346).
   *
   * The Turn window is the second clock a student is under and the band draws it in the same place,
   * because a last minute that is a visual signal cannot be a signal the student has to scroll to
   * find. What it must not borrow is the working clock's wording: the window closing is not "the
   * working clock has run out" — nothing is lost, the decision already filed stands (FR-113).
   */
  kind?: 'working' | 'turnWindow'
  className?: string
}

/** The three sentences each clock announces, in the words of the clock it is (09 §6). */
const ANNOUNCEMENTS: Record<
  NonNullable<ClockProps['kind']>,
  { label: string; fiveMinutes: string; oneMinute: string; expired: string }
> = {
  working: {
    label: t('run.clockLabel'),
    fiveMinutes: t('run.clockFiveMinutes'),
    oneMinute: t('run.clockOneMinute'),
    expired: t('run.clockExpired'),
  },
  turnWindow: {
    label: t('run.windowLabel'),
    fiveMinutes: t('run.windowFiveMinutes'),
    oneMinute: t('run.windowOneMinute'),
    expired: t('run.windowExpired'),
  },
}

export function Clock({
  clock,
  label,
  thresholds = true,
  kind = 'working',
  className,
}: ClockProps) {
  const remaining = useClock(
    clock === null ? null : { remainingMs: clock.remainingMs, frozen: clock.paused },
  )

  const words = ANNOUNCEMENTS[kind]
  const seconds = remaining === null ? null : clockSeconds(remaining)
  const announcement = useThresholdAnnouncement(
    thresholds ? seconds : null,
    clock !== null && clock.paused,
    words,
  )

  if (clock === null || remaining === null || seconds === null) return null

  const paused = clock.paused
  const warning = thresholds && !paused && seconds <= FIVE_MINUTES
  const tone = paused
    ? 'border-line bg-paper-sunken [&_svg]:text-ink-muted'
    : !warning
      ? 'border-line bg-paper-raised'
      : seconds <= ONE_MINUTE
        ? 'border-red bg-red-soft [&_svg]:text-red'
        : 'border-amber bg-amber-soft [&_svg]:text-amber'

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        className={cn(
          'text-ink flex h-10 items-center gap-2 rounded-md border px-3',
          'transition-colors duration-150 ease-out',
          tone,
        )}
      >
        {paused && <PauseCircleIcon aria-hidden="true" className="size-4 shrink-0" />}
        {warning && <TriangleAlertIcon aria-hidden="true" className="size-4 shrink-0" />}
        <span
          role="timer"
          aria-label={label ?? words.label}
          className="text-mono font-mono font-medium"
        >
          {formatClock(remaining)}
        </span>
        {/* The window carries its name beside the digits, and the working clock does not (D-354). A
            run is under two clocks in its life and they are drawn in the same pill in the same band,
            so the second one has to say which it is: without the word, the last minute of the Turn
            window is a red alarm identical to the one that means the decision is about to be filed
            for you. The working clock is the run's default and stays unlabelled. */}
        {!paused && kind === 'turnWindow' && (
          <span className="text-meta font-medium">{words.label}</span>
        )}
        {/* The pause has a word beside the icon: a stopped clock that only changed colour reads as
            a clock that is still running (DESIGN.md §The clock). */}
        {paused && <span className="text-meta font-medium">{t('run.clockPaused')}</span>}
      </div>

      {/* Empty except on the tick that crosses a threshold, so the announcement is the event and not
          the second it happened on. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  )
}

/**
 * The sentence to announce, or the empty string.
 *
 * It fires on the *crossing*, which is why the previous reading is kept: a student who opens the
 * page with two minutes left is not told "five minutes left", and a clock that sits at 00:00 while
 * the poll catches up is not told it expired over and over. A paused clock announces nothing —
 * nothing is running down.
 */
function useThresholdAnnouncement(
  seconds: number | null,
  paused: boolean,
  words: { fiveMinutes: string; oneMinute: string; expired: string },
): string {
  const [announcement, setAnnouncement] = useState('')
  const previous = useRef<number | null>(null)
  // The sentences are module constants picked by `kind`, so the effect reads them through a ref
  // rather than depending on the object identity: a re-render must not re-fire a crossing.
  const said = useRef(words)
  useEffect(() => {
    said.current = words
  })

  useEffect(() => {
    if (seconds === null || paused) {
      previous.current = seconds
      return
    }
    const before = previous.current
    previous.current = seconds
    // The first reading is a starting point, never a crossing.
    if (before === null || before <= seconds) return

    if (before > 0 && seconds <= 0) setAnnouncement(said.current.expired)
    else if (before > ONE_MINUTE && seconds <= ONE_MINUTE) setAnnouncement(said.current.oneMinute)
    else if (before > FIVE_MINUTES && seconds <= FIVE_MINUTES) {
      setAnnouncement(said.current.fiveMinutes)
    }
  }, [seconds, paused])

  return announcement
}
