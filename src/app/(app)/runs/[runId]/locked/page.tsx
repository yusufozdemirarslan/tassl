import type { Metadata } from 'next'
import type { Route } from 'next'
import { notFound, redirect } from 'next/navigation'
import { AddendumControl } from '@/components/features/run/addendum-dialog'
import { FramePanel } from '@/components/features/run/frame-panel'
import { TurnWait } from '@/components/features/run/turn-wait'
import { PageHeader } from '@/components/layout/page-header'
import { Panel } from '@/components/layout/panel'
import { isAppError } from '@/lib/errors'
import { formatDateTime } from '@/lib/format/date-time'
import { t } from '@/lib/i18n/t'
import {
  getDecision,
  TURN_WINDOW_MS,
  type BriefFieldUnitValue,
  type BriefNamedField,
  type BriefView,
} from '@/server/modules/runs'
import { getViewer } from '../../../viewer'
import { getRunView } from '../run-view'

export const metadata: Metadata = { title: t('decision.metaTitle') }

// UI-024 `/runs/[runId]/locked` (FR-084, FR-102, FR-107, FR-110): the decision is filed, and the
// student is waiting for the Turn.
//
// **Everything on this screen is read-only, and there is no control that pretends otherwise.** The
// lock is irreversible: `run_briefs` refuses an UPDATE past `locked_at` at the database (migration
// 0006) and `run_frames` and `run_addenda` have no UPDATE grant at all (migration 0009), so there
// is no edit path to draw and none is drawn. The one thing a student may still do is add an
// addendum — once, fifty words, kept apart from the decision (FR-107) — and that control disappears
// the moment it is used, because a disabled button beside the note it wrote is a control that
// cannot act.
//
// **Nothing here evaluates what was filed.** No mark, no summary, no comment, and in particular no
// `auto_locked` and no `speed_outlier`: FR-106's flag is an instructor observation and a signal
// rather than a penalty, and telling the student their lock was flagged would make it one
// (`BriefViewSchema` does not carry either field, D-298). An auto-locked run therefore looks like
// any other on this page, with the fields that were empty when the clock ended shown as empty —
// which is what FR-105 filed.
//
// **The countdown is a plain reading.** `Clock` marks its last five minutes amber and its last
// minute red for the *working* clock, because that is time being spent; the wait for the Turn is
// time passing, so this one is drawn without thresholds (see `clock.tsx`). Nothing polls this page:
// the RunFrame band above it polls `GET /runs/{runId}` every five seconds, and when the Turn is
// delivered the state changes and the band refreshes the tree, which sends the student to `/turn`
// through the guard below (D-042).
//
// **What happens next comes first** (D-327). The common way onto this screen is the bad one:
// FR-105's auto-lock, the clock running out on a student who may have been mid-sentence. The two
// columns stacked in markup order under `lg`, so the first thing that student met was an inventory
// of their own blank fields and the sentence that matters — "You do not need to do anything until
// then; this page moves on by itself" — was third, past the whole brief and the whole frame. The
// Turn is now a full-width band directly under the header at every width, and the filed record sits
// below it. The lock's own timestamp comes with the panel title rather than as a footnote at the
// bottom of a long panel: "Filed 3:12 pm" is the answer to "what just happened to me".
//
// **The columns split at `2xl`** and at no width below it, for the reason the workspace's do
// (D-310): a filed brief is reading matter, and DESIGN.md's 72-character measure needs about 650 px
// of column, which two columns cannot give it until 1536. Below that the record runs full width and
// the prose is clamped to the measure.

/** The states `/runs/[runId]/locked` draws (09 §1): the decision is filed, the Turn has not landed. */
const LOCKED_STATE = 'decision_locked'

/** The unit a named field was entered in, in the student's own language. */
const UNIT_LABELS: Record<BriefFieldUnitValue, string> = {
  percent: t('decision.unitPercent'),
  ratio: t('decision.unitRatio'),
  months: t('decision.unitMonths'),
  usd: t('decision.unitUsd'),
  count: t('decision.unitCount'),
  other: t('decision.unitOther'),
}

export default async function RunLockedPage({ params }: PageProps<'/runs/[runId]/locked'>) {
  const { runId } = await params
  const { status } = await getRunView(runId)
  const next = status.run.links.next as Route

  if (status.run.state !== LOCKED_STATE) redirect(next)

  const { actor } = await getViewer()
  let record
  try {
    record = await getDecision(actor, runId)
  } catch (error) {
    if (!isAppError(error)) throw error
    // The run moved between the read above and this one — the Turn landed, or the decision was
    // filed in another tab and this one is behind. The run's own next step is the answer.
    if (error.code === 'ILLEGAL_TRANSITION') redirect(next)
    if (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN') notFound()
    throw error
  }

  const { run, frame, brief, namedFields, addendum, canAddAddendum, turnRemainingMs } = record

  return (
    <>
      <PageHeader title={t('decision.title')} description={t('decision.description')} />

      <div className="flex flex-col gap-6">
        {/* What happens next, first and full width, because the common way onto this screen is the
            auto-lock and the sentence a student needs then is "you do not need to do anything"
            (D-327). `tabIndex={-1}` is where the focus goes when the countdown reaches zero. */}
        <Panel id="turn-wait" title={t('decision.turnTitle')} headingLevel={2} tabIndex={-1}>
          <div className="flex flex-col gap-3">
            <TurnWait remainingMs={turnRemainingMs} panelId="turn-wait" />
            <p className="text-ink-muted text-reading max-w-measure">
              {t('decision.turnBody', { limit: Math.round(TURN_WINDOW_MS / 60_000) })}
            </p>
          </div>
        </Panel>

        {/* Two columns from `2xl`: what was filed, and the one thing that can still be written
            beside it. Below that they stack in the reading order the markup already has, so the
            visual order and the focus order agree. */}
        <div className="grid gap-6 2xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] 2xl:items-start">
          <div className="flex min-w-0 flex-col gap-6">
            <Panel
              id="locked-brief"
              title={t('decision.briefTitle')}
              description={t('decision.briefPermanent')}
              headingLevel={2}
              padding="reading"
              actions={
                brief?.lockedAt == null ? undefined : (
                  <p className="text-ink text-mono-sm font-mono tabular-nums">
                    {t('decision.briefLockedAt', { when: formatDateTime(brief.lockedAt) })}
                  </p>
                )
              }
            >
              {brief === null ? (
                <div className="flex flex-col gap-2">
                  <h3 className="text-h4">{t('decision.briefMissingTitle')}</h3>
                  <p className="text-ink-muted text-reading max-w-measure">
                    {t('decision.briefMissingBody')}
                  </p>
                </div>
              ) : (
                <FiledBrief brief={brief} namedFields={namedFields} />
              )}
            </Panel>

            {frame !== null && (
              <Panel
                id="locked-frame"
                title={t('decision.frameTitle')}
                description={t('decision.frameBody')}
                headingLevel={2}
                padding="reading"
              >
                <FramePanel frame={frame} />
              </Panel>
            )}
          </div>

          <Panel
            id="addendum"
            title={
              addendum === null ? t('decision.addendumTitle') : t('decision.addendumUsedTitle')
            }
            {...(addendum === null ? { description: t('decision.addendumBody') } : {})}
            headingLevel={2}
            className="min-w-0 self-start"
          >
            {addendum === null ? (
              canAddAddendum ? (
                <AddendumControl runId={run.id} canAdd />
              ) : (
                <p className="text-ink-muted text-body max-w-measure">
                  {t('decision.addendumClosed')}
                </p>
              )
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-ink text-reading max-w-measure whitespace-pre-line">
                  {addendum.text}
                </p>
                <p className="text-ink-muted text-meta">
                  {t('decision.addendumWrittenAt', { when: formatDateTime(addendum.createdAt) })}
                </p>
                <p className="text-ink-muted text-meta max-w-measure">
                  {t('decision.addendumUsedNote')}
                </p>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------------------------
// The filed brief, read back
// ---------------------------------------------------------------------------------------------

/**
 * The six fields as they were filed.
 *
 * A definition list, because that is what it is: a field name and what the student wrote in it. An
 * empty field says it was empty rather than drawing a blank line — the auto-lock files whatever was
 * there when the clock ended (FR-105), and a page that silently omitted those fields would be
 * hiding half of what was filed from the person who filed it.
 */
function FiledBrief({
  brief,
  namedFields,
}: {
  brief: BriefView
  namedFields: readonly BriefNamedField[]
}) {
  return (
    <dl className="flex flex-col gap-6">
      <Entry label={t('decision.briefRecommendation')} value={brief.recommendation} />
      <Entry label={t('decision.briefRationale')} value={brief.rationale} />

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
