'use client'

import { useEffect, useState } from 'react'
import { Loader2Icon } from 'lucide-react'
import { FormAlert } from '@/components/features/account/form-feedback'
import { Button } from '@/components/ui/button'
import { t } from '@/lib/i18n/messages/workspace'
import { closeDocumentAction, openDocumentAction } from '@/server/modules/runs/actions'

// UI-023, the Evidence Room's reading surface (FR-022, FR-024, FR-117, D-082).
//
// **This component is the record.** A document body is handed over by exactly one thing —
// `POST /runs/{runId}/documents/{documentId}/open` — and that call writes the `document_open` event
// in the transaction that produced the body, so there is no way to read a document without the run
// recording the read (10 §6). The reader therefore opens on mount rather than being handed a body by
// its parent: the mount *is* the reading, and its end is the close.
//
// A close that never arrives is a real cost to the student. The duration of an open is capped only
// by the clock and by `ABANDONED_OPEN_MS`, and the next open closes whatever is still open — so a
// reading nobody ended is charged to the student as everything up to their next click, and the
// clock timeline of their debrief shows one long read where there were two short ones. That is why
// there are three ways out of here and not one:
//
//   1. **Unmount** — the student closed the document, or the workspace navigated. React runs the
//      cleanup and the close goes through the Server Action, because the page is still alive.
//   2. **The tab is hidden** — `visibilitychange`. A student who alt-tabs to their notes is not
//      reading, and a mobile browser that backgrounds the tab may discard it without ever running
//      an unmount. The reading ends here; if the tab comes back and this reader is still mounted, a
//      *new* open starts a new reading, so the segments recorded are the time the document was
//      actually in front of them. Two short segments are the truth; one long one is not.
//   3. **The page goes away** — `pagehide`, and `beforeunload` beside it for the browsers that fire
//      only the second. A Server Action cannot survive this: its request is abandoned with the
//      document that started it. The close instead goes to the same endpoint the action calls,
//      through `fetch` with `keepalive`, which the browser is obliged to finish after the page is
//      gone. `sendBeacon` cannot be used for it: a cookie-authenticated mutation must carry
//      `X-Requested-With: tassl` (08 §2.7) and a beacon cannot set a header.
//
// Every one of these can fire for the same reading, and that is expected rather than a bug: a close
// is idempotent server-side, and a close for an open somebody already closed writes no second event
// (10 §6). The local `openId` is cleared on the way out so this side does not send the same close
// twice either.
//
// Nothing here is a hint about the document (FR-023): no summary, no highlighting, no reading time,
// no "recommended". What is on screen is the author's text, its attribution, and the state of the
// reading.

/** The reader's own state: the body it is showing, and what has gone wrong around it. */
type Reading =
  | { status: 'opening' }
  | { status: 'open'; body: string; notice: string | null }
  | { status: 'failed'; message: string; requestId: string }

/**
 * The close that outlives the page (`pagehide`, `beforeunload`).
 *
 * `keepalive` is what makes the browser finish a request whose document is being discarded. The
 * header is the CSRF condition every cookie-authenticated mutation on `/api/v1` carries (08 §2.7),
 * and the route takes no body — the run and the open are both in the path.
 */
function closeOnUnload(runId: string, openId: string): void {
  try {
    void fetch(`/api/v1/runs/${runId}/document-opens/${openId}/close`, {
      method: 'POST',
      keepalive: true,
      headers: { 'X-Requested-With': 'tassl' },
    }).catch(() => {
      // The page is going away. There is nobody left to tell, and the server closes an abandoned
      // open on the next one or at the frame lock (10 §6).
    })
  } catch {
    // `fetch` itself can throw while a document is being torn down; the fallback is the same one.
  }
}

/** Blank-line-separated paragraphs of the author's own text; single newlines are kept inside one. */
function paragraphsOf(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
}

export type DocumentReaderProps = {
  runId: string
  documentId: string
  /** The id of the heading that names this document; the article is labelled by it. */
  labelledBy: string
}

export function DocumentReader({ runId, documentId, labelledBy }: DocumentReaderProps) {
  const [reading, setReading] = useState<Reading>({ status: 'opening' })
  /** Bumped by "Try again"; the effect below is the one place an open is ever made. */
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    // Held in the closure rather than in state: these decide what the *listeners* do, and a
    // listener registered once must not read a stale render's copy of them.
    let cancelled = false
    let openId: string | null = null
    let requesting = false
    let hidden = false

    const start = (): void => {
      if (cancelled || requesting || openId !== null) return
      requesting = true
      void openDocumentAction({ runId, documentId }).then(
        (result) => {
          requesting = false
          if (!result.ok) {
            if (cancelled) return
            const { message, requestId } = result.error
            // A first open that fails is the whole of what is on screen; one that fails on the way
            // back from a hidden tab leaves the text up and says that it is no longer counted.
            setReading((held) =>
              held.status === 'open'
                ? { ...held, notice: t('workspace.readerReopenFailed', { message }) }
                : { status: 'failed', message, requestId },
            )
            return
          }
          // Unmounted while the open was in flight: the reading happened, so it is closed rather
          // than left running.
          if (cancelled) {
            closeOnUnload(runId, result.data.openId)
            return
          }
          openId = result.data.openId
          setReading({ status: 'open', body: result.data.document.body, notice: null })
          // The tab went away while the open was in flight, so the close that would have ended
          // this reading found nothing to end. The reading ends where the tab did; the text stays
          // on screen, and coming back starts a new one.
          if (hidden) stop(true)
        },
        () => {
          requesting = false
          if (cancelled) return
          setReading((held) =>
            held.status === 'open'
              ? { ...held, notice: t('workspace.roomOpenFailed') }
              : { status: 'failed', message: t('workspace.roomOpenFailed'), requestId: '' },
          )
        },
      )
    }

    const stop = (unloading: boolean): void => {
      const id = openId
      openId = null
      if (id === null) return
      if (unloading) {
        closeOnUnload(runId, id)
        return
      }
      void closeDocumentAction({ runId, openId: id }).catch(() => {
        // The reading ended either way; the server closes an open it never heard about at the next
        // open or at the frame lock.
      })
    }

    const onVisibility = (): void => {
      hidden = document.visibilityState === 'hidden'
      if (hidden) stop(true)
      else start()
    }
    const onUnload = (): void => {
      stop(true)
    }

    start()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onUnload)
    window.addEventListener('beforeunload', onUnload)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onUnload)
      window.removeEventListener('beforeunload', onUnload)
      stop(false)
    }
  }, [runId, documentId, attempt])

  if (reading.status === 'opening') {
    return (
      <p role="status" className="text-ink-muted text-body flex items-center gap-2 py-4">
        <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />
        {t('workspace.readerOpening')}
      </p>
    )
  }

  if (reading.status === 'failed') {
    return (
      <div className="py-3">
        <FormAlert
          message={reading.message}
          action={
            <div className="flex flex-col items-start gap-2">
              {reading.requestId !== '' && (
                <code className="text-mono-sm text-ink font-mono break-all">
                  {reading.requestId}
                </code>
              )}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setReading({ status: 'opening' })
                  setAttempt((n) => n + 1)
                }}
              >
                {t('workspace.readerRetry')}
              </Button>
            </div>
          }
        />
      </div>
    )
  }

  const paragraphs = paragraphsOf(reading.body)

  return (
    <article aria-labelledby={labelledBy} className="flex flex-col gap-4 py-3">
      {reading.notice !== null && <FormAlert message={reading.notice} />}
      <div className="flex max-w-[72ch] flex-col gap-4">
        {paragraphs.map((paragraph, index) => (
          <p
            key={paragraph.slice(0, 48) + String(index)}
            className="text-ink text-reading whitespace-pre-line"
          >
            {paragraph}
          </p>
        ))}
      </div>
    </article>
  )
}
