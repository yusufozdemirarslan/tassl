// Error codes of the `scenarios` module (docs/tech/10-backend-spec-modules.md §4) and the throwers
// the service states its rules with. Every code is already in the registry (`src/lib/errors.ts`),
// which owns the status and the default message; this file only names the six that belong to this
// module and gives each rule one call site, so a rule and its code can never drift apart.
//
// The throwers return `never` and are function declarations: TypeScript narrows after a
// `never`-returning call only for declarations, which is what lets the service read
// `if (version.status !== 'draft') versionFrozen()` and carry on with a draft.
//
// Three of them carry `details`, because the author cannot act on the code alone: which elements
// are still undecided, and which rules the package fails. `details` travels in the envelope
// (`{ error: { code, message, details, requestId } }`) and the confirmation workspace renders it.
import { AppError, type ErrorCode } from '@/lib/errors'
import type { ElementTypeValue, ValidationFailure } from './schema'

/** The codes 10 §4 names for this module. */
export const SCENARIOS_ERROR_CODES = [
  'VERSION_FROZEN',
  'ELEMENTS_UNCONFIRMED',
  'TEACHING_NOTE_UNCHECKED',
  'PACKAGE_INVALID',
  'LICENSE_NOT_CONFIRMED',
  'IMPORT_INVALID',
] as const satisfies readonly ErrorCode[]

/** One element still waiting on a decision, named the way the workspace addresses it. */
export type UnconfirmedElement = {
  elementType: ElementTypeValue
  /** Null for a singleton element (the brief, the counterfactual, the clock). */
  elementId: string | null
  key: string
}

/**
 * The version is confirmed, so it and every element under it are immutable (NFR-004). The database
 * triggers refuse the write as well; this is the same refusal reached before the round trip.
 */
export function versionFrozen(): never {
  throw new AppError('VERSION_FROZEN')
}

/** Confirmation refused: these elements have no `confirmed` or `edited` decision yet (FR-192). */
export function elementsUnconfirmed(elements: readonly UnconfirmedElement[]): never {
  throw new AppError('ELEMENTS_UNCONFIRMED', undefined, { details: { elements } })
}

/** Confirmation refused: the author has not ticked the teaching-note check (FR-027). */
export function teachingNoteUnchecked(): never {
  throw new AppError('TEACHING_NOTE_UNCHECKED')
}

/** `validatePackage` failed; the rule codes and the elements at fault ride in `details`. */
export function packageInvalid(failures: readonly ValidationFailure[]): never {
  throw new AppError('PACKAGE_INVALID', undefined, {
    details: { rules: failures.map((failure) => failure.code), failures },
  })
}

/** A package may only be built from a seed whose license permits adaptation (FR-190). */
export function licenseNotConfirmed(): never {
  throw new AppError('LICENSE_NOT_CONFIRMED')
}

/** The imported document is not a package export: wrong schema version, or a broken reference. */
export function importInvalid(details?: unknown): never {
  throw new AppError('IMPORT_INVALID', undefined, { details })
}
