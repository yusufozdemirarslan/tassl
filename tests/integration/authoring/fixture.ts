// The world every authoring suite runs in: one institution, one author, one package created from a
// licensed seed case, and a drain that runs the `generate_package_step` queue to a standstill.
//
// The seat is an `instructor` carrying no platform role, which is 08 §4's "Create package from
// seed; run generation" *and* the confirming authority (PRD §8) — the pipeline and the confirmation
// workspace are the same person's work, and the measures suite needs both.
import { asUser } from '@tests/setup/integration'
import type { SessionUser } from '@/server/auth/types'
import { drainQueues } from '@/server/jobs/drain'
import { registerAllHandlers } from '@/server/jobs/handlers/register'
import * as f from '@tests/factories'

export type AuthoringFixture = {
  orgId: string
  author: SessionUser
  authorId: string
  packageId: string
  versionId: string
}

/** Four concepts: the version row's own check refuses fewer (06 §3.3). */
export const CONCEPTS = [
  'payback_period',
  'contribution_margin',
  'cohort_retention',
  'evidence_recency',
]

export const SEED = {
  caseTitle: 'Northbank Dairy Cooperative: pricing the chilled delivery tier',
  publisher: 'Harbour Case Press',
  licenseTerms: 'Adaptation permitted for classroom use with attribution in the course pack.',
  licensePermitsAdaptation: true,
  seedText:
    'Northbank Dairy Cooperative piloted a chilled home-delivery tier at a premium price. The ' +
    'pilot deck put the payback at nine months on a margin that excluded cold-chain freight. A ' +
    'later finance note put the freight at 1.10 dollars a delivery and the payback at fourteen ' +
    'months. The board must decide the share of the marketing budget going to the chilled tier.',
}

const actorFor = (
  user: { id: string; email: string; name: string },
  orgId: string,
): SessionUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
  emailVerified: true,
  activeOrganizationId: orgId,
  platformRole: 'none',
})

/** An institution, an author, and version 1 of a package built from `SEED`. Generation not started. */
export async function setupAuthoringFixture(label: string): Promise<AuthoringFixture> {
  const scenarios = await import('@/server/modules/scenarios')
  const { organization } = await f.createInstitution(`authoring-${label}`)
  const author = await f.createUser(`authoring-author-${label}`)
  await f.addMember(organization.id, author.id, 'instructor')

  const actor = actorFor(author, organization.id)
  const created = await scenarios.createPackageFromSeed(actor, organization.id, {
    title: 'Halden Roastworks: the premium tier',
    familyKey: `halden-${label}`,
    conceptSet: CONCEPTS,
    seed: SEED,
  })

  return {
    orgId: organization.id,
    author: actor,
    authorId: author.id,
    packageId: created.packageId,
    versionId: created.versionId,
  }
}

/** A signed-in session for the fixture's author, for the endpoint suite. */
export const sessionFor = async (fixture: AuthoringFixture): Promise<Headers> =>
  asUser(fixture.authorId, { activeOrganizationId: fixture.orgId })

/**
 * Runs the queue until it is empty.
 *
 * `JOBS_DRAIN_ON_ENQUEUE` already drains inline from `startGeneration`, so by the time it returns
 * the pipeline has usually finished; this is what makes that a guarantee rather than a hope, and
 * what a suite that enqueued with `drain: false` uses.
 */
export async function drain(maxMs = 60_000): Promise<void> {
  await registerAllHandlers()
  await drainQueues({ maxMs })
}
