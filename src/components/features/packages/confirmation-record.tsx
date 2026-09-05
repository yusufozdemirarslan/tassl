import { CheckIcon, ChevronDownIcon, PencilLineIcon, XIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDateTime } from '@/lib/format/date-time'
import { t } from '@/lib/i18n/t'
import type {
  ConfirmationDecisionValue,
  ElementConfirmationView,
  ElementTypeValue,
} from '@/server/modules/scenarios/schema'

// UI-044 → `ConfirmationRecord`: element, decision, by, when, revision (FR-195, FR-198). Every
// decision an author took on this version, which is the record a reviewer reads to see who signed
// off on what and how much of it was rewritten before they did.
//
// A confirmed version carries a decision for every element — around a hundred of them, and on a
// version confirmed in one sitting nearly all are the same authority confirming the same way in the
// same minute. Read as one flat table that is five thousand pixels of four identical columns, and
// the four rows that say something are lost in it. So the record is read in three passes:
//
//   1. by element type — how many decisions, of what kind, by whom, and when the last one landed;
//   2. the exceptions — an edit, a rejection, a second revision, a note, or a different decider:
//      every row whose story is not "confirmed once, first time, by the same person";
//   3. every row, in full, behind a disclosure.
//
// The third pass is not a courtesy. FR-198 asks for the authoring record, so nothing may become
// unreachable: `<details>` is native, keyboard-operable, open to a browser's find-in-page in every
// current engine, and costs the route no JavaScript.
//
// A singleton element (the brief, the Turn, the counterfactual) carries no element id of its own,
// so its row names the element type and nothing else; a row element is named by its type and the id
// the confirmation was written against, because the record itself carries no element keys.
//
// The note is not one of the five columns, but a rejection with no reason on the screen is a record
// that cannot be read: it sits under the element it belongs to, where there is room for a sentence.

export type ConfirmationRecordProps = {
  rows: readonly ElementConfirmationView[]
}

/** Element types in the order the confirmation workspace lists them; the summary follows it. */
const ELEMENT_LABELS: Record<ElementTypeValue, () => string> = {
  brief: () => t('packageVersion.element.brief'),
  document: () => t('packageVersion.element.document'),
  stakeholder: () => t('packageVersion.element.stakeholder'),
  answer_space_position: () => t('packageVersion.element.answerSpacePosition'),
  named_field: () => t('packageVersion.element.namedField'),
  claim: () => t('packageVersion.element.claim'),
  variant_claim_state: () => t('packageVersion.element.variantClaimState'),
  probe: () => t('packageVersion.element.probe'),
  turn: () => t('packageVersion.element.turn'),
  defense_question: () => t('packageVersion.element.defenseQuestion'),
  readiness_item: () => t('packageVersion.element.readinessItem'),
  counterfactual: () => t('packageVersion.element.counterfactual'),
  general_escalation_reply: () => t('packageVersion.element.generalEscalationReply'),
  clock_and_difficulty: () => t('packageVersion.element.clockAndDifficulty'),
  seed_reskin: () => t('packageVersion.element.seedReskin'),
}

const ELEMENT_ORDER = Object.keys(ELEMENT_LABELS) as ElementTypeValue[]

const DECISION_LABELS: Record<ConfirmationDecisionValue, () => string> = {
  confirmed: () => t('packageVersion.decision.confirmed'),
  edited: () => t('packageVersion.decision.edited'),
  rejected: () => t('packageVersion.decision.rejected'),
}

const DECISION_COUNTS: Record<ConfirmationDecisionValue, (count: number) => string> = {
  confirmed: (count) => t('packageVersion.recordConfirmedCount', { count }),
  edited: (count) => t('packageVersion.recordEditedCount', { count }),
  rejected: (count) => t('packageVersion.recordRejectedCount', { count }),
}

type TypeSummary = {
  elementType: ElementTypeValue
  counts: Record<ConfirmationDecisionValue, number>
  deciders: string[]
  latest: string
}

/**
 * One line per element type, in the workspace's own order; a type with no decisions is absent.
 * `decidedAt` is always `toISOString()` output — fixed width, always UTC — so the latest of two is
 * the greater string and no date has to be parsed to find it.
 */
function summarize(rows: readonly ElementConfirmationView[]): TypeSummary[] {
  const summaries: TypeSummary[] = []
  for (const elementType of ELEMENT_ORDER) {
    const own = rows.filter((row) => row.elementType === elementType)
    const first = own[0]
    if (!first) continue

    const counts: Record<ConfirmationDecisionValue, number> = {
      confirmed: 0,
      edited: 0,
      rejected: 0,
    }
    let latest = first.decidedAt
    const deciders = new Set<string>()
    for (const row of own) {
      counts[row.decision] += 1
      deciders.add(row.decidedByName)
      if (row.decidedAt > latest) latest = row.decidedAt
    }
    summaries.push({ elementType, counts, deciders: [...deciders], latest })
  }
  return summaries
}

/**
 * Whoever signed most of this version. It is the baseline the exceptions are measured against: on
 * a version one authority confirmed in one sitting, a row by anybody else is the whole story.
 */
function principalDecider(rows: readonly ElementConfirmationView[]): string | null {
  const tally = new Map<string, number>()
  for (const row of rows) tally.set(row.decidedByName, (tally.get(row.decidedByName) ?? 0) + 1)

  let best: string | null = null
  let bestCount = 0
  for (const [name, count] of tally) {
    if (count > bestCount) {
      best = name
      bestCount = count
    }
  }
  return best
}

/** "Confirmed once, on its first revision, by the person who signed the rest, and said nothing." */
function isRoutine(row: ElementConfirmationView, decider: string | null): boolean {
  return (
    row.decision === 'confirmed' &&
    row.revision === 1 &&
    row.note.length === 0 &&
    row.decidedByName === decider
  )
}

/**
 * Green for a confirmation, red for a rejection, the neutral wash for an edit: three decisions that
 * mean three different things. Each carries its own word and its own icon, so the color is never
 * the only signal and the green stays in the icon rather than in the text.
 */
function DecisionBadge({ decision }: { decision: ConfirmationDecisionValue }) {
  const label = DECISION_LABELS[decision]()
  if (decision === 'rejected') {
    return (
      <Badge variant="destructive">
        <XIcon aria-hidden="true" />
        {label}
      </Badge>
    )
  }
  if (decision === 'edited') {
    return (
      <Badge variant="secondary">
        <PencilLineIcon aria-hidden="true" className="text-ink-muted" />
        {label}
      </Badge>
    )
  }
  return (
    <Badge className="bg-green-soft text-ink border-transparent">
      <CheckIcon aria-hidden="true" className="text-green" />
      {label}
    </Badge>
  )
}

/** The five columns of the record itself, over whichever rows it is given. */
function DecisionsTable({
  rows,
  caption,
}: {
  rows: readonly ElementConfirmationView[]
  caption: string
}) {
  return (
    <Table className="min-w-3xl">
      <TableCaption>{caption}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">{t('packageVersion.columnElement')}</TableHead>
          <TableHead scope="col">{t('packageVersion.columnDecision')}</TableHead>
          <TableHead scope="col">{t('packageVersion.columnBy')}</TableHead>
          <TableHead scope="col">{t('packageVersion.columnWhen')}</TableHead>
          <TableHead scope="col">{t('packageVersion.columnRevision')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="whitespace-normal">
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">{ELEMENT_LABELS[row.elementType]()}</span>
                {row.elementId !== null && (
                  <span className="text-ink-muted text-mono-sm font-mono">{row.elementId}</span>
                )}
                {row.note.length > 0 && (
                  <span className="text-ink-muted text-meta max-w-[52ch]">{row.note}</span>
                )}
              </span>
            </TableCell>
            <TableCell>
              <DecisionBadge decision={row.decision} />
            </TableCell>
            <TableCell className="whitespace-normal">{row.decidedByName}</TableCell>
            <TableCell className="whitespace-normal">{formatDateTime(row.decidedAt)}</TableCell>
            <TableCell className="font-mono tabular-nums">{row.revision}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function ConfirmationRecord({ rows }: ConfirmationRecordProps) {
  const decider = principalDecider(rows)
  const exceptions = rows.filter((row) => !isRoutine(row, decider))

  return (
    <div className="flex flex-col gap-6">
      <Table className="min-w-lg">
        <TableCaption>{t('packageVersion.recordByTypeCaption')}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t('packageVersion.columnElementType')}</TableHead>
            <TableHead scope="col">{t('packageVersion.columnDecisions')}</TableHead>
            <TableHead scope="col">{t('packageVersion.columnBy')}</TableHead>
            <TableHead scope="col">{t('packageVersion.columnLatest')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {summarize(rows).map((summary) => (
            <TableRow key={summary.elementType}>
              <TableCell className="font-medium whitespace-normal">
                {ELEMENT_LABELS[summary.elementType]()}
              </TableCell>
              <TableCell className="whitespace-normal">
                <span className="flex flex-col gap-0.5">
                  {(['confirmed', 'edited', 'rejected'] as const)
                    .filter((decision) => summary.counts[decision] > 0)
                    .map((decision) => (
                      <span key={decision} className="tabular-nums">
                        {DECISION_COUNTS[decision](summary.counts[decision])}
                      </span>
                    ))}
                </span>
              </TableCell>
              <TableCell className="whitespace-normal">{summary.deciders.join(', ')}</TableCell>
              <TableCell className="whitespace-normal">{formatDateTime(summary.latest)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* A second level of grouping is a heading and a hairline, never a panel inside a panel. */}
      <section className="border-line flex flex-col gap-3 border-t pt-5">
        <h3 className="text-h4">{t('packageVersion.recordExceptionsTitle')}</h3>
        {exceptions.length === 0 ? (
          <p className="text-ink-muted text-body max-w-[72ch]">
            {t('packageVersion.recordExceptionsNone')}
          </p>
        ) : (
          <DecisionsTable rows={exceptions} caption={t('packageVersion.recordExceptionsCaption')} />
        )}
      </section>

      {/* Native disclosure: keyboard operable, open to find-in-page, and no JavaScript on the
          route. The chevron turns through the arbitrary variant rather than `group-open`, so the
          rule is one Tailwind compiles from this file alone. */}
      <details className="border-line border-t pt-2 [&[open]_summary_svg]:rotate-180">
        <summary className="text-primary text-meta focus-visible:outline-focus inline-flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
          <ChevronDownIcon
            aria-hidden="true"
            className="size-4 transition-transform duration-150 ease-out"
          />
          {t('packageVersion.recordAllSummary', { count: rows.length })}
        </summary>
        <div className="mt-2">
          <DecisionsTable rows={rows} caption={t('packageVersion.recordCaption')} />
        </div>
      </details>
    </div>
  )
}
