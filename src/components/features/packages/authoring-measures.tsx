import { t } from '@/lib/i18n/t'
import type { AuthoringMeasures as AuthoringMeasuresView } from '@/server/modules/scenarios/schema'

// UI-044 → `AuthoringMeasures` (FR-198): the five numbers the service reads off the seed record and
// the element decisions. They are the institution's own accounting of what building a scenario
// costs — which is why a program lead sees this panel and nothing else on the screen (08 §4).
//
// Every figure says what it measures underneath it, and a measure with nothing behind it yet says
// so in words rather than showing a dash or a zero. Which measures those are is decided by the
// arithmetic in `authoring/measures.ts`, not by taste:
//
//   * `seedToConfirmedMs` is null until the version is frozen — there is no end of the span yet.
//   * `reviewMsPerElement` is null until some element has been decided, and *that same fact* is
//     what the edit rate and the rejected share have no answer for: both are shares of the
//     version's elements, and both are 0 on a package nobody has opened. A screen that printed
//     "0 %" there would be read as "nothing was edited" — PRD §11 watches this figure for exactly
//     the opposite reading ("an edit rate near zero is approving rather than reviewing"), so the
//     one state that must not be mistaken for it is the one where no review has happened at all.
//   * `generationPasses` is a count of runs, and 0 is a true and complete answer: it means this
//     version was written by hand or brought in as an export. Its help sentence says so.

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
  // No element has been decided on: the two shares have no denominator anybody has touched yet.
  const undecided = measures.reviewMsPerElement === null
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
      figure: undecided ? null : PERCENT.format(measures.editRate),
      state: t('packageVersion.measureNoDecisions'),
      help: t('packageVersion.editRateHelp'),
    },
    {
      label: t('packageVersion.rejectedShare'),
      figure: undecided ? null : PERCENT.format(measures.rejectedShare),
      state: t('packageVersion.measureNoDecisions'),
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
