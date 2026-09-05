import {
  ArrowUpRight,
  Check,
  MessageSquareWarning,
  OctagonX,
  SearchCheck,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/cn'
// The stance namespace alone, not the composed catalogue: this mark is drawn inside the element
// confirmation workspace (UI-043), which is a Client Component, and a `@/lib/i18n/t` here would
// send all twenty-eight namespaces to the browser to label five chips (16 §3.4).
import { t } from '@/lib/i18n/messages/stance'
import type { StanceValue } from '@/server/modules/scenarios/schema'

// The one mark for a stance, wherever a stance is shown (09 §3 reserves `features/run` for the
// stance vocabulary: `StanceControl`, the five-chip radio group a student answers with, is built
// on this module's labels, icons and colours in the run workspace phase, so the stance a package
// says a claim deserved and the stance a student took are drawn as the same object).
//
// DESIGN.md's Labelled-Stance Rule: a stance colour never appears without its text label and its
// icon. The label is not optional here — it is rendered by the component, so no call site can drop
// it — and the colour is carried by the border and the icon only, with the text in ink, so the
// chip is legible without colour vision and the five colours stay a mark rather than a highlight.
// Pill geometry (radius 999 px) is reserved product-wide for stance chips, which is what separates
// this mark at a glance from a label chip (2 px radius with a side tab) and a Badge (2 px radius).

export const STANCE_LABELS: Record<StanceValue, () => string> = {
  accept: () => t('stance.accept'),
  verify: () => t('stance.verify'),
  challenge: () => t('stance.challenge'),
  reject: () => t('stance.reject'),
  escalate: () => t('stance.escalate'),
}

/** The five icons named in 09 §2.4; `OctagonX` is lucide 1.x's name for `x-octagon`. */
export const STANCE_ICONS: Record<StanceValue, LucideIcon> = {
  accept: Check,
  verify: SearchCheck,
  challenge: MessageSquareWarning,
  reject: OctagonX,
  escalate: ArrowUpRight,
}

/** Border and icon take the stance colour; the text stays ink (DESIGN.md §Colors). */
const STANCE_TONE: Record<StanceValue, string> = {
  accept: 'border-stance-accept [&_svg]:text-stance-accept',
  verify: 'border-stance-verify [&_svg]:text-stance-verify',
  challenge: 'border-stance-challenge [&_svg]:text-stance-challenge',
  reject: 'border-stance-reject [&_svg]:text-stance-reject',
  escalate: 'border-stance-escalate [&_svg]:text-stance-escalate',
}

export type StanceChipProps = {
  stance: StanceValue
  /**
   * What this stance is, for a reader who meets the chip without its column or its `dt` — a table
   * cell stacks four marks and none of them names itself. Rendered for assistive technology only;
   * the visible text is the stance label, which is never omitted.
   */
  srLabel?: string
  className?: string
}

/** The read-only mark. The interactive control (five 40 px chips) is `StanceControl`, UI-023. */
export function StanceChip({ stance, srLabel, className }: StanceChipProps) {
  const Icon = STANCE_ICONS[stance]
  // The separator is joined here rather than left as JSX whitespace, so the accessible name is
  // "Warranted stance Challenge" and never runs the two words together.
  const spoken = srLabel === undefined ? undefined : `${srLabel} `
  return (
    <span
      data-stance={stance}
      className={cn(
        'bg-paper-raised text-ink text-meta inline-flex items-center gap-1 rounded-full border py-0.5 pr-2.5 pl-1.5 font-medium',
        STANCE_TONE[stance],
        className,
      )}
    >
      {spoken !== undefined && <span className="sr-only">{spoken}</span>}
      <Icon aria-hidden="true" className="size-4" />
      {STANCE_LABELS[stance]()}
    </span>
  )
}
