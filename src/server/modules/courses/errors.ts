// Error codes of the `courses` module (docs/tech/10-backend-spec-modules.md §3) and the throwers
// the service states its rules with. Every code is already in the registry (`src/lib/errors.ts`),
// which owns the status and the default message; this file only names the seven that belong to
// this module and gives each rule one call site, so a rule and its code can never drift apart.
//
// The throwers return `never` and are function declarations: TypeScript narrows after a
// `never`-returning call only for declarations, which is what lets the service read
// `if (!course) notFound()` and then use `course`.
import { AppError, type ErrorCode } from '@/lib/errors'
import { t } from '@/lib/i18n/t'

/** The codes 10 §3 names for this module. */
export const COURSES_ERROR_CODES = [
  'PACKAGE_NOT_CONFIRMED',
  'VARIANT_MISMATCH',
  'ASSIGNMENT_IN_USE',
  'MEMBER_HAS_RUNS',
  'MAPPING_INVALID',
  'MAPPING_CHANGE_UNCONFIRMED',
  'NOT_SECTION_MEMBER',
] as const satisfies readonly ErrorCode[]

/** A resource outside the actor's institution is NOT_FOUND, never FORBIDDEN (08 §4). */
export function courseNotFound(): never {
  throw new AppError('NOT_FOUND', t('courses.courseNotFound'))
}

export function sectionNotFound(): never {
  throw new AppError('NOT_FOUND', t('courses.sectionNotFound'))
}

export function assignmentNotFound(): never {
  throw new AppError('NOT_FOUND', t('courses.assignmentNotFound'))
}

export function runNotFound(): never {
  throw new AppError('NOT_FOUND', t('courses.runNotFound'))
}

export function forbidden(message?: string): never {
  throw new AppError('FORBIDDEN', message)
}

/** The mapping is not four positive numbers (07 §5). */
export function mappingInvalid(): never {
  throw new AppError('MAPPING_INVALID')
}

/** The course already has confirmed runs, so the mapping change belongs to Phase 11 (FR-206). */
export function mappingChangeUnconfirmed(): never {
  throw new AppError('MAPPING_CHANGE_UNCONFIRMED')
}

/** The package version an assignment points at is still a draft (or retired). */
export function packageNotConfirmed(): never {
  throw new AppError('PACKAGE_NOT_CONFIRMED')
}

/** The variant belongs to another package version. */
export function variantMismatch(): never {
  throw new AppError('VARIANT_MISMATCH')
}

/** A run that is not voided exists, so the assignment's setup is fixed. */
export function assignmentInUse(): never {
  throw new AppError('ASSIGNMENT_IN_USE')
}

/** The person has runs in the section, so the membership cannot be removed. */
export function memberHasRuns(): never {
  throw new AppError('MEMBER_HAS_RUNS')
}

/** The address is not a member of the institution the section belongs to (D-062). */
export function notSectionMember(): never {
  throw new AppError('NOT_SECTION_MEMBER')
}
