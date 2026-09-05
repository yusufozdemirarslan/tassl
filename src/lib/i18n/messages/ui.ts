// Shared UI primitives
import { scopedT } from '../scoped'

export const ui = {
  'ui.close': 'Close',
  'ui.loading': 'Loading',
  'ui.more': 'More',
  // A form that arrives with its dialog (16 §3.2) and did not; reopening the dialog retries.
  'ui.formLoadFailed': 'The form could not be loaded. Close this and open it again.',
  // A menu that arrives with the press that opens it (16 §3.2) and did not; pressing again retries.
  'ui.menuLoadFailed': 'The menu could not be loaded. Try again.',
  // A dialog that arrives with the press that opens it and did not; pressing again retries.
  'ui.actionLoadFailed': 'That could not be opened. Try the button again.',
  // Timestamps are formatted in UTC so a server render and its hydration always agree (D-177).
  'ui.dateTime': '{value} UTC',
  'toast.region': 'Messages',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(ui)
