import { IllustrativeSample } from '@/components/layout/illustrative-sample'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { t } from '@/lib/i18n/t'
import { SAMPLE_LABEL, type SampleTrajectory } from '@/server/modules/records/schema'

// `TrajectorySample` (09 §3, UI-029): the four-run trajectory of FR-171, which is illustrative and
// nothing else.
//
// **It cannot be drawn unlabelled, and that refusal is the point.** These are invented numbers put
// in front of a student on the page that holds their real record, and an unlabelled chart of
// invented data is the worst thing this product could show. So the component renders *through*
// `IllustrativeSample` — there is no path that produces the rows without the dashed border and the
// amber chip — and it checks the fixture's own `label` as well (FR-254, D-035): the label travels in
// the data, so a fixture that lost it is refused here rather than drawn.
//
// **It is tables, not a plot** (D-466). Tassl computes four graphs per run and this is not one of
// them: a cross-run trajectory is exactly what the build does not measure, and drawing invented
// numbers as a chart on a student's Judgment Record would give them the authority of the four
// beside them. Tables say the same thing, are readable without sight, and cost the record route no
// charting library at all.
//
// It is a Server Component: nothing here is interactive, so no reader pays a byte for it.

/** The four bands, lowest first — the ladder the rows are read against. */
const BAND_LABELS: Record<string, string> = {
  novice: t('band.novice'),
  developing: t('band.developing'),
  proficient: t('band.proficient'),
  professional: t('band.professional'),
}

const DIMENSION_LABELS: Record<string, string> = {
  framing: t('band.dimension.framing'),
  delegation: t('band.dimension.delegation'),
  verification: t('band.dimension.verification'),
  calibration: t('band.dimension.calibration'),
  decision_quality: t('band.dimension.decision_quality'),
  adaptation: t('band.dimension.adaptation'),
  ownership: t('band.dimension.ownership'),
}

const PERCENT = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 })

export type TrajectorySampleProps = {
  /** The fixture, which carries its own FR-254 label; a payload without it is refused. */
  data: SampleTrajectory
  /** The panel heading beside the mandatory chip. */
  title?: string
  headingLevel?: 2 | 3 | 4
}

export function TrajectorySample({
  data,
  title = t('record.trajectoryTitle'),
  headingLevel = 2,
}: TrajectorySampleProps) {
  if (data.label !== SAMPLE_LABEL) {
    throw new Error('TrajectorySample requires fixture data carrying the FR-254 label')
  }

  const runs = data.runs
  const escalations = new Map(data.escalations.map((row) => [row.runIndex, row]))
  const confidence = new Map(data.confidenceVsAccuracy.map((row) => [row.runIndex, row]))

  return (
    <IllustrativeSample label={title} headingLevel={headingLevel}>
      <div className="flex flex-col gap-6">
        <p className="text-ink text-body max-w-measure">{t('record.trajectoryNote')}</p>

        <div className="overflow-x-auto">
          <Table className="min-w-2xl">
            <TableCaption>{t('record.trajectoryBandsCaption')}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t('record.trajectoryDimensionColumn')}</TableHead>
                {runs.map((run) => (
                  <TableHead key={run.runIndex} scope="col">
                    {run.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.bands.map((row) => (
                <TableRow key={row.dimension}>
                  <TableCell className="whitespace-normal">
                    {DIMENSION_LABELS[row.dimension] ?? row.dimension}
                  </TableCell>
                  {row.values.map((value, index) => (
                    <TableCell
                      key={`${row.dimension}-${String(index)}`}
                      className="whitespace-normal"
                    >
                      {BAND_LABELS[value] ?? value}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="overflow-x-auto">
          <Table className="min-w-2xl">
            <TableCaption>{t('record.trajectoryReadingsCaption')}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t('record.trajectoryRunColumn')}</TableHead>
                <TableHead scope="col">{t('record.trajectoryChallengeColumn')}</TableHead>
                <TableHead scope="col">{t('record.trajectoryConfidenceColumn')}</TableHead>
                <TableHead scope="col">{t('record.trajectoryAccuracyColumn')}</TableHead>
                <TableHead scope="col">{t('record.trajectoryEscalationColumn')}</TableHead>
                <TableHead scope="col">{t('record.trajectoryOutsideColumn')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run, index) => {
                const reading = confidence.get(run.runIndex)
                const escalation = escalations.get(run.runIndex)
                const rate = data.falseChallengeRate[index]
                return (
                  <TableRow key={run.runIndex}>
                    <TableCell className="whitespace-normal">{run.label}</TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {rate === undefined ? '' : PERCENT.format(rate)}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {reading?.confidenceAtLock ?? ''}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {reading === undefined ? '' : PERCENT.format(reading.accuracyAtLock)}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {escalation?.used ?? ''}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {escalation?.outsideCompetence ?? ''}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </IllustrativeSample>
  )
}
