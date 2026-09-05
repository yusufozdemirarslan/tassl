import { t } from '@/lib/i18n/t'
import type { AuthoringMeasures as AuthoringMeasuresView } from '@/server/modules/scenarios/schema'

// UI-044 → `AuthoringMeasures` (FR-198): the five numbers the service reads off the seed record and
// the element decisions. They are the institution's own accounting of what building a scenario
// costs — which is why a program lead sees this panel and nothing else on the screen (08 §4).
//
// Every figure says what it measures underneath it. A share of 0 on a version nobody has decided
// anything on would otherwise read as "nothing was edited" rather than "nothing has happened yet",
// so the two nullable measures name the state they are in instead of showing a dash.

export type AuthoringMeasuresProps = {
  measures: AuthoringMeasuresView
}

const PERCENT = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 })

/** A duration an author reads, from milliseconds: seconds, minutes, hours, then days and hours. */
function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  if (totalSeconds < 60) return t('packageVersion.durationSeconds', { seconds: totalSeconds })

  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes < 60) {
    const seconds = totalSeconds % 60
    return seconds === 0
      ? t('packageVersion.durationMinutes', { minutes: totalMinutes })
      : t('packageVersion.durationMinutesSeconds', { minutes: totalMinutes, seconds })
  }

  const totalHours = Math.floor(totalMinutes / 60)
  if (totalHours < 24) {
    return t('packageVersion.durationHours', { hours: totalHours, minutes: totalMinutes % 60 })
  }
  return t('packageVersion.durationDays', {
    days: Math.floor(totalHours / 24),
    hours: totalHours % 24,
  })
}

/** `figure` is a number to read at a glance; `state` is a sentence about a measure that has none. */
type Measure = { label: string; figure: string | null; state: string; help: string }

function measuresOf(measures: AuthoringMeasuresView): Measure[] {
  return [
    {
      label: t('packageVersion.seedToConfirmed'),
      figure:
        measures.seedToConfirmedMs === null ? null : formatDuration(measures.seedToConfirmedMs),
      state: t('packageVersion.measureNotConfirmed'),
      help: t('packageVersion.seedToConfirmedHelp'),
    },
    {
      label: t('packageVersion.editRate'),
      figure: PERCENT.format(measures.editRate),
      state: '',
      help: t('packageVersion.editRateHelp'),
    },
    {
      label: t('packageVersion.rejectedShare'),
      figure: PERCENT.format(measures.rejectedShare),
      state: '',
      help: t('packageVersion.rejectedShareHelp'),
    },
    {
      label: t('packageVersion.generationPasses'),
      figure: String(measures.generationPasses),
      state: '',
      help: t('packageVersion.generationPassesHelp'),
    },
    {
      label: t('packageVersion.reviewPerElement'),
      figure:
        measures.reviewMsPerElement === null ? null : formatDuration(measures.reviewMsPerElement),
      state: t('packageVersion.measureNoDecisions'),
      help: t('packageVersion.reviewPerElementHelp'),
    },
  ]
}

export function AuthoringMeasures({ measures }: AuthoringMeasuresProps) {
  return (
    <dl className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {measuresOf(measures).map((measure) => (
        <div key={measure.label} className="flex min-w-0 flex-col gap-1">
          <dt className="text-ink-muted text-meta">{measure.label}</dt>
          <dd className="flex flex-col gap-1">
            {measure.figure === null ? (
              // A measure with nothing behind it yet says so in words; a dash would read as zero.
              <span className="text-ink-muted text-body">{measure.state}</span>
            ) : (
              <span className="text-ink text-h4 font-mono tabular-nums">{measure.figure}</span>
            )}
            <span className="text-ink-muted text-meta max-w-[46ch]">{measure.help}</span>
          </dd>
        </div>
      ))}
    </dl>
  )
}
