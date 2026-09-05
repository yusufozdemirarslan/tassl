import { cache } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Route } from 'next'
import {
  ConfirmWorkspace,
  type ConfirmWorkspaceProps,
} from '@/components/features/packages/confirm-workspace'
import { elementAddress, type WorkspaceElement } from '@/components/features/packages/element-model'
import { EmptyState } from '@/components/layout/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { Panel } from '@/components/layout/panel'
import { isAppError } from '@/lib/errors'
import { formatDateTime } from '@/lib/format/date-time'
import { t } from '@/lib/i18n/t'
import {
  getPackageVersion,
  listVersionElements,
  type PackageVersionView,
} from '@/server/modules/scenarios'
import {
  PackageIdParamsSchema,
  SINGLETON_ELEMENT_ID,
  VersionIdParamsSchema,
} from '@/server/modules/scenarios/schema'
import { getViewer } from '../../../../../viewer'

// UI-043 (FR-192, FR-027, FR-198), the element confirmation workspace: where an author reads every
// element of a draft version, edits what needs it, records a decision on each, and then freezes the
// version for good.
//
// Two reads serve it, and they answer different questions. `getPackageVersion` says what the
// version *is* — how far it has got, which rules it still fails, and what this actor may do to it.
// `listVersionElements` says what it *holds*: every element with the values its own schema takes,
// the id a patch addresses it by, and the decision that currently stands on it. Neither is
// derivable from the other, and the second is authors only — a TA reads a package on UI-044, but
// the room where it is signed belongs to the people who sign it (08 §4, FR-028).
//
// The workspace itself is a Client Component because the whole screen is one interaction: the tree,
// the form, the drafts that must survive a change of selection, and the `opened_at` the browser is
// the only thing that knows (FR-198). Everything the page can settle on the server it settles here
// — the element roster, the tree's content, the capabilities — so the client is given a decided
// screen rather than a loading one.
//
// A version the reader may not see is the not-found page, never the error boundary: NOT_FOUND for
// another institution's id and FORBIDDEN for a seat that may not read packages mean the same thing
// to the person who typed the address.

/**
 * The route's props. `PageProps<'/packages/[packageId]/versions/[versionId]/confirm'>` is the house
 * form, but this route is new and the generated route map has not seen it yet; this is the same
 * shape typegen writes for it, and the build-time validator accepts it unchanged.
 */
type ConfirmPageProps = {
  params: Promise<{ packageId: string; versionId: string }>
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
 * Every element of the version, or null for a seat that may read the version but not the room where
 * it is confirmed. A refusal is not an incident: the screen says whose room this is.
 */
async function loadElements(versionId: string): Promise<WorkspaceElement[] | null> {
  const { actor } = await getViewer()
  try {
    const views = await listVersionElements(actor, versionId)
    return views.map((view) => ({
      id: elementAddress(view.elementType, view.elementId),
      elementType: view.elementType,
      // A singleton has no row id; the routes address it with the all-zero uuid, and resolving it
      // here is what keeps that constant out of the browser.
      elementId: view.elementId ?? SINGLETON_ELEMENT_ID,
      key: view.key,
      values: view.values,
      decision: view.confirmation?.decision ?? null,
      decidedAt: view.confirmation?.decidedAt ?? null,
      decidedByName: view.confirmation?.decidedByName ?? '',
      note: view.confirmation?.note ?? '',
      revision: view.confirmation?.revision ?? 0,
    }))
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
}

export async function generateMetadata({ params }: ConfirmPageProps): Promise<Metadata> {
  const { packageId, versionId } = await params
  if (!VersionIdParamsSchema.safeParse({ versionId }).success) return { title: t('packages.title') }

  const version = await loadVersion(versionId)
  // A title must not confirm that an id exists, so a version the reader may not see keeps the
  // generic one; the page itself answers 404.
  if (!version || version.packageId !== packageId) return { title: t('packages.title') }
  return {
    title: t('confirm.metaTitle', { title: version.packageTitle, version: version.version }),
  }
}

export default async function ConfirmPage({ params }: ConfirmPageProps) {
  const { packageId, versionId } = await params

  // An id that is not a uuid never reaches the repository: a malformed address is a 404, not a
  // database cast error on the error boundary.
  if (!PackageIdParamsSchema.safeParse({ packageId }).success) notFound()
  if (!VersionIdParamsSchema.safeParse({ versionId }).success) notFound()

  const version = await loadVersion(versionId)
  if (!version) notFound()
  // The address names both; a version reached under another package's id is a wrong address.
  if (version.packageId !== packageId) notFound()

  const versionHref = `/packages/${packageId}/versions/${versionId}` as Route
  const frozen = version.status !== 'draft'

  const header = (
    <PageHeader
      title={version.packageTitle}
      description={
        frozen
          ? version.confirmedAt === null
            ? t('confirm.frozenDescriptionNoDate', { version: version.version })
            : t('confirm.frozenDescription', {
                version: version.version,
                date: formatDateTime(version.confirmedAt),
              })
          : t('confirm.draftDescription', { version: version.version })
      }
      eyebrow={
        <Link
          href={versionHref}
          className="text-primary focus-visible:outline-focus rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {t('confirm.backToVersion', { version: version.version })}
        </Link>
      }
    />
  )

  const elements = await loadElements(versionId)

  if (elements === null) {
    return (
      <>
        {header}
        <Panel id="confirm-refused">
          <EmptyState
            headingLevel={2}
            title={t('confirm.readOnlyTitle')}
            body={t('confirm.readOnlyBody')}
          />
        </Panel>
      </>
    )
  }

  if (elements.length === 0) {
    return (
      <>
        {header}
        <Panel id="confirm-empty">
          <EmptyState
            headingLevel={2}
            title={t('confirm.emptyTitle')}
            body={t('confirm.emptyBody')}
          />
        </Panel>
      </>
    )
  }

  const workspace: ConfirmWorkspaceProps = {
    packageId,
    versionId,
    version: version.version,
    frozen,
    teachingNoteChecked: version.teachingNoteChecked,
    validation: version.validation,
    canEdit: version.capabilities.canEdit,
    canConfirm: version.capabilities.canConfirm,
    conceptSet: version.conceptSet,
    elements,
    versionHref,
  }

  return (
    <>
      {header}
      <ConfirmWorkspace {...workspace} />
    </>
  )
}
