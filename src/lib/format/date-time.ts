import { t } from '@/lib/i18n/t'

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
