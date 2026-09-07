import { LabelChip } from '@/components/layout/label-chip'
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
// The module's `schema`, not its `index`: a component takes a module's wire types and its actions
// and nothing else (CLAUDE.md §Layering, enforced by `boundaries/dependencies`).
import type { DebriefPoints } from '@/server/modules/debrief/schema'

// UI-028 → "What your course does with the bands" (FR-202, FR-203, D-091).
//
// **Three numbers, each named for what it is.** `draft` is what the pipeline computed from draft
// bands and reaches no export; `confirmed` exists only once every dimension carries a decision;
// `effective` is FR-005's floor after a correction. A single "points" field would have to be
// labelled by the reader, and would be labelled wrongly on the day it mattered — so the figure on
// screen is the one the run actually stands on, and it says which one it is.
//
// **The arithmetic is written out.** There is no composite anywhere in this product: what the run
// holds is seven bands, and what the course does with them is a mapping, a sum and a division the
// student can check. The mapping is a real table (09 §UI-021's rule, applied here too), because
// four numbers with meanings are a table and not a sentence.

const BAND_LABELS = [
  { key: 'novice', label: t('band.novice') },
  { key: 'developing', label: t('band.developing') },
  { key: 'proficient', label: t('band.proficient') },
  { key: 'professional', label: t('band.professional') },
] as const satisfies ReadonlyArray<{ key: keyof DebriefPoints['mapping']; label: string }>

/** Which of the three figures the run stands on, and the two sentences that name it. */
function figureOf(points: DebriefPoints): {
  value: number
  label: string
  note: string
  draft: boolean
} | null {
  if (points.effective !== null) {
    return {
      value: points.effective,
      label: t('debrief.points.correctedLabel'),
      note: t('debrief.points.correctedNote'),
      draft: false,
    }
  }
  if (points.confirmed !== null) {
    return {
      value: points.confirmed,
      label: t('debrief.points.confirmedLabel'),
      note: t('debrief.points.confirmedNote'),
      draft: false,
    }
  }
  if (points.draft !== null) {
    return {
      value: points.draft,
      label: t('debrief.points.draftLabel'),
      note: t('debrief.points.draftNote'),
      draft: true,
    }
  }
  return null
}

export function PointsSummary({ points }: { points: DebriefPoints }) {
  const figure = figureOf(points)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h3 className="text-h4">{t('debrief.points.mappingLabel')}</h3>
        <Table className="max-w-lg">
          <TableCaption>{t('debrief.points.mappingCaption')}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t('debrief.points.mappingBandColumn')}</TableHead>
              <TableHead scope="col">{t('debrief.points.mappingValueColumn')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {BAND_LABELS.map(({ key, label }) => (
              <TableRow key={key}>
                <TableCell className="whitespace-normal">{label}</TableCell>
                <TableCell className="font-mono tabular-nums">{points.mapping[key]}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="text-h4">{t('debrief.points.weightLabel')}</h3>
        <p className="text-ink text-reading font-mono tabular-nums">
          {t('debrief.points.weight', { weight: points.weight })}
        </p>
      </div>

      <p className="text-ink-muted text-body max-w-measure">
        {t('debrief.points.arithmetic', { assessed: points.assessed })}
      </p>

      {figure === null ? (
        <p className="text-ink text-body max-w-measure">{t('debrief.points.none')}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-h4">{figure.label}</h3>
            {figure.draft && <LabelChip kind="provisional" />}
          </div>
          <p className="text-ink text-h3 font-mono tabular-nums">{figure.value.toFixed(3)}</p>
          <p className="text-ink-muted text-body max-w-measure">{figure.note}</p>
        </div>
      )}

      <p className="text-ink-muted text-body max-w-measure">{t('debrief.points.gradebookNote')}</p>
    </div>
  )
}
