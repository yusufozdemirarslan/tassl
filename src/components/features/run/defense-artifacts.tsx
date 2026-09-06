import { FrameBesideDecision } from '@/components/graphs/frame-beside-decision'
import { Panel } from '@/components/layout/panel'
import { formatDateTime } from '@/lib/format/date-time'
import { t } from '@/lib/i18n/t'
import type { DefenseView } from '@/server/modules/defense/schema'

// UI-026: the artifacts the defense is about (FR-120, FR-124, D-341).
//
// **This is the whole of what the student has in front of them, and that is the point of the
// screen.** The defense is what a person can say about their own decision with no assistant and no
// Evidence Room — PRD §7.12 — so there is no room here, no claim table, no Delegation Log, no
// trace, and no route to any of them. The trace is sealed to its owner in `defense_pending` by one
// rule in the module that owns it (`trace.requireOwnerReadAccess`, D-279), so this is not a screen
// hiding a door: there is no door.
//
// What *is* here is the student's own work: the frame they locked, the decision they filed, the one
// addendum, and the response they gave the Turn. Every one of them is something they wrote, which
// is the difference between a reference panel and a lifeline.
//
// **It is a Server Component.** Nothing on it can change — the frame is immutable in the database,
// the brief from the lock, the addendum from the moment it is written, and a Turn response is
// filed once — so it carries no state, no control, and no client bytes on a route already paying
// for a textarea per question (B4 / NFR-013, 16 §3.2). That is also why it may read the whole
// catalogue through `@/lib/i18n/t`.
//
// **Nothing on it is marked.** No evaluation of the decision, no `speed_outlier`, no `auto_locked`,
// no note about which figures matched a claim: those are the instructor's observations (FR-106,
// D-298) and the debrief's to say afterwards. `DefenseView.artifacts` does not carry them, and this
// component would have nothing to draw if it wanted to.

/** The three responses in the student's own words; `implicit` is the fourth case (D-335). */
const RESPONSE_LABELS: Record<'hold' | 'revise' | 'reverse', () => string> = {
  hold: () => t('defense.turnHold'),
  revise: () => t('defense.turnRevise'),
  reverse: () => t('defense.turnReverse'),
}

export type DefenseArtifactsProps = {
  artifacts: DefenseView['artifacts']
}

export function DefenseArtifacts({ artifacts }: DefenseArtifactsProps) {
  const { frame, brief, addendum, turnResponse, namedFields } = artifacts

  return (
    <Panel
      id="defense-artifacts"
      title={t('defense.artifactsTitle')}
      description={t('defense.artifactsDescription')}
      headingLevel={2}
      padding="reading"
    >
      <div className="flex flex-col gap-8">
        <FrameBesideDecision frame={frame} brief={brief} namedFields={namedFields} />

        {addendum !== null && (
          <section className="border-line flex flex-col gap-2 border-t pt-6">
            <h3 className="text-h4">{t('defense.addendumTitle')}</h3>
            <p className="text-ink text-reading max-w-measure whitespace-pre-line">
              {addendum.text}
            </p>
            <p className="text-ink-muted text-meta">
              <time dateTime={addendum.createdAt}>
                {t('defense.addendumAt', { when: formatDateTime(addendum.createdAt) })}
              </time>
            </p>
          </section>
        )}

        <section className="border-line flex flex-col gap-3 border-t pt-6">
          <h3 className="text-h4">{t('defense.turnTitle')}</h3>
          {turnResponse === null ? (
            <p className="text-ink-muted text-reading max-w-measure">{t('defense.turnNone')}</p>
          ) : (
            <dl className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                {/* The category itself, in the word the student pressed. `implicit` is not a
                    fourth category: it is the same hold, recorded because the window closed with
                    nobody there, and the sentence beside it says so rather than the label lying
                    about a press that never happened (FR-113, D-335). */}
                <dd className="text-ink text-reading font-medium">
                  {RESPONSE_LABELS[turnResponse.response]()}
                </dd>
                {turnResponse.implicit && (
                  <dd className="text-ink-muted text-reading max-w-measure">
                    {t('defense.turnImplicit')}
                  </dd>
                )}
              </div>

              {turnResponse.justification !== null && (
                <div className="flex flex-col gap-1">
                  <dt className="text-ink-muted text-meta font-medium">
                    {t('defense.turnJustification')}
                  </dt>
                  <dd className="text-ink text-reading max-w-measure whitespace-pre-line">
                    {turnResponse.justification}
                  </dd>
                </div>
              )}

              {turnResponse.confidence !== null && (
                <div className="flex flex-col gap-1">
                  <dt className="text-ink-muted text-meta font-medium">
                    {t('defense.turnConfidence')}
                  </dt>
                  <dd className="text-ink text-mono font-mono tabular-nums">
                    {t('defense.turnConfidenceValue', { value: turnResponse.confidence })}
                  </dd>
                </div>
              )}
            </dl>
          )}
          {turnResponse !== null && (
            <p className="text-ink-muted text-meta">
              <time dateTime={turnResponse.lockedAt}>
                {t('defense.turnFiledAt', { when: formatDateTime(turnResponse.lockedAt) })}
              </time>
            </p>
          )}
        </section>
      </div>
    </Panel>
  )
}
