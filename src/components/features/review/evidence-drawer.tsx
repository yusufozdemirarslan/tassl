import Link from 'next/link'
import type { Route } from 'next'
import { t } from '@/lib/i18n/t'
import type { BandView } from '@/server/modules/scoring/schema'
import { eventTypeLabel } from './replay-trace'
import type { TraceEventView } from '@/server/modules/trace/schema'

// UI-033 → `EvidenceDrawer`: what one band was read from (FR-180, FR-181).
//
// Three things, and the band names all three itself: the graphs the read used (`graph_keys`), the
// trace events it pointed at (`evidence_event_seqs`), and the quotes a model read took from the
// student's own words. Every one of them is `reviewer_only` in `owner-view.ts` and none of them
// reaches a student's debrief — the projection there drops `quotes` and `evidenceEventSeqs` by
// picking rather than deleting (12 §8).
//
// It is a native `<details>` rather than a sheet, and that is not a shortcut. A drawer would be a
// focus trap, a portal and a client bundle to reveal three lists the reviewer is standing next to;
// `<details>` opens with the keyboard, opens to find-in-page, prints, and costs the route nothing.
// The seven of them together are what a reviewer opens and closes while deciding, so the cheap one
// is also the fast one.

export type EvidenceDrawerProps = {
  band: BandView
  /** The run's events, so a sequence number can be named rather than left as a bare number. */
  events: readonly TraceEventView[]
  /** Human titles for the four graph keys, in the reader's language. */
  graphTitles: Readonly<Record<string, string>>
  /**
   * The Trace view's own address, so a sequence number is a link rather than a number to memorise.
   *
   * The href filters the trace to the event's own kind and anchors on the row: a reviewer deciding
   * a band who wants to see event 42 was otherwise memorising "42", changing tab, scrolling two
   * hundred rows, and losing the band they were deciding.
   */
  tracePath: Route
}

export function EvidenceDrawer({ band, events, graphTitles, tracePath }: EvidenceDrawerProps) {
  const bySeq = new Map(events.map((event) => [event.seq, event]))
  const empty =
    band.graphKeys.length === 0 && band.evidenceEventSeqs.length === 0 && band.quotes.length === 0

  return (
    <details className="border-line border-t pt-2">
      <summary className="text-primary text-meta focus-visible:outline-focus inline-flex min-h-10 cursor-pointer list-none items-center rounded-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
        {t('review.evidenceSummary')}
      </summary>

      {empty ? (
        <p className="text-ink-muted text-body max-w-measure mt-3">{t('review.evidenceNone')}</p>
      ) : (
        <div className="mt-3 flex flex-col gap-4">
          {band.graphKeys.length > 0 && (
            <div className="flex flex-col gap-1">
              <h5 className="text-ink text-body font-semibold">{t('review.evidenceGraphs')}</h5>
              <ul className="text-ink text-body flex flex-col gap-0.5">
                {band.graphKeys.map((key) => (
                  <li key={key}>{graphTitles[key] ?? key}</li>
                ))}
              </ul>
            </div>
          )}

          {band.evidenceEventSeqs.length > 0 && (
            <div className="flex flex-col gap-1">
              <h5 className="text-ink text-body font-semibold">{t('review.evidenceEvents')}</h5>
              <ul className="flex flex-col gap-0.5">
                {band.evidenceEventSeqs.map((seq) => {
                  const event = bySeq.get(seq)
                  if (!event) {
                    return (
                      <li key={seq} className="text-ink-muted text-mono-sm font-mono tabular-nums">
                        {t('review.evidenceEventSeq', { seq })}
                      </li>
                    )
                  }
                  return (
                    <li key={seq} className="text-ink text-body">
                      <Link
                        href={`${tracePath}&event=${event.type}#event-${String(seq)}` as Route}
                        className="text-primary focus-visible:outline-focus inline-flex min-h-10 items-center gap-2 rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                      >
                        <span className="text-mono-sm font-mono tabular-nums">
                          {t('review.evidenceEventSeq', { seq })}
                        </span>
                        {eventTypeLabel(event.type)}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {band.quotes.length > 0 && (
            <div className="flex flex-col gap-2">
              <h5 className="text-ink text-body font-semibold">{t('review.evidenceQuotes')}</h5>
              <ul className="flex flex-col gap-2">
                {band.quotes.map((quote) => (
                  <li key={`${String(quote.event_seq)}-${quote.text.slice(0, 24)}`}>
                    <blockquote className="border-line text-ink text-reading max-w-measure border-l-2 pl-4 break-words">
                      {quote.text}
                    </blockquote>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </details>
  )
}
