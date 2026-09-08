import type { Route } from 'next'
import Link from 'next/link'
import { RecordDisclosure } from '@/components/layout/record-disclosure'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { t } from '@/lib/i18n/t'
import type { RunEventTypeValue } from '@/server/modules/trace/schema'
import type { TraceEventView } from '@/server/modules/trace/schema'

// UI-033 → Trace: every event of the run in the order it was written, with the clock as it stood
// (FR-180, FR-240, D-042).
//
// **It is a Server Component and it ships no JavaScript.** Two things UI-033 asks for would
// ordinarily buy a client bundle, and neither has to:
//
//   * *Row expansion by keyboard.* The record of each event is a native `<details>` inside the last
//     cell. `<summary>` is a button in every engine, opens to find-in-page, and needs no state; a
//     hand-rolled `aria-expanded` pair would cost the route a hydration boundary to do less.
//   * *Filter by type.* The filter is a plain `<form method="get">` whose select lists only the
//     kinds this run actually wrote, so the filtered view is an address a reviewer can send and
//     come back to — the same reason the tabs above it are links (D-176's reading of UI-030).
//
// The table scrolls inside its own container with a sticky header row, because a trace is dense by
// design and the columns must stay named while a reviewer reads down two hundred events.

export type ReplayTraceProps = {
  events: readonly TraceEventView[]
  /** The address the filter form posts back to; the tab parameter travels with it. */
  action: Route
  /** The kind currently being shown, or null for all of them. */
  filter: RunEventTypeValue | null
  /** How many events the run holds in total, so a filtered view can say what it is showing. */
  total: number
}

/** One label per event type, so a type added to the enum is a missing key and not a blank cell. */
const EVENT_LABELS: Record<RunEventTypeValue, () => string> = {
  policy_displayed: () => t('review.eventType.policy_displayed'),
  lifecycle: () => t('review.eventType.lifecycle'),
  readiness_item: () => t('review.eventType.readiness_item'),
  readiness_skipped: () => t('review.eventType.readiness_skipped'),
  document_open: () => t('review.eventType.document_open'),
  document_close: () => t('review.eventType.document_close'),
  frame_locked: () => t('review.eventType.frame_locked'),
  delegation: () => t('review.eventType.delegation'),
  claim_used: () => t('review.eventType.claim_used'),
  stance_set: () => t('review.eventType.stance_set'),
  action: () => t('review.eventType.action'),
  escalation: () => t('review.eventType.escalation'),
  outside_tool_declared: () => t('review.eventType.outside_tool_declared'),
  pause: () => t('review.eventType.pause'),
  resume: () => t('review.eventType.resume'),
  lock_refused: () => t('review.eventType.lock_refused'),
  decision_locked: () => t('review.eventType.decision_locked'),
  brief_opened: () => t('review.eventType.brief_opened'),
  brief_closed: () => t('review.eventType.brief_closed'),
  addendum: () => t('review.eventType.addendum'),
  turn_delivered: () => t('review.eventType.turn_delivered'),
  turn_response_locked: () => t('review.eventType.turn_response_locked'),
  defense_question: () => t('review.eventType.defense_question'),
  defense_answer: () => t('review.eventType.defense_answer'),
  draft_band: () => t('review.eventType.draft_band'),
  band_decision: () => t('review.eventType.band_decision'),
  claim_neutralized: () => t('review.eventType.claim_neutralized'),
  run_voided: () => t('review.eventType.run_voided'),
  run_reoffered: () => t('review.eventType.run_reoffered'),
  debrief_opened: () => t('review.eventType.debrief_opened'),
  debrief_answer: () => t('review.eventType.debrief_answer'),
  probe_fired: () => t('review.eventType.probe_fired'),
}

export const eventTypeLabel = (type: RunEventTypeValue): string => EVENT_LABELS[type]()

/**
 * The payload fields worth putting in the summary column, in the order they are looked for.
 *
 * A preference list rather than one branch per event type, and deliberately: thirty-two branches
 * would be thirty-two places to forget a field, and the summary is a *hint* — the record itself is
 * one keystroke away in the same row. What the order encodes is what a reviewer scans a trace for:
 * which claim, which stance, which document, which dimension, why.
 */
const SUMMARY_KEYS = [
  'key',
  'claim_key',
  'to',
  'stance',
  'dimension',
  'band',
  'decision',
  'type',
  'kind',
  'cause',
  'reason',
  'response',
  'document_key',
  'purpose',
  'concept_key',
  'seq',
  'auto',
  'failed',
] as const

/** `mm:ss` of clock left, tabular so the column does not shift; null is "no clock was running". */
function clockLeft(ms: number | null): string | null {
  if (ms === null) return null
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

/** A scalar as one short token; anything structured is left to the record below the row. */
function scalar(value: unknown): string | null {
  if (typeof value === 'string') return value.length > 60 ? `${value.slice(0, 57)}…` : value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

/** Up to three `name value` pairs from the payload, in `SUMMARY_KEYS` order. */
export function summarize(payload: Record<string, unknown>): string {
  const parts: string[] = []
  for (const key of SUMMARY_KEYS) {
    if (parts.length === 3) break
    const found = scalar(payload[key])
    if (found !== null) parts.push(`${key.replace(/_/g, ' ')} ${found}`)
  }
  return parts.join(' · ')
}

export function ReplayTrace({ events, action, filter, total }: ReplayTraceProps) {
  // Only the kinds this run actually wrote: a select offering thirty-two options, thirty of which
  // answer "no events of that kind", is a control that mostly wastes a press.
  const kinds = [...new Set(events.map((event) => event.type))].sort((left, right) =>
    eventTypeLabel(left).localeCompare(eventTypeLabel(right)),
  )
  const shown = filter === null ? events : events.filter((event) => event.type === filter)
  const caption =
    filter === null
      ? t('review.traceCaption')
      : t('review.traceCaptionFiltered', { type: eventTypeLabel(filter) })

  return (
    <div className="flex flex-col gap-4">
      {/* A GET form: submitting it is a navigation, so the filtered trace has an address and the
          back gesture works. No JavaScript is involved on this route at all. */}
      <form method="get" action={action} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="tab" value="trace" />
        <div className="flex flex-col gap-1">
          <label htmlFor="trace-filter" className="text-ink text-meta font-medium">
            {t('review.traceFilterLabel')}
          </label>
          <select
            id="trace-filter"
            name="event"
            defaultValue={filter ?? ''}
            className="border-line-control bg-paper-raised text-ink text-body focus-visible:outline-focus h-10 max-w-72 rounded-md border px-3 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <option value="">{t('review.traceFilterAll')}</option>
            {kinds.map((kind) => (
              <option key={kind} value={kind}>
                {eventTypeLabel(kind)}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="border-line-control bg-paper-raised text-primary text-meta hover:bg-paper-sunken focus-visible:outline-focus inline-flex h-10 items-center rounded-md border px-4 font-medium transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {t('review.traceFilterApply')}
        </button>
        {filter !== null && (
          <Link
            href={`${action}?tab=trace` as Route}
            className="text-primary text-meta focus-visible:outline-focus inline-flex h-10 items-center rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {t('review.traceFilterClear')}
          </Link>
        )}
      </form>

      <p className="text-ink-muted text-body max-w-measure">
        {caption} {t('review.traceCount', { shown: shown.length, total })}
      </p>

      {shown.length === 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-h4">{t('review.traceEmptyFilterTitle')}</h3>
          <p className="text-ink-muted text-body max-w-measure">
            {t('review.traceEmptyFilterBody')}
          </p>
        </div>
      ) : (
        <div
          role="region"
          tabIndex={0}
          aria-label={caption}
          className="border-line focus-visible:outline-focus relative max-h-[min(34rem,70vh)] w-full scroll-pt-12 overflow-auto rounded-sm border focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <table className="text-body w-full min-w-3xl caption-bottom">
            {/* The header stays named while the trace is read down (UI-033 A11y). Sticky needs a
                scrolling ancestor with a height, which is why this table brings its own bounded
                container rather than using `Table`'s, whose height is its content's. */}
            <TableHeader className="bg-paper-raised [&_th]:border-line sticky top-0 z-10 [&_th]:border-b">
              <TableRow>
                <TableHead scope="col" className="w-14">
                  {t('review.traceColumnSeq')}
                </TableHead>
                <TableHead scope="col" className="w-24">
                  {t('review.traceColumnClock')}
                </TableHead>
                <TableHead scope="col" className="w-48">
                  {t('review.traceColumnType')}
                </TableHead>
                <TableHead scope="col">{t('review.traceColumnSummary')}</TableHead>
                <TableHead scope="col">{t('review.traceColumnRecord')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((event) => {
                const left = clockLeft(event.clockRemainingMs)
                const summary = summarize(event.payload)
                return (
                  // The row is the anchor a band's evidence links to (`#event-42`). The scroll
                  // that lands on it happens inside *this* container, not the document, so the
                  // page's `scroll-padding-top` does not apply and the row would come to rest under
                  // the sticky header; `scroll-mt-12` clears it wherever the scroll comes from.
                  <TableRow
                    key={event.seq}
                    id={`event-${String(event.seq)}`}
                    className="target:bg-primary-soft scroll-mt-12"
                  >
                    <TableCell className="text-ink-muted font-mono tabular-nums">
                      {event.seq}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {left ?? (
                        <>
                          <span aria-hidden="true" className="text-ink-faint">
                            —
                          </span>
                          <span className="sr-only">{t('review.traceNoClockFull')}</span>
                        </>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {eventTypeLabel(event.type)}
                    </TableCell>
                    <TableCell className="text-ink-muted text-mono-sm font-mono whitespace-normal">
                      {summary}
                    </TableCell>
                    <TableCell>
                      <RecordDisclosure
                        record={event.payload}
                        label={t('review.traceOpenRecord')}
                        emptyLabel={t('review.traceNoRecord')}
                      />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </table>
        </div>
      )}
    </div>
  )
}
