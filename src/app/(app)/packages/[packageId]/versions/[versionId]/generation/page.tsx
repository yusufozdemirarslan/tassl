import { cache } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Route } from 'next'
import {
  GenerationProgress,
  type GenerationRuleFailure,
} from '@/components/features/packages/generation-progress'
import { PageHeader } from '@/components/layout/page-header'
import { isAppError } from '@/lib/errors'
import { t } from '@/lib/i18n/t'
import { getGenerationStatus, type GenerationStatusView } from '@/server/modules/authoring'
import {
  getPackageVersion,
  listVersionElements,
  type PackageVersionView,
} from '@/server/modules/scenarios'
import { PackageIdParamsSchema, VersionIdParamsSchema } from '@/server/modules/scenarios/schema'
import { getViewer } from '../../../../../viewer'

// UI-042 (FR-191, FR-198, AI-001), the generation progress screen: what the seven steps have done
// to this draft, what one of them could not satisfy, and the way into the room where every element
// it wrote is read and signed.
//
// **The gate is this page's own, and it is the narrow one.** 07 §6 gives `GET .../generation` to
// "Auth, Editor" and to nobody else, because the report it carries names the rules a draft breaks —
// which is to say where its defects are. A seat that may *read* a package version (a teaching
// assistant, a program lead) is not admitted here, and the page proves that itself rather than
// trusting the component below it: the status read is made first, and a refusal renders the
// not-found page. NOT_FOUND for another institution's id and FORBIDDEN for a seat with no author
// membership mean the same thing to the person who typed the address.
//
// **The rule sentences come from the validator, not from a second table.** `generation_runs`
// records the rule *codes* a step could not satisfy (DATA-027), and the sentence a code deserves —
// "Stakeholders S2 and S3 have no document in the Evidence Room" — is one `validatePackage` writes
// for this package, with its element keys in it. So the page reads the version's own rule report
// and hands the client the two things it cannot compose: code → sentence for the step rows, and the
// failures with their elements resolved to keys for the report (D-540).
//
// Everything except the poll is settled here. The client is given a decided screen — the steps as
// they stand, the rules as they stand, and whether this seat may press anything — and asks the
// route to render again only when the pipeline stops.

/**
 * The route's props. `PageProps<'/packages/[packageId]/versions/[versionId]/generation'>` is the
 * house form, but this route is new and the generated route map has not seen it yet; this is the
 * same shape typegen writes for it, and the build-time validator accepts it unchanged.
 */
type GenerationPageProps = {
  params: Promise<{ packageId: string; versionId: string }>
}

/** A version this seat may not generate renders the not-found page, never the error boundary. */
function isMissing(error: unknown): boolean {
  return isAppError(error) && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')
}

/** `generateMetadata` and the render both need the status; `cache` makes that one read (D-178). */
const loadStatus = cache(async (versionId: string): Promise<GenerationStatusView | null> => {
  const { actor } = await getViewer()
  try {
    return await getGenerationStatus(actor, versionId)
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
})

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
 * The key an author knows each element by, for the elements a rule failure names.
 *
 * `listVersionElements` is the authoring roster and admits exactly the seats this page admits, so
 * it is read only when a failure has an element in it — a draft that meets every rule pays nothing
 * for the lookup.
 */
async function elementKeys(versionId: string): Promise<ReadonlyMap<string, string>> {
  const { actor } = await getViewer()
  try {
    const views = await listVersionElements(actor, versionId)
    return new Map(
      views.flatMap((view) => (view.elementId === null ? [] : [[view.elementId, view.key]])),
    )
  } catch (error) {
    if (isMissing(error)) return new Map()
    throw error
  }
}

export async function generateMetadata({ params }: GenerationPageProps): Promise<Metadata> {
  const { packageId, versionId } = await params
  if (!VersionIdParamsSchema.safeParse({ versionId }).success) return { title: t('packages.title') }

  const version = await loadVersion(versionId)
  // A title must not confirm that an id exists, so a version the reader may not see keeps the
  // generic one; the page itself answers 404.
  if (!version || version.packageId !== packageId) return { title: t('packages.title') }
  return {
    title: t('generation.metaTitle', { title: version.packageTitle, version: version.version }),
  }
}

export default async function GenerationPage({ params }: GenerationPageProps) {
  const { packageId, versionId } = await params

  // An id that is not a uuid never reaches the repository: a malformed address is a 404, not a
  // database cast error on the error boundary.
  if (!PackageIdParamsSchema.safeParse({ packageId }).success) notFound()
  if (!VersionIdParamsSchema.safeParse({ versionId }).success) notFound()

  // The gate: the generation report is the author's, and this page is refused before it renders
  // anything at all to a seat that may not have it.
  const status = await loadStatus(versionId)
  if (!status) notFound()
  if (status.packageId !== packageId) notFound()

  const version = await loadVersion(versionId)
  if (!version) notFound()

  const versionHref = `/packages/${packageId}/versions/${versionId}` as Route
  const confirmHref = `${versionHref}/confirm` as Route
  const frozen = version.status !== 'draft'

  const ruleText: Record<string, string> = {}
  for (const failure of version.validation.failures) ruleText[failure.code] = failure.message

  const named = version.validation.failures.some((failure) => failure.elementIds.length > 0)
  const keys = named ? await elementKeys(versionId) : new Map<string, string>()
  const failures: GenerationRuleFailure[] = version.validation.failures.map((failure) => ({
    code: failure.code,
    message: failure.message,
    elements: failure.elementIds.map((elementId) => ({
      elementId,
      key: keys.get(elementId) ?? elementId,
    })),
  }))

  const description = frozen
    ? t('generation.descriptionFrozen', { version: version.version })
    : status.state === 'complete'
      ? t('generation.descriptionComplete', { version: version.version })
      : status.state === 'failed'
        ? t('generation.descriptionStopped')
        : status.state === 'running'
          ? t('generation.descriptionRunning', { version: version.version })
          : t('generation.descriptionNotStarted', { version: version.version })

  return (
    <>
      <PageHeader
        title={version.packageTitle}
        description={description}
        eyebrow={
          <Link
            href={versionHref}
            className="text-primary focus-visible:outline-focus rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {t('generation.backToVersion', { version: version.version })}
          </Link>
        }
      />
      <GenerationProgress
        packageId={packageId}
        versionId={versionId}
        version={version.version}
        status={{ state: status.state, steps: status.steps }}
        ruleText={ruleText}
        failures={failures}
        canGenerate={version.capabilities.canRegenerate}
        frozen={frozen}
        confirmHref={confirmHref}
      />
    </>
  )
}
