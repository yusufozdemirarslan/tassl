// The stored record of one event, opened in place (D-623).
//
// Two screens in this product show a reader the exact JSON a row was written with — the replay's
// trace (`review.traceOpenRecord`, UI-033) and the admin audit log (`admin.audit.openRecord`,
// UI-050) — and until this file they showed it with the same eight lines written out twice, down
// to the `[&::-webkit-details-marker]:hidden` and the hand-written focus recipe. They are the same
// control: *this is the record; here it is, unedited.* One implementation is what keeps the two
// screens saying it the same way, and what stops the next one saying it a third.
//
// **A native `<details>`, for the reasons both call sites already gave.** It opens with the
// keyboard, opens to a browser's find-in-page, prints open, needs no JavaScript and costs the route
// nothing — so this file has no `'use client'` and can be rendered from either side of the
// boundary. The default marker is hidden because the summary is a text link in this design system,
// not a disclosure triangle.
//
// **The words are the caller's.** The two screens name the same act differently ("Open the record"
// against the trace, against the audit log) and their empty states differ too, so both strings
// arrive as props: this component takes no message catalogue and therefore drags none into either
// route's chunk.
export type RecordDisclosureProps = {
  /** The stored payload. An empty object draws `emptyLabel` and no control. */
  record: Readonly<Record<string, unknown>>
  /** The summary's words, from the caller's own `t()`. */
  label: string
  /** What stands in place of the control when there is nothing recorded. */
  emptyLabel: string
}

export function RecordDisclosure({ record, label, emptyLabel }: RecordDisclosureProps) {
  if (Object.keys(record).length === 0) {
    return <span className="text-ink-muted text-meta">{emptyLabel}</span>
  }
  return (
    <details>
      <summary className="text-primary text-meta focus-visible:outline-focus inline-flex min-h-10 cursor-pointer list-none items-center rounded-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
        {label}
      </summary>
      {/* `max-w-lg` keeps a wide payload from setting the column's width; `break-words` keeps a
          long unbroken key or id inside it, and the region scrolls sideways for what neither can
          fold. */}
      <pre className="bg-paper-sunken text-ink text-mono-sm mt-2 w-full max-w-lg overflow-x-auto rounded-md p-3 font-mono break-words whitespace-pre-wrap">
        {JSON.stringify(record, null, 2)}
      </pre>
    </details>
  )
}
