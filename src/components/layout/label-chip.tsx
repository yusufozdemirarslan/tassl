import {
  BadgeCheck,
  EyeOff,
  Flag,
  FlaskConical,
  Footprints,
  Hourglass,
  PencilLine,
  ScanSearch,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { t } from '@/lib/i18n/messages/label'

export type LabelKind =
  | 'draft'
  | 'confirmed'
  | 'uncalibrated'
  | 'walkthrough'
  | 'provisional'
  | 'unreviewed'
  /** The FR-254 "Illustrative sample data" label carried by IllustrativeSample. */
  | 'sample'
  /**
   * Something the author should look at before this package is used (the authoring warnings of
   * FR-190). The wording is the warning's own, so this kind is the one that expects `label`.
   */
  | 'warning'
  /** The one consequential defect an author planted in a variant (`DEFECTIVE_VARIANT_PLANT`). */
  | 'planted'

// Ink text on a soft wash with the strong color as border and icon only (DESIGN.md: the
// Amber-Is-Not-Text rule). Amber marks draft, provisional, uncalibrated, sample, and warning
// states; red marks the planted defect, which is the one fact on a package screen that changes
// what the reader does next.
const STYLES: Record<LabelKind, { icon: LucideIcon; className: string }> = {
  draft: { icon: PencilLine, className: 'bg-amber-soft border-amber [&_svg]:text-amber' },
  provisional: { icon: Hourglass, className: 'bg-amber-soft border-amber [&_svg]:text-amber' },
  uncalibrated: { icon: FlaskConical, className: 'bg-amber-soft border-amber [&_svg]:text-amber' },
  sample: { icon: ScanSearch, className: 'bg-amber-soft border-amber [&_svg]:text-amber' },
  confirmed: { icon: BadgeCheck, className: 'bg-green-soft border-green [&_svg]:text-green' },
  walkthrough: {
    icon: Footprints,
    className: 'bg-primary-soft border-primary [&_svg]:text-primary',
  },
  unreviewed: {
    icon: EyeOff,
    className: 'bg-paper-sunken border-line-strong [&_svg]:text-ink-muted',
  },
  warning: { icon: TriangleAlert, className: 'bg-amber-soft border-amber [&_svg]:text-amber' },
  planted: { icon: Flag, className: 'bg-red-soft border-red [&_svg]:text-red' },
}

const TEXT: Record<LabelKind, () => string> = {
  draft: () => t('label.draft'),
  confirmed: () => t('label.confirmed'),
  uncalibrated: () => t('label.uncalibrated'),
  walkthrough: () => t('label.walkthrough'),
  provisional: () => t('label.provisional'),
  unreviewed: () => t('label.unreviewed'),
  sample: () => t('sample.label'),
  warning: () => t('label.warning'),
  planted: () => t('label.planted'),
}

export function LabelChip({
  kind,
  label,
  className,
}: {
  kind: LabelKind
  /** Wording that varies with the thing being labelled (one warning of several); the kind's own
   *  word otherwise. A chip is never drawn without text. */
  label?: string
  className?: string
}) {
  const { icon: Icon, className: kindClass } = STYLES[kind]
  return (
    <span
      data-kind={kind}
      className={cn(
        'text-ink text-meta inline-flex items-center gap-1 rounded-sm border-l-2 py-0.5 pr-2 pl-1.5 font-medium',
        kindClass,
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-4" />
      {label ?? TEXT[kind]()}
    </span>
  )
}
