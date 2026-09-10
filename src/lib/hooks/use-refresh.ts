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
// components that refresh are many and the router is one; the instance that started the flight is
// the one that clears it, from its own transition's `pending`, and a flight older than the stale
// bound is treated as over so an unmounted starter cannot hold the page hostage.

/** How long a flight may be believed before it is treated as finished (a refresh takes well under a second). */
const STALE_MS = 5_000

let inFlight = 0 // the instant the flight started, or 0 when none is in flight
let queued = false

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

  // The starter's transition settling is the end of the flight; a queued request runs then.
  useEffect(() => {
    if (pending || !startedHere.current) return
    startedHere.current = false
    inFlight = 0
    if (queued) start()
  }, [pending, start])

  return useCallback((): void => {
    if (inFlight !== 0 && Date.now() - inFlight < STALE_MS) {
      queued = true
      return
    }
    start()
  }, [start])
}

/** Test seam: forgets any flight, so one test's refresh cannot queue behind another's. */
export function resetRefreshState(): void {
  inFlight = 0
  queued = false
}
