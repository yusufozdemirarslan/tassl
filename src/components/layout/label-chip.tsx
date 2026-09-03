import {
  BadgeCheck,
  EyeOff,
  FlaskConical,
  Footprints,
  Hourglass,
  PencilLine,
  ScanSearch,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { t } from '@/lib/i18n/t'

export type LabelKind =
  | 'draft'
  | 'confirmed'
  | 'uncalibrated'
  | 'walkthrough'
  | 'provisional'
  | 'unreviewed'
  /** The FR-254 "Illustrative sample data" label carried by IllustrativeSample. */
  | 'sample'

// Ink text on a soft wash with the strong color as border and icon only (DESIGN.md: the
// Amber-Is-Not-Text rule). Amber marks draft, provisional, uncalibrated, and sample states.
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
}

const TEXT: Record<LabelKind, () => string> = {
  draft: () => t('label.draft'),
  confirmed: () => t('label.confirmed'),
  uncalibrated: () => t('label.uncalibrated'),
  walkthrough: () => t('label.walkthrough'),
  provisional: () => t('label.provisional'),
  unreviewed: () => t('label.unreviewed'),
  sample: () => t('sample.label'),
}

export function LabelChip({ kind, className }: { kind: LabelKind; className?: string }) {
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
      {TEXT[kind]()}
    </span>
  )
}
