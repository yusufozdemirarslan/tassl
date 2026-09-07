import { t } from '@/lib/i18n/t'

// UI-028 → "One thing this run did" (FR-153, 10 §13.1).
//
// FR-153 requires the debrief to name at least one thing the run did, and the service's ladder
// always returns a sentence: the last rung is true of every run that reached this page. So there is
// no empty state here and there must not be one — a section that could render nothing would be a
// section that sometimes says the run did nothing.

export function DoneWell({ sentence }: { sentence: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-ink text-reading max-w-measure break-words">{sentence}</p>
      <p className="text-ink-muted text-meta">{t('debrief.doneWell.label')}</p>
    </div>
  )
}
