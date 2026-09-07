// The Judgment Record and its export (UI-036, FR-170, FR-243; src/server/modules/records)
// The record copy of the trace is a download (07 §1 "Content types"); the run id names the file so
// two records taken in a row do not land on top of each other. The record screen's strings arrive
// with the screen, in Phase 11.
import { scopedT } from '../scoped'

export const record = {
  'record.exportFileName': 'tassl-record-{runId}.json',
  // The course file is versioned (D-087), so its name is too: two versions of one run are two
  // different files, and a downloads folder is exactly where that difference gets lost.
  'record.courseExportFileName': 'tassl-course-export-{runId}-v{version}.json',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(record)
