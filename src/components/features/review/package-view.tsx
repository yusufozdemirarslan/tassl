import type { ReactNode } from 'react'
import Link from 'next/link'
import type { Route } from 'next'
import { AuthoringMeasures } from '@/components/features/packages/authoring-measures'
import { ConfirmationRecord } from '@/components/features/packages/confirmation-record'
import { t } from '@/lib/i18n/t'
import type { PackageVersionView } from '@/server/modules/scenarios/schema'
import type { VariantKeyValue } from '@/server/modules/scenarios/schema'

// UI-033 → Package: which version of which package this run was drawn from, who confirmed each
// element of it, and the five authoring measures (FR-180, FR-195, FR-198, FR-253).
//
// **The confirmation record is `features/packages/confirmation-record.tsx`, not a second one.**
// 09 §3's inventory lists `ConfirmationRecord` under `features/review`; the component was built for
// UI-044 one phase earlier and is the same object — element, decision, by, when, revision, with the
// exceptions read first and every row behind a disclosure. Two implementations of "what the author
// signed off on" would be two answers to it, and the one that is wrong would be the one nobody was
// looking at. The same reasoning puts the claim object view in `features/packages` and gives it the
// replay's two extra props (D-452).
//
// A Server Component: everything here is a fact about a confirmed version, and nothing on this tab
// is interactive except the links out of it.

export type PackageViewProps = {
  version: PackageVersionView
  /** The variant this run drew, so the tab says which of the two the student met. */
  variantKey: VariantKeyValue
  /** The version's own screen (UI-044), where the seed record and the export live. */
  versionHref: Route
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-ink-muted text-meta">{label}</dt>
      <dd className="text-ink text-body break-words">{children}</dd>
    </div>
  )
}

const STATUS_LABELS: Record<string, () => string> = {
  draft: () => t('review.packageStatusDraft'),
  confirmed: () => t('review.packageStatusConfirmed'),
  retired: () => t('review.packageStatusRetired'),
}

/**
 * The variant, as one word.
 *
 * `review.variantDefective` is "Defective variant", which reads correctly in the page header's
 * "Attempt 1 · Defective variant" and reads as a stammer under a label that already says
 * "Variant on this run". The claim vocabulary owns the short pair.
 */
const VARIANT_LABELS: Record<VariantKeyValue, () => string> = {
  defective: () => t('claimObject.variant.defective'),
  sound: () => t('claimObject.variant.sound'),
}

export function PackageView({ version, variantKey, versionHref }: PackageViewProps) {
  return (
    <div className="flex flex-col gap-6">
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label={t('review.packageIdLabel')}>
          <span className="flex flex-col gap-0.5">
            <span>{version.packageTitle}</span>
            <span className="text-ink-muted text-mono-sm font-mono">{version.packageId}</span>
          </span>
        </Fact>
        <Fact label={t('review.packageVersionLabel')}>
          <span className="font-mono tabular-nums">{version.version}</span>
        </Fact>
        <Fact label={t('review.packageStatusLabel')}>
          {STATUS_LABELS[version.status]?.() ?? version.status}
        </Fact>
        <Fact label={t('review.packageVariantLabel')}>{VARIANT_LABELS[variantKey]()}</Fact>
      </dl>

      <p>
        <Link
          href={versionHref}
          className="text-primary text-meta focus-visible:outline-focus inline-flex min-h-10 items-center rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {t('review.packageOpen')}
        </Link>
      </p>

      {/* A second level of grouping is a heading and a hairline, never a panel inside a panel. */}
      <section className="border-line flex flex-col gap-3 border-t pt-5">
        <h3 className="text-h4">{t('review.packageRecordTitle')}</h3>
        <p className="text-ink-muted text-body max-w-measure">
          {t('review.packageRecordDescription')}
        </p>
        {version.restricted ? (
          // Heading, sentence: "there is a record and it is not yours to read" and "there is no
          // record" are different facts, so each says which one it is (DESIGN.md §Empty states).
          <div className="flex flex-col gap-1">
            <h4 className="text-reading">{t('review.packageRestrictedTitle')}</h4>
            <p className="text-ink-muted text-body max-w-measure">
              {t('review.packageRestrictedBody')}
            </p>
          </div>
        ) : version.confirmationRecord.length === 0 ? (
          <div className="flex flex-col gap-1">
            <h4 className="text-reading">{t('review.packageRecordEmptyTitle')}</h4>
            <p className="text-ink-muted text-body max-w-measure">
              {t('review.packageRecordEmptyBody')}
            </p>
          </div>
        ) : (
          <ConfirmationRecord rows={version.confirmationRecord} />
        )}
      </section>

      <section className="border-line flex flex-col gap-3 border-t pt-5">
        <h3 className="text-h4">{t('review.packageMeasuresTitle')}</h3>
        <AuthoringMeasures measures={version.measures} />
      </section>
    </div>
  )
}
