import {
  BadgeCheckIcon,
  CircleSlashIcon,
  EyeIcon,
  FileTextIcon,
  HourglassIcon,
  LockIcon,
  PauseCircleIcon,
  PencilLineIcon,
  RadioIcon,
  SquareCheckIcon,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { t } from '@/lib/i18n/messages/run'
import type { RunStateValue } from '@/server/modules/runs/schema'

// The state chip the run wears everywhere: the runs list, the RunFrame band, and the reviewer's
// table on an assignment (09 §2.4).
//
// It is its own module rather than the top of `run-status.tsx`, which is where it used to live,
// because of who carries it (B4 / NFR-013, 16 §3.2). Three of its four readers are Client
// Components, so every one of them shipped `RunStatus` as well — the status screen's `Panel`, its
// `EmptyState`, `next/link`, `buttonVariants` and the fifteen sentences of `messageFor` — to draw a
// chip that is a `<span>`, an icon and one word. A module a client component imports is a module
// the browser downloads, so a screen-sized component and a chip do not share a file.
//
// No 'use client' here either: nothing holds state, so it renders on the server for the reviewer's
// table and compiles into the client bundle where a client component imports it. That is only true
// while it reads `@/lib/i18n/messages/run` rather than the composed catalogue — a `@/lib/i18n/t`
// here would send all twenty-eight namespaces to the browser to label one chip (16 §3.4, D-221).

const STATE_LABELS: Record<RunStateValue, () => string> = {
  assigned: () => t('run.stateAssigned'),
  readiness: () => t('run.stateReadiness'),
  framing: () => t('run.stateFraming'),
  working: () => t('run.stateWorking'),
  paused: () => t('run.statePaused'),
  decision_locked: () => t('run.stateDecisionLocked'),
  turn_open: () => t('run.stateTurnOpen'),
  turn_locked: () => t('run.stateTurnLocked'),
  defense_pending: () => t('run.stateDefensePending'),
  defense_complete: () => t('run.stateDefenseComplete'),
  scored: () => t('run.stateScored'),
  confirmed: () => t('run.stateConfirmed'),
  recorded: () => t('run.stateRecorded'),
  voided: () => t('run.stateVoided'),
  abandoned: () => t('run.stateAbandoned'),
  defense_missed: () => t('run.stateDefenseMissed'),
  under_appeal: () => t('run.stateUnderAppeal'),
  expired: () => t('run.stateExpired'),
}

/** 09 §2.4's state icons where it names one; a line icon that says the same thing where it does not. */
const STATE_ICONS: Record<RunStateValue, LucideIcon> = {
  assigned: HourglassIcon,
  readiness: SquareCheckIcon,
  framing: PencilLineIcon,
  working: PencilLineIcon,
  paused: PauseCircleIcon,
  decision_locked: LockIcon,
  turn_open: RadioIcon,
  turn_locked: LockIcon,
  defense_pending: FileTextIcon,
  defense_complete: FileTextIcon,
  scored: BadgeCheckIcon,
  confirmed: BadgeCheckIcon,
  recorded: BadgeCheckIcon,
  voided: CircleSlashIcon,
  abandoned: CircleSlashIcon,
  defense_missed: CircleSlashIcon,
  under_appeal: EyeIcon,
  expired: CircleSlashIcon,
}

/**
 * Three tones and no more. Teal is where the student is now — the one accent on the screen, on the
 * one row they can act on. Green is a run that reached its end well. Neutral is everything else,
 * including `voided`: a voided attempt is not an error the student made, and a red chip on their
 * own list would say it was (PRD §7.1; nothing Tassl observes is treated as misconduct).
 */
const LIVE_STATES: readonly RunStateValue[] = [
  'assigned',
  'readiness',
  'framing',
  'working',
  'paused',
  'decision_locked',
  'turn_open',
  'turn_locked',
  'defense_pending',
]
const DONE_STATES: readonly RunStateValue[] = ['scored', 'confirmed', 'recorded']

function toneOf(state: RunStateValue): string {
  if (LIVE_STATES.includes(state)) return 'bg-primary-soft border-primary [&_svg]:text-primary'
  if (DONE_STATES.includes(state)) return 'bg-green-soft border-green [&_svg]:text-green'
  return 'bg-paper-sunken border-line-strong [&_svg]:text-ink-muted'
}

export type RunStateChipProps = {
  state: RunStateValue
  /**
   * `scoring_status = 'held'`. It replaces the state word rather than sitting beside it: a student
   * looking at "Scored · Under review" would read the first word as a result they can act on, and
   * the whole of what FR-140 tells them is the second (10 §6).
   */
  underReview?: boolean
  className?: string
}

/**
 * The run's state as one mark: a label chip in `DESIGN.md`'s shape (2 px radius, 2 px left border,
 * 16 px icon in the strong colour, ink text on a soft wash). It is not `LabelChip`, whose nine
 * kinds are a fixed product vocabulary; this one is total over the state machine, so a state added
 * to the enum is a type error here rather than a blank chip on four screens.
 */
export function RunStateChip({ state, underReview = false, className }: RunStateChipProps) {
  const Icon = underReview ? EyeIcon : STATE_ICONS[state]
  const tone = underReview ? 'bg-amber-soft border-amber [&_svg]:text-amber' : toneOf(state)
  return (
    <span
      data-state={underReview ? 'under_review' : state}
      className={cn(
        'text-ink text-meta inline-flex items-center gap-1 rounded-sm border-l-2 py-0.5 pr-2 pl-1.5 font-medium whitespace-nowrap',
        tone,
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-4" />
      {underReview ? t('run.stateUnderReview') : STATE_LABELS[state]()}
    </span>
  )
}
