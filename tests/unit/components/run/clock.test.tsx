import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Clock } from '@/components/features/run/clock'
import { enUS } from '@/lib/i18n/en-US'

// Step 6.5's acceptance test: the clock renders mm:ss from a deadline, and its live region carries
// the threshold sentences and nothing else.
//
// Time is frozen, so `Date.now()` and `setTimeout` are the same fake clock the component counts
// against. That is the whole point of the design under test: the component is handed the server's
// *reading*, turns it into a deadline at the instant it arrives, and re-reads the wall clock on
// every tick — so advancing the fake clock by n seconds must move the display by exactly n seconds,
// with no dependence on how many timer callbacks ran.

const START = Date.UTC(2026, 8, 5, 12, 0, 0)

function renderClock(remainingMs: number, paused = false) {
  return render(<Clock clock={{ remainingMs, paused }} />)
}

const timer = () => screen.getByRole('timer')
const liveRegion = () => screen.getByRole('status')

/** Advance the fake clock inside `act`, so every tick's re-render is flushed before we assert. */
function tick(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

describe('Clock (UI-027)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(START)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('mm:ss from a deadline', () => {
    it('renders the server reading as mm:ss and names itself', () => {
      renderClock(125_000)
      expect(timer()).toHaveTextContent('02:05')
      expect(timer()).toHaveAccessibleName(enUS['run.clockLabel'])
    })

    it('counts down one second at a time from the deadline the reading anchored', () => {
      renderClock(125_000)
      tick(1_000)
      expect(timer()).toHaveTextContent('02:04')
      tick(4_000)
      expect(timer()).toHaveTextContent('02:00')
    })

    it('pads both fields and does not wrap minutes into hours', () => {
      renderClock(4_500_000) // 75:00
      expect(timer()).toHaveTextContent('75:00')
      tick(4_499_000)
      expect(timer()).toHaveTextContent('00:01')
    })

    it('stops at 00:00 and never goes negative', () => {
      renderClock(2_000)
      tick(10_000)
      expect(timer()).toHaveTextContent('00:00')
    })

    it('catches up in one step when the tab was throttled or asleep', () => {
      renderClock(600_000)
      // One jump of four minutes, however many callbacks the environment ran in between.
      tick(240_000)
      expect(timer()).toHaveTextContent('06:00')
    })

    it('shows a paused clock frozen at its reading, with the pause named', () => {
      renderClock(180_000, true)
      expect(timer()).toHaveTextContent('03:00')
      expect(screen.getByText(enUS['run.clockPaused'])).toBeInTheDocument()
      tick(60_000)
      expect(timer()).toHaveTextContent('03:00')
    })

    it('renders nothing when the run has no working clock', () => {
      render(<Clock clock={null} />)
      expect(screen.queryByRole('timer')).not.toBeInTheDocument()
    })

    it('shows the server reading before the first tick, so hydration matches the HTML', () => {
      renderClock(125_000)
      // Nothing has been scheduled long enough to fire; the digits are the server's own number.
      expect(timer()).toHaveTextContent('02:05')
    })

    it('re-anchors on a new reading rather than counting on from the old one', () => {
      const view = render(<Clock clock={{ remainingMs: 125_000, paused: false }} />)
      tick(5_000)
      expect(timer()).toHaveTextContent('02:00')
      // A credit lands: the server says there is more time than the browser was counting to.
      view.rerender(<Clock clock={{ remainingMs: 300_000, paused: false }} />)
      expect(timer()).toHaveTextContent('05:00')
      tick(2_000)
      expect(timer()).toHaveTextContent('04:58')
    })
  })

  describe('the live region at the thresholds', () => {
    it('says nothing while there is more than five minutes left', () => {
      renderClock(360_000)
      tick(3_000)
      expect(liveRegion()).toHaveTextContent('')
    })

    it('announces five minutes on the tick that crosses 05:00', () => {
      renderClock(302_000)
      tick(1_000)
      expect(liveRegion()).toHaveTextContent('')
      tick(1_000)
      expect(timer()).toHaveTextContent('05:00')
      expect(liveRegion()).toHaveTextContent(enUS['run.clockFiveMinutes'])
    })

    it('announces one minute on the tick that crosses 01:00', () => {
      renderClock(62_000)
      tick(2_000)
      expect(timer()).toHaveTextContent('01:00')
      expect(liveRegion()).toHaveTextContent(enUS['run.clockOneMinute'])
    })

    it('announces the expiry once the clock reaches 00:00', () => {
      renderClock(2_000)
      tick(2_000)
      expect(timer()).toHaveTextContent('00:00')
      expect(liveRegion()).toHaveTextContent(enUS['run.clockExpired'])
    })

    it('replaces the five-minute sentence with the one-minute one, and does not repeat either', () => {
      renderClock(302_000)
      tick(2_000)
      expect(liveRegion()).toHaveTextContent(enUS['run.clockFiveMinutes'])
      // Between the two thresholds the region holds the last thing said and adds nothing.
      tick(180_000)
      expect(liveRegion()).toHaveTextContent(enUS['run.clockFiveMinutes'])
      tick(60_000)
      expect(timer()).toHaveTextContent('01:00')
      expect(liveRegion()).toHaveTextContent(enUS['run.clockOneMinute'])
    })

    it('says nothing on a clock that opens below a threshold: nothing was crossed', () => {
      renderClock(120_000)
      tick(3_000)
      expect(liveRegion()).toHaveTextContent('')
    })

    it('says nothing while the clock is paused: nothing is running down', () => {
      renderClock(30_000, true)
      tick(60_000)
      expect(liveRegion()).toHaveTextContent('')
    })
  })
})
