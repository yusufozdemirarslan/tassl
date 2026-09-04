// The one shape the three screens that point an assignment at a scenario package version agree on:
// UI-032's configuration form, UI-030's "New assignment" dialog, and the two Server Components that
// read the versions. It lives beside the form rather than inside it because a Server Component may
// not import a `'use client'` module's functions, and beside the module schema is not an option
// either — a client component never imports `schema.ts` (D-186), not even for a type.
//
// `toPackageVersionOptions` takes the rows structurally, so nothing here imports the courses module:
// `ConfirmedPackageVersion[]` from `@/server/modules/courses` satisfies the parameter as it stands.

export type AssignmentVariantOption = {
  id: string
  key: 'defective' | 'sound'
}

export type PackageVersionOption = {
  id: string
  title: string
  version: number
  /** Nothing is calibrated in this build (PRD §7.19); the chip is what says so on the screen. */
  calibrationStatus: 'uncalibrated' | 'calibrated'
  /** The variants this version offers; the radio shows one row per entry. */
  variants: readonly AssignmentVariantOption[]
  /** The version's own working clock, shown as the default; null when it is not known here. */
  defaultWorkingClockSeconds: number | null
}

/** A confirmed version as the courses module lists it, as the form reads it. */
export function toPackageVersionOptions(
  versions: readonly {
    id: string
    version: number
    packageTitle: string
    calibrationStatus: 'uncalibrated' | 'calibrated'
    workingClockSeconds: number
    variants: readonly AssignmentVariantOption[]
  }[],
): PackageVersionOption[] {
  return versions.map((version) => ({
    id: version.id,
    title: version.packageTitle,
    version: version.version,
    calibrationStatus: version.calibrationStatus,
    variants: version.variants,
    defaultWorkingClockSeconds: version.workingClockSeconds,
  }))
}
