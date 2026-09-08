import { t } from '@/lib/i18n/messages/ui'

// One timestamp format for the whole product (D-177). It is deliberately fixed to UTC: the same
// string is produced by the server render and by the hydration that follows it, so a `<time>` in a
// client component never mismatches, and a reader is never shown a time whose zone is unstated.
const DATE_TIME = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
})

/** `Sep 4, 2026, 2:15 PM UTC` from an ISO string; an unparsable value renders as an em dash. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return t('ui.dateTime', { value: DATE_TIME.format(date) })
}

// A calendar date with no clock on it: the legal pages' "Last reviewed" (UI-006), where a time and
// a zone would be noise. UTC for the same reason as above — one string on the server and after
// hydration — and no `ui.dateTime` wrapper, because there is no zone to name on a date.
const DATE = new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' })

/** `September 7, 2026` from an ISO date or timestamp; an unparsable value renders as an em dash. */
export function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return DATE.format(date)
}
