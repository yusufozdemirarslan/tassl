// Service of the `scenarios` module (docs/tech/10-backend-spec-modules.md §4; 07-api-spec.md §6;
// 08-auth-authz.md §4, §5; 06-data-model.md §3.3). Package families and their immutable versions,
// every authored element, element confirmation, version freezing, import and export, and the two
// views that show an author what a package actually is (FR-011, FR-021, FR-027, FR-028, FR-082,
// FR-093, FR-114, FR-180, FR-185, FR-190, FR-192, FR-195, FR-196, FR-197, SYS-026).
//
// The four rules the `courses` service is built on hold here too:
//
//   1. The actor comes first and its permission helper is the first statement (08 §5). A version
//      and a claim are addressed by ids that do not name their tenant, so resolving the resource is
//      what resolves the institution; nothing below trusts an organization id from the input.
//   2. A package the actor's institutions do not contain answers NOT_FOUND, never FORBIDDEN, so an
//      id cannot be probed for existence (07 §1 "Tenancy", 08 §4 "Cross-tenant"). FORBIDDEN is for
//      someone who can see the package but holds the wrong role.
//   3. Every rule that carries its own error code (10 §4) is one call to `./errors.ts`.
//   4. Analytics fire after the writing transaction commits (17 §5.4), never inside it.
//
// Two more belong to this module in particular:
//
//   5. A confirmed version is immutable (NFR-004). `updateElement` and `decideElement` answer
//      `VERSION_FROZEN` before they touch the database; the `package_frozen` trigger family is the
//      guarantee behind that answer, not the first line of defence.
//   6. Authoring and reading are two seats (D-748). A Scenario Editor of the institution (or the
//      Platform Admin) authors, decides and confirms; an Instructor reads a package to assign and
//      review it, and every write refuses them.
//
// `authoring.computeAuthoringMeasures` (10 §5) and the generation records it reads arrive with the
// pipeline in Phase 12. The measures the package view needs before then are derived here from the
// confirmation rows, which is the whole of what a hand-authored or imported package has: the
// generation counters read zero because no generation has run.
import { AppError, isAppError } from '@/lib/errors'
import { t } from '@/lib/i18n/t'
import { countWords } from '@/lib/words'
import { track } from '@/server/analytics/track'
import {
  AUTHORING_ROLES,
  PACKAGE_READER_ROLES,
  hasRole,
  requireAuthorOnPackage,
  requireMembership,
  requireRunOwner,
  type PlatformRole,
} from '@/server/auth/permissions'
import type { SessionUser } from '@/server/auth/types'
import { audit } from '@/server/modules/admin'
// 10 §5 owns the generation record and the arithmetic of FR-198's measures; the package view is
// where they are read (10 §4). The dependency runs one way — `authoring` never imports this
// module's `index.ts` or `service.ts` — which is what keeps the pair acyclic (D-530).
import { listGenerationRunsForVersion, type GenerationRunView } from '@/server/modules/authoring'
import { computeMeasures, type AuthoringMeasureValues } from '@/server/modules/authoring/measures'
import { notify } from '@/server/modules/notifications'
import { listMemberIdsWithPlatformRoles, listMyInstitutions } from '@/server/modules/tenancy'
import {
  elementsUnconfirmed,
  importInvalid,
  licenseNotConfirmed,
  packageInvalid,
  teachingNoteUnchecked,
  versionFrozen,
  type UnconfirmedElement,
} from './errors'
import * as repo from './repository'
import {
  DEFAULT_CONCEPT_SET,
  ELEMENT_INPUT_SCHEMAS,
  ELEMENT_PATCH_SCHEMAS,
  ImportPackageSchema,
  SINGLETON_ELEMENT_ID,
  type CarriedValue,
  type AuthoringRecordView,
  type ClaimObjectView,
  type ClaimStateView,
  type ConfirmVersionInput,
  type CreatePackageFromSeedInput,
  type CreatedPackageView,
  type ElementConfirmationView,
  type ElementCounts,
  type ElementDecisionInput,
  type ElementTypeValue,
  type ImportedPackageView,
  type PackageExport,
  type PackageSummaryView,
  type PackageVersionView,
  type PackageView,
  type PackageWarningValue,
  type PageQuery,
  type RegenerateVersionInput,
  type SeedRecordView,
  type StudentScenarioView,
  type ValidationResult,
  type VerificationPaths,
  type VersionSummaryView,
} from './schema'
import { elementUnits, type ElementUnit } from './units'
import { buildExport } from './export-document'
import { validateExport } from './validate-export'
import { thinlyCarriedConcepts, validatePackage } from './validate'

// `validatePackage` is the twelfth row of 10 §4's table and lives in `./validate.ts`, which is an
// internal module file: the public `index.ts` may import only `service` and `schema` (04 §2), so the
// validator and its rule vocabulary reach the rest of the app through here.
export { VALIDATION_RULE_CODES, validatePackage } from './validate'
export type {
  PackageValidationFailure,
  PackageValidationResult,
  ValidationRuleCode,
} from './validate'

// ---------------------------------------------------------------------------------------------
// Who may do what (08 §4 "Permission matrix", D-748)
//
// Two role sets from `permissions.ts`, and the admin is admitted to both:
//   - `PACKAGE_READER_ROLES` (Scenario Editor, Instructor): list packages, read a package, a version,
//     a claim object, and take the export — an Instructor reads a package to assign and review it;
//   - `AUTHORING_ROLES` (Scenario Editor): everything that writes, the confirmation workspace's
//     element list, and the seed record, which is the licensed case behind the package (FR-028).
// ---------------------------------------------------------------------------------------------

/** Who the `package_confirmed` notice goes to: the institution's Instructors and Scenario Editors. */
const PACKAGE_NOTICE_ROLES: readonly PlatformRole[] = ['instructor', 'tassl_scenario_editor']

// ---------------------------------------------------------------------------------------------
// Element vocabulary
// ---------------------------------------------------------------------------------------------

/**
 * Element types a version has at most one of. Their confirmation rows carry `element_id = null`
 * (06 §3.3), and a route addresses them with `SINGLETON_ELEMENT_ID`; the three that are rows of
 * their own (probe, turn, seed record) may also be addressed by that row's id, which resolves to
 * the same unit, so there is only ever one confirmation key per element.
 */
export const SINGLETON_ELEMENT_TYPES: ReadonlySet<ElementTypeValue> = new Set([
  'brief',
  'counterfactual',
  'general_escalation_reply',
  'clock_and_difficulty',
  'probe',
  'turn',
  'seed_reskin',
])

/**
 * One thing an author confirms: what the workspace lists and what `confirmVersion` counts.
 *
 * The walk that produces them lives in `./units.ts`, because `authoring.computeAuthoringMeasures`
 * (10 §5) divides by the same list and a second copy of it would let the package view and the
 * `package_confirmed` event report different edit rates for one package.
 */
export type { ElementUnit } from './units'

/** An element as it is stored, in the shape its input schema takes. */
type ElementValues = Record<string, unknown>

/** What `updateElement` answers with: the element after the patch, and the decision it recorded. */
export type ElementView = ElementUnit & {
  values: ElementValues
  confirmation: ElementConfirmationView | null
}

// ---------------------------------------------------------------------------------------------
// Small conversions
// ---------------------------------------------------------------------------------------------

const iso = (value: Date): string => value.toISOString()
const isoOrNull = (value: Date | null): string | null => (value === null ? null : iso(value))

/** Structural equality by serialization: enough for the scalar, array and jsonb fields an element has. */
const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/**
 * Zod spells an optional key `k?: T | undefined`; the stored row types and the export types spell it
 * `k?: T`, and under `exactOptionalPropertyTypes` those are different types. `schema.ts` publishes
 * the tightened form of every element as a type, so a parsed value is the same value seen through
 * it — that is the whole of this conversion, and it is why it is written once rather than inline.
 */
const tightened = <T>(value: unknown): T => value as T

/**
 * A Postgres unique violation; `(organization_id, family_key)` is the only one this module can
 * raise, and 07 §6 answers it `CONFLICT`. Drizzle wraps the driver's error in a `DrizzleQueryError`,
 * so the code is looked for down the `cause` chain rather than on the value that was thrown.
 */
function isUniqueViolation(error: unknown): boolean {
  for (let current = error; current !== null && current !== undefined;) {
    if (typeof current !== 'object') return false
    if ((current as { code?: unknown }).code === '23505') return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

// ---------------------------------------------------------------------------------------------
// Failures that carry no module code of their own
// ---------------------------------------------------------------------------------------------

/** A package, version, claim or element outside the actor's institutions (rule 2 above). */
function notFound(what: string): never {
  throw new AppError('NOT_FOUND', `That ${what} no longer exists.`)
}

function forbidden(): never {
  throw new AppError('FORBIDDEN')
}

/**
 * 06 §3.3 makes `scenario_claims.source_document_id` required "when a Source Trace path exists", and
 * nothing else can enforce it: there is no CHECK across the two tables, and `validatePackage` reads
 * the trace's document by key without ever seeing the column. So the two writes that can break the
 * pairing refuse it — a state that adds a trace to a claim with no source document, and a claim
 * whose source document is cleared while one of its states still traces.
 */
function sourceDocumentMissing(): never {
  throw new AppError(
    'VALIDATION_ERROR',
    'A claim with a Source Trace path must name the document the trace leads to.',
  )
}

/**
 * An element key is its identity in the export, and `upsertElement` targets a row by it: renaming
 * one through a patch would leave the old element behind and write a second one beside it.
 */
function keyImmutable(field: string): never {
  throw new AppError(
    'VALIDATION_ERROR',
    `An element's ${field} identifies it inside the package and cannot be changed by an edit.`,
  )
}

// ---------------------------------------------------------------------------------------------
// Resolving a version to its tenant
//
// A version, a package and a claim are addressed without their institution, so the tenant is found
// by asking each institution the actor belongs to (every institution, for the admin) — which is also
// the tenancy check: an id in an institution they do not belong to is simply not found (rule 2).
// Every repository call stays `tenantId` first (D-006).
// ---------------------------------------------------------------------------------------------

async function tenantsOf(actor: SessionUser): Promise<string[]> {
  const institutions = await listMyInstitutions(actor)
  const ids = institutions.map((institution) => institution.id)
  // The session's active institution is tried first, which is the only one in the common case.
  const active = actor.activeOrganizationId
  if (active && ids.includes(active)) return [active, ...ids.filter((id) => id !== active)]
  return ids
}

type VersionScope = { tenantId: string; version: repo.VersionFull }

async function resolveVersion(actor: SessionUser, versionId: string): Promise<VersionScope> {
  for (const tenantId of await tenantsOf(actor)) {
    const version = await repo.findVersionFull(tenantId, versionId)
    if (version) return { tenantId, version }
  }
  notFound('package version')
}

/**
 * Institution membership holding one of `roles` (the admin needs neither). A non-member is answered
 * NOT_FOUND rather than FORBIDDEN (rule 2); a member holding another role is FORBIDDEN.
 */
async function requireVisibleMembership(
  actor: SessionUser,
  orgId: string,
  roles: readonly PlatformRole[],
  what = 'institution',
): Promise<void> {
  try {
    await requireMembership(actor, orgId)
  } catch (error) {
    if (isAppError(error) && error.code === 'FORBIDDEN') notFound(what)
    throw error
  }
  if (!hasRole(actor, roles)) forbidden()
}

/** The read side of a version: a Scenario Editor or an Instructor of its institution, or the admin. */
async function requireVersionReader(actor: SessionUser, scope: VersionScope): Promise<void> {
  await requireVisibleMembership(actor, scope.tenantId, PACKAGE_READER_ROLES, 'package version')
}

/**
 * The write side: `requireAuthorOnPackage` resolves the package's institution itself and admits a
 * Scenario Editor there, or the admin (08 §5, D-748).
 */
async function requireAuthor(actor: SessionUser, packageId: string): Promise<string> {
  const scope = await requireAuthorOnPackage(actor, packageId)
  return scope.organizationId
}

/**
 * Whether the actor authors and signs for a package: a Scenario Editor, or the admin (D-748). Every
 * write proves it through `requireAuthor`; the version view asks it to draw the workspace's controls.
 */
const isConfirmingAuthority = (actor: SessionUser): boolean => hasRole(actor, AUTHORING_ROLES)

// ---------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------

function toVersionSummary(row: repo.ScenarioPackageVersion): VersionSummaryView {
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    calibrationStatus: row.calibrationStatus,
    confirmedAt: isoOrNull(row.confirmedAt),
    createdAt: iso(row.createdAt),
  }
}

/**
 * `keys` is the version's own element index (`elementKeyIndex`), given where the row is read on
 * the record beside a hundred others; the confirmation an element carries for itself already sits
 * under its key and passes none.
 */
function toConfirmationView(
  row: repo.ElementConfirmation,
  names: ReadonlyMap<string, string>,
  keys?: ReadonlyMap<string, string>,
): ElementConfirmationView {
  return {
    id: row.id,
    elementType: row.elementType,
    elementId: row.elementId,
    ...(keys === undefined
      ? {}
      : { elementKey: row.elementId === null ? null : (keys.get(row.elementId) ?? null) }),
    revision: row.revision,
    decision: row.decision,
    note: row.note,
    openedAt: iso(row.openedAt),
    decidedAt: iso(row.decidedAt),
    decidedBy: row.decidedBy,
    decidedByName: names.get(row.decidedBy) ?? '',
  }
}

/** Element id → the key the workspace shows it under, from the version's own unit list. */
function elementKeyIndex(units: readonly ElementUnit[]): ReadonlyMap<string, string> {
  return new Map(
    units.flatMap((unit) => (unit.elementId === null ? [] : [[unit.elementId, unit.key]])),
  )
}

function toSeedRecordView(row: repo.SeedRecord): SeedRecordView {
  return {
    caseTitle: row.caseTitle,
    publisher: row.publisher,
    licenseTerms: row.licenseTerms,
    licensePermitsAdaptation: row.licensePermitsAdaptation,
    seedText: row.seedText,
    reskinLog: row.reskinLog,
  }
}

function countElements(version: repo.VersionFull): ElementCounts {
  return {
    documents: version.documents.length,
    stakeholders: version.stakeholders.length,
    answerSpacePositions: version.answerSpacePositions.length,
    namedFields: version.namedFields.length,
    claims: version.claims.length,
    variants: version.variants.length,
    defenseQuestions: version.defenseQuestions.length,
    readinessItems: version.readinessItems.length,
  }
}

/**
 * D-083: the PRD asks every family to include an ethical-shortcut defect and gives the build family
 * exactly one defect, a stale-evidence one. The two rules cannot both hold, so the shortfall is a
 * warning on the list rather than a block. `unacceptable_route` is the failure family that carries
 * the ethical shortcut (06 §3.3).
 */
const ETHICAL_DEFECT_FAMILY = 'unacceptable_route'

/**
 * What the version's own screen tells its author to look at (FR-190). Neither warning blocks a
 * confirmation, which is the whole point of the mechanism: it says "this is unwise" where a rule
 * would say "this is invalid".
 *
 * `READINESS_CONCEPT_SINGLE_ITEM` is the one authored property that decides how much of the
 * Readiness Check's own marking a student is handed. The concept map is returned when the check
 * closes and PRD §7.1 requires it, so a reading of correctness by concept is the product; a concept
 * carried by one item narrows that reading to the item, which is per-item marking before the run is
 * scored. `thinlyCarriedConcepts` states the floor and this is where an author hears about it
 * (D-251). The shipped Meridian Roast fixture earns it — seven of its eleven concepts are carried
 * by a single item — and keeps its confirmation, which is what a warning is for.
 */
function versionWarnings(version: repo.VersionFull): PackageWarningValue[] {
  const warnings: PackageWarningValue[] = []
  const hasEthicalDefect = version.variants.some((variant) =>
    variant.claimStates.some((state) => state.failureFamily === ETHICAL_DEFECT_FAMILY),
  )
  if (!hasEthicalDefect) warnings.push('FAMILY_LACKS_ETHICAL_DEFECT')
  if (thinlyCarriedConcepts(version.readinessItems).length > 0) {
    warnings.push('READINESS_CONCEPT_SINGLE_ITEM')
  }
  return warnings
}

// ---------------------------------------------------------------------------------------------
// The confirmation record, and the measures read off it (FR-198)
// ---------------------------------------------------------------------------------------------

/** The address a confirmation row is filed under: type plus element id, singletons under null. */
const confirmationKey = (elementType: ElementTypeValue, elementId: string | null): string =>
  `${elementType}:${elementId ?? ''}`

type DecisionIndex = {
  /** The newest decision per element (rows arrive newest first). */
  latest: Map<string, repo.ElementConfirmation>
  /** Every decision per element, newest first. */
  all: Map<string, repo.ElementConfirmation[]>
}

function indexDecisions(rows: readonly repo.ElementConfirmation[]): DecisionIndex {
  const latest = new Map<string, repo.ElementConfirmation>()
  const all = new Map<string, repo.ElementConfirmation[]>()
  for (const row of rows) {
    const key = confirmationKey(row.elementType, row.elementId)
    const list = all.get(key)
    if (list) list.push(row)
    else all.set(key, [row])
    const seen = latest.get(key)
    if (!seen || seen.revision < row.revision) latest.set(key, row)
  }
  return { latest, all }
}

/** A decision that stands as confirmation: an author's explicit tick, or their own edit (10 §4). */
const isConfirming = (decision: repo.ElementConfirmation['decision']): boolean =>
  decision === 'confirmed' || decision === 'edited'

const reviewMs = (row: repo.ElementConfirmation): number =>
  Math.max(0, row.decidedAt.getTime() - row.openedAt.getTime())

/**
 * FR-198's five measures for this version (10 §5's `computeAuthoringMeasures`, from here).
 *
 * The arithmetic is `authoring/measures.ts`, which is where 10 §5 puts it, and the generation runs
 * are the `authoring` module's table: a package built by hand or by import has none, so its
 * counters read zero without a special case. What this file still owns is the element list they are
 * divided by (`./units.ts`), which is the same list `confirmVersion` counts.
 */
function measureAuthoring(
  version: repo.VersionFull,
  units: readonly ElementUnit[],
  confirmations: readonly repo.ElementConfirmation[],
  runs: readonly GenerationRunView[],
): AuthoringMeasureValues {
  return computeMeasures({
    units,
    decisions: confirmations,
    runs,
    seedCreatedAt: version.seedRecord?.createdAt ?? null,
    confirmedAt: version.confirmedAt,
  })
}

function toAuthoringRecord(
  version: repo.VersionFull,
  rows: readonly repo.ElementConfirmation[],
  names: ReadonlyMap<string, string>,
  runs: readonly GenerationRunView[],
): AuthoringRecordView {
  const decisionsPerEditor = new Map<string, number>()
  for (const row of rows) {
    decisionsPerEditor.set(row.decidedBy, (decisionsPerEditor.get(row.decidedBy) ?? 0) + 1)
  }
  return {
    generationModel: version.generationModel,
    generatedAt: isoOrNull(version.generatedAt),
    runs: runs.map((run) => ({
      step: run.step,
      passNumber: run.passNumber,
      status: run.status,
      failedRules: run.failedRules,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    })),
    editors: [...decisionsPerEditor].map(([userId, decisions]) => ({
      userId,
      name: names.get(userId) ?? '',
      decisions,
    })),
  }
}

// ---------------------------------------------------------------------------------------------
// Reading one element back in the shape its input schema takes
// ---------------------------------------------------------------------------------------------

/** The element addressed by `(elementType, elementId)`, or undefined when the version has no such one. */
function locateElement(
  version: repo.VersionFull,
  elementType: ElementTypeValue,
  elementId: string,
): { unit: ElementUnit; values: ElementValues } | undefined {
  const unit = (key: string, id: string | null): ElementUnit => ({
    elementType,
    elementId: id,
    key,
  })
  const byId = <T extends { id: string; key: string }>(rows: readonly T[]): T | undefined =>
    rows.find((row) => row.id === elementId)

  switch (elementType) {
    case 'brief':
      return { unit: unit('brief', null), values: { brief: version.brief } }
    case 'counterfactual':
      return {
        unit: unit('counterfactual', null),
        values: { debriefCounterfactual: version.debriefCounterfactual },
      }
    case 'general_escalation_reply':
      return {
        unit: unit('general_escalation_reply', null),
        values: { generalEscalationReply: version.generalEscalationReply },
      }
    case 'clock_and_difficulty':
      return {
        unit: unit('clock_and_difficulty', null),
        values: {
          workingClockSeconds: version.workingClockSeconds,
          turnDelaySeconds: version.turnDelaySeconds,
          difficultyProfile: version.difficultyProfile,
        },
      }
    case 'document': {
      const row = byId(version.documents)
      if (!row) return undefined
      return {
        unit: unit(row.key, row.id),
        values: {
          key: row.key,
          title: row.title,
          author: row.author,
          datedOn: row.datedOn,
          role: row.role,
          position: row.position,
          body: row.body,
          supersededByDocumentId: row.supersededByDocumentId,
          stakeholderId: row.stakeholderId,
        },
      }
    }
    case 'stakeholder': {
      const row = byId(version.stakeholders)
      if (!row) return undefined
      return {
        unit: unit(row.key, row.id),
        values: {
          key: row.key,
          name: row.name,
          roleTitle: row.roleTitle,
          positionStatement: row.positionStatement,
          incentives: row.incentives,
          blindSpots: row.blindSpots,
          contradictionPoint: row.contradictionPoint,
          contradictsStakeholderId: row.contradictsStakeholderId,
        },
      }
    }
    case 'answer_space_position': {
      const row = byId(version.answerSpacePositions)
      if (!row) return undefined
      return {
        unit: unit(row.key, row.id),
        values: {
          key: row.key,
          kind: row.kind,
          summary: row.summary,
          ignoredEvidence: row.ignoredEvidence,
          isMinimumCommitment: row.isMinimumCommitment,
          position: row.position,
          supportingDocumentIds: row.supportingDocumentIds,
        },
      }
    }
    case 'named_field': {
      const row = byId(version.namedFields)
      if (!row) return undefined
      return {
        unit: unit(row.key, row.id),
        values: { key: row.key, label: row.label, unit: row.unit, position: row.position },
      }
    }
    case 'claim': {
      const row = byId(version.claims)
      if (!row) return undefined
      return {
        unit: unit(row.key, row.id),
        values: {
          key: row.key,
          text: row.text,
          sourceKind: row.sourceKind,
          sourceDocumentId: row.sourceDocumentId,
          sourcePassage: row.sourcePassage,
          importance: row.importance,
          consequenceLevel: row.consequenceLevel,
          verificationCost: row.verificationCost,
          weaklySourced: row.weaklySourced,
          volatile: row.volatile,
          conceptKey: row.conceptKey,
          carriedValues: row.carriedValues,
          triggerPhrases: row.triggerPhrases,
          triggerDescription: row.triggerDescription,
          escalatable: row.escalatable,
          escalationReply: row.escalationReply,
          rationale: row.rationale,
          position: row.position,
        },
      }
    }
    case 'variant_claim_state': {
      const claimKeyById = new Map(version.claims.map((claim) => [claim.id, claim.key]))
      for (const variant of version.variants) {
        const row = variant.claimStates.find((state) => state.id === elementId)
        if (!row) continue
        return {
          unit: unit(`${variant.key}:${claimKeyById.get(row.claimId) ?? row.claimId}`, row.id),
          values: {
            variantId: row.variantId,
            claimId: row.claimId,
            evidenceStatus: row.evidenceStatus,
            failureFamily: row.failureFamily,
            warrantedStance: row.warrantedStance,
            planted: row.planted,
            verificationPaths: row.verificationPaths,
          },
        }
      }
      return undefined
    }
    case 'probe': {
      const row = version.probe
      if (!row || !(elementId === SINGLETON_ELEMENT_ID || elementId === row.id)) return undefined
      return {
        unit: unit('probe', null),
        values: {
          claimId: row.claimId,
          originalPosition: row.originalPosition,
          scriptedReversal: row.scriptedReversal,
        },
      }
    }
    case 'turn': {
      const row = version.turn
      if (!row || !(elementId === SINGLETON_ELEMENT_ID || elementId === row.id)) return undefined
      return {
        unit: unit('turn', null),
        values: {
          text: row.text,
          voice: row.voice,
          stakeholderId: row.stakeholderId,
          warrantsChange: row.warrantsChange,
          proportionateResponse: row.proportionateResponse,
          evidence: row.evidence,
          disruptedAssumptionKeys: row.disruptedAssumptionKeys,
          windowClaimIds: row.windowClaimIds,
        },
      }
    }
    case 'defense_question': {
      const row = byId(version.defenseQuestions)
      if (!row) return undefined
      return {
        unit: unit(row.key, row.id),
        values: {
          key: row.key,
          kind: row.kind,
          claimId: row.claimId,
          assumptionIndex: row.assumptionIndex,
          template: row.template,
          condition: row.condition,
          followUp: row.followUp,
          expectedAnswerNotes: row.expectedAnswerNotes,
          isDefault: row.isDefault,
          position: row.position,
        },
      }
    }
    case 'readiness_item': {
      const row = byId(version.readinessItems)
      if (!row) return undefined
      return {
        unit: unit(row.key, row.id),
        values: {
          key: row.key,
          category: row.category,
          conceptKey: row.conceptKey,
          stem: row.stem,
          options: row.options,
          answerKey: row.answerKey,
          position: row.position,
        },
      }
    }
    case 'seed_reskin': {
      const row = version.seedRecord
      if (!row || !(elementId === SINGLETON_ELEMENT_ID || elementId === row.id)) return undefined
      return {
        unit: unit('seed_reskin', null),
        values: {
          caseTitle: row.caseTitle,
          publisher: row.publisher,
          licenseTerms: row.licenseTerms,
          licensePermitsAdaptation: row.licensePermitsAdaptation,
          seedText: row.seedText,
          reskinLog: row.reskinLog,
        },
      }
    }
  }
}

/**
 * The row `upsertElement` writes for a validated element. `word_count` is derived here and never
 * accepted from input: a document that could declare its own count could declare a false one and
 * walk past `DOCUMENT_TOO_LONG` (D-081).
 */
function toElementRow(
  elementType: ElementTypeValue,
  values: ElementValues,
): repo.ElementInput[repo.ElementType] {
  switch (elementType) {
    case 'brief': {
      const input = ELEMENT_INPUT_SCHEMAS.brief.parse(values)
      return { brief: input.brief }
    }
    case 'counterfactual': {
      const input = ELEMENT_INPUT_SCHEMAS.counterfactual.parse(values)
      return { debriefCounterfactual: input.debriefCounterfactual }
    }
    case 'general_escalation_reply': {
      const input = ELEMENT_INPUT_SCHEMAS.general_escalation_reply.parse(values)
      return { generalEscalationReply: input.generalEscalationReply }
    }
    case 'clock_and_difficulty': {
      const input = ELEMENT_INPUT_SCHEMAS.clock_and_difficulty.parse(values)
      return {
        workingClockSeconds: input.workingClockSeconds,
        turnDelaySeconds: input.turnDelaySeconds,
        difficultyProfile: input.difficultyProfile,
      }
    }
    case 'document': {
      const input = ELEMENT_INPUT_SCHEMAS.document.parse(values)
      return {
        key: input.key,
        title: input.title,
        author: input.author,
        datedOn: input.datedOn,
        body: input.body,
        wordCount: countWords(input.body),
        role: input.role,
        supersededByDocumentId: input.supersededByDocumentId,
        stakeholderId: input.stakeholderId,
        position: input.position,
      }
    }
    case 'stakeholder': {
      const input = ELEMENT_INPUT_SCHEMAS.stakeholder.parse(values)
      return {
        key: input.key,
        name: input.name,
        roleTitle: input.roleTitle,
        positionStatement: input.positionStatement,
        incentives: input.incentives,
        blindSpots: input.blindSpots,
        contradictsStakeholderId: input.contradictsStakeholderId,
        contradictionPoint: input.contradictionPoint,
      }
    }
    case 'answer_space_position': {
      const input = ELEMENT_INPUT_SCHEMAS.answer_space_position.parse(values)
      return {
        key: input.key,
        kind: input.kind,
        summary: input.summary,
        supportingDocumentIds: input.supportingDocumentIds,
        ignoredEvidence: input.ignoredEvidence,
        isMinimumCommitment: input.isMinimumCommitment,
        position: input.position,
      }
    }
    case 'named_field': {
      const input = ELEMENT_INPUT_SCHEMAS.named_field.parse(values)
      return { key: input.key, label: input.label, unit: input.unit, position: input.position }
    }
    case 'claim': {
      const input = ELEMENT_INPUT_SCHEMAS.claim.parse(values)
      return {
        key: input.key,
        text: input.text,
        sourceKind: input.sourceKind,
        sourceDocumentId: input.sourceDocumentId,
        sourcePassage: input.sourcePassage,
        importance: input.importance,
        consequenceLevel: input.consequenceLevel,
        verificationCost: input.verificationCost,
        weaklySourced: input.weaklySourced,
        volatile: input.volatile,
        conceptKey: input.conceptKey,
        carriedValues: tightened<CarriedValue[]>(input.carriedValues),
        triggerPhrases: input.triggerPhrases,
        triggerDescription: input.triggerDescription,
        escalatable: input.escalatable,
        escalationReply: input.escalationReply,
        rationale: input.rationale,
        position: input.position,
      }
    }
    case 'variant_claim_state': {
      const input = ELEMENT_INPUT_SCHEMAS.variant_claim_state.parse(values)
      return {
        variantId: input.variantId,
        claimId: input.claimId,
        evidenceStatus: input.evidenceStatus,
        failureFamily: input.failureFamily,
        warrantedStance: input.warrantedStance,
        verificationPaths: tightened<VerificationPaths>(input.verificationPaths),
        planted: input.planted,
      }
    }
    case 'probe': {
      const input = ELEMENT_INPUT_SCHEMAS.probe.parse(values)
      return {
        claimId: input.claimId,
        originalPosition: input.originalPosition,
        scriptedReversal: input.scriptedReversal,
      }
    }
    case 'turn': {
      const input = ELEMENT_INPUT_SCHEMAS.turn.parse(values)
      return {
        text: input.text,
        voice: input.voice,
        stakeholderId: input.stakeholderId,
        warrantsChange: input.warrantsChange,
        proportionateResponse: input.proportionateResponse,
        evidence: input.evidence,
        disruptedAssumptionKeys: input.disruptedAssumptionKeys,
        windowClaimIds: input.windowClaimIds,
      }
    }
    case 'defense_question': {
      const input = ELEMENT_INPUT_SCHEMAS.defense_question.parse(values)
      return {
        key: input.key,
        kind: input.kind,
        claimId: input.claimId,
        assumptionIndex: input.assumptionIndex,
        template: input.template,
        condition: input.condition,
        followUp: input.followUp,
        expectedAnswerNotes: input.expectedAnswerNotes,
        isDefault: input.isDefault,
        position: input.position,
      }
    }
    case 'readiness_item': {
      const input = ELEMENT_INPUT_SCHEMAS.readiness_item.parse(values)
      return {
        key: input.key,
        category: input.category,
        conceptKey: input.conceptKey,
        stem: input.stem,
        options: input.options,
        answerKey: input.answerKey,
        position: input.position,
      }
    }
    case 'seed_reskin': {
      const input = ELEMENT_INPUT_SCHEMAS.seed_reskin.parse(values)
      return {
        caseTitle: input.caseTitle,
        publisher: input.publisher,
        licenseTerms: input.licenseTerms,
        licensePermitsAdaptation: input.licensePermitsAdaptation,
        seedText: input.seedText,
        reskinLog: input.reskinLog,
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// createPackageFromSeed (FR-190)
// ---------------------------------------------------------------------------------------------

/**
 * A package family, its first draft version, the seed record it records its origin in, and the two
 * variants every version carries (10 §4).
 *
 * Three of the fields are optional and this is where they get their answers (D-751):
 *
 *   *The concept set*, when the author names none, is `DEFAULT_CONCEPT_SET` — four concepts any
 *   decision run exercises. The version row refuses fewer than four, so there is no "none".
 *
 *   *The seed record*, when the author names no source case, records the package as the author's
 *   own material. FR-190's licence tick is an attestation about somebody *else's* case; a package
 *   with no third-party case has nothing to attest to, so the tick is required exactly when a case
 *   title or publisher is named and is otherwise the statement the record already makes.
 *
 *   *The seed text* may be empty. Step 1 reads it as the case to re-skin, and a package generated
 *   from its title alone gives the model the title, the concepts, and nothing it has to honour from
 *   somebody else's work — which is a sound package, not a lesser one.
 */
export async function createPackageFromSeed(
  actor: SessionUser,
  orgId: string,
  input: CreatePackageFromSeedInput,
): Promise<CreatedPackageView> {
  await requireVisibleMembership(actor, orgId, AUTHORING_ROLES)

  const seed = resolveSeed(actor, input)
  // FR-190: a licensed case may only be re-skinned when its license says so, and the author is the
  // one who confirms it. The wire schema takes a plain boolean so this answers the documented code.
  if (namesASourceCase(input) && !seed.licensePermitsAdaptation) licenseNotConfirmed()

  const conceptSet = input.conceptSet.length === 0 ? [...DEFAULT_CONCEPT_SET] : input.conceptSet
  const created = await createPackageRows(actor, orgId, input, conceptSet, seed)

  track(
    'package_created_from_seed',
    {
      package_id: created.packageId,
      package_version_id: created.versionId,
      version: 1,
      seed_chars: seed.seedText.length,
      concept_count: conceptSet.length,
    },
    { userId: actor.id, organizationId: orgId },
  )
  return created
}

/** True when the author says the package is adapted from somebody else's case (D-751). */
function namesASourceCase(input: CreatePackageFromSeedInput): boolean {
  return input.seed.caseTitle !== '' || input.seed.publisher !== ''
}

/** What `seed_records` is written with: the author's own words, or the record of original material. */
function resolveSeed(actor: SessionUser, input: CreatePackageFromSeedInput): repo.SeedRecordInsert {
  const original = !namesASourceCase(input)
  const { caseTitle, publisher, licenseTerms, licensePermitsAdaptation, seedText } = input.seed
  return {
    caseTitle: caseTitle === '' ? input.title : caseTitle,
    publisher:
      publisher !== ''
        ? publisher
        : actor.name.trim() === ''
          ? t('packageNew.originalPublisher')
          : actor.name,
    licenseTerms: licenseTerms === '' ? t('packageNew.originalLicenseTerms') : licenseTerms,
    // Nothing is being adapted, so nothing is being attested to; the record says so in its terms.
    licensePermitsAdaptation: original ? true : licensePermitsAdaptation,
    // Step 1 reads this as the case. An empty one says so rather than arriving as an empty string,
    // which the column refuses and which would tell the model nothing about why it is empty.
    seedText: seedText === '' ? t('packageNew.originalSeedText', { title: input.title }) : seedText,
  }
}

/** The write of `createPackageFromSeed`; the family key is unique per institution (07 §6). */
async function createPackageRows(
  actor: SessionUser,
  orgId: string,
  input: CreatePackageFromSeedInput,
  conceptSet: readonly string[],
  seed: repo.SeedRecordInsert,
): Promise<CreatedPackageView> {
  try {
    return await repo.withTransaction(async (tx) => {
      const pkg = await repo.insertPackage(
        orgId,
        { title: input.title, familyKey: input.familyKey, createdBy: actor.id },
        tx,
      )
      const version = await repo.insertVersion(
        orgId,
        { packageId: pkg.id, version: 1, status: 'draft', conceptSet: [...conceptSet] },
        tx,
      )
      await repo.insertSeedRecord(version.id, seed, tx)
      await repo.insertVariants(version.id, DEFAULT_VARIANTS, tx)
      return { packageId: pkg.id, versionId: version.id }
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError('CONFLICT', 'This institution already has a package with that family key.')
    }
    throw error
  }
}

/** Every version carries both readings of the same scenario (DATA-020, PRD §7.18). */
const DEFAULT_VARIANTS = [
  { key: 'defective' as const, label: 'Defective' },
  { key: 'sound' as const, label: 'Sound' },
]

// ---------------------------------------------------------------------------------------------
// listPackages (UI-040)
// ---------------------------------------------------------------------------------------------

/**
 * The institution's packages with the status of their latest version and the family warnings D-083
 * records. Scenario Editors and Instructors, who choose a confirmed version for an assignment from
 * this shelf (D-748).
 */
export async function listPackages(
  actor: SessionUser,
  orgId: string,
  input: PageQuery = {},
): Promise<repo.Page<PackageSummaryView>> {
  await requireVisibleMembership(actor, orgId, PACKAGE_READER_ROLES)

  const page = await repo.pagePackages(orgId, input)
  const versions = await repo.listVersionsForPackages(
    orgId,
    page.items.map((row) => row.id),
  )
  const withEthicalDefect = new Set(
    await repo.listVersionsWithEthicalDefect(versions.map((row) => row.id)),
  )

  const byPackage = new Map<string, repo.ScenarioPackageVersion[]>()
  for (const version of versions) {
    const list = byPackage.get(version.packageId)
    if (list) list.push(version)
    else byPackage.set(version.packageId, [version])
  }

  return {
    items: page.items.map((row) => {
      // `listVersionsForPackages` orders by version number descending, so the first is the latest.
      const family = byPackage.get(row.id) ?? []
      const latest = family[0]
      return {
        id: row.id,
        title: row.title,
        familyKey: row.familyKey,
        discipline: row.discipline,
        latestVersion: latest ? toVersionSummary(latest) : null,
        versionCount: family.length,
        // The warning is about the family, so one version carrying the ethical-shortcut defect
        // clears it for the whole row (D-083).
        warnings: family.some((version) => withEthicalDefect.has(version.id))
          ? []
          : ['FAMILY_LACKS_ETHICAL_DEFECT'],
        updatedAt: iso(row.updatedAt),
      }
    }),
    nextCursor: page.nextCursor,
  }
}

// ---------------------------------------------------------------------------------------------
// getPackage (07 §6 `GET /packages/{packageId}`)
// ---------------------------------------------------------------------------------------------

/**
 * One package family with every version of it: the row the list shows, plus the versions a reader
 * chooses between (07 §6). An Instructor reaches it as well as an author, because this is the only
 * screen that answers "which version is my section running", and it carries nothing the version
 * view does not — no seed record, no elements, no defect placement.
 */
export async function getPackage(actor: SessionUser, packageId: string): Promise<PackageView> {
  for (const tenantId of await tenantsOf(actor)) {
    const pkg = await repo.findPackage(tenantId, packageId)
    if (!pkg) continue

    await requireVisibleMembership(actor, tenantId, PACKAGE_READER_ROLES, 'package')

    const versions = await repo.listVersions(tenantId, packageId)
    const withEthicalDefect = new Set(
      await repo.listVersionsWithEthicalDefect(versions.map((row) => row.id)),
    )
    // `listVersions` orders by version number descending, so the first is the latest.
    const latest = versions[0]
    return {
      id: pkg.id,
      title: pkg.title,
      familyKey: pkg.familyKey,
      discipline: pkg.discipline,
      latestVersion: latest ? toVersionSummary(latest) : null,
      versionCount: versions.length,
      // The warning is about the family, so one version carrying the ethical-shortcut defect
      // clears it for the whole package (D-083), exactly as it does on the list.
      warnings: versions.some((version) => withEthicalDefect.has(version.id))
        ? []
        : ['FAMILY_LACKS_ETHICAL_DEFECT'],
      versions: versions.map(toVersionSummary),
      createdAt: iso(pkg.createdAt),
      updatedAt: iso(pkg.updatedAt),
    }
  }
  notFound('package')
}

// ---------------------------------------------------------------------------------------------
// getPackageVersion (FR-180, FR-195, FR-198, FR-028)
// ---------------------------------------------------------------------------------------------

/**
 * The package version view: what the version is, what it still fails, who decided on it, and what
 * the authoring of it cost (07 §6). The seed record rides along only for a Scenario Editor or the
 * admin; an Instructor reads the package without the licensed case behind it (FR-028, D-748).
 */
export async function getPackageVersion(
  actor: SessionUser,
  versionId: string,
): Promise<PackageVersionView> {
  const scope = await resolveVersion(actor, versionId)
  await requireVersionReader(actor, scope)
  return buildVersionView(actor, scope)
}

async function buildVersionView(
  actor: SessionUser,
  scope: VersionScope,
): Promise<PackageVersionView> {
  const { version } = scope
  const confirmations = await repo.listConfirmations(version.id)
  const names = await deciderNames(confirmations, version.confirmedBy)

  const units = elementUnits(version)
  const runs = await listGenerationRunsForVersion(version.id)
  const measured = measureAuthoring(version, units, confirmations, runs)
  const isDraft = version.status === 'draft'
  const mayAuthor = isConfirmingAuthority(actor)

  return {
    id: version.id,
    packageId: version.packageId,
    packageTitle: version.package.title,
    familyKey: version.package.familyKey,
    version: version.version,
    status: version.status,
    calibrationStatus: version.calibrationStatus,
    conceptSet: version.conceptSet,
    brief: version.brief,
    workingClockSeconds: version.workingClockSeconds,
    turnDelaySeconds: version.turnDelaySeconds,
    difficultyProfile: version.difficultyProfile,
    generalEscalationReply: version.generalEscalationReply,
    debriefCounterfactual: version.debriefCounterfactual,
    teachingNoteChecked: version.teachingNoteChecked,
    confirmedAt: isoOrNull(version.confirmedAt),
    confirmedBy: version.confirmedBy,
    counts: countElements(version),
    confirmationRecord: confirmations.map((row) =>
      toConfirmationView(row, names, elementKeyIndex(units)),
    ),
    authoringRecord: toAuthoringRecord(version, confirmations, names, runs),
    measures: {
      seedToConfirmedMs: measured.seedToConfirmedMs,
      editRate: measured.editRate,
      rejectedShare: measured.rejectedShare,
      generationPasses: measured.generationPasses,
      reviewMsPerElement: measured.reviewMsPerElement,
    },
    validation: toValidationResult(version),
    warnings: versionWarnings(version),
    seedRecord: version.seedRecord && mayAuthor ? toSeedRecordView(version.seedRecord) : null,
    capabilities: {
      canEdit: isDraft && mayAuthor,
      canConfirm: isDraft && mayAuthor,
      // The pipeline refuses a frozen version on the write itself (10 §5); this is the same rule
      // said early enough for the workspace to draw the buttons, never instead of it.
      canRegenerate: isDraft && mayAuthor,
    },
  }
}

/** `validatePackage` narrows the rule codes; the view carries the wider wire shape. */
function toValidationResult(version: repo.VersionFull): ValidationResult {
  const result = validatePackage(version)
  return {
    ok: result.ok,
    failures: result.failures.map((failure) => ({
      code: failure.code,
      elementIds: failure.elementIds,
      elementKeys: failure.elementKeys,
      message: failure.message,
    })),
  }
}

async function deciderNames(
  confirmations: readonly repo.ElementConfirmation[],
  confirmedBy: string | null,
): Promise<Map<string, string>> {
  const ids = new Set(confirmations.map((row) => row.decidedBy))
  if (confirmedBy) ids.add(confirmedBy)
  const rows = await repo.findUserSummaries([...ids])
  return new Map(rows.map((row) => [row.id, row.name]))
}

// ---------------------------------------------------------------------------------------------
// listVersionElements (FR-192): the confirmation workspace's read
// ---------------------------------------------------------------------------------------------

/**
 * Every element of a draft version, in the order the workspace lists them, each with the values its
 * input schema takes and the decision that currently stands on it (UI-043).
 *
 * `getPackageVersion` answers what a version *is* — counts, record, measures — and `exportPackage`
 * answers what it *says*, addressed by element key. Neither is enough to edit one: an element is
 * patched by `(elementType, elementId)`, and an element id appears in neither view. This is that
 * third read, and it is deliberately the shape `updateElement` already answers with, so the
 * workspace can swap the element it just saved into the list it is holding.
 *
 * Scenario Editors and the admin only. The seed record is one of the elements here (FR-028), and
 * every action the workspace can take refuses anyone else, so the gate is the write side's, not the
 * version reader's: an Instructor reads a package on UI-044, never in the room where it is signed.
 */
export async function listVersionElements(
  actor: SessionUser,
  versionId: string,
): Promise<ElementView[]> {
  const scope = await resolveVersion(actor, versionId)
  await requireVisibleMembership(actor, scope.tenantId, AUTHORING_ROLES, 'package version')

  const confirmations = await repo.listConfirmations(versionId)
  const decisions = indexDecisions(confirmations)
  const names = await deciderNames(confirmations, null)

  const elements: ElementView[] = []
  for (const unit of elementUnits(scope.version)) {
    // `elementUnits` files a singleton under a null id, which is how its confirmation row is
    // keyed; `locateElement` addresses it the way a route does.
    const found = locateElement(
      scope.version,
      unit.elementType,
      unit.elementId ?? SINGLETON_ELEMENT_ID,
    )
    if (!found) continue
    const latest = decisions.latest.get(confirmationKey(unit.elementType, unit.elementId))
    elements.push({
      ...unit,
      values: found.values,
      confirmation: latest ? toConfirmationView(latest, names) : null,
    })
  }
  return elements
}

// ---------------------------------------------------------------------------------------------
// getClaimObject (FR-180)
// ---------------------------------------------------------------------------------------------

/**
 * Everything one claim is, what it deserved, and how it could have been checked (07 §6). Package
 * readers only — a Scenario Editor, an Instructor, the admin: a student who could open this would be
 * reading the answer key (D-117).
 */
export async function getClaimObject(
  actor: SessionUser,
  versionId: string,
  claimId: string,
  variantId?: string,
): Promise<ClaimObjectView> {
  const scope = await resolveVersion(actor, versionId)
  await requireVisibleMembership(actor, scope.tenantId, PACKAGE_READER_ROLES, 'package version')

  const claim = await repo.findClaimWithState(versionId, claimId, variantId ?? null)
  if (!claim) notFound('claim')

  const confirmations = await repo.listConfirmations(versionId)
  const names = await deciderNames(confirmations, null)
  const decisions = indexDecisions(confirmations)
  const latest = decisions.latest.get(confirmationKey('claim', claim.id))

  const states: ClaimStateView[] = claim.variantStates.map((state) => ({
    variantId: state.variantId,
    variantKey: state.variant.key,
    evidenceStatus: state.evidenceStatus,
    failureFamily: state.failureFamily,
    warrantedStance: state.warrantedStance,
    planted: state.planted,
    verificationPaths: state.verificationPaths,
  }))

  return {
    id: claim.id,
    key: claim.key,
    text: claim.text,
    sourceKind: claim.sourceKind,
    source: claim.sourceDocument
      ? {
          documentId: claim.sourceDocument.id,
          key: claim.sourceDocument.key,
          title: claim.sourceDocument.title,
          author: claim.sourceDocument.author,
          datedOn: claim.sourceDocument.datedOn,
          passage: claim.sourcePassage,
        }
      : null,
    importance: claim.importance,
    consequenceLevel: claim.consequenceLevel,
    verificationCost: claim.verificationCost,
    weaklySourced: claim.weaklySourced,
    volatile: claim.volatile,
    conceptKey: claim.conceptKey,
    carriedValues: claim.carriedValues,
    triggerPhrases: claim.triggerPhrases,
    triggerDescription: claim.triggerDescription,
    escalatable: claim.escalatable,
    escalationReply: claim.escalationReply,
    rationale: claim.rationale,
    states: states.sort((a, b) => a.variantKey.localeCompare(b.variantKey)),
    confirmation: latest ? toConfirmationView(latest, names) : null,
  }
}

// ---------------------------------------------------------------------------------------------
// updateElement and decideElement (FR-192, FR-198)
// ---------------------------------------------------------------------------------------------

/** The version an element write is about: a draft, in the actor's institution, they may author. */
async function requireDraftForWrite(
  actor: SessionUser,
  versionId: string,
): Promise<{ scope: VersionScope; tenantId: string }> {
  const scope = await resolveVersion(actor, versionId)
  const tenantId = await requireAuthor(actor, scope.version.packageId)
  if (scope.version.status !== 'draft') versionFrozen()
  return { scope, tenantId }
}

/**
 * Applies a patch to one element of a draft version. The stored element is merged with the fields
 * the editor sent and the whole is re-validated, so a patch can never leave a row that its own
 * schema would refuse; an element key is not patchable, because it is the element's identity in the
 * export and in the upsert that writes it.
 *
 * An author's edit is a confirmation (10 §4): a change writes an `edited` decision, which is what
 * makes "every element has a decision" true after a hand-authored pass.
 */
export async function updateElement(
  actor: SessionUser,
  versionId: string,
  elementType: ElementTypeValue,
  elementId: string,
  patch: unknown,
): Promise<ElementView> {
  const { scope, tenantId } = await requireDraftForWrite(actor, versionId)
  const found = locateElement(scope.version, elementType, elementId)
  if (!found) notFound('element')

  const sent = ELEMENT_PATCH_SCHEMAS[elementType].parse(patch) as ElementValues
  assertIdentityUnchanged(elementType, found.values, sent)

  const merged: ElementValues = { ...found.values, ...sent }
  const row = toElementRow(elementType, merged)
  // Re-read the merged values through the input schema so the answer carries what was stored —
  // `wordLimit` strips markup in place, so the value written and the value returned are the same.
  const values = ELEMENT_INPUT_SCHEMAS[elementType].parse(merged) as ElementValues
  assertReferencesInVersion(scope.version, elementType, found.unit.elementId, values)
  assertSourceDocumentPairing(scope.version, elementType, found.unit, values)

  const edits: Record<string, { before: unknown; after: unknown }> = {}
  for (const field of Object.keys(sent)) {
    const before = found.values[field]
    const after = values[field]
    if (!sameValue(before, after)) edits[field] = { before, after }
  }

  const decidedAt = new Date()

  const written = await repo.withTransaction(async (tx) => {
    await repo.upsertElement(tenantId, versionId, elementType, row, tx)
    // A patch that changed nothing is not an edit, so it records no decision.
    if (Object.keys(edits).length === 0) return null
    return repo.insertConfirmation(
      {
        packageVersionId: versionId,
        elementType,
        elementId: found.unit.elementId,
        decision: 'edited',
        edits,
        note: '',
        // The PATCH body carries no `openedAt` (07 §6): an edit records the instant it was made,
        // and the review span of an element is measured by the decision that follows it.
        openedAt: decidedAt,
        decidedAt,
        decidedBy: actor.id,
      },
      tx,
    )
  })

  if (written) {
    trackElementDecision(actor, scope, written, Object.keys(edits).length)
  }
  const names = written ? await deciderNames([written], null) : new Map<string, string>()
  return {
    ...found.unit,
    values,
    confirmation: written ? toConfirmationView(written, names) : null,
  }
}

/** The fields that address a row: changing one through a patch would write a second element. */
function assertIdentityUnchanged(
  elementType: ElementTypeValue,
  stored: ElementValues,
  sent: ElementValues,
): void {
  const identity =
    elementType === 'variant_claim_state' ? (['variantId', 'claimId'] as const) : (['key'] as const)
  for (const field of identity) {
    if (field in sent && !sameValue(stored[field], sent[field])) keyImmutable(field)
  }
}

/**
 * 06 §3.3: `scenario_claims.source_document_id` is required when a Source Trace path exists. The
 * pairing spans two tables, so it is checked on both writes that can break it.
 */
/**
 * Every reference an element carries has to point inside this version.
 *
 * The ids arrive in a patch as bare uuids, and the foreign keys behind them are global: nothing in
 * the database says `scenario_claims.source_document_id` names a document of the same version, and
 * `validatePackage` has no rule for it either. Left unchecked, an id from another institution was
 * accepted here and dereferenced by `getClaimObject`, which is a cross-tenant read through a write
 * that trusted the request body — the one shape 08 §4 "Cross-tenant" exists to prevent. It also
 * plants a foreign key that stops the other institution from deleting its own row.
 *
 * The version is already loaded in full for the merge, so this costs nothing but the lookups.
 */
function assertReferencesInVersion(
  version: repo.VersionFull,
  elementType: ElementTypeValue,
  elementId: string | null,
  values: ElementValues,
): void {
  const documents = new Set(version.documents.map((row) => row.id))
  const stakeholders = new Set(version.stakeholders.map((row) => row.id))
  const claims = new Set(version.claims.map((row) => row.id))
  const variants = new Set(version.variants.map((row) => row.id))

  const one = (field: string, known: ReadonlySet<string>, kind: string): void => {
    const id = values[field]
    if (id === null || id === undefined) return
    if (typeof id !== 'string' || !known.has(id)) referenceOutsideVersion(field, kind)
  }
  const many = (field: string, known: ReadonlySet<string>, kind: string): void => {
    const ids = values[field]
    if (!Array.isArray(ids)) return
    for (const id of ids) {
      if (typeof id !== 'string' || !known.has(id)) referenceOutsideVersion(field, kind)
    }
  }
  const notItself = (field: string): void => {
    if (elementId !== null && values[field] === elementId) {
      throw new AppError('VALIDATION_ERROR', `An element cannot be its own ${field}.`)
    }
  }

  switch (elementType) {
    case 'document':
      one('supersededByDocumentId', documents, 'document')
      one('stakeholderId', stakeholders, 'stakeholder')
      notItself('supersededByDocumentId')
      return
    case 'stakeholder':
      one('contradictsStakeholderId', stakeholders, 'stakeholder')
      notItself('contradictsStakeholderId')
      return
    case 'answer_space_position':
      many('supportingDocumentIds', documents, 'document')
      return
    case 'claim':
      one('sourceDocumentId', documents, 'document')
      return
    case 'variant_claim_state': {
      one('claimId', claims, 'claim')
      one('variantId', variants, 'variant')
      const paths = values['verificationPaths'] as
        { source_trace?: { document_id?: unknown } } | undefined
      const traceDocument = paths?.source_trace?.document_id
      if (traceDocument !== undefined && traceDocument !== null) {
        if (typeof traceDocument !== 'string' || !documents.has(traceDocument)) {
          referenceOutsideVersion('verificationPaths.source_trace.document_id', 'document')
        }
      }
      return
    }
    case 'turn':
      one('stakeholderId', stakeholders, 'stakeholder')
      many('windowClaimIds', claims, 'claim')
      return
    case 'probe':
      one('claimId', claims, 'claim')
      return
    case 'defense_question':
      one('claimId', claims, 'claim')
      return
    default:
      return
  }
}

function referenceOutsideVersion(field: string, kind: string): never {
  throw new AppError('VALIDATION_ERROR', `${field} must name a ${kind} of this package version.`, {
    details: { field },
  })
}

function assertSourceDocumentPairing(
  version: repo.VersionFull,
  elementType: ElementTypeValue,
  unit: ElementUnit,
  values: ElementValues,
): void {
  if (elementType === 'variant_claim_state') {
    const paths = values['verificationPaths'] as { source_trace?: unknown } | undefined
    if (!paths?.source_trace) return
    const claim = version.claims.find((row) => row.id === values['claimId'])
    if (claim && claim.sourceDocumentId === null) sourceDocumentMissing()
    return
  }
  if (elementType !== 'claim') return
  if (values['sourceDocumentId'] !== null) return
  const traced = version.variants.some((variant) =>
    variant.claimStates.some(
      (state) => state.claimId === unit.elementId && state.verificationPaths.source_trace,
    ),
  )
  if (traced) sourceDocumentMissing()
}

/**
 * One element decision (FR-192, FR-198). `openedAt` comes from the client because only the browser
 * knows when the element was opened; `decidedAt` is the server's clock. A `rejected` element stays
 * in the version and blocks `confirmVersion` until it is re-authored or regenerated (10 §4, §5).
 */
export async function decideElement(
  actor: SessionUser,
  versionId: string,
  elementType: ElementTypeValue,
  elementId: string,
  input: ElementDecisionInput,
): Promise<ElementConfirmationView> {
  const { scope } = await requireDraftForWrite(actor, versionId)

  const found = locateElement(scope.version, elementType, elementId)
  if (!found) notFound('element')

  const openedAt = new Date(input.openedAt)
  const decidedAt = new Date()
  const written = await repo.withTransaction((tx) =>
    repo.insertConfirmation(
      {
        packageVersionId: versionId,
        elementType,
        elementId: found.unit.elementId,
        decision: input.decision,
        note: input.note,
        // A clock skewed into the future would make the review span negative; the instant an
        // element was opened can never be later than the instant it was decided.
        openedAt: openedAt > decidedAt ? decidedAt : openedAt,
        decidedAt,
        decidedBy: actor.id,
      },
      tx,
    ),
  )

  trackElementDecision(actor, scope, written, 0)
  const names = await deciderNames([written], null)
  return toConfirmationView(written, names)
}

/** AN-001 (17 §3.2); `review_ms` is the span the confirmation row itself carries. */
function trackElementDecision(
  actor: SessionUser,
  scope: VersionScope,
  row: repo.ElementConfirmation,
  editedFieldsCount: number,
): void {
  track(
    'element_decided',
    {
      package_id: scope.version.packageId,
      package_version_id: scope.version.id,
      version: scope.version.version,
      element_type: row.elementType,
      revision: row.revision,
      decision: row.decision,
      review_ms: reviewMs(row),
      edited_fields_count: editedFieldsCount,
    },
    { userId: actor.id, organizationId: scope.tenantId },
  )
}

// ---------------------------------------------------------------------------------------------
// confirmVersion (FR-192, FR-027)
// ---------------------------------------------------------------------------------------------

/**
 * Publishes the version: freezes it and makes it assignable (10 §4, FR-192, FR-027; D-752).
 *
 * Three things must hold and each answers with its own code, checked in the order the rule table
 * gives them: no element stands *rejected*, the attestation is made, and `validatePackage` passes.
 *
 * The first of those used to be "every element has a decision that stands", and the difference is
 * what makes publishing one press. An author reviews a version on one screen and signs for it with
 * one attestation; requiring a separate tick against each of sixty elements first made the common
 * case sixty presses long and taught nobody anything the attestation does not already say. So an
 * element nobody has decided on is confirmed *by this press*, with a confirmation row filed in the
 * author's name at the moment they publish, and the dialog says so before they press it. What is
 * not swept up is a rejection: an author who sent an element back meant it, and publishing over
 * that would be the one thing FR-192 is there to stop.
 *
 * On success the version's status, `confirmed_at/by` and the export-format snapshot are written in
 * one statement — the `package_version_frozen` trigger refuses every later write to the row, so the
 * snapshot must ride with the transition, not follow it — and the confirmations, the audit row and
 * the `package_confirmed` notice commit with them.
 */
export async function confirmVersion(
  actor: SessionUser,
  versionId: string,
  input: ConfirmVersionInput,
): Promise<PackageVersionView> {
  const scope = await resolveVersion(actor, versionId)
  // A Scenario Editor publishes the version; an Instructor reads it and is refused here (D-748).
  const tenantId = await requireAuthor(actor, scope.version.packageId)
  if (scope.version.status !== 'draft') versionFrozen()

  const confirmations = await repo.listConfirmations(versionId)
  const decisions = indexDecisions(confirmations)
  const units = elementUnits(scope.version)
  const latestOf = (unit: ElementUnit): repo.ElementConfirmation | undefined =>
    decisions.latest.get(confirmationKey(unit.elementType, unit.elementId))

  // An element the author sent back is the one thing this press may not sweep up.
  const rejected: UnconfirmedElement[] = units
    .filter((unit) => latestOf(unit)?.decision === 'rejected')
    .map((unit) => ({ elementType: unit.elementType, elementId: unit.elementId, key: unit.key }))
  if (rejected.length > 0) elementsUnconfirmed(rejected)

  // Everything still waiting is confirmed by this press, in the author's name (D-752).
  const undecided = units.filter((unit) => {
    const latest = latestOf(unit)
    return !latest || !isConfirming(latest.decision)
  })

  // FR-027: the author states they have read the teaching note before the package can be used.
  if (!input.teachingNoteChecked) teachingNoteUnchecked()

  const validation = validatePackage(scope.version)
  if (!validation.ok) packageInvalid(validation.failures)

  const snapshot = buildExport(scope.version)
  const confirmedAt = new Date()

  await repo.withTransaction(async (tx) => {
    for (const unit of undecided) {
      await repo.insertConfirmation(
        {
          packageVersionId: versionId,
          elementType: unit.elementType,
          elementId: unit.elementId,
          decision: 'confirmed',
          // The note is the record of *how* it was confirmed, so a reader of the confirmation
          // record can tell an element the author opened from one the publish swept up.
          note: t('confirm.confirmedOnPublishNote'),
          openedAt: confirmedAt,
          decidedAt: confirmedAt,
          decidedBy: actor.id,
        },
        tx,
      )
    }

    const updated = await repo.updateVersionStatus(
      tenantId,
      versionId,
      {
        status: 'confirmed',
        confirmedAt,
        confirmedBy: actor.id,
        teachingNoteChecked: true,
        snapshot,
      },
      tx,
    )
    if (!updated) notFound('package version')
    await audit(tx, {
      actorId: actor.id,
      orgId: tenantId,
      action: 'package.confirm',
      targetType: 'scenario_package_version',
      targetId: versionId,
      metadata: {
        packageId: scope.version.packageId,
        version: scope.version.version,
        elementCount: units.length,
      },
    })

    // 10 §4: the institution's Instructors learn a package is assignable, and its Scenario Editors
    // that it is published (D-748). Inside the transaction, so the notice exists exactly when the
    // confirmation does; the author is dropped from the list because they are the one who just did
    // it.
    const recipients = (
      await listMemberIdsWithPlatformRoles(tenantId, PACKAGE_NOTICE_ROLES)
    ).filter((userId) => userId !== actor.id)
    await notify(tx, {
      userIds: recipients,
      type: 'package_confirmed',
      title: t('notifications.packageConfirmedTitle'),
      body: t('notifications.packageConfirmedBody', {
        title: scope.version.package.title,
        version: scope.version.version,
      }),
      link: `/packages/${scope.version.packageId}/versions/${versionId}`,
      payload: { packageId: scope.version.packageId, packageVersionId: versionId },
      orgId: tenantId,
    })
  })

  const runs = await listGenerationRunsForVersion(versionId)
  // Re-read: the sweep above filed a confirmation per undecided element, and FR-198's edit rate and
  // rejected share are shares *of the decisions on record*, so they have to count those too.
  const filed = await repo.listConfirmations(versionId)
  const measured = measureAuthoring({ ...scope.version, confirmedAt }, units, filed, runs)
  track(
    'package_confirmed',
    {
      package_id: scope.version.packageId,
      package_version_id: versionId,
      version: scope.version.version,
      seed_to_confirmed_ms: measured.seedToConfirmedMs ?? 0,
      edit_rate: measured.editRate,
      rejected_share: measured.rejectedShare,
      generation_passes: measured.generationPasses,
      generation_max_pass: measured.generationMaxPass,
      elements_count: measured.elementsCount,
      review_ms_total: measured.reviewMsTotal,
      review_ms_per_element: measured.reviewMsPerElement ?? 0,
      claims_count: scope.version.claims.length,
      documents_count: scope.version.documents.length,
    },
    { userId: actor.id, organizationId: tenantId },
  )

  const confirmed = await resolveVersion(actor, versionId)
  return buildVersionView(actor, confirmed)
}

// ---------------------------------------------------------------------------------------------
// regenerateVersion (FR-195, FR-199)
// ---------------------------------------------------------------------------------------------

/**
 * A new draft copied from this version (10 §4). Every element is copied with a new id — claims
 * included, which is what keeps the two versions' claim ids apart — so runs already taken against
 * the source keep the version they were taken on, exactly as FR-195 requires. The source is left
 * confirmed and usable; nothing about it changes.
 */
export async function regenerateVersion(
  actor: SessionUser,
  versionId: string,
  input: RegenerateVersionInput,
): Promise<CreatedPackageView> {
  const scope = await resolveVersion(actor, versionId)
  const tenantId = await requireAuthor(actor, scope.version.packageId)

  const siblings = await repo.listVersions(tenantId, scope.version.packageId)
  const nextVersion = Math.max(...siblings.map((row) => row.version), 0) + 1

  const copied = await repo.withTransaction(async (tx) => {
    const result = await repo.copyVersion(tenantId, versionId, { version: nextVersion }, tx)
    if (!result) return undefined
    // The reason a version was superseded is the only record of why the copy exists, so it commits
    // with the copy (08 §5) rather than being reconstructed from two timestamps later.
    await audit(tx, {
      actorId: actor.id,
      orgId: tenantId,
      action: 'package.regenerate',
      targetType: 'scenario_package_version',
      targetId: result.version.id,
      metadata: {
        packageId: scope.version.packageId,
        fromVersionId: versionId,
        fromVersion: scope.version.version,
        version: nextVersion,
        reason: input.reason,
      },
    })
    return result
  })
  if (!copied) notFound('package version')
  return { packageId: scope.version.packageId, versionId: copied.version.id }
}

// ---------------------------------------------------------------------------------------------
// importPackage and exportPackage (SYS-026)
// ---------------------------------------------------------------------------------------------

/**
 * Reads a package export into this institution (10 §4). Every reference in the document is an
 * element key, so the import is the place they become database ids: a key naming nothing is the
 * document's fault, not the reader's, and answers `IMPORT_INVALID` with the reference at fault.
 *
 * `confirmOnImport` is the fixture path (06 §5): it marks every element confirmed by the importing
 * actor, so the seed can go straight on to confirm the version. Because that is a claim about the
 * package being ready, an import that asks for it is refused when the package breaks a rule
 * (`PACKAGE_INVALID`, 07 §6); a plain import returns the rule report instead, which is what lets an
 * author bring in a half-finished package and finish it in the workspace.
 */
export async function importPackage(
  actor: SessionUser,
  orgId: string,
  document: unknown,
): Promise<ImportedPackageView> {
  // Importing — with `confirmOnImport`, which files a confirmation for every element in the actor's
  // name — is the author's act, the same seat `decideElement` and `confirmVersion` require (D-748).
  await requireVisibleMembership(actor, orgId, AUTHORING_ROLES)

  const parsed = ImportPackageSchema.safeParse(document)
  if (!parsed.success) importInvalid({ issues: parsed.error.issues })
  const input = parsed.data

  if (input.confirmOnImport) {
    // The package has to be valid before any of it is written: the refusal used to arrive after
    // the commit, leaving a draft package on the shelf and the family key taken, so the corrected
    // re-run answered CONFLICT about a fault that no longer existed.
    // Checked here as well as inside the transaction, and not redundantly: this reads the document,
    // so its failures name element keys the author can find (C3, D1) rather than uuids that do not
    // exist yet, and no row is written for a package that was never going to be accepted.
    const upfront = validateExport(tightened<PackageExport>(input))
    if (!upfront.ok) packageInvalid(upfront.failures)
  }

  const created = await writeImportedPackage(actor, orgId, input)
  const stored = await repo.findVersionFull(orgId, created.versionId)
  if (!stored) notFound('package version')

  const validation = toValidationResult(stored)
  if (input.confirmOnImport && !validation.ok) packageInvalid(validatePackage(stored).failures)

  return { ...created, validation }
}

type ImportContext = {
  documentIdByKey: Map<string, string>
  stakeholderIdByKey: Map<string, string>
  claimIdByKey: Map<string, string>
}

/** A key the document references but does not define. */
function requireKey(index: ReadonlyMap<string, string>, kind: string, key: string): string {
  const id = index.get(key)
  if (id === undefined) importInvalid({ reference: kind, key })
  return id
}

const optionalKey = (
  index: ReadonlyMap<string, string>,
  kind: string,
  key: string | null,
): string | null => (key === null ? null : requireKey(index, kind, key))

async function writeImportedPackage(
  actor: SessionUser,
  orgId: string,
  input: ReturnType<typeof ImportPackageSchema.parse>,
): Promise<CreatedPackageView> {
  // Ids for the three element kinds that are referenced by key, allocated before any insert so a
  // reference can be resolved in the same pass that writes the row holding it.
  const context: ImportContext = {
    documentIdByKey: new Map(input.documents.map((row) => [row.key, crypto.randomUUID()])),
    stakeholderIdByKey: new Map(input.stakeholders.map((row) => [row.key, crypto.randomUUID()])),
    claimIdByKey: new Map(input.claims.map((row) => [row.key, crypto.randomUUID()])),
  }

  try {
    return await repo.withTransaction(async (tx) => {
      const pkg = await repo.insertPackage(
        orgId,
        {
          title: input.package.title,
          familyKey: input.package.familyKey,
          discipline: input.package.discipline,
          createdBy: actor.id,
        },
        tx,
      )
      const version = await repo.insertVersion(
        orgId,
        {
          packageId: pkg.id,
          version: 1,
          status: 'draft',
          conceptSet: input.version.conceptSet,
          brief: input.version.brief,
          workingClockSeconds: input.version.workingClockSeconds,
          turnDelaySeconds: input.version.turnDelaySeconds,
          difficultyProfile: input.version.difficultyProfile,
          generalEscalationReply: input.version.generalEscalationReply,
          debriefCounterfactual: input.version.debriefCounterfactual,
        },
        tx,
      )

      const units = await writeImportedElements(orgId, version.id, input, context, tx)
      if (input.confirmOnImport) {
        // The document was validated before this transaction opened; this reads the rows it became
        // and validates those, so a write that lost something rolls back with everything else
        // rather than confirming a package the rows do not support.
        const stored = await repo.findVersionFull(orgId, version.id, tx)
        const written = stored ? validatePackage(stored) : null
        if (!written?.ok) packageInvalid(written?.failures ?? [])

        // 10 §4: the fixture path signs for every element as the importing actor.
        const at = new Date()
        for (const unit of units) {
          await repo.insertConfirmation(
            {
              packageVersionId: version.id,
              elementType: unit.elementType,
              elementId: unit.elementId,
              decision: 'confirmed',
              note: '',
              openedAt: at,
              decidedAt: at,
              decidedBy: actor.id,
            },
            tx,
          )
        }
      }
      return { packageId: pkg.id, versionId: version.id }
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError('CONFLICT', 'This institution already has a package with that family key.')
    }
    throw error
  }
}

/**
 * Writes every element of the document in reference order: a row is inserted only once the rows it
 * points at exist, because the foreign keys are checked per statement. Documents are the exception
 * — `superseded_by_document_id` points at another document — so they are written twice, first
 * without the reference and then with it.
 */
async function writeImportedElements(
  tenantId: string,
  versionId: string,
  input: ReturnType<typeof ImportPackageSchema.parse>,
  context: ImportContext,
  tx: repo.Tx,
): Promise<ElementUnit[]> {
  const units: ElementUnit[] = []
  const write = async (
    elementType: ElementTypeValue,
    row: repo.ElementInput[repo.ElementType],
  ): Promise<{ id: string }> => repo.upsertElement(tenantId, versionId, elementType, row, tx)

  units.push({ elementType: 'brief', elementId: null, key: 'brief' })
  const writtenDocumentKeys = new Set<string>()

  for (const row of input.stakeholders) {
    await write('stakeholder', {
      id: requireKey(context.stakeholderIdByKey, 'stakeholder', row.key),
      key: row.key,
      name: row.name,
      roleTitle: row.roleTitle,
      positionStatement: row.positionStatement,
      incentives: row.incentives,
      blindSpots: row.blindSpots,
      contradictsStakeholderId: optionalKey(
        context.stakeholderIdByKey,
        'stakeholder',
        row.contradictsStakeholderKey,
      ),
      contradictionPoint: row.contradictionPoint,
    })
    units.push({
      elementType: 'stakeholder',
      elementId: requireKey(context.stakeholderIdByKey, 'stakeholder', row.key),
      key: row.key,
    })
  }

  // `superseded_by_document_id` points at another document of the same version, and the two rules
  // that guard it pull against each other: the foreign key needs the successor row to exist, and
  // `scenario_documents_superseded_by_check` refuses to store a superseded document without one. So
  // the documents are written successor-first, in as many passes as the chain is deep. A pass that
  // writes nothing means the references form a cycle, which is the document's fault, not the
  // reader's — no ordering could satisfy it.
  const pendingDocuments = [...input.documents]
  while (pendingDocuments.length > 0) {
    const ready = pendingDocuments.filter(
      (row) => row.supersededByKey === null || writtenDocumentKeys.has(row.supersededByKey),
    )
    if (ready.length === 0) {
      importInvalid({ reference: 'document', cycle: pendingDocuments.map((row) => row.key) })
    }
    for (const row of ready) {
      await write('document', {
        id: requireKey(context.documentIdByKey, 'document', row.key),
        key: row.key,
        title: row.title,
        author: row.author,
        datedOn: row.datedOn,
        body: row.body,
        wordCount: countWords(row.body),
        role: row.role,
        supersededByDocumentId: optionalKey(
          context.documentIdByKey,
          'document',
          row.supersededByKey,
        ),
        stakeholderId: optionalKey(context.stakeholderIdByKey, 'stakeholder', row.stakeholderKey),
        position: row.position,
      })
      writtenDocumentKeys.add(row.key)
      units.push({
        elementType: 'document',
        elementId: requireKey(context.documentIdByKey, 'document', row.key),
        key: row.key,
      })
      pendingDocuments.splice(pendingDocuments.indexOf(row), 1)
    }
  }

  for (const row of input.answerSpacePositions) {
    const written = await write('answer_space_position', {
      key: row.key,
      kind: row.kind,
      summary: row.summary,
      supportingDocumentIds: row.supportingDocumentKeys.map((key) =>
        requireKey(context.documentIdByKey, 'document', key),
      ),
      ignoredEvidence: row.ignoredEvidence,
      isMinimumCommitment: row.isMinimumCommitment,
      position: row.position,
    })
    units.push({ elementType: 'answer_space_position', elementId: written.id, key: row.key })
  }

  for (const row of input.namedFields) {
    const written = await write('named_field', {
      key: row.key,
      label: row.label,
      unit: row.unit,
      position: row.position,
    })
    units.push({ elementType: 'named_field', elementId: written.id, key: row.key })
  }

  // 06 §3.3: a claim with a Source Trace path names the document the trace leads to. The export
  // holds the trace beside the claim's state, so the import is where the two meet and the column
  // can be filled — from the claim's own key when it has one, and from its trace when it does not.
  const tracedDocumentKeyByClaim = new Map<string, string>()
  for (const variant of input.variants) {
    for (const state of variant.claimStates) {
      const key = state.verificationPaths.source_trace?.document_key
      if (key && !tracedDocumentKeyByClaim.has(state.claimKey)) {
        tracedDocumentKeyByClaim.set(state.claimKey, key)
      }
    }
  }

  for (const row of input.claims) {
    const sourceKey = row.sourceDocumentKey ?? tracedDocumentKeyByClaim.get(row.key) ?? null
    await write('claim', {
      id: requireKey(context.claimIdByKey, 'claim', row.key),
      key: row.key,
      text: row.text,
      sourceKind: row.sourceKind,
      sourceDocumentId: optionalKey(context.documentIdByKey, 'document', sourceKey),
      sourcePassage: row.sourcePassage,
      importance: row.importance,
      consequenceLevel: row.consequenceLevel,
      verificationCost: row.verificationCost,
      weaklySourced: row.weaklySourced,
      volatile: row.volatile,
      conceptKey: row.conceptKey,
      carriedValues: tightened<CarriedValue[]>(row.carriedValues),
      triggerPhrases: row.triggerPhrases,
      triggerDescription: row.triggerDescription,
      escalatable: row.escalatable,
      escalationReply: row.escalationReply,
      rationale: row.rationale,
      position: row.position,
    })
    units.push({
      elementType: 'claim',
      elementId: requireKey(context.claimIdByKey, 'claim', row.key),
      key: row.key,
    })
  }

  const variants = await repo.insertVariants(
    versionId,
    input.variants.map((row) => ({ key: row.key, label: row.label })),
    tx,
  )
  const variantIdByKey = new Map(variants.map((row) => [row.key, row.id]))

  for (const variant of input.variants) {
    for (const state of variant.claimStates) {
      const trace = state.verificationPaths.source_trace
      const written = await write('variant_claim_state', {
        variantId: requireKey(variantIdByKey, 'variant', variant.key),
        claimId: requireKey(context.claimIdByKey, 'claim', state.claimKey),
        evidenceStatus: state.evidenceStatus,
        failureFamily: state.failureFamily,
        warrantedStance: state.warrantedStance,
        planted: state.planted,
        verificationPaths: {
          ...(trace
            ? {
                source_trace: {
                  document_id: requireKey(context.documentIdByKey, 'document', trace.document_key),
                  passage: trace.passage,
                  dated_on: trace.dated_on,
                  author: trace.author,
                },
              }
            : {}),
          ...(state.verificationPaths.replication_check
            ? { replication_check: state.verificationPaths.replication_check }
            : {}),
          ...(state.verificationPaths.decomposition_check
            ? { decomposition_check: state.verificationPaths.decomposition_check }
            : {}),
        },
      })
      units.push({
        elementType: 'variant_claim_state',
        elementId: written.id,
        key: `${variant.key}:${state.claimKey}`,
      })
    }
  }

  if (input.probe) {
    await write('probe', {
      claimId: requireKey(context.claimIdByKey, 'claim', input.probe.claimKey),
      originalPosition: input.probe.originalPosition,
      scriptedReversal: input.probe.scriptedReversal,
    })
    units.push({ elementType: 'probe', elementId: null, key: 'probe' })
  }

  if (input.turn) {
    await write('turn', {
      text: input.turn.text,
      voice: input.turn.voice,
      stakeholderId: optionalKey(
        context.stakeholderIdByKey,
        'stakeholder',
        input.turn.stakeholderKey,
      ),
      warrantsChange: input.turn.warrantsChange,
      proportionateResponse: input.turn.proportionateResponse,
      evidence: input.turn.evidence,
      disruptedAssumptionKeys: input.turn.disruptedAssumptionKeys,
      windowClaimIds: input.turn.windowClaimKeys.map((key) =>
        requireKey(context.claimIdByKey, 'claim', key),
      ),
    })
    units.push({ elementType: 'turn', elementId: null, key: 'turn' })
  }

  for (const row of input.defenseQuestions) {
    const written = await write('defense_question', {
      key: row.key,
      kind: row.kind,
      claimId: optionalKey(context.claimIdByKey, 'claim', row.claimKey),
      assumptionIndex: row.assumptionIndex,
      template: row.template,
      condition: row.condition,
      followUp: row.followUp,
      expectedAnswerNotes: row.expectedAnswerNotes,
      isDefault: row.isDefault,
      position: row.position,
    })
    units.push({ elementType: 'defense_question', elementId: written.id, key: row.key })
  }

  for (const row of input.readinessItems) {
    const written = await write('readiness_item', {
      key: row.key,
      category: row.category,
      conceptKey: row.conceptKey,
      stem: row.stem,
      options: row.options,
      answerKey: row.answerKey,
      position: row.position,
    })
    units.push({ elementType: 'readiness_item', elementId: written.id, key: row.key })
  }

  units.push({ elementType: 'counterfactual', elementId: null, key: 'counterfactual' })
  units.push({
    elementType: 'general_escalation_reply',
    elementId: null,
    key: 'general_escalation_reply',
  })
  units.push({ elementType: 'clock_and_difficulty', elementId: null, key: 'clock_and_difficulty' })

  if (input.seedRecord) {
    await repo.insertSeedRecord(
      versionId,
      {
        caseTitle: input.seedRecord.caseTitle,
        publisher: input.seedRecord.publisher,
        licenseTerms: input.seedRecord.licenseTerms,
        licensePermitsAdaptation: input.seedRecord.licensePermitsAdaptation,
        seedText: input.seedRecord.seedText,
        reskinLog: input.seedRecord.reskinLog,
      },
      tx,
    )
    units.push({ elementType: 'seed_reskin', elementId: null, key: 'seed_reskin' })
  }

  return units
}

/**
 * The package as one portable document (10 §4). A confirmed version answers with the snapshot it
 * was frozen with, which is the copy nothing can have changed since; a draft is built from its rows,
 * because it has no snapshot yet and will not have one until it is confirmed.
 */
export async function exportPackage(actor: SessionUser, versionId: string): Promise<PackageExport> {
  const scope = await resolveVersion(actor, versionId)
  await requireVisibleMembership(actor, scope.tenantId, PACKAGE_READER_ROLES, 'package version')

  const snapshot = scope.version.snapshot
  const document = (snapshot ? parseSnapshot(snapshot) : null) ?? buildExport(scope.version)
  // The same gate the version view applies (FR-028, D-748): an Instructor may take the package,
  // never the licensed case behind it. Withheld here rather than at the route, because the snapshot
  // path would otherwise hand back a record the row-built path had already been taught to hide.
  return isConfirmingAuthority(actor) ? document : { ...document, seedRecord: null }
}

/**
 * The stored snapshot, when it still parses as the current export format. A snapshot written under
 * an older one is rebuilt from the rows rather than refused: they are still the package, and the
 * reader asked for a document they can import.
 */
function parseSnapshot(snapshot: repo.PackageSnapshot): PackageExport | null {
  const parsed = ImportPackageSchema.omit({ confirmOnImport: true }).safeParse(snapshot)
  return parsed.success ? tightened<PackageExport>(parsed.data) : null
}

// ---------------------------------------------------------------------------------------------
// getStudentScenario (D-117)
// ---------------------------------------------------------------------------------------------

/**
 * What a student may read of the package their run is on: the brief, the documents as the Evidence
 * Room *lists* them, and the named fields the brief asks for. Nothing else — no roles, no word
 * counts, no stakeholders, no claims, no answer space, no seed record, no question bank (08 §4,
 * D-117).
 *
 * **The withholding is the query, not a projection over it (D-252).** `findRunScenario` names the
 * nine columns this view is made of, so the warranted stances, the evidence statuses, the failure
 * families, the verification paths, the question bank and the readiness answer keys are never
 * loaded — rather than loaded and then dropped here. That matters because this is the read behind
 * `GET /runs/{runId}/workspace`, which a student's screen polls for the whole working period: an
 * answer key that never enters the request cannot leave in a Sentry `extra` or a pino error field.
 * The runs repository states the same discipline one module along for `scenario_documents`.
 * `student-view.ts` holds the key sets the security test checks this answer — and the row behind
 * it — against.
 *
 * The bodies are not here, and that is a rule rather than an economy (D-243): every document open
 * is a trace event with a duration and a before-first-delegation flag (FR-022), so the body arrives
 * from `runs.openDocument`, which writes the event in the transaction that answers it. A room
 * delivered whole would make the reading segment of the clock timeline a record of clicks.
 */
export async function getStudentScenario(
  actor: SessionUser,
  runId: string,
): Promise<StudentScenarioView> {
  const run = await requireRunOwner(actor, runId)
  const scenario = await repo.findRunScenario(run.organizationId, runId)
  if (!scenario) notFound('run')
  return scenario
}

/**
 * Marks a confirmed package version as wanting its author's attention (FR-003, 10 §12).
 *
 * The seam `review.neutralizeClaim` reaches this module through, in the shape `trace.append` has:
 * the transaction and the ids, no actor, because the faculty seat's permission was proved by the
 * caller — a neutralization is an instructor's act on a *run*, and the version it flags belongs to
 * whoever authored it.
 *
 * Nothing about the version changes but these two columns. A neutralization says one claim of the
 * package misbehaved in one run; it does not retire the version, does not unconfirm it, and does
 * not stop the runs already taken under it from being read against it (NFR-004, D-137). What it
 * does is put the version in front of its author with the reason attached, which is what FR-003
 * asks for and the whole of what this writes.
 */
export async function flagVersionForReview(
  tx: repo.Tx,
  tenantId: string,
  versionId: string,
  reason: string,
  at: Date = new Date(),
): Promise<void> {
  await repo.flagVersionForReview(tenantId, versionId, { at, reason }, tx)
}
