// The confirmed scenario package version the Phase 4 instructor specs point their assignments at,
// named by the ids `tests/e2e/global-setup.ts` writes it under.
//
// `createAssignment` refuses a version that is not confirmed (`PACKAGE_NOT_CONFIRMED`) and a
// variant that belongs to another version (`VARIANT_MISMATCH`), and the seeded database holds no
// confirmed version until Phase 5 ships the Meridian Roast package (06 §5 item 4). Until then the
// suite seeds `minimalConfirmedVersion()` once per run and every spec addresses it through the
// deterministic ids below — `tests/factories/ids.ts` derives them from the label, so the setup and
// the specs cannot disagree about which version they mean.
//
// The constants live in their own module rather than in the setup file so that a spec can import
// them without pulling `@/server/db/client` — and a live Postgres connection — into its worker.
import { uuidFrom } from '../factories/ids'

/** Every row the suite writes carries this in its name, which is what lets the purge be exact. */
export const SUITE_PREFIX = 'E2E Phase 4'

/** Addresses the roster spec invites; the purge removes pending invitations under this prefix. */
export const SUITE_INVITE_PREFIX = 'e2e-phase-4-invite'

export const FIXTURE_PACKAGE_LABEL = 'e2e-phase-4'

/** `tests/factories/package.ts` titles a fixture package `<label> (fixture)`. */
export const FIXTURE_PACKAGE_TITLE = `${FIXTURE_PACKAGE_LABEL} (fixture)`

export const FIXTURE_PACKAGE_ID = uuidFrom(`package:${FIXTURE_PACKAGE_LABEL}`)
export const FIXTURE_VERSION_ID = uuidFrom(`version:${FIXTURE_PACKAGE_LABEL}:1`)
export const FIXTURE_VERSION_NUMBER = 1

export const FIXTURE_VARIANT_IDS = {
  defective: uuidFrom(`variant:${FIXTURE_PACKAGE_LABEL}:defective`),
  sound: uuidFrom(`variant:${FIXTURE_PACKAGE_LABEL}:sound`),
} as const

/**
 * `scenario_package_versions.working_clock_seconds` default (06 §3.3). The fixture never overrides
 * it, so this is the number UI-032 shows as "the package sets N seconds".
 */
export const FIXTURE_PACKAGE_CLOCK_SECONDS = 1500

/** A course, section, or assignment name no other run collides with, under the suite prefix. */
export function suiteName(what: string): string {
  return `${SUITE_PREFIX} ${what} ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}
