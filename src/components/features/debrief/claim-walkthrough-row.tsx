import { StanceChip, type StanceValue } from '@/components/features/run/stance-chip'
import { LabelChip } from '@/components/layout/label-chip'
import { t } from '@/lib/i18n/t'

// UI-028 → "Claim by claim": one row of the walk under the stance matrix (FR-151).
//
// The row's shape is restated here rather than imported from `debrief/assembly.ts`, for the reason
// `graphs/frame-beside-decision.tsx` gives at its own head: a component takes a module's `schema`
// types and its `actions` and nothing else (CLAUDE.md), and the section payload arrives typed
// `unknown` because a module schema may not import the four graph builders. What the row needs is a
// shape, and a structural one is satisfied by the assembly's own output without either file
// reaching into the other.
//
// **Every sentence on the row was written by the server.** `lines` is the generated half — fixed
// templates from the `debrief.` catalogue with this run's facts interpolated (FR-153) — and
// `rationale` is the one piece of prose nobody generated: what the scenario's author wrote about
// what this claim deserved and why. Neither is composed here, because a screen that assembled a
// sentence about a student's run would be a second place the product's voice could slip.

export type ClaimWalkthroughData = {
  claimId: string
  key: string
  text: string
  importance: 'load_bearing' | 'supporting'
  stanceTaken: StanceValue | null
  warrantedStance: StanceValue
  match: boolean
  evidenceStatus: 'sound' | 'defective'
  failureFamily: string | null
  failureFamilyLabel: string | null
  reliedOn: boolean
  neutralized: boolean
  rationale: string
  lines: readonly string[]
}

const IMPORTANCE_LABELS: Record<ClaimWalkthroughData['importance'], string> = {
  load_bearing: t('debrief.claim.importance.load_bearing'),
  supporting: t('debrief.claim.importance.supporting'),
}

export function ClaimWalkthroughRow({ claim }: { claim: ClaimWalkthroughData }) {
  const headingId = `claim-${claim.claimId}-title`
  return (
    <article
      id={`claim-${claim.key}`}
      aria-labelledby={headingId}
      data-claim-id={claim.claimId}
      className="border-line flex flex-col gap-3 border-t pt-5 first:border-t-0 first:pt-0"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h4 id={headingId} className="text-reading font-medium">
          {t('debrief.claim.heading', { key: claim.key })}
        </h4>
        <span className="text-ink-muted text-meta">{IMPORTANCE_LABELS[claim.importance]}</span>
        {claim.neutralized && <LabelChip kind="unreviewed" label={t('label.corrected')} />}
      </div>

      <p className="text-ink text-reading max-w-measure break-words">{claim.text}</p>

      {/* The two stances side by side, each named for a reader who meets the chip on its own: the
          colour is never the carrier (09 §6), so both chips speak their column. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-ink-muted text-meta">{t('debrief.claim.yourStanceLabel')}</span>
          {claim.stanceTaken === null ? (
            <span className="text-ink text-meta">{t('debrief.claim.noStanceShort')}</span>
          ) : (
            <StanceChip stance={claim.stanceTaken} srLabel={t('debrief.claim.yourStanceLabel')} />
          )}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-ink-muted text-meta">{t('debrief.claim.warrantedLabel')}</span>
          <StanceChip stance={claim.warrantedStance} srLabel={t('debrief.claim.warrantedLabel')} />
        </span>
        {claim.stanceTaken !== null && (
          <span className="text-ink text-meta font-medium">
            {claim.match ? t('debrief.claim.matchYes') : t('debrief.claim.matchNo')}
          </span>
        )}
      </div>

      <p className="text-ink-muted text-body max-w-measure">
        {claim.evidenceStatus === 'defective'
          ? t('debrief.claim.defectiveHere')
          : t('debrief.claim.soundHere')}
        {claim.failureFamilyLabel !== null && ` ${claim.failureFamilyLabel}.`}
      </p>

      <ul className="flex flex-col gap-1">
        {claim.lines.map((line, index) => (
          <li
            key={`${claim.claimId}-line-${String(index)}`}
            className="text-ink text-body max-w-measure"
          >
            {line}
          </li>
        ))}
      </ul>

      <div className="bg-paper-sunken flex flex-col gap-1 rounded-md p-3">
        <h5 className="text-body font-semibold">{t('debrief.claim.rationaleLabel')}</h5>
        <p className="text-ink text-body max-w-measure break-words">{claim.rationale}</p>
      </div>
    </article>
  )
}
