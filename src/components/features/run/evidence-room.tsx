'use client'

import { useEffect, useId, useState } from 'react'
import { EmptyState } from '@/components/layout/empty-state'
import { Panel } from '@/components/layout/panel'
import { Button } from '@/components/ui/button'
import { t } from '@/lib/i18n/messages/workspace'
import { closeDocumentAction } from '@/server/modules/runs/actions'
import type { DocumentSummary, OpenDocument } from '@/server/modules/runs/schema'
import { DocumentReader } from './document-reader'

// UI-023, left column: the Evidence Room (FR-021 to FR-024).
//
// Six to twelve dated, attributed documents, and the list says nothing else about any of them.
// FR-023 is the whole design brief for this component: no hints, no highlighting, no recommended
// order, no summary, and nothing hidden or locked. So there is no "unread" mark, no length, no
// reading-time estimate, no sort control and no filter — the room is in the order the package holds
// it, every row carries the same three facts, and a row a student has already read looks exactly
// like one they have not. A mark that said "opened" would be a nudge about where to go next, and a
// nudge is what this room is defined by not having.
//
// One document is open at a time, which is the shape the server already enforces: an open closes
// whatever the run still has outstanding (10 §6), so a room that let two readers sit open would
// display two readings while recording one. Opening is a disclosure — the reader expands under the
// document's own heading rather than replacing the list — so nothing is ever hidden to read
// something else.
//
// The leftover opens are the other half of FR-117. A tab closed on an open document leaves a reading
// with no end, and `RunWorkspace.openDocuments` is what the next page load is handed so it can close
// it. They are closed once, on mount, from the first render's list: a later render can carry the
// open this very screen has just made, and closing that would end a reading the student is in the
// middle of.

/**
 * A document's date is a calendar date (`YYYY-MM-DD`), not an instant, so it is formatted in UTC —
 * the same reading D-177 gives timestamps. A local zone would shift a March 5 memo to March 4 for
 * half the world, and would make the server's HTML and the browser's hydration disagree.
 */
const DATE = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' })

function formatDatedOn(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : DATE.format(date)
}

export type EvidenceRoomProps = {
  runId: string
  /** The room in the order the package holds it; five fields per document and no sixth (12 §8). */
  documents: readonly DocumentSummary[]
  /** Readings a previous page left open (FR-117); closed once, on mount. */
  openDocuments: readonly OpenDocument[]
  /** `capabilities.canOpenDocuments`: false while the run is paused. */
  canOpen: boolean
}

export function EvidenceRoom({ runId, documents, openDocuments, canOpen }: EvidenceRoomProps) {
  const baseId = useId()
  const [reading, setReading] = useState<string | null>(null)

  // The first render's outstanding opens, and only those. Held in state so that a re-render with a
  // newer workspace — the poll found the run somewhere else and refreshed the tree — cannot close
  // the document being read now.
  const [abandoned] = useState<readonly string[]>(() => openDocuments.map((open) => open.openId))

  useEffect(() => {
    for (const openId of abandoned) {
      void closeDocumentAction({ runId, openId }).catch(() => {
        // A close that does not land is closed by the next open or by the frame lock (10 §6).
      })
    }
  }, [runId, abandoned])

  return (
    <Panel
      id="evidence-room"
      title={t('workspace.roomTitle')}
      description={t('workspace.roomDescription')}
      headingLevel={2}
    >
      {documents.length === 0 ? (
        <EmptyState
          title={t('workspace.roomEmptyTitle')}
          body={t('workspace.roomEmptyBody')}
          headingLevel={3}
        />
      ) : (
        <>
          {!canOpen && (
            <p id={`${baseId}-closed`} className="text-ink-muted text-body mb-3">
              {t('workspace.roomPausedNote')}
            </p>
          )}
          <ul aria-label={t('workspace.roomListLabel')} className="flex flex-col">
            {documents.map((entry) => {
              const open = reading === entry.id
              const headingId = `${baseId}-${entry.id}-title`
              const panelId = `${baseId}-${entry.id}-panel`
              return (
                <li
                  key={entry.id}
                  className="border-line border-t py-3 first:border-t-0 first:pt-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <div className="min-w-0 flex-1 basis-48">
                      <h3 id={headingId} className="text-h4 break-words">
                        {entry.title}
                      </h3>
                      <p className="text-ink-muted text-meta mt-1 break-words">
                        {t('workspace.documentMeta', {
                          author: entry.author.trim() || t('workspace.documentNoAuthor'),
                          date: formatDatedOn(entry.datedOn),
                        })}
                      </p>
                    </div>
                    {/* `aria-disabled` rather than `disabled`: the control keeps its place and its
                        reason while the run is paused, which is DESIGN.md's rule for a control that
                        must stay discoverable. */}
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      aria-expanded={open}
                      aria-controls={panelId}
                      aria-disabled={!canOpen && !open ? true : undefined}
                      aria-describedby={!canOpen && !open ? `${baseId}-closed` : undefined}
                      onClick={() => {
                        if (open) {
                          setReading(null)
                          return
                        }
                        if (!canOpen) return
                        setReading(entry.id)
                      }}
                    >
                      {open ? t('workspace.closeDocument') : t('workspace.openDocument')}
                      <span className="sr-only"> {entry.title}</span>
                    </Button>
                  </div>

                  {/* The container is always in the document so `aria-controls` always resolves;
                      the reader itself mounts only while the document is open, because its mount is
                      the open and its unmount is the close. */}
                  <div id={panelId} hidden={!open}>
                    {open && (
                      <DocumentReader runId={runId} documentId={entry.id} labelledBy={headingId} />
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </Panel>
  )
}
