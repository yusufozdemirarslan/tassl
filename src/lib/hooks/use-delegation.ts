'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// The client half of `POST /api/v1/runs/{runId}/delegations` (07 §7, AI-002): the one endpoint in
// the product that answers `text/event-stream`, read here with `fetch` and a reader.
//
// **A reader, not a state machine, and D-271 is why.** The service completes the whole reply before
// it yields anything: the defect-word filter and the numeric guard are whole-reply passes and have
// to run before a word reaches the screen, so the delegation is guarded, stored and traced before
// the response headers are written. Everything that can refuse — the state gate, the length limit,
// the rate bucket, a provider that never answered — is therefore an ordinary JSON error envelope
// with a status, and a 200 means every event will arrive. There is no half-answered stream to
// interpret and nothing here has to decide what a truncated reply means.
//
// `EventSource` cannot be used for it. That API is GET-only and cannot set a header, and this is a
// cookie-authenticated POST carrying `X-Requested-With: tassl` (08 §2.7) and a JSON body. So the
// framing of 07 §7 — `event: <name>`, one `data:` line of JSON, a blank line — is parsed here, from
// the response body's own reader.
//
// **The claim is carried opaquely, and that is a boundary rule rather than a preference.** This file
// lives in `src/lib`, which never imports `src/server` (04 §2, the ESLint `boundaries` policy), so
// the `ClaimView` a `segment` event carries cannot be named here. The hook is generic over it: the
// component that renders the card imports the type from the module schema, which components may do,
// and hands it in. Nothing is validated beyond the frame's own shape — the payload is our own
// server's answer to our own request, and a second copy of `ClaimViewSchema` in the browser would
// be one more thing to keep in step with the module that owns it.

/** 07 §7's `segment` event: the assistant's own prose, or one claim object. */
export type DelegationSegment<TClaim> =
  { type: 'text'; text: string } | { type: 'claim'; claim: TClaim }

/** What a refusal leaves behind: the envelope's own words, and the wait when there is one. */
export type DelegationFailure = {
  code: string
  message: string
  /** `RATE_LIMITED` only (`details.retryAfterSeconds`); null everywhere else. */
  retryAfterSeconds: number | null
  /**
   * The envelope's own `requestId`, so the refusal on screen can be quoted (D-322).
   *
   * Undefined where there is no envelope to read it from: a socket that closed mid-stream and a
   * `fetch` that never reached the server have no request id, and inventing one would be worse for
   * the person trying to look it up than leaving it out.
   */
  requestId?: string
}

export type DelegationStatus = 'idle' | 'streaming' | 'complete' | 'failed'

export type DelegationState<TClaim> = {
  status: DelegationStatus
  /** The request as it was sent, so the reply on screen keeps the question above it. */
  request: string | null
  segments: readonly DelegationSegment<TClaim>[]
  /** The claims this reply surfaced; the number the completion announcement reads out. */
  claimCount: number
  /** Set by the `done` event (07 §7). */
  delegationId: string | null
  error: DelegationFailure | null
}

export type UseDelegationOptions = {
  /**
   * Called once, after `done`. The workspace refreshes its server tree from here: the Delegation
   * Log and the claim list are read by the page, and this delegation has just changed both.
   */
  onComplete?: (delegationId: string) => void
  /** Called when the request was refused or the stream broke, with the envelope's code. */
  onFailed?: (failure: DelegationFailure) => void
}

export type UseDelegation<TClaim> = {
  state: DelegationState<TClaim>
  /** Sends a request. A send while one is in flight replaces it: the earlier read is aborted. */
  send: (request: string) => void
}

const idle = <TClaim>(): DelegationState<TClaim> => ({
  status: 'idle',
  request: null,
  segments: [],
  claimCount: 0,
  delegationId: null,
  error: null,
})

/** The envelope every refusal on `/api/v1` carries (10 §1). */
type ErrorEnvelope = {
  error?: {
    code?: unknown
    message?: unknown
    requestId?: unknown
    details?: { retryAfterSeconds?: unknown }
  }
}

function failureOf(body: unknown, fallback: string): DelegationFailure {
  const envelope = (body ?? {}) as ErrorEnvelope
  const { code, message, requestId, details } = envelope.error ?? {}
  const seconds = details?.retryAfterSeconds
  return {
    code: typeof code === 'string' ? code : 'INTERNAL_ERROR',
    message: typeof message === 'string' && message !== '' ? message : fallback,
    retryAfterSeconds: typeof seconds === 'number' && Number.isFinite(seconds) ? seconds : null,
    ...(typeof requestId === 'string' && requestId !== '' ? { requestId } : {}),
  }
}

/** One parsed frame: the event name and its single JSON payload. */
type Frame = { event: string; data: unknown }

/**
 * Reads one SSE frame (07 §7's wire format).
 *
 * `data:` lines are joined with newlines, which is what the specification says to do and costs
 * nothing here — `JSON.stringify` never emits a raw newline, so our own server always writes one.
 * A frame with no `data:` line, or one whose payload is not JSON, is dropped rather than thrown on:
 * a comment or a keep-alive is a legal thing for a stream to carry.
 */
function parseFrame(frame: string): Frame | null {
  let event = 'message'
  const data: string[] = []
  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
  }
  if (data.length === 0) return null
  try {
    return { event, data: JSON.parse(data.join('\n')) as unknown }
  } catch {
    return null
  }
}

/** A `segment` payload, as far as this file is allowed to know it. */
function toSegment<TClaim>(data: unknown): DelegationSegment<TClaim> | null {
  if (typeof data !== 'object' || data === null) return null
  const segment = data as { type?: unknown; text?: unknown; claim?: unknown }
  if (segment.type === 'text' && typeof segment.text === 'string') {
    return { type: 'text', text: segment.text }
  }
  if (segment.type === 'claim' && typeof segment.claim === 'object' && segment.claim !== null) {
    return { type: 'claim', claim: segment.claim as TClaim }
  }
  return null
}

const delegationIdOf = (data: unknown): string | null => {
  if (typeof data !== 'object' || data === null) return null
  const { delegationId } = data as { delegationId?: unknown }
  return typeof delegationId === 'string' ? delegationId : null
}

/**
 * The assistant panel's delegation: one request, the reply as it arrives, and how it ended.
 *
 * `fallbackMessage` is the sentence shown when the failure carries none of its own — the browser
 * went offline, or the stream stopped before `done`. Every other message on screen is the server's,
 * because a refusal states its own reason better than a screen can guess it.
 */
export function useDelegation<TClaim>(
  runId: string,
  fallbackMessage: string,
  options: UseDelegationOptions = {},
): UseDelegation<TClaim> {
  const [state, setState] = useState<DelegationState<TClaim>>(idle)

  // Refs, not state: the reader loop reads them and must not be restarted when a callback identity
  // changes, and the abort controller is the one thing a second send has to reach.
  const inFlight = useRef<AbortController | null>(null)
  const callbacks = useRef(options)
  useEffect(() => {
    callbacks.current = options
  })

  // An unmount is a reader that went away, which the route already expects: the delegation is
  // finished and stored before the first frame is written, so aborting the read loses the reply on
  // screen and nothing else.
  useEffect(
    () => () => {
      inFlight.current?.abort()
    },
    [],
  )

  const send = useCallback(
    (request: string): void => {
      inFlight.current?.abort()
      const controller = new AbortController()
      inFlight.current = controller

      setState({
        status: 'streaming',
        request,
        segments: [],
        claimCount: 0,
        delegationId: null,
        error: null,
      })

      const fail = (failure: DelegationFailure): void => {
        if (controller.signal.aborted) return
        setState((held) => ({ ...held, status: 'failed', error: failure }))
        callbacks.current.onFailed?.(failure)
      }

      void (async () => {
        let response: Response
        try {
          response = await fetch(`/api/v1/runs/${runId}/delegations`, {
            method: 'POST',
            cache: 'no-store',
            headers: { 'content-type': 'application/json', 'X-Requested-With': 'tassl' },
            body: JSON.stringify({ request }),
            signal: controller.signal,
          })
        } catch {
          fail({ code: 'NETWORK', message: fallbackMessage, retryAfterSeconds: null })
          return
        }

        if (!response.ok || !response.body) {
          const body = (await response.json().catch(() => null)) as unknown
          fail(failureOf(body, fallbackMessage))
          return
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let finished = false

        const handle = (frame: string): void => {
          const parsed = parseFrame(frame)
          if (!parsed) return
          if (parsed.event === 'segment') {
            const segment = toSegment<TClaim>(parsed.data)
            if (!segment) return
            setState((held) => ({
              ...held,
              segments: [...held.segments, segment],
              claimCount: held.claimCount + (segment.type === 'claim' ? 1 : 0),
            }))
            return
          }
          if (parsed.event !== 'done') return
          finished = true
          const delegationId = delegationIdOf(parsed.data)
          setState((held) => ({ ...held, status: 'complete', delegationId }))
          if (delegationId !== null) callbacks.current.onComplete?.(delegationId)
        }

        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
            for (let cut = buffer.indexOf('\n\n'); cut !== -1; cut = buffer.indexOf('\n\n')) {
              const frame = buffer.slice(0, cut)
              buffer = buffer.slice(cut + 2)
              handle(frame)
            }
          }
        } catch {
          // The read was aborted, or the connection died mid-body. Either way the loop is over and
          // the branch below decides which of the two it was.
        }

        if (controller.signal.aborted) return
        // A stream that ended without `done` is a connection that dropped after the headers. The
        // delegation itself is safe — it was stored before the first frame — so the run's own
        // record is intact and the reply on screen is what was lost.
        if (!finished)
          fail({ code: 'STREAM_ENDED', message: fallbackMessage, retryAfterSeconds: null })
      })()
    },
    [runId, fallbackMessage],
  )

  return { state, send }
}
