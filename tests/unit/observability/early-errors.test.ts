// @vitest-environment jsdom
// The window the lazy Sentry SDK would otherwise leave open (D-579).
//
// `src/instrumentation-client.ts` runs before React hydrates, but its `import('@sentry/nextjs')`
// resolves after hydration has begun. Everything thrown in between — a hydration mismatch, a module
// that throws while it initializes — would arrive with no handler installed. These assertions are
// the proof that it does not: the listeners exist from the synchronous first line, and what they
// catch reaches `captureException` once the SDK is up.
import { describe, expect, it, vi } from 'vitest'
import { installEarlyErrorBuffer, type EarlyError } from '@/lib/observability/early-errors'

// A detached target rather than `window`: an `error` event dispatched on the real window with no
// listener left is reported by jsdom as an uncaught error, which is noise about the test rather
// than about the code.
type Target = Pick<Window, 'addEventListener' | 'removeEventListener'>
const makeTarget = (): EventTarget & Target => new EventTarget() as EventTarget & Target

const dispatchError = (target: EventTarget, message: string, error?: unknown): void => {
  target.dispatchEvent(new ErrorEvent('error', { message, error }))
}

const dispatchRejection = (target: EventTarget, reason: unknown): void => {
  // jsdom does not construct PromiseRejectionEvent, so the shape the handler reads is dispatched.
  const event = new Event('unhandledrejection') as Event & { reason: unknown }
  event.reason = reason
  target.dispatchEvent(event)
}

describe('installEarlyErrorBuffer', () => {
  it('holds what is thrown before the SDK arrives and replays it in order', () => {
    const target = makeTarget()
    const buffer = installEarlyErrorBuffer(target)
    const boom = new Error('hydration failed')

    dispatchError(target, 'hydration failed', boom)
    dispatchRejection(target, 'a rejected promise')

    const captured: EarlyError[] = []
    buffer.drain((error) => captured.push(error))

    expect(captured).toEqual([
      { value: boom, kind: 'error' },
      { value: 'a rejected promise', kind: 'unhandledrejection' },
    ])
  })

  it('falls back to the message when the event carries no Error object', () => {
    const target = makeTarget()
    const buffer = installEarlyErrorBuffer(target)
    dispatchError(target, 'Script error.')
    const captured: EarlyError[] = []
    buffer.drain((error) => captured.push(error))
    expect(captured).toEqual([{ value: 'Script error.', kind: 'error' }])
  })

  it('stops listening once drained, so Sentry alone owns what happens next', () => {
    const target = makeTarget()
    const buffer = installEarlyErrorBuffer(target)
    const capture = vi.fn()
    buffer.drain(capture)
    expect(capture).not.toHaveBeenCalled()

    dispatchError(target, 'after handover', new Error('after handover'))
    buffer.drain(capture)
    expect(capture).not.toHaveBeenCalled()
    expect(buffer.pending).toHaveLength(0)
  })

  it('bounds a crash loop rather than growing without limit', () => {
    const target = makeTarget()
    const buffer = installEarlyErrorBuffer(target, 3)
    for (let i = 0; i < 25; i += 1) dispatchError(target, `boom ${i}`, new Error(`boom ${i}`))
    const captured: EarlyError[] = []
    buffer.drain((error) => captured.push(error))
    expect(captured).toHaveLength(3)
  })

  it('installs nothing that survives it: the listeners are removed on drain', () => {
    const spy = { addEventListener: vi.fn(), removeEventListener: vi.fn() }
    const buffer = installEarlyErrorBuffer(spy)
    expect(spy.addEventListener).toHaveBeenCalledTimes(2)
    buffer.drain(vi.fn())
    expect(spy.removeEventListener).toHaveBeenCalledTimes(2)
  })
})
