'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useTransition } from 'react'

// One `router.refresh()` in flight at a time (D-709).
//
// Every save in the product ends with a refresh so the server render carries the new state. Two
// saves in quick succession — two stance chips pressed a hundred milliseconds apart — used to start
// two refreshes, and the second cancelled the first mid-body. Chromium and WebKit report a
// cancelled fetch as an abort, which Next expects; Firefox reports the cancelled response stream as
// `TypeError: Error in input stream`, which Next does not, so React logged it and the route's error
// boundary rendered for a moment before the second refresh replaced it. The reader saw a flash of
// "Something went wrong" between two clicks that had both succeeded.
//
// This hook is what every component calls instead of `router.refresh()`. A refresh asked for while
// one is in flight is not started; it is remembered, and one more refresh runs when the current one
// settles — which is all a second refresh could have added, since a refresh renders the server's
// state at the moment it runs. The flight is tracked for the whole page (module state), because the
// components that refresh are many and the router is one.
//
// A remembered refresh must never be lost (D-713). The flight ends in one of three ways, and each
// of them runs the remembered refresh through whichever instance is still mounted: the starter's
// transition settles; the starter unmounts mid-flight (the refresh it started replaced its own
// subtree, which is common — a confirmed element re-renders as a different row); or the stale bound
// passes without either, in which case a timer armed when the refresh was remembered ends the
// flight. Before the last two existed, a refresh remembered behind a starter that unmounted waited
// for the *next* call to notice the stale flight, and if no call came it never ran: an element
// confirmed a hundred milliseconds after another stayed unconfirmed on screen until the reader did
// something else.

/** How long a flight may be believed before it is treated as finished (a refresh takes well under a second). */
const STALE_MS = 5_000

let inFlight = 0 // the instant the flight started, or 0 when none is in flight
let queued = false
let staleTimer: ReturnType<typeof setTimeout> | null = null
/** Every mounted instance's `start`, so a remembered refresh can run through any of them. */
const live = new Set<() => void>()

/** The flight is over: run the remembered refresh, if any, through a mounted instance. */
function settle(): void {
  inFlight = 0
  if (staleTimer !== null) {
    clearTimeout(staleTimer)
    staleTimer = null
  }
  if (!queued) return
  // No instance mounted at this instant: the refresh stays remembered for the next one to register.
  const run = live.values().next().value
  if (run) run()
}

/** Remember a refresh asked for mid-flight, and make sure the flight ends by the stale bound. */
function remember(): void {
  queued = true
  if (staleTimer !== null) return
  const remaining = Math.max(0, STALE_MS - (Date.now() - inFlight))
  staleTimer = setTimeout(() => {
    staleTimer = null
    if (inFlight !== 0) settle()
  }, remaining)
}

export type Refresh = () => void

export function useRefresh(): Refresh {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const startedHere = useRef(false)

  const start = useCallback((): void => {
    inFlight = Date.now()
    queued = false
    startedHere.current = true
    startTransition(() => {
      router.refresh()
    })
  }, [router])

  // Registered while mounted; a remembered refresh runs through any registered instance, and one
  // left over from a moment with no instance mounted runs as soon as this one registers.
  useEffect(() => {
    live.add(start)
    if (queued && inFlight === 0) start()
    return () => {
      live.delete(start)
    }
  }, [start])

  // The starter leaving mid-flight ends the flight, since its transition can no longer report.
  // This is the unmount alone (no dependencies), not every change of `start`.
  useEffect(
    () => () => {
      if (!startedHere.current) return
      startedHere.current = false
      settle()
    },
    [],
  )

  // The starter's transition settling is the end of the flight; a remembered refresh runs then.
  useEffect(() => {
    if (pending || !startedHere.current) return
    startedHere.current = false
    settle()
  }, [pending])

  return useCallback((): void => {
    if (inFlight !== 0 && Date.now() - inFlight < STALE_MS) {
      remember()
      return
    }
    start()
  }, [start])
}

/** Test seam: forgets any flight, so one test's refresh cannot queue behind another's. */
export function resetRefreshState(): void {
  inFlight = 0
  queued = false
  if (staleTimer !== null) {
    clearTimeout(staleTimer)
    staleTimer = null
  }
}
