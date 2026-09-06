'use client'

import { type ReactNode } from 'react'
import { ChevronDownIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { t } from '@/lib/i18n/messages/workspace'
import type { ActionResult, ActionTypeValue } from '@/server/modules/reliance/schema'

// UI-023: the interrogation actions — choosing one, and reading what it returned (FR-070 to FR-073).
//
// Both halves are in one file because they are one act, and because the chunk they share is the
// only thing on the claim card that is not needed until a student decides to check something: the
// menu (a Base UI menu, its positioner and its portal) and the sheet (a Base UI dialog and its
// portal) arrive together, on the first press, from `claim-card.tsx`.
//
// **The menu lists `availableActions` and nothing else.** That array is the author's confirmed
// `verification_paths` for this claim on this run's variant (FR-071), so the menu never offers a
// check that would come back empty — and never offers one it would then refuse. What it does *not*
// do is say anything about the claim: the three checks are in cost order on every claim that
// carries them, there is no recommendation, no "worth checking" mark, and no difference in how a
// claim with three checks and a claim with one are described. The cost is in front of the press
// because it is a clock the student cannot get back (FR-072), never as a warning.
//
// **The result is the author's own words, and the sheet says so.** FR-073 is that Tassl never says
// a claim is wrong: nothing here scores, summarises, highlights or comments on a result, and no
// result is drawn differently from another. The keys are the author's — `document_id`, `passage`,
// `dated_on`, `author`, `steps` — and the labelled ones are labelled for reading; an unlisted key
// is shown as the author wrote it rather than dropped, because a result this file did not expect is
// still a result the student paid for.
//
// The one value that is *not* printed as it stands is the document, and that is the same rule
// rather than an exception to it. A Source Trace's stored payload names the document by id, because
// that is what the row holds once a package is imported (`toVerificationPathsExport` maps it back
// to an element key on the way out, SYS-026) — and a uuid is not an answer to "where did this come
// from". FR-070's point is that the student can go and read the thing, so the id is resolved
// against the Evidence Room's own list and shown as the key and title the room already shows them.
//
// A sheet rather than a dialog, and that is the honest shape: a result is something to read *beside*
// the claim, often while typing the brief, and it is not a decision to confirm. It closes on Escape
// and on the scrim, like every non-destructive overlay in the product.

// ---------------------------------------------------------------------------------------------
// The menu
// ---------------------------------------------------------------------------------------------

/** What each action is called, in the words UI-023 puts on the menu. */
export const ACTION_LABELS: Record<ActionTypeValue, () => string> = {
  source_trace: () => t('workspace.actionSourceTrace'),
  replication_check: () => t('workspace.actionReplicationCheck'),
  decomposition_check: () => t('workspace.actionDecompositionCheck'),
}

/**
 * What each action costs the working clock, in whole minutes (FR-070, `runs/limits.ts`).
 *
 * Restated rather than imported: a client component never imports a module's `schema.ts` or a
 * server file for a value (D-186), and what the menu owes the student is the cost the service will
 * charge. Escalation's five minutes are stated by the escalation dialog, which is the control that
 * spends them.
 */
const ACTION_COST_MINUTES: Record<ActionTypeValue, number> = {
  source_trace: 1,
  replication_check: 3,
  decomposition_check: 4,
}

/** The label a screen reader hears: the check, the claim, and what it costs. */
export function actionCostLabel(minutes: number): string {
  return minutes === 1
    ? t('workspace.actionCostSpokenOne')
    : t('workspace.actionCostSpoken', { minutes })
}

export type ActionsMenuProps = {
  claimKey: string
  /** The claim's confirmed verification paths, in cost order (FR-071). Never the authored flags. */
  available: readonly ActionTypeValue[]
  /** False while the run is paused; the trigger keeps its place and says why it refuses. */
  canWrite: boolean
  /** True while a check is in flight: one at a time, and the trigger says so. */
  running: boolean
  onRun: (type: ActionTypeValue) => void
  /**
   * The trigger's treatment, which the claim card sets (`WELL_CONTROL` in `claim-card.tsx`).
   *
   * A check spends the clock, and DESIGN.md keeps the one accent for the act the student is there
   * to take — the stance (D-323) — so on a claim card this is an ink label on a control hairline
   * rather than the teal secondary. It is a prop rather than a constant here because the class
   * belongs to the surface the control sits on, and importing it from the card would close the two
   * files into a cycle.
   */
  className?: string
}

export function ActionsMenu({
  claimKey,
  available,
  canWrite,
  running,
  onRun,
  className,
}: ActionsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            className={className}
            aria-label={t('workspace.actionsMenuFor', { key: claimKey })}
            aria-disabled={canWrite && !running ? undefined : true}
            aria-busy={running}
          />
        }
      >
        {running ? t('workspace.actionRunning') : t('workspace.actionsMenu')}
        <ChevronDownIcon aria-hidden="true" className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent aria-label={t('workspace.actionsMenuLabel', { key: claimKey })}>
        {available.map((type) => {
          const minutes = ACTION_COST_MINUTES[type]
          // Joined here rather than left as JSX text, so the accessible name reads "Source Trace,
          // costs one minute of your working clock" instead of running the two together.
          const spoken = `, ${actionCostLabel(minutes)}`
          return (
            <DropdownMenuItem
              key={type}
              disabled={!canWrite || running}
              onClick={() => {
                onRun(type)
              }}
              className="justify-between gap-6"
            >
              <span>{ACTION_LABELS[type]()}</span>
              {/* The cost, in Mono with tabular figures like every other number the product
                  counts (DESIGN.md §The Tabular Clock Rule). The spoken form is beside it because
                  "1 min" read aloud is not a sentence. */}
              <span className="text-ink-muted text-mono-sm font-mono tabular-nums">
                {t('workspace.actionCost', { minutes })}
                <span className="sr-only">{spoken}</span>
              </span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ---------------------------------------------------------------------------------------------
// The result
// ---------------------------------------------------------------------------------------------

/**
 * The keys a `verification_paths` result uses, in the order a reader wants them.
 *
 * `document_id` and `document_key` are both here because the same field is spelled two ways in two
 * places, and a result can honestly carry either: a package *travels* as an element key (SYS-026,
 * `toVerificationPathsExport`) and is *stored* as the document's id once it is imported. What the
 * student is shown is neither — see `DocumentValue`.
 */
const RESULT_KEYS: readonly string[] = [
  'document_id',
  'document_key',
  'dated_on',
  'author',
  'passage',
  'method',
  'result',
  'steps',
  'note',
]

/** A label for a key this build knows; an unlisted key keeps the author's own spelling. */
const RESULT_LABELS: Record<string, () => string> = {
  document_id: () => t('workspace.actionResultDocument'),
  document_key: () => t('workspace.actionResultDocument'),
  dated_on: () => t('workspace.actionResultDate'),
  author: () => t('workspace.actionResultAuthor'),
  passage: () => t('workspace.actionResultPassage'),
  method: () => t('workspace.actionResultMethod'),
  result: () => t('workspace.actionResultFinding'),
  steps: () => t('workspace.actionResultSteps'),
  note: () => t('workspace.actionResultNote'),
}

/** A document of the Evidence Room, as the room already lists it (07 §10 `DocumentSummary`). */
export type TracedDocument = { id: string; key: string; title: string }

/** The listed keys first, in reading order, then anything else the author wrote, as they wrote it. */
function orderedEntries(result: Record<string, unknown>): [string, unknown][] {
  const known = RESULT_KEYS.filter((key) => key in result).map(
    (key) => [key, result[key]] as [string, unknown],
  )
  const rest = Object.entries(result).filter(([key]) => !RESULT_KEYS.includes(key))
  return [...known, ...rest]
}

/** One step of a decomposition: the author's label and what it came to. */
type Step = { label?: unknown; result?: unknown }

const isStepList = (value: unknown): value is Step[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'object' && entry !== null)

/**
 * One value, drawn as what it is.
 *
 * A string is prose and is set at the reading measure with its own line breaks kept; a list of
 * steps is an ordered list of label and result; anything else is printed as the author wrote it.
 * Nothing is truncated and nothing is summarised — the student paid clock time for this.
 */
function ResultValue({ value }: { value: unknown }): ReactNode {
  if (isStepList(value)) {
    return (
      <ol className="flex list-inside list-decimal flex-col gap-2">
        {value.map((step, index) => (
          <li key={`step-${String(index)}`} className="text-ink text-reading max-w-measure">
            <span className="font-medium">{String(step.label ?? '')}</span>
            {step.result === undefined ? null : <span> — {String(step.result)}</span>}
          </li>
        ))}
      </ol>
    )
  }
  if (Array.isArray(value)) {
    return (
      <ul className="flex list-inside list-disc flex-col gap-1">
        {value.map((entry, index) => (
          <li key={`entry-${String(index)}`} className="text-ink text-reading max-w-measure">
            {String(entry)}
          </li>
        ))}
      </ul>
    )
  }
  return (
    <p className="text-ink text-reading max-w-measure whitespace-pre-line">
      {typeof value === 'string' ? value : JSON.stringify(value)}
    </p>
  )
}

/**
 * The document a Source Trace leads to, named the way the student already knows it.
 *
 * The stored result points at the document by id, because that is what a row in the database holds
 * once a package is imported. A uuid is not an answer to "where did this come from": the point of
 * FR-070 is that the student can go and read the thing, so the id is resolved against the Evidence
 * Room's own list and shown as the key and the title the room shows. An id the room does not carry
 * is printed as it stands rather than dropped — the student paid a minute for it, and a missing row
 * would be worse than an opaque one.
 */
function DocumentValue({
  value,
  documents,
}: {
  value: unknown
  documents: readonly TracedDocument[]
}) {
  const found =
    typeof value === 'string' ? documents.find((entry) => entry.id === value) : undefined
  if (found === undefined) {
    return <p className="text-ink text-reading max-w-measure">{String(value)}</p>
  }
  // The separator is joined here rather than left as JSX text, so the key and the title are read as
  // one line rather than run together.
  const titled = ` · ${found.title}`
  return (
    <p className="text-ink text-reading max-w-measure">
      <span className="text-mono-sm text-ink-muted font-mono">{found.key}</span>
      <span>{titled}</span>
    </p>
  )
}

export type ActionResultSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  claimKey: string
  /** The result as the service returned it: the authored payload, verbatim (FR-070, FR-071). */
  action: ActionResult | null
  /** The Evidence Room's documents, so a trace can name the one it leads to (see `DocumentValue`). */
  documents?: readonly TracedDocument[]
}

export function ActionResultSheet({
  open,
  onOpenChange,
  claimKey,
  action,
  documents = [],
}: ActionResultSheetProps) {
  if (action === null) return null
  const entries = orderedEntries(action.result)
  const minutes = Math.round(action.clockCostMs / 60_000)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {t('workspace.actionResultTitle', {
              action: ACTION_LABELS[action.type](),
              key: claimKey,
            })}
          </SheetTitle>
          <SheetDescription>{t('workspace.actionResultDescription')}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 px-4 pb-4">
          {entries.length === 0 ? (
            <p className="text-ink-muted text-reading">{t('workspace.actionResultEmpty')}</p>
          ) : (
            <dl className="flex flex-col gap-5">
              {entries.map(([key, value]) => (
                <div key={key} className="flex flex-col gap-1">
                  <dt className="text-ink-muted text-meta font-medium">
                    {RESULT_LABELS[key]?.() ?? key}
                  </dt>
                  <dd>
                    {key === 'document_id' ? (
                      <DocumentValue value={value} documents={documents} />
                    ) : (
                      <ResultValue value={value} />
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          {/* What it cost, after the result rather than in front of it: the charge was taken when
              the check started (FR-072), and the student came here to read the answer. */}
          <p className="border-line text-ink-muted text-meta border-t pt-4">
            {minutes === 1
              ? t('workspace.actionResultCostOne')
              : t('workspace.actionResultCost', { minutes })}
          </p>
        </div>
      </SheetContent>
    </Sheet>
  )
}
