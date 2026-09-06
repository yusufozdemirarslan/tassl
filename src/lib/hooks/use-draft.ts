'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// A draft of what is in a box, kept in the tab the student is writing in, so a reload does not
// take it (D-360).
//
// **Why this is not the brief's autosave.** `saveBriefDraftAction` writes a `run_briefs` row, and
// that is right for the brief: FR-108 makes the draft a *record* the run carries — the auto-lock
// files it when the clock runs out, so the server has to hold it. The Turn justification and the
// defense answer are not records. Neither is filed until the student presses, both are immutable
// once filed, and the trace must gain no event for a keystroke. A draft of them is a convenience
// belonging to one browser tab, so it lives in one browser tab: no table, no endpoint, no action,
// no trace consideration, and nothing that can desynchronise the record from what was submitted.
//
// **`sessionStorage`, not `localStorage`.** The failure this closes is a reload, a mis-hit shortcut
// or a crashed tab, and a tab's storage survives all three (a restored session restores it with the
// tab). What it does not survive is the tab being closed, which is the point: a student's unsent
// defense answer must not sit on a shared lab machine for the next person to open the browser on,
// and a per-tab shelf that empties itself needs no expiry policy of its own to guarantee that.
//
// **Every read and write is wrapped.** Private modes, "block site data", and a full quota all throw
// on the property access or on the write, and none of them is a reason a student cannot type. When
// storage refuses, `restored` stays false, `save` does nothing, and the form behaves exactly as it
// did before this hook existed.
//
// **The read happens after mount, never during render.** These forms are server-rendered and then
// hydrated; seeding state from storage during the first render would make the client's tree differ
// from the HTML it is hydrating. So the restore is an effect: the first paint is the server's empty
// form, and the draft arrives with it.
//
// Nothing here reaches the network. A draft is never sent, never announced to another viewer, and
// never carries a measurement — see `defense-question.tsx` on `durationMs`.

/** One namespace for the product's drafts, so nothing else in the tab can collide with them. */
const PREFIX = 'tassl.draft.'

/** The tab's shelf, or null wherever it cannot be reached (the server, a browser refusing it). */
function shelf(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    // Some browsers throw on the property access itself when site data is blocked.
    return null
  }
}

export type Draft<T> = {
  /** True once a stored draft has been put back into the form; the screen says so when it is. */
  restored: boolean
  /** Keep the stored draft in step with the box. Silent when storage refuses, and after `discard`. */
  save: (value: T) => void
  /** Forget it, and stop keeping it. Called when the thing it was a draft of has been filed. */
  discard: () => void
}

export type DraftOptions<T> = {
  /** Identifies the one surface this is a draft of; the run and the question it belongs to. */
  key: string
  /**
   * False once the surface is no longer being written — an answer filed, a question not open.
   * Nothing is restored, and anything already stored under the key is forgotten, so a filed answer
   * can never come back as an editable draft.
   */
  active?: boolean
  /**
   * What was on the shelf, narrowed to the shape this form writes, or null to ignore it.
   *
   * It returns null for a draft with nothing in it as well as for one that does not parse: an
   * empty draft is not something to tell the student about.
   */
  revive: (held: unknown) => T | null
  /** Put the revived draft into the form. Called at most once per key, after mount. */
  restore: (value: T) => void
}

/**
 * A per-tab draft of one writing surface.
 *
 * `revive` and `restore` need not be stable: they are read through a ref, so the restore runs once
 * for a given key and a re-render never re-seeds a box the student has since typed in.
 */
export function useDraft<T>({ key, active = true, revive, restore }: DraftOptions<T>): Draft<T> {
  const name = PREFIX + key
  const [restored, setRestored] = useState(false)
  const discarded = useRef(false)
  const restoredFor = useRef<string | null>(null)

  // Written in an effect and never during render, which React's purity rules forbid. A commit-phase
  // effect with no dependency list runs before the keyed effect below on mount, so the first read
  // already sees this render's callbacks.
  const handlers = useRef({ revive, restore })
  useEffect(() => {
    handlers.current = { revive, restore }
  })

  useEffect(() => {
    const store = shelf()
    if (store === null) return

    if (!active) {
      try {
        store.removeItem(name)
      } catch {
        // Nothing to do and nothing to say: the draft is unreachable either way.
      }
      return
    }

    if (restoredFor.current === name) return
    restoredFor.current = name

    let held: unknown
    try {
      const raw = store.getItem(name)
      if (raw === null) return
      held = JSON.parse(raw)
    } catch {
      // Storage refused, or the tab holds something this build does not understand. Either way the
      // form opens empty, which is what it did before there were drafts.
      return
    }

    const value = handlers.current.revive(held)
    if (value === null) return
    handlers.current.restore(value)
    setRestored(true)
  }, [name, active])

  const save = useCallback(
    (value: T) => {
      if (discarded.current) return
      const store = shelf()
      if (store === null) return
      try {
        store.setItem(name, JSON.stringify(value))
      } catch {
        // Quota, private mode, or a serialization the browser refused. The box keeps its text; only
        // the safety net is missing, and claiming otherwise on screen would be the worse failure.
      }
    },
    [name],
  )

  const discard = useCallback(() => {
    discarded.current = true
    const store = shelf()
    if (store === null) return
    try {
      store.removeItem(name)
    } catch {
      // See above.
    }
  }, [name])

  return { restored, save, discard }
}
