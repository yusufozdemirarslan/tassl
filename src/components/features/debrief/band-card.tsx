import { BadgeCheckIcon } from 'lucide-react'
import { LabelChip } from '@/components/layout/label-chip'
import { bandRationaleText, unassessedReasonText } from '@/lib/band-prose'
import { t } from '@/lib/i18n/t'

// UI-028 → one of the seven dimensions, as the student reads it (FR-151, FR-004, FR-182).
//
// **The same card in both versions of the page** (FR-150). A draft carries `decision: null` and the
// amber Draft chip; once the instructor has decided, the confirmed band replaces the draft *in
// place* with the green chip, the sentence naming what they did, and any note they wrote. There is
// no second component and no second layout, because the promise the two versions make is that they
// are one page read twice.
//
// **What is deliberately not here.** No `quotes` and no `evidenceEventSeqs`: both are reviewer-only
// in every state, so the module's projection never carries them and this card has nothing to drop.
// What FR-151 means by "with evidence" is the graphs the band was read from, and those are named
// here and drawn in full further up the page (D-438). There is no evidence drawer on the student's
// side: the drawer opens a list of trace sequence numbers, which is the reviewer's instrument.

/**
 * One dimension, as both student surfaces carry it.
 *
 * Structural rather than `DebriefBand`, because the Judgment Record draws the same card from
 * `RecordBand` (D-469): the two projections are the same seven facts with two extra fields on the
 * debrief's — FR-004's sentence for a dimension that holds no band, and FR-005's raise after a
 * correction — so the record satisfies this shape by having neither. A second card would be a
 * second answer to "what does a confirmed band look like".
 */
export type BandCardData = {
  dimension:
    | 'framing'
    | 'delegation'
    | 'verification'
    | 'calibration'
    | 'decision_quality'
    | 'adaptation'
    | 'ownership'
  band: 'novice' | 'developing' | 'proficient' | 'professional' | null
  status: 'drafted' | 'unassessed'
  decision: 'confirmed' | 'overridden' | 'unassessed' | null
  note: string | null
  rationale: string
  graphKeys: readonly string[]
  /** FR-004's sentence when the dimension holds no band; absent on the record's projection. */
  reason?: string
  /** True when a correction the instructor entered moved this dimension up (FR-005). */
  raisedByCorrection?: boolean
}

const DIMENSION_LABELS: Record<BandCardData['dimension'], string> = {
  framing: t('band.dimension.framing'),
  delegation: t('band.dimension.delegation'),
  verification: t('band.dimension.verification'),
  calibration: t('band.dimension.calibration'),
  decision_quality: t('band.dimension.decision_quality'),
  adaptation: t('band.dimension.adaptation'),
  ownership: t('band.dimension.ownership'),
}

const BAND_LABELS: Record<NonNullable<BandCardData['band']>, string> = {
  novice: t('band.novice'),
  developing: t('band.developing'),
  proficient: t('band.proficient'),
  professional: t('band.professional'),
}

const DECISION_SENTENCES: Record<NonNullable<BandCardData['decision']>, string> = {
  confirmed: t('debrief.band.decision.confirmed'),
  overridden: t('debrief.band.decision.overridden'),
  unassessed: t('debrief.band.decision.unassessed'),
}

const GRAPH_TITLES: Record<string, string> = {
  confidence_line: t('graph.confidenceLine.title'),
  clock_timeline: t('graph.clockTimeline.title'),
  stance_matrix: t('graph.stanceMatrix.title'),
  frame_beside_decision: t('graph.frameBesideDecision.title'),
}

export type BandCardProps = {
  band: BandCardData
  /**
   * Where each graph this band was read from is drawn, as a same-page fragment.
   *
   * UI-028's tree asks the band card for a **graph link**, and the two screens that draw this card
   * put the four graphs in different places: the debrief gives each its own section, the record
   * gives them one panel. A map keyed by graph key lets both answer without this file knowing
   * either layout, and a key with no entry renders as the plain title it always was.
   */
  graphAnchors?: Readonly<Record<string, string>>
}

export function BandCard({ band, graphAnchors = {} }: BandCardProps) {
  const confirmed = band.decision !== null
  const headingId = `band-${band.dimension}-title`
  const name = band.band === null ? t('band.unassessed') : BAND_LABELS[band.band]

  return (
    <article
      id={`band-${band.dimension}`}
      aria-labelledby={headingId}
      className="border-line flex flex-col gap-3 border-t pt-6 first:border-t-0 first:pt-0"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={headingId} className="text-h4">
          {DIMENSION_LABELS[band.dimension]}
        </h3>
        <LabelChip kind={confirmed ? 'confirmed' : 'draft'} />
      </div>

      <p className="text-ink text-reading">
        <span className="text-ink-muted text-meta mr-2">
          {confirmed ? t('debrief.band.confirmedLabel') : t('debrief.band.draftLabel')}
        </span>
        <span className="font-medium">{name}</span>
      </p>

      {confirmed && band.decision !== null && (
        <p className="text-ink text-body max-w-measure">{DECISION_SENTENCES[band.decision]}</p>
      )}

      {/* Both of these are a sentence, never the identifier the row stores (D-515). A hand-banded
          held run carries the literal `manual` on all seven dimensions and an unassessed one
          carries `no_evidence`; the reviewer's replay had prose for each and these two surfaces —
          the debrief and the Judgment Record, which is the copy the student keeps — did not. */}
      <p className="text-ink text-reading max-w-measure break-words">
        {bandRationaleText(band.rationale)}
      </p>

      {band.status === 'unassessed' && band.reason !== undefined && band.reason.length > 0 && (
        <p className="text-ink-muted text-body max-w-measure break-words">
          {unassessedReasonText(band.reason)}
        </p>
      )}

      {band.raisedByCorrection === true && (
        // The product's confirmation treatment — hairline, green wash, ink text, icon — rather than
        // a coloured edge, which DESIGN.md reserves for the label chip.
        <p className="border-green bg-green-soft text-ink text-body max-w-measure flex items-start gap-2 rounded-md border p-3">
          <BadgeCheckIcon aria-hidden="true" className="text-green mt-0.5 size-4 shrink-0" />
          <span>{t('debrief.band.raisedByCorrection')}</span>
        </p>
      )}

      {band.graphKeys.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-ink-muted text-body">{t('debrief.band.evidenceLabel')}</span>
          <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {band.graphKeys.map((key) => {
              const title = GRAPH_TITLES[key] ?? key
              const anchor = graphAnchors[key]
              return (
                <li key={key} className="text-ink text-body">
                  {anchor === undefined ? (
                    title
                  ) : (
                    <a
                      href={anchor}
                      className="text-primary focus-visible:outline-focus inline-flex min-h-10 items-center rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      {title}
                    </a>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {confirmed && (
        <div className="bg-paper-sunken flex flex-col gap-1 rounded-md p-3">
          <h4 className="text-reading">{t('debrief.band.noteLabel')}</h4>
          <p className="text-ink text-body max-w-measure break-words whitespace-pre-line">
            {band.note !== null && band.note.trim().length > 0
              ? band.note
              : t('debrief.band.noNote')}
          </p>
        </div>
      )}
    </article>
  )
}
