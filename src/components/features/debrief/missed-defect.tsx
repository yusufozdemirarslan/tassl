import { t } from '@/lib/i18n/t'

// UI-028 → "Defects the decision rested on" (FR-151, FR-153).
//
// One block per planted claim the filed decision still rested on: the document behind it, the
// passage the author quoted, and the check that would have shown it. Every sentence arrives already
// written by the assembly — `stanceLine`, `checkLine` and `actionLine` are `debrief.` templates with
// this run's facts in them — because FR-153's rule about naming actions and omissions rather than
// people is a rule about what the sentences say, and there must be one place that says them.
//
// The shape is restated here rather than imported from `debrief/assembly.ts`; see the head of
// ./claim-walkthrough-row.tsx for why.

export type MissedDefectData = {
  claimId: string
  key: string
  text: string
  failureFamily: string | null
  failureFamilyLabel: string | null
  document: { title: string; author: string; datedOn: string } | null
  passage: string
  stanceLine: string
  checkLine: string
  actionLine: string
}

export function MissedDefect({ defect }: { defect: MissedDefectData }) {
  const headingId = `defect-${defect.claimId}-title`
  return (
    <article
      aria-labelledby={headingId}
      data-claim-id={defect.claimId}
      className="border-line flex flex-col gap-3 border-t pt-5 first:border-t-0 first:pt-0"
    >
      <h3 id={headingId} className="text-h4">
        {t('debrief.defect.heading', { key: defect.key })}
      </h3>
      <p className="text-ink text-reading max-w-measure break-words">{defect.text}</p>

      <p className="text-ink text-body max-w-measure">{defect.stanceLine}</p>

      {defect.failureFamilyLabel !== null && (
        <div className="flex flex-col gap-1">
          <h4 className="text-reading">{t('debrief.defect.familyLabel')}</h4>
          <p className="text-ink text-body max-w-measure">{defect.failureFamilyLabel}</p>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <h4 className="text-reading">{t('debrief.defect.documentLabel')}</h4>
        <p className="text-ink text-body max-w-measure break-words">
          {defect.document === null
            ? t('debrief.defect.noDocument')
            : t('debrief.defect.document', {
                title: defect.document.title,
                author: defect.document.author,
                dated: defect.document.datedOn,
              })}
        </p>
      </div>

      {defect.passage.trim().length > 0 && (
        <div className="flex flex-col gap-1">
          <h4 className="text-reading">{t('debrief.defect.passageLabel')}</h4>
          <blockquote className="border-line text-ink text-reading max-w-measure border-l-2 pl-4 break-words whitespace-pre-line">
            {defect.passage}
          </blockquote>
        </div>
      )}

      <div className="bg-paper-sunken flex flex-col gap-1 rounded-md p-3">
        <h4 className="text-reading">{t('debrief.defect.checkLabel')}</h4>
        <p className="text-ink text-body max-w-measure break-words">{defect.checkLine}</p>
        <p className="text-ink-muted text-body max-w-measure">{defect.actionLine}</p>
      </div>
    </article>
  )
}
