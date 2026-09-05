import { cache, type ReactNode } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Route } from 'next'
import { BadgeCheckIcon, CircleAlertIcon } from 'lucide-react'
import { AuthoringMeasures } from '@/components/features/packages/authoring-measures'
import {
  ClaimObjectView,
  type ClaimVariantState,
} from '@/components/features/packages/claim-object-view'
import { ClaimsTable, type ClaimSummary } from '@/components/features/packages/claims-table'
import { ConfirmationRecord } from '@/components/features/packages/confirmation-record'
import { VersionHeader } from '@/components/features/packages/version-header'
import { EmptyState } from '@/components/layout/empty-state'
import { Panel } from '@/components/layout/panel'
import { buttonVariants } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { isAppError } from '@/lib/errors'
import { formatDateTime } from '@/lib/format/date-time'
import { t } from '@/lib/i18n/t'
import {
  exportPackage,
  getPackageVersion,
  type PackageExport,
  type PackageVersionView,
} from '@/server/modules/scenarios'
import {
  PackageIdParamsSchema,
  VersionIdParamsSchema,
  type ReskinKindValue,
} from '@/server/modules/scenarios/schema'
import { getViewer } from '../../../../viewer'

// UI-044 (FR-180, FR-195, FR-198, FR-028). What a package version actually is: which version it is
// and how far it has got, the element-by-element confirmation record, the authoring record and the
// case behind it, the five authoring measures, and every claim with what each variant makes of it.
//
// Two reads serve the screen. `getPackageVersion` answers the record, the measures and the
// capabilities; `exportPackage` answers the claims, because the version view publishes counts
// rather than claims and a claim is only addressable by the element key an export carries. Both
// functions admit exactly the same three seats — instructor, scenario author, teaching assistant —
// so a reader who is admitted to the version's content is admitted to the export, and a program
// lead, whose row in 08 §4 reads "measures only", is refused both. That is why the export is not
// even attempted for them: the screen states what it is showing instead of drawing a package with
// no brief (`restricted`, D-211).
//
// The claim object is a sub-view of this same address (`?claim=<key>`), the way UI-030's four
// sub-views are: the claim is bookmarkable, the back gesture works, the whole screen stays a server
// component, and the route ships no JavaScript for any of it.
//
// A version the reader may not see is the not-found page, never the error boundary: NOT_FOUND for
// another institution's id and FORBIDDEN for a seat that may not read packages mean the same thing
// to the person who typed the address.

/**
 * The route's props. `PageProps<'/packages/[packageId]/versions/[versionId]'>` is the house form,
 * but this route is new and the generated route map has not seen it yet; this is the same shape
 * typegen writes for it, and the build-time validator accepts it unchanged.
 */
type PackageVersionPageProps = {
  params: Promise<{ packageId: string; versionId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const RESKIN_KIND_LABELS: Record<ReskinKindValue, () => string> = {
  renamed_entity: () => t('packageVersion.reskin.renamedEntity'),
  altered_number: () => t('packageVersion.reskin.alteredNumber'),
  restructured_document: () => t('packageVersion.reskin.restructuredDocument'),
}

/** A version the reader may not see renders the not-found page, never the error boundary. */
function isMissing(error: unknown): boolean {
  return isAppError(error) && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')
}

/** `generateMetadata` and the render both need the version; `cache` makes that one read (D-178). */
const loadVersion = cache(async (versionId: string): Promise<PackageVersionView | null> => {
  const { actor } = await getViewer()
  try {
    return await getPackageVersion(actor, versionId)
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
})

/**
 * The package as one portable document, which is where the claims and their per-variant states
 * live. A refusal is not an incident here: the rest of the screen is still true, so the claims
 * panel says that this part is not open to the reader rather than taking the page down with it.
 */
async function loadExport(versionId: string): Promise<PackageExport | null> {
  const { actor } = await getViewer()
  try {
    return await exportPackage(actor, versionId)
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
}

export async function generateMetadata({ params }: PackageVersionPageProps): Promise<Metadata> {
  const { packageId, versionId } = await params
  if (!VersionIdParamsSchema.safeParse({ versionId }).success) return { title: t('packages.title') }

  const version = await loadVersion(versionId)
  // A title must not confirm that an id exists, so a version the reader may not see keeps the
  // generic one; the page itself answers 404.
  if (!version || version.packageId !== packageId) return { title: t('packages.title') }
  return {
    title: t('packageVersion.metaTitle', {
      title: version.packageTitle,
      version: version.version,
    }),
  }
}

export default async function PackageVersionPage({
  params,
  searchParams,
}: PackageVersionPageProps) {
  const [{ packageId, versionId }, query] = await Promise.all([params, searchParams])

  // An id that is not a uuid never reaches the repository: a malformed address is a 404, not a
  // database cast error on the error boundary.
  if (!PackageIdParamsSchema.safeParse({ packageId }).success) notFound()
  if (!VersionIdParamsSchema.safeParse({ versionId }).success) notFound()

  const version = await loadVersion(versionId)
  if (!version) notFound()
  // The address names both; a version reached under another package's id is a wrong address.
  if (version.packageId !== packageId) notFound()

  const basePath = `/packages/${packageId}/versions/${versionId}`
  const confirmHref = `${basePath}/confirm` as Route

  const packageDocument = version.restricted ? null : await loadExport(versionId)

  const variantKeys = packageDocument?.variants.map((variant) => variant.key) ?? []
  const documentTitles = new Map(
    (packageDocument?.documents ?? []).map((row) => [row.key, row.title] as const),
  )

  // Every variant's reading of a claim, gathered under the claim's own key: the export hangs a
  // state off the variant it belongs to, and the table reads them the other way round.
  const statesByClaim = new Map<string, ClaimVariantState[]>()
  for (const variant of packageDocument?.variants ?? []) {
    for (const state of variant.claimStates) {
      const entry: ClaimVariantState = {
        variantKey: variant.key,
        evidenceStatus: state.evidenceStatus,
        failureFamily: state.failureFamily,
        warrantedStance: state.warrantedStance,
        planted: state.planted,
        verificationPaths: state.verificationPaths,
      }
      const found = statesByClaim.get(state.claimKey)
      if (found) found.push(entry)
      else statesByClaim.set(state.claimKey, [entry])
    }
  }

  const claims: ClaimSummary[] = (packageDocument?.claims ?? []).map((claim) => ({
    key: claim.key,
    text: claim.text,
    importance: claim.importance,
    consequenceLevel: claim.consequenceLevel,
    verificationCost: claim.verificationCost,
    states: statesByClaim.get(claim.key) ?? [],
  }))

  // A hand-edited key is a bad address, not an incident: the claims table is the honest answer.
  const requested = typeof query.claim === 'string' ? query.claim : null
  const selected =
    requested === null
      ? null
      : ((packageDocument?.claims ?? []).find((row) => row.key === requested) ?? null)
  const selectedSource =
    selected === null || selected.sourceDocumentKey === null
      ? null
      : ((packageDocument?.documents ?? []).find((row) => row.key === selected.sourceDocumentKey) ??
        null)

  return (
    <>
      <VersionHeader version={version} confirmHref={confirmHref} />

      <div className="flex flex-col gap-6">
        {!version.restricted && (
          <Panel
            id="confirmation-record"
            title={t('packageVersion.recordTitle')}
            description={t('packageVersion.recordDescription')}
            headingLevel={2}
          >
            {version.confirmationRecord.length === 0 ? (
              <EmptyState
                title={t('packageVersion.recordEmptyTitle')}
                body={t('packageVersion.recordEmptyBody')}
              />
            ) : (
              <ConfirmationRecord rows={version.confirmationRecord} />
            )}
          </Panel>
        )}

        <Panel
          id="authoring-record"
          title={t('packageVersion.authoringTitle')}
          description={t('packageVersion.authoringDescription')}
          headingLevel={2}
        >
          <AuthoringRecord version={version} confirmHref={confirmHref} />
        </Panel>

        <Panel
          id="authoring-measures"
          title={t('packageVersion.measuresTitle')}
          description={t('packageVersion.measuresDescription')}
          headingLevel={2}
        >
          {/* The measures are the whole of what a "measures only" seat is admitted to, so the
              sentence saying that is here, with them, rather than two panels above them. */}
          {version.restricted ? (
            <div className="flex flex-col gap-5">
              <section className="border-line flex flex-col gap-2 border-b pb-5">
                <h3 className="text-h4">{t('packageVersion.restrictedTitle')}</h3>
                <p className="text-ink-muted text-body max-w-[72ch]">
                  {t('packageVersion.restrictedBody')}
                </p>
              </section>
              <AuthoringMeasures measures={version.measures} />
            </div>
          ) : (
            <AuthoringMeasures measures={version.measures} />
          )}
        </Panel>

        {!version.restricted && (
          <Panel
            id="claims"
            headingLevel={2}
            title={
              selected === null
                ? t('packageVersion.claimsTitle')
                : t('claimObject.title', { key: selected.key })
            }
            {...(selected === null ? { description: t('packageVersion.claimsDescription') } : {})}
          >
            {selected !== null ? (
              <ClaimObjectView
                claim={selected}
                sourceDocument={selectedSource}
                states={statesByClaim.get(selected.key) ?? []}
                documentTitles={documentTitles}
                backHref={basePath as Route}
              />
            ) : packageDocument === null ? (
              <EmptyState
                title={t('packageVersion.claimsWithheldTitle')}
                body={t('packageVersion.claimsWithheldBody')}
              />
            ) : claims.length === 0 ? (
              <EmptyState
                title={t('packageVersion.claimsEmptyTitle')}
                body={t('packageVersion.claimsEmptyBody')}
              />
            ) : (
              <ClaimsTable claims={claims} variantKeys={variantKeys} basePath={basePath} />
            )}
          </Panel>
        )}
      </div>
    </>
  )
}

/** One labelled fact of the authoring record. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-ink-muted text-meta">{label}</dt>
      <dd className="text-ink text-body break-words">{children}</dd>
    </div>
  )
}

/**
 * A rights fact that stops a version being confirmed, in the shape a refusal takes everywhere in
 * the product: the red wash, the alert icon, full ink text, and — where the reader may act on it —
 * the way to. Rendered as muted meta beside its opposite, a missing licence confirmation and a
 * present one looked the same, which is the one thing they must never do.
 */
function Refusal({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="border-red bg-red-soft text-ink text-body flex max-w-[72ch] items-start gap-2 rounded-md border p-3">
      <CircleAlertIcon aria-hidden="true" className="text-red mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-3">
        <p>{children}</p>
        {action}
      </div>
    </div>
  )
}

/**
 * How the version came to be and the case it was adapted from (FR-195, FR-028). The seed record is
 * the licensed case's own record — its title, its publisher and the terms the author relied on —
 * and `getPackageVersion` returns it as null for anyone who may not read it. Null is stated rather
 * than drawn as an empty panel: "there is a seed record and it is not yours to read" and "there is
 * no seed record" are different facts, and only the first is true of a TA.
 */
function AuthoringRecord({
  version,
  confirmHref,
}: {
  version: PackageVersionView
  confirmHref: Route
}) {
  const record = version.authoringRecord
  const seed = version.seedRecord
  const confirmedByName =
    version.confirmedBy === null
      ? null
      : (record.editors.find((editor) => editor.userId === version.confirmedBy)?.name ??
        version.confirmedBy)

  return (
    <div className="flex flex-col gap-6">
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label={t('packageVersion.modelLabel')}>
          {record.generationModel ?? (
            <span className="text-ink-muted">{t('packageVersion.modelNone')}</span>
          )}
        </Fact>
        <Fact label={t('packageVersion.generatedAtLabel')}>
          {record.generatedAt === null ? (
            <span className="text-ink-muted">{t('packageVersion.notGenerated')}</span>
          ) : (
            formatDateTime(record.generatedAt)
          )}
        </Fact>
        <Fact label={t('packageVersion.confirmedByLabel')}>
          {confirmedByName ?? (
            <span className="text-ink-muted">{t('packageVersion.notConfirmed')}</span>
          )}
        </Fact>
        <Fact label={t('packageVersion.confirmedAtLabel')}>
          {version.confirmedAt === null ? (
            <span className="text-ink-muted">{t('packageVersion.notConfirmed')}</span>
          ) : (
            formatDateTime(version.confirmedAt)
          )}
        </Fact>
      </dl>

      <section className="border-line flex flex-col gap-3 border-t pt-5">
        <h3 className="text-h4">{t('packageVersion.seedTitle')}</h3>

        {seed === null ? (
          <p className="text-ink-muted text-body max-w-[72ch]">
            {t('packageVersion.seedWithheld')}
          </p>
        ) : (
          <>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Fact label={t('packageVersion.caseTitleLabel')}>{seed.caseTitle}</Fact>
              <Fact label={t('packageVersion.publisherLabel')}>{seed.publisher}</Fact>
            </dl>
            <div className="flex flex-col items-start gap-2">
              <h4 className="text-reading">{t('packageVersion.licenseTermsLabel')}</h4>
              {/* Licence boilerplate at the reading size was the largest body copy on the screen;
                  it is quoted terms, not a passage anybody reads at length. */}
              <p className="text-ink text-body max-w-[72ch]">{seed.licenseTerms}</p>
              {seed.licensePermitsAdaptation ? (
                <p className="text-ink text-body flex max-w-[72ch] items-start gap-2">
                  <BadgeCheckIcon
                    aria-hidden="true"
                    className="text-green mt-0.5 size-4 shrink-0"
                  />
                  <span>{t('packageVersion.licenseConfirmed')}</span>
                </p>
              ) : (
                <Refusal>{t('packageVersion.licenseNotConfirmed')}</Refusal>
              )}
            </div>

            <div className="mt-2 flex flex-col items-start gap-2">
              <h4 className="text-reading">{t('packageVersion.reskinTitle')}</h4>
              {seed.reskinLog.length === 0 ? (
                // `RESKIN_LOG_EMPTY` is one of the rules that keeps this version a draft, so it is
                // a refusal with the way to act on it, not a note in the margin.
                <Refusal
                  {...(version.capabilities.canEdit
                    ? {
                        action: (
                          <Link
                            href={confirmHref}
                            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                          >
                            {t('packageVersion.openWorkspace')}
                          </Link>
                        ),
                      }
                    : {})}
                >
                  {t('packageVersion.reskinEmpty')}
                </Refusal>
              ) : (
                <Table className="min-w-2xl">
                  <TableCaption>{t('packageVersion.reskinCaption')}</TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">{t('packageVersion.reskinColumnKind')}</TableHead>
                      <TableHead scope="col">{t('packageVersion.reskinColumnFrom')}</TableHead>
                      <TableHead scope="col">{t('packageVersion.reskinColumnTo')}</TableHead>
                      <TableHead scope="col">{t('packageVersion.reskinColumnNote')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {seed.reskinLog.map((entry, index) => (
                      <TableRow key={`${entry.kind}-${entry.from}-${String(index)}`}>
                        <TableCell className="whitespace-normal">
                          {RESKIN_KIND_LABELS[entry.kind]()}
                        </TableCell>
                        <TableCell className="whitespace-normal">{entry.from}</TableCell>
                        <TableCell className="whitespace-normal">{entry.to}</TableCell>
                        <TableCell className="max-w-[40ch] whitespace-normal">
                          {entry.note.length > 0 ? (
                            entry.note
                          ) : (
                            <>
                              <span aria-hidden="true" className="text-ink-faint">
                                —
                              </span>
                              <span className="sr-only">{t('packageVersion.reskinNoNote')}</span>
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
