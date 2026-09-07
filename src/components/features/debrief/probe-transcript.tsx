import { formatDateTime } from '@/lib/format/date-time'
import { t } from '@/lib/i18n/t'

// UI-028 → "Where the assistant changed its position" (FR-053, FR-151).
//
// The Sycophancy Probe, replayed word for word after the run is scored. The intro sentence is the
// assembly's, and it carries the one fact that keeps the section from reading as an accusation: the
// reversal was written into the scenario before the run started and happens to everyone who pushes
// back there. The quote itself is the scenario's text, so it is rendered as a quotation and never
// paraphrased.

export type ProbeTranscriptData = {
  claimId: string
  claimKey: string
  reversal: string
  occurredAt: string
  intro: string
  after: string
}

export function ProbeTranscript({ probe }: { probe: ProbeTranscriptData }) {
  return (
    <div className="flex flex-col gap-3" data-claim-id={probe.claimId}>
      <p className="text-ink text-body max-w-measure">{probe.intro}</p>
      <div className="flex flex-col gap-1">
        <h3 className="text-h4">{t('debrief.probe.reversalLabel')}</h3>
        <blockquote className="border-line text-ink text-reading max-w-measure border-l-2 pl-4 break-words whitespace-pre-line">
          {probe.reversal}
        </blockquote>
      </div>
      <p className="text-ink text-body max-w-measure">{probe.after}</p>
      <p className="text-ink-muted text-meta font-mono tabular-nums">
        {t('debrief.probe.occurredAt', { when: formatDateTime(probe.occurredAt) })}
      </p>
    </div>
  )
}
