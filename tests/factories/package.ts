// Minimal scenario package fixture (a package, one version, both variants) through the scenarios
// repository, so assignments and runs have valid parents before Phase 5 ships the full Meridian
// Roast package and `validatePackage`.
import type { ScenarioPackage, ScenarioPackageVersion, ScenarioVariant } from '@/server/db/schema'
import {
  insertPackage,
  insertVariants,
  insertVersion,
  updateVersionStatus,
} from '@/server/modules/scenarios/repository'
import { uuidFrom } from './ids'
import { FROZEN_TIME } from './time'

export type PackageFixture = {
  pkg: ScenarioPackage
  version: ScenarioPackageVersion
  defective: ScenarioVariant
  sound: ScenarioVariant
}

export async function createPackageVersion(
  organizationId: string,
  label: string,
  input: { createdBy: string; version?: number },
): Promise<PackageFixture> {
  const pkg = await insertPackage(organizationId, {
    id: uuidFrom(`package:${label}`),
    title: `${label} (fixture)`,
    familyKey: label,
    createdBy: input.createdBy,
    createdAt: FROZEN_TIME,
    updatedAt: FROZEN_TIME,
  })
  const version = await insertVersion(organizationId, {
    id: uuidFrom(`version:${label}:${input.version ?? 1}`),
    packageId: pkg.id,
    version: input.version ?? 1,
    conceptSet: ['pricing_power', 'cannibalization', 'unit_economics', 'evidence_quality'],
    createdAt: FROZEN_TIME,
    updatedAt: FROZEN_TIME,
  })
  const variants = await insertVariants(version.id, [
    { id: uuidFrom(`variant:${label}:defective`), key: 'defective', label: 'Defective' },
    { id: uuidFrom(`variant:${label}:sound`), key: 'sound', label: 'Sound' },
  ])
  const defective = variants.find((v) => v.key === 'defective')!
  const sound = variants.find((v) => v.key === 'sound')!
  return { pkg, version, defective, sound }
}

/**
 * The smallest package version an assignment may point at: `createAssignment` requires
 * `status = 'confirmed'` (`PACKAGE_NOT_CONFIRMED`) and a variant of that version
 * (`VARIANT_MISMATCH`), so this is `createPackageVersion` plus the confirming status change.
 *
 * The order matters and is the same order Phase 5's `confirmVersion` will use: elements — here just
 * the two variants — are written while the version is still a draft, because the `package_frozen`
 * triggers (migration 0004) refuse every element write once `confirmed_at` is set, and refuse every
 * later change to the version row itself beyond its status and review fields.
 *
 * The version carries no claims, documents, or questions: nothing in Phase 4 reads them, and
 * `validatePackage` — the rule that would require them — arrives with Phase 5, which replaces this
 * factory's role with the fixture package.
 */
export async function minimalConfirmedVersion(
  organizationId: string,
  label: string,
  input: { createdBy: string; version?: number },
): Promise<PackageFixture> {
  const draft = await createPackageVersion(organizationId, label, input)
  const confirmed = await updateVersionStatus(organizationId, draft.version.id, {
    status: 'confirmed',
    confirmedAt: FROZEN_TIME,
    confirmedBy: input.createdBy,
    teachingNoteChecked: true,
  })
  if (!confirmed)
    throw new Error(`version ${draft.version.id} is not in organization ${organizationId}`)
  return { ...draft, version: confirmed }
}
