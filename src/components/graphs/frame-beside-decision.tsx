import { FramePanel } from '@/components/features/run/frame-panel'
import { formatDateTime } from '@/lib/format/date-time'
import { t } from '@/lib/i18n/messages/decision'
import type { BriefFieldUnitValue } from '@/server/modules/runs/schema'

// `FrameBesideDecision` (09 §4): the frame a student locked before the assistant was in the room,
// set beside the decision they filed after it (UI-025, UI-028).
//
// **This is the layout, and the layout is the argument.** The whole of the Frame-vs-Decision
// reading is that the two are read *together*: what a student said they were deciding, before any
// help, against what they filed at the end of the working period. A screen that shows one and then
// the other, a scroll apart, does not make that comparison available; a screen that puts them in
// two columns of the same grid does. The Turn's own screen is the first caller — UI-025 asks for
// "the frozen pre-Turn record beside" — and the debrief is the second, where the same layout gains
// the graph payload (Phase 10).
//
// **It renders content, never a panel.** `FramePanel` set the rule for the same reason (DESIGN.md
// §The One-Layer Rule): both callers already have a `Panel` around this, and a panel inside a panel
// is the nesting the rule bans. The caller supplies the container and the panel title; this supplies
// two labelled columns and the hairline between them.
//
// **The split is a container query, not a breakpoint.** D-310's arithmetic is about the column the
// prose lands in rather than the width of the window: this component is drawn full-width on the
// debrief and inside a 5/12 column on the Turn screen, and a `2xl:` breakpoint would put two 230 px
// columns of reading text inside the second one. `@4xl` (896 px) is the width at which each half
// still holds a usable measure, and a container query is what lets one component be right in both
// places (D-348).
//
// **It is a Server Component and stays one.** Nothing on it is interactive — the frame is immutable
// in the database and the brief is immutable from the lock — so no caller pays a byte to draw it.
// That is also why it may read the `decision` namespace directly: those strings are already the
// words `/locked` reads this record back in, and two names for "Your recommendation" would be two
// records.

/** The unit a named field was entered in, in the student's own language. */
const UNIT_LABELS: Record<BriefFieldUnitValue, string> = {
  percent: t('decision.unitPercent'),
  ratio: t('decision.unitRatio'),
  months: t('decision.unitMonths'),
  usd: t('decision.unitUsd'),
  count: t('decision.unitCount'),
  other: t('decision.unitOther'),
}

// The three shapes this layout draws, stated structurally rather than imported.
//
// Two modules carry them under two names — `runs/schema.ts` has `Frame`, `BriefView` and
// `BriefNamedField`; `defense/schema.ts` restates the same fields for the boundary reason D-341
// gives — and both satisfy these. Naming one of the two here would make the debrief's caller
// convert a shape into another module's, which is the coupling the restatement exists to avoid.

/** The frame locked before the assistant was in the room (FR-041). */
export type FramedRecord = {
  decision: string
  assumptions: string[]
  position: string
  confidence: number
  lockedAt: string
}

/** The brief as filed (FR-100 to FR-103). */
export type FiledRecord = {
  recommendation: string
  briefRationale: string
  assumptions: string[]
  changeMyMind: string
  confidence: number | null
  namedValues: Record<string, number>
  lockedAt: string | null
}

/** The author's own label and unit for a named field (06 §3.1). */
export type NamedFieldLabel = { key: string; label: string; unit: BriefFieldUnitValue }

export type FrameBesideDecisionProps = {
  /** The frame locked before the assistant was in the room (FR-041); null on a run without one. */
  frame: FramedRecord | null
  /** The brief as filed. Never null after a lock: the auto-lock files an empty one (FR-105). */
  brief: FiledRecord | null
  /** The author's own label and unit per named field, so the brief reads back in their words. */
  namedFields: readonly NamedFieldLabel[]
  /**
   * The element for the two column titles. Both callers put this under a panel title, so the
   * default is the rung below it and the document outline never skips a level (DESIGN.md
   * §The Descending-Heading Rule).
   */
  headingLevel?: 3 | 4
}

export function FrameBesideDecision({
  frame,
  brief,
  namedFields,
  headingLevel = 3,
}: FrameBesideDecisionProps) {
  // DESIGN.md §The Descending-Heading Rule: an h3 is the Subtitle style, an h4 the same serif at
  // the reading size. The base layer already gives both the serif face and weight 500.
  const Heading = `h${headingLevel}` as const
  const headingClass = headingLevel === 3 ? 'text-h4' : 'text-reading'

  return (
    <div className="@container">
      {/* Two columns from 896 px of *container*, one below it. The hairline is the separation
          DESIGN.md asks for; there is no second card. */}
      <div className="grid gap-6 @4xl:grid-cols-2 @4xl:gap-8">
        <section className="flex min-w-0 flex-col gap-3">
          <Heading className={headingClass}>{t('decision.frameTitle')}</Heading>
          {frame === null ? (
            <p className="text-ink-muted text-reading max-w-measure">
              {t('decision.frameMissing')}
            </p>
          ) : (
            <FramePanel frame={frame} />
          )}
        </section>

        <section className="border-line flex min-w-0 flex-col gap-3 @4xl:border-l @4xl:pl-8">
          <div className="flex flex-col gap-1">
            <Heading className={headingClass}>{t('decision.briefTitle')}</Heading>
            {/* The instant it was filed, under the heading rather than at the foot of a long
                column: "Filed 3:12 pm" answers "when did this become permanent", and D-327 put the
                same line beside the same title on `/locked` for the same reason. */}
            {brief?.lockedAt != null && (
              <p className="text-ink-muted text-mono-sm font-mono tabular-nums">
                <time dateTime={brief.lockedAt}>
                  {t('decision.briefLockedAt', { when: formatDateTime(brief.lockedAt) })}
                </time>
              </p>
            )}
          </div>
          {brief === null ? (
            <p className="text-ink-muted text-reading max-w-measure">
              {t('decision.briefMissingBody')}
            </p>
          ) : (
            <FiledBrief brief={brief} namedFields={namedFields} />
          )}
        </section>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// The filed brief, read back
// ---------------------------------------------------------------------------------------------

/**
 * The six fields as they were filed (FR-100 to FR-103).
 *
 * A definition list, because that is what it is: a field name and what the student wrote in it. An
 * empty field says it was empty rather than drawing a blank line — the auto-lock files whatever was
 * there when the clock ended (FR-105), and a screen that silently omitted those fields would be
 * hiding half of what was filed from the person who filed it.
 *
 * It is exported because three screens read the same record back — `/locked`, the Turn, and the
 * debrief — and a second implementation would be a second answer to "what did I file".
 */
export function FiledBrief({
  brief,
  namedFields,
}: {
  brief: FiledRecord
  namedFields: readonly NamedFieldLabel[]
}) {
  return (
    <dl className="flex flex-col gap-6">
      <Entry label={t('decision.briefRecommendation')} value={brief.recommendation} />
      <Entry label={t('decision.briefRationale')} value={brief.briefRationale} />

      <div className="flex flex-col gap-2">
        <dt className="text-ink-muted text-meta font-medium">{t('decision.briefAssumptions')}</dt>
        <dd>
          <ol className="flex flex-col gap-2">
            {brief.assumptions.map((assumption, index) => (
              <li key={`assumption-${String(index)}`} className="flex flex-col gap-0.5">
                <span className="text-ink-muted text-meta max-w-measure">
                  {t('decision.briefAssumption', { number: index + 1 })}
                </span>
                <span
                  className={
                    assumption.trim() === ''
                      ? 'text-ink-muted text-reading max-w-measure'
                      : 'text-ink text-reading max-w-measure'
                  }
                >
                  {assumption.trim() === '' ? t('decision.briefEmptyField') : assumption}
                </span>
              </li>
            ))}
          </ol>
        </dd>
      </div>

      <Entry label={t('decision.briefChangeMyMind')} value={brief.changeMyMind} />

      <div className="flex flex-col gap-1">
        <dt className="text-ink-muted text-meta font-medium">{t('decision.briefConfidence')}</dt>
        <dd className="text-ink text-mono font-mono tabular-nums">
          {brief.confidence === null
            ? t('decision.briefEmptyValue')
            : t('decision.briefConfidenceValue', { value: brief.confidence })}
        </dd>
      </div>

      {namedFields.length > 0 && (
        <div className="flex flex-col gap-2">
          <dt className="text-ink-muted text-meta font-medium">{t('decision.briefFigures')}</dt>
          <dd>
            <ul className="flex flex-col gap-2">
              {namedFields.map((field) => {
                const value = brief.namedValues[field.key]
                return (
                  <li key={field.key} className="flex flex-col gap-0.5">
                    <span className="text-ink-muted text-meta max-w-measure">
                      {t('decision.briefFigureUnit', {
                        label: field.label,
                        unit: UNIT_LABELS[field.unit],
                      })}
                    </span>
                    <span
                      className={
                        value === undefined
                          ? 'text-ink-muted text-body max-w-measure'
                          : 'text-ink text-mono font-mono tabular-nums'
                      }
                    >
                      {value === undefined ? t('decision.briefEmptyValue') : String(value)}
                    </span>
                  </li>
                )
              })}
            </ul>
          </dd>
        </div>
      )}
    </dl>
  )
}

function Entry({ label, value }: { label: string; value: string }) {
  const empty = value.trim() === ''
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-ink-muted text-meta font-medium">{label}</dt>
      <dd
        className={
          empty
            ? 'text-ink-muted text-reading max-w-measure'
            : 'text-ink text-reading max-w-measure whitespace-pre-line'
        }
      >
        {empty ? t('decision.briefEmptyField') : value}
      </dd>
    </div>
  )
}
