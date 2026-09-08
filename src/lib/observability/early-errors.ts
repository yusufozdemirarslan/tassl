// The pre-hydration error buffer (D-579).
//
// The Sentry browser SDK is loaded with `import()`, because importing it at module scope charges
// 84,724 bytes of gzip to every route in the product. What that would ordinarily cost is the errors
// most worth having: `src/instrumentation-client.ts` runs before React hydrates, but a dynamic
// import resolves after it, so an error thrown during hydration would arrive before any handler
// existed and be lost.
//
// This closes that window with two listeners and an array — no dependency, a few hundred bytes, and
// installed synchronously before the SDK is even requested. `drain` hands over what they caught the
// moment the SDK is up. It lives here rather than inline so it can be tested without booting either
// SDK, and so `instrumentation-client.ts` stays a file of configuration.

export type EarlyError = { value: unknown; kind: 'error' | 'unhandledrejection' }

export type EarlyErrorBuffer = {
  /** Removes the listeners and replays what they caught, oldest first. Safe to call twice. */
  drain: (capture: (error: EarlyError) => void) => void
  /** For tests: what is held right now. */
  readonly pending: readonly EarlyError[]
}

/** Ten is far more than a page throws before it is interactive, and it bounds a crash loop. */
const DEFAULT_MAX = 10

export function installEarlyErrorBuffer(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  max: number = DEFAULT_MAX,
): EarlyErrorBuffer {
  const pending: EarlyError[] = []

  const onError = (event: Event): void => {
    if (pending.length >= max) return
    const { error, message } = event as ErrorEvent
    pending.push({ value: error ?? message, kind: 'error' })
  }
  const onRejection = (event: Event): void => {
    if (pending.length >= max) return
    pending.push({ value: (event as PromiseRejectionEvent).reason, kind: 'unhandledrejection' })
  }

  target.addEventListener('error', onError)
  target.addEventListener('unhandledrejection', onRejection)

  let drained = false
  return {
    pending,
    drain(capture) {
      if (drained) return
      drained = true
      target.removeEventListener('error', onError)
      target.removeEventListener('unhandledrejection', onRejection)
      // A copy, so a `capture` that throws cannot leave the array half-replayed on a retry.
      const held = pending.splice(0, pending.length)
      for (const error of held) capture(error)
    },
  }
}
