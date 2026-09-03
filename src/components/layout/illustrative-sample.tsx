import type { ReactNode } from 'react'
import { LabelChip } from '@/components/layout/label-chip'
import { cn } from '@/lib/cn'
import { t } from '@/lib/i18n/t'

type IllustrativeSampleProps = {
  /** What the sample shows (for example "Sample debrief"); required so no sample panel ships unlabelled (FR-254). */
  label: string
  children: ReactNode
  className?: string
  /** Element for the label heading; the style stays the h4 "Subtitle" size. */
  headingLevel?: 2 | 3 | 4
}

// Mandatory wrapper for sample data: a dashed strong-hairline panel whose header carries the amber
// "Illustrative sample data" chip. It refuses to render unlabelled: throws in development, and in
// production still renders the fixed chip so the data is never mistaken for a real record.
export function IllustrativeSample({
  label,
  children,
  className,
  headingLevel = 3,
}: IllustrativeSampleProps) {
  if (!label && process.env.NODE_ENV !== 'production') {
    throw new Error('IllustrativeSample requires a label (FR-254)')
  }
  const Heading = `h${headingLevel}` as const
  return (
    <section
      data-sample="true"
      aria-label={label || t('sample.label')}
      className={cn(
        'border-line-strong bg-paper-raised rounded-md border border-dashed p-4',
        className,
      )}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {label ? <Heading className="text-h4">{label}</Heading> : <span />}
        <LabelChip kind="sample" />
      </div>
      {children}
    </section>
  )
}
