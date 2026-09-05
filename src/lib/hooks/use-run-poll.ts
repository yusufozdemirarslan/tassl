'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// The five-second poll of 09 §8: every run screen asks `GET /api/v1/runs/{runId}` while something
// on it can change without the student doing anything — a clock running out, the Turn arriving,
// scoring finishing.
//
// It is a poll rather than a stream because the thing being watched is a timer that the *server*
// materializes on read (D-042): the request is not only how the client learns, it is also what
// makes an expiry happen at all when nobody else is looking. A socket held open would still need
// the same read behind it.
//
// `If-None-Match` is what keeps it cheap. The run's version is its event count, the route answers
// `ETag: "v<version>"`, and a run where nothing has happened answers `304` with no body (D-123,
// D-224). The 304 is decided *after* the service has materialized timers, so the cheap answer is
// never the reason a run stays where it was.
//
// Three things this hook does not do. It does not refresh the page: the caller is handed the change
// and decides, because a state change on the workspace means `router.refresh()` and a state change
// on the status screen means the same call for a different reason, and a hook that guessed would be
// wrong on one of them. It does not count anything down — `useClock` does that, from the reading
// this one delivers. And it keeps no copy of the server render: which of the two is newer is
// decided in the render below, by version, so there is no state to synchronize and no moment where
// the two disagree.

/** The only field of the polled body this hook reads; `RunSummary` satisfies it (07 §10). */
export type PolledRun = { version: number }

export type RunPollOptions<T extends PolledRun> = {
  runId: string
  /** The run as the server rendered it. Whichever of it and the poll is newer is what is returned. */
  initial: T
  /** False on a run that cannot change on its own; the hook then never asks. */
  enabled?: boolean
  intervalMs?: number
  /** Called after a poll that returned a newer version than the poll's own last answer. */
  onChange?: (next: T, previous: T) => void
}

const POLL_MS = 5_000

/** The run as it now stands: the newer of what the server rendered and what the poll last fetched. */
export function useRunPoll<T extends PolledRun>(options: RunPollOptions<T>): T {
  const { runId, initial, enabled = true, intervalMs = POLL_MS } = options

  const [polled, setPolled] = useState<T | null>(null)

  // Refs, not state: the loop reads them and must not be restarted when they change. `latest` is
  // the mirror the comparison is made against, so the decision to call `onChange` is taken in the
  // fetch callback and never inside a `setState` updater, which React is free to run twice.
  const latest = useRef<T | null>(null)
  const server = useRef<T>(initial)
  const etag = useRef<string | null>(null)
  const onChange = useRef(options.onChange)
  useEffect(() => {
    onChange.current = options.onChange
    server.current = initial
  })

  const apply = useCallback((next: T): void => {
    // What the screen is showing right now, which on the first poll of a page is the server render
    // and after a `router.refresh()` may be the server render again. Comparing against the polled
    // answer alone would miss the change a fresh page's very first poll finds, which is exactly the
    // case that matters: a student who reloads `/work` a second before their clock runs out.
    const held = latest.current
    const previous = held === null || server.current.version > held.version ? server.current : held
    if (next.version <= previous.version) return
    latest.current = next
    setPolled(next)
    onChange.current?.(next, previous)
  }, [])

  useEffect(() => {
    if (!enabled) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const schedule = (): void => {
      if (stopped) return
      timer = setTimeout(() => void poll(), intervalMs)
    }

    const poll = async (): Promise<void> => {
      if (stopped) return
      // A hidden tab is not being read, and the deadline it is counting against does not move while
      // nothing happens, so there is nothing to learn until it comes back. The listener below asks
      // the moment it does.
      if (document.hidden) {
        schedule()
        return
      }
      try {
        const tag = etag.current
        const response = await fetch(`/api/v1/runs/${runId}`, {
          cache: 'no-store',
          ...(tag === null ? {} : { headers: { 'If-None-Match': tag } }),
        })
        if (stopped) return
        if (response.ok) {
          etag.current = response.headers.get('etag')
          apply((await response.json()) as T)
        }
        // 304: the run is exactly where the client already has it, and nothing is re-anchored.
        // 4xx and 5xx: the screen keeps what it has. A run that has become unreadable — signed out,
        // voided out from under the reader — is the server render's business on the next
        // navigation, not a poll's to act on.
      } catch {
        // Offline, or the request was cut off. Ask again on the next tick.
      }
      schedule()
    }

    const onVisible = (): void => {
      if (document.hidden || stopped) return
      if (timer !== undefined) clearTimeout(timer)
      void poll()
    }

    schedule()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [runId, enabled, intervalMs, apply])

  // A fresh server render — `router.refresh()` after a write, or a navigation — may carry a version
  // the poll has not seen, and the poll may be ahead of a payload that was serialized before it.
  // Comparing them here rather than copying one into the other means there is never a render where
  // the screen shows the older of the two.
  if (polled === null || initial.version >= polled.version) return initial
  return polled
}
