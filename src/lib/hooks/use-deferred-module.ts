'use client'

import { useCallback, useState } from 'react'

// B4 / NFR-013 (16 §3.2). Code that only runs once a control is used is not part of what a route
// paints, so it should not be part of what the route downloads: the dialog forms
// (react-hook-form, the zod/mini schema, the resolver and the field primitives) and the header's
// two menus (the Base UI menu and its positioner) are fetched on the press that needs them.
//
// The import can fail — an offline moment, a deployment that moved the file — and a control that
// does nothing is worse than no control, so every caller says so where the missing thing would
// have been and calls `request` again on the next press.

export type DeferredStatus = 'idle' | 'loading' | 'failed'

export type DeferredModule<T extends object> = {
  /** The module once it has arrived; null until then, and after a failed import. */
  loaded: T | null
  status: DeferredStatus
  /** Starts the import, or retries it after a failure. Safe to call on every open. */
  request: () => void
}

/**
 * Loads a client module on demand. `load` must be a module-scope arrow holding a literal
 * `import()` — the bundler matches the call site to the chunk, so a variable path would not split.
 */
export function useDeferredModule<T extends object>(load: () => Promise<T>): DeferredModule<T> {
  const [loaded, setLoaded] = useState<T | null>(null)
  const [status, setStatus] = useState<DeferredStatus>('idle')

  const request = useCallback(() => {
    if (loaded !== null) return
    setStatus('loading')
    void load().then(
      (mod) => {
        setLoaded(mod)
        setStatus('idle')
      },
      () => {
        setStatus('failed')
      },
    )
  }, [load, loaded])

  return { loaded, status, request }
}
