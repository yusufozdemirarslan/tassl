// D-721: the request-error seam drops a client disconnect and reports everything else.
//
// The exemption is one message wide on purpose, and this is what keeps it that width. A filter that
// grew to "render errors are noisy" would silence the class of failure Sentry exists to catch, so
// each case below states one of the two halves: the disconnect never reaches Sentry, and an
// ordinary error still does — including one whose message merely mentions a stream.
import * as Sentry from '@sentry/nextjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { onRequestError } from '@/instrumentation'

const captureRequestError = vi.mocked(Sentry.captureRequestError)

/** The two arguments Next passes beside the error; neither is read by the filter. */
const REQUEST = { path: '/runs/abc', method: 'GET', headers: {} }
const CONTEXT = { routerKind: 'App Router', routePath: '/runs/[runId]', routeType: 'render' }

const report = (error: unknown): unknown =>
  (onRequestError as (error: unknown, request: unknown, context: unknown) => unknown)(
    error,
    REQUEST,
    CONTEXT,
  )

beforeEach(() => {
  captureRequestError.mockReset()
})

describe('onRequestError', () => {
  it('drops the render React cancels when the client goes away', () => {
    // React's own words, raised once per unfinished Suspense boundary when Next destroys the
    // PassThrough it pipes the renderer into. A closed tab is not an incident.
    report(new Error('The destination stream closed early.'))
    expect(captureRequestError).not.toHaveBeenCalled()
  })

  it('reports an ordinary render error', () => {
    const error = new Error('Cannot read properties of undefined')
    report(error)
    expect(captureRequestError).toHaveBeenCalledWith(error, REQUEST, CONTEXT)
  })

  it('reports a stream error that is not the disconnect', () => {
    // The neighbouring message in React's renderer is a real write failure on the response stream,
    // not a client that left, and nothing observed has ever produced it here. It stays reportable.
    const error = new Error('The destination stream errored while writing data.')
    report(error)
    expect(captureRequestError).toHaveBeenCalledWith(error, REQUEST, CONTEXT)
  })

  it('reports an error whose message merely contains the disconnect sentence', () => {
    // The match is the whole message, not a substring: a failure that quotes React's line while
    // describing something else is still a failure.
    const error = new Error('Upstream said: The destination stream closed early. Retrying.')
    report(error)
    expect(captureRequestError).toHaveBeenCalledWith(error, REQUEST, CONTEXT)
  })

  it('reports a thrown value that is not an Error', () => {
    report('The destination stream closed early.')
    expect(captureRequestError).toHaveBeenCalledWith(
      'The destination stream closed early.',
      REQUEST,
      CONTEXT,
    )
  })
})
