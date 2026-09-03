// Minimal scenario package fixture (a package, one draft version, both variants) through the
// scenarios repository, so assignments and runs have valid parents before Phase 5 ships the full
// Meridian Roast package.
import type { ScenarioPackage, ScenarioPackageVersion, ScenarioVariant } from '@/server/db/schema'
import { insertPackage, insertVariants, insertVersion } from '@/server/modules/scenarios/repository'
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
