'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

// Two facts the working screen needs in one place, because both are about the screen rather than
// about any one panel on it (D-313, D-314).
//
// **1. Where a claim is being worked.** A claim is drawn twice on this screen: inside the
// assistant's live reply, and in the Delegation Log. D-303 put the controls in both, for a real
// reason — the reply is client state and there is one at a time, so after the next request or a
// reload the log is the only copy left. What that produced was two identical instruments on one
// claim, nine affordances each, and no way for the student to tell which of them counts.
//
// So the rule is now one sentence: **a claim is worked where it was most recently surfaced.** The
// assistant panel reports the claims its current reply is holding; the log draws those as the
// record — the text, the stance already taken, the used mark, and a line saying where they are
// being worked — and keeps the full instrument for every other claim it lists. Nothing is lost:
// send the next request or reload the page, the reply empties, and the log's copy is the
// instrument again. `data-claim-id` follows the instrument, so the Decision Lock's "Go to the
// claim" always lands on the copy that can answer it (D-306).
//
// **2. One announcement queue.** Every claim used to carry a `role="status"` of its own, and a busy
// reply put fourteen live regions on one screen: a stance press, a returning check and an autosave
// could speak over one another with nobody owning the order. There is one polite region for the
// working screen now, and every act on a claim — a stance saved, a check run, an escalation
// answered, a used mark, a why line — is announced through it, last message wins. Two regions stay
// outside it and both are addressable by id because they speak about something other than a claim:
// the assistant's `#assistant-reply-status`, which says a stream is over and how many claims it
// produced, and the clock's threshold announcements in the `RunFrame` band.
//
// Both halves are context rather than props because the two panels are siblings under a Server
// Component, which cannot hand a callback from one to the other. The provider is the only client
// component between them.

export type RunWork = {
  /** Claim ids the assistant's current reply is drawing with controls; the log defers on these. */
  worked: readonly string[]
  /** Called by the assistant panel whenever the reply it is holding changes. */
  setWorked: (claimIds: readonly string[]) => void
  /** Say one sentence in the screen's polite region. The last one said is the one that stands. */
  announce: (message: string) => void
}

const RunWorkContext = createContext<RunWork | null>(null)

/**
 * The screen's shared state, and the one live region it speaks through.
 *
 * `children` is server-rendered and passed straight through, so the panels below keep their own
 * server rendering, their reading order and their a11y tree; only the context travels.
 */
export function RunWorkProvider({ children }: { children: ReactNode }) {
  const [worked, setWorkedState] = useState<readonly string[]>([])
  const [announcement, setAnnouncement] = useState('')

  const setWorked = useCallback((claimIds: readonly string[]) => {
    setWorkedState((held) =>
      held.length === claimIds.length && held.every((id, index) => id === claimIds[index])
        ? held
        : [...claimIds],
    )
  }, [])

  const announce = useCallback((message: string) => {
    setAnnouncement(message)
  }, [])

  const value = useMemo<RunWork>(
    () => ({ worked, setWorked, announce }),
    [worked, setWorked, announce],
  )

  return (
    <RunWorkContext.Provider value={value}>
      {/* Stays mounted and collapses when empty, so an announcement fires on the sentence changing
          rather than on the region being inserted. It is `sr-only` because every act it reports
          already shows itself on screen — a chip filling, a sheet opening, a badge appearing — and
          a second visible copy of that would be the screen narrating itself. */}
      <p id="run-announcer" role="status" aria-live="polite" className="sr-only empty:hidden">
        {announcement}
      </p>
      {children}
    </RunWorkContext.Provider>
  )
}

/**
 * The screen's shared state, or a no-op standing in for it.
 *
 * A claim card is also drawn where there is no provider — the Turn's read-only record, the
 * reviewer's replay — and neither needs the queue nor the hand-off. The fallback is silent rather
 * than an error for that reason: `worked` is empty, so every copy is the instrument, which is
 * exactly right for a screen that draws a claim once.
 */
export function useRunWork(): RunWork {
  return useContext(RunWorkContext) ?? FALLBACK
}

const FALLBACK: RunWork = {
  worked: [],
  setWorked: () => undefined,
  announce: () => undefined,
}
