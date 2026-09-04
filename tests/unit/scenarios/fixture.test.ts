// Step 5.3 — the Meridian Roast fixture package (PRD §6; docs/tech/10-backend-spec-modules.md §4).
//
// The fixture is the package every screen from Phase 6 on is built and demoed against, and the seed
// imports it confirmed. That makes it the one piece of authored content in the repository that has
// to satisfy the whole rule table, so it is held to the same standard as a package an author would
// confirm: `validateExport` runs all thirty rules over the document with no database behind it.
//
// The assertions are deliberately about the document rather than about the loader. If a later edit
// breaks a rule, the failure message names the rule code and the element keys, because
// `validateExport` uses each element's key as its id.
import { describe, expect, it } from 'vitest'
import fixture from '@/server/db/fixtures/meridian-roast.package.json'
import {
  PACKAGE_EXPORT_SCHEMA_VERSION,
  PackageExportSchema,
  VARIANT_KEYS,
  type PackageExport,
} from '@/server/modules/scenarios/schema'
import { validateExport } from '@/server/modules/scenarios/validate-export'

/**
 * The document as the importer would receive it. Parsing here rather than casting is the point of
 * the first test: a fixture that no longer satisfies the export schema would otherwise reach
 * `validateExport` as a shape the validator was never given, and fail somewhere less legible.
 *
 * The assertion afterwards is the same `tightened` conversion the service performs on a parsed
 * document (`service.ts`): Zod spells an optional key `k?: T | undefined` and `PackageExport`
 * spells it `k?: T`, which `exactOptionalPropertyTypes` makes two different types for one value.
 */
const parsed = PackageExportSchema.parse(fixture) as PackageExport

/** Every failure on one line, so a broken fixture says which rule broke and where. */
function report(
  failures: readonly { code: string; elementIds: string[]; message: string }[],
): string {
  if (failures.length === 0) return 'no failures'
  return failures
    .map((failure) => `${failure.code} [${failure.elementIds.join(', ')}]: ${failure.message}`)
    .join('\n')
}

describe('the Meridian Roast fixture package', () => {
  it('parses as a package export document', () => {
    const result = PackageExportSchema.safeParse(fixture)
    expect(result.success ? 'ok' : JSON.stringify(result.error.issues, null, 2)).toBe('ok')
    expect(parsed.schemaVersion).toBe(PACKAGE_EXPORT_SCHEMA_VERSION)
    expect(parsed.package.familyKey).toBe('meridian-roast')
  })

  it('passes every rule of the package validator', () => {
    const result = validateExport(parsed)
    expect(report(result.failures)).toBe('no failures')
    expect(result.failures).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('carries a state for all eight claims in both variants', () => {
    expect(parsed.claims).toHaveLength(8)
    expect(parsed.variants.map((variant) => variant.key)).toEqual([...VARIANT_KEYS])

    const claimKeys = parsed.claims.map((claim) => claim.key)
    for (const variant of parsed.variants) {
      expect(variant.claimStates).toHaveLength(claimKeys.length)
      expect(variant.claimStates.map((state) => state.claimKey).sort()).toEqual(
        [...claimKeys].sort(),
      )
    }
  })

  it('plants exactly one claim, and only in the defective variant', () => {
    const planted = parsed.variants.flatMap((variant) =>
      variant.claimStates
        .filter((state) => state.planted)
        .map((state) => ({ variantKey: variant.key, claimKey: state.claimKey })),
    )
    expect(planted).toEqual([{ variantKey: 'defective', claimKey: 'C3' }])

    const defect = parsed.variants
      .find((variant) => variant.key === 'defective')
      ?.claimStates.find((state) => state.claimKey === 'C3')
    expect(defect?.evidenceStatus).toBe('defective')
    expect(defect?.failureFamily).toBe('stale_evidence')
    // The defect has to be catchable: the Source Trace names a document that is in the room.
    const traced = defect?.verificationPaths.source_trace?.document_key
    expect(parsed.documents.map((document) => document.key)).toContain(traced)

    // Nothing else is defective anywhere, in either variant.
    const defective = parsed.variants.flatMap((variant) =>
      variant.claimStates
        .filter((state) => state.evidenceStatus === 'defective')
        .map((state) => `${variant.key}:${state.claimKey}`),
    )
    expect(defective).toEqual(['defective:C3'])
  })
})
