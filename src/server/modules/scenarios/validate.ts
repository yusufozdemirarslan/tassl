// Module `scenarios` — `validatePackage` (docs/tech/10-backend-spec-modules.md §4, the rule table;
// PRD §7.18 (9) and (12), §7.2, §7.3, §7.10, §7.11, §7.14, §7.1; AI-005).
//
// The rule table is the authored standard a package is held to, and this file is the only place it
// exists as code. `confirmVersion` refuses on any failure (`PACKAGE_INVALID`), the confirmation
// workspace renders the failures inline against the elements they name, and the fixture test asserts
// the shipped package produces none.
//
// Three properties this file is built for and every rule must keep:
//
//   *Pure* — no database, no clock, no randomness, no `Date.now()`. The version arrives whole (the
//            shape `findVersionFull` returns) and the answer is a function of it alone, so the
//            validator runs identically over a stored version, over an imported document before a
//            row exists, and over a fixture in a unit test.
//   *Total* — every rule runs and every failure is reported. An author fixing a package needs the
//             whole list, not the first thing that broke; stopping early would cost them a round
//             trip per rule.
//   *Nameable* — a failure carries the rule code, the ids of the elements at fault, and a sentence
//                naming what is missing. Set-level rules ("the room needs six documents") name no
//                element because none is individually at fault.
//
// Messages are validator output, not UI copy: they travel on the wire inside `PACKAGE_INVALID`
// `details` and inside `PackageVersionView.validation`, the same way a Zod issue message does, so
// they stay in code rather than going through `t()`.
import { countSentences } from '@/lib/sentences'
import { countWords, stripMarkup } from '@/lib/words'
import { noItemNamesAClaim } from '@/server/modules/authoring/checks'
import {
  BRIEF_WORD_LIMIT,
  DOCUMENT_WORD_LIMIT,
  STANCES,
  TURN_DELAY_SECONDS_MAX,
  TURN_DELAY_SECONDS_MIN,
  VARIANT_KEYS,
  type ValidationFailure,
} from './schema'

// ---------------------------------------------------------------------------------------------
// Rule codes (10 §4, in table order — the order failures are reported in)
// ---------------------------------------------------------------------------------------------

export const VALIDATION_RULE_CODES = [
  'BRIEF_TOO_LONG',
  'DOCUMENT_COUNT',
  'DOCUMENT_TOO_LONG',
  'DOCUMENT_ROLES_MISSING',
  'STAKEHOLDER_NO_DOCUMENT',
  'STAKEHOLDER_NO_CONTRADICTION',
  'ANSWER_SPACE_SINGLE',
  'ANSWER_SPACE_NO_INCONSISTENT',
  'ANSWER_SPACE_NO_MINIMUM',
  'NAMED_FIELDS_MISSING',
  'CLAIMS_TOO_FEW',
  'CLAIM_STATE_MISSING',
  'DEFECTIVE_VARIANT_PLANT',
  'VARIANTS_DIFFER_BEYOND_PLANT',
  'PLANTED_PATH_MISSING',
  'DEFECT_OUTSIDE_CONCEPTS',
  'DEFECT_NOT_CONSEQUENTIAL',
  'NO_STANCE_CHANGING_TRACE',
  'NO_ESCALATABLE_CLAIM',
  'NO_LOW_STAKES_SOUND',
  'NO_ACCEPT_WARRANTED_SOUND',
  'WARRANTED_STANCE_UNSET',
  'TURN_MISSING',
  'TURN_DELAY',
  'QUESTION_BANK_INCOMPLETE',
  'COUNTERFACTUAL_SENTENCES',
  'READINESS_SPLIT',
  'CLAIM_CONCEPT_UNKNOWN',
  'GENERAL_REPLY_MISSING',
  'RESKIN_LOG_EMPTY',
] as const

export type ValidationRuleCode = (typeof VALIDATION_RULE_CODES)[number]

/**
 * One failed rule. It is a `ValidationFailure` (`schema.ts`) with the code narrowed to the table,
 * so the result travels on the wire — inside `PACKAGE_INVALID` details and inside
 * `PackageVersionView.validation` — without a conversion, and a typo in a rule code is a build
 * error rather than a string nobody matches.
 */
export type PackageValidationFailure = ValidationFailure & { code: ValidationRuleCode }

/**
 * The result, spelled out rather than intersected with `ValidationResult`: an intersection of two
 * array types resolves `find` and `map` against the wider signature, which would lose the narrow
 * code at every call site. The test file pins that this is still assignable to `ValidationResult`.
 */
export type PackageValidationResult = { ok: boolean; failures: PackageValidationFailure[] }

// ---------------------------------------------------------------------------------------------
// Thresholds (every number the table names, once, where an author can find it)
// ---------------------------------------------------------------------------------------------

/** PRD §7.2 / §7.18 (4): the Evidence Room holds 6 to 12 documents. */
export const DOCUMENT_COUNT_MIN = 6
export const DOCUMENT_COUNT_MAX = 12

/** PRD §7.18 (6): at least two defensible positions, and exactly one minimum commitment (§7.10). */
export const DEFENSIBLE_POSITIONS_MIN = 2
export const MINIMUM_COMMITMENT_COUNT = 1

/** PRD §7.10: the Decision Brief needs at least one named numeric field. */
export const NAMED_FIELDS_MIN = 1

/** PRD §7.18 (9): "both carry at least six consequential claims". */
export const CLAIMS_MIN = 6

/** PRD §7.18 (9): at least two sound claims low enough that a Challenge on them is a false alarm. */
export const LOW_STAKES_SOUND_CLAIMS_MIN = 2

/** PRD §12 step 16: at least one sound consequential claim whose warranted stance is Accept. */
export const ACCEPT_WARRANTED_SOUND_CLAIMS_MIN = 1

/**
 * The planted defect's acceptable verification path is a Source Trace, except where the defect is
 * arithmetic or methodological: those are caught by redoing the work, not by reading the source.
 */
export const REPLICATION_CHECK_FAMILIES = ['uncomputed_number', 'misapplied_method'] as const

/** PRD §7.12: the frame carries three assumptions, so the bank carries an item for each (0–2). */
export const FRAME_ASSUMPTION_INDEXES = [0, 1, 2] as const

/** PRD §7.18 (12): the default set must cover a run that selects too few questions (six to nine). */
export const DEFAULT_QUESTIONS_MIN = 6

/** D-135 / FR-025: one `{figure}` question for a named-field value that matches nothing. */
export const FIGURE_PROVENANCE_QUESTIONS_MIN = 1
export const FIGURE_PLACEHOLDER = '{figure}'

/** PRD §7.14: the debrief counterfactual is three sentences. */
export const COUNTERFACTUAL_SENTENCE_COUNT = 3

/** PRD §7.1 / §7.18 (14): 16 keyed items, six on foundations, four on the defect concepts, six on AI. */
export const READINESS_ITEM_COUNTS = {
  foundation: 6,
  defect_concept: 4,
  ai_behavior: 6,
} as const satisfies Record<string, number>

export const READINESS_ITEM_TOTAL = 16
export const READINESS_OPTION_COUNT = 4

/** PRD §7.18 (1): the re-skin log records each renamed entity, altered number, restructured document. */
export const RESKIN_LOG_MIN_ENTRIES = 3
export const RESKIN_KINDS_REQUIRED = [
  'renamed_entity',
  'altered_number',
  'restructured_document',
] as const

// ---------------------------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------------------------
//
// The validator reads a structural view of the version rather than the repository's `VersionFull`
// directly: `validate.ts` is an internal module file and may not import the repository (it holds
// the database handle), and a structural type is what lets the importer validate a document before
// any row exists. Every field a rule reads is here and nothing else. Enum-valued columns are widened
// to `string` on purpose — `WARRANTED_STANCE_UNSET` and `READINESS_SPLIT` exist precisely to catch a
// value the database column would have refused, and a narrowed type would make those rules
// unreachable. `tests/unit/scenarios/validate.test.ts` pins that `VersionFull` still assigns here.

export type ValidatedDocument = {
  id: string
  key: string
  body: string
  role: string
  /** ISO `YYYY-MM-DD`, so lexicographic order is chronological order. */
  datedOn: string
  supersededByDocumentId: string | null
  stakeholderId: string | null
}

export type ValidatedStakeholder = {
  id: string
  key: string
  contradictsStakeholderId: string | null
  contradictionPoint: string | null
}

export type ValidatedAnswerSpacePosition = {
  id: string
  key: string
  kind: string
  ignoredEvidence: string | null
  isMinimumCommitment: boolean
}

export type ValidatedNamedField = { key: string }

export type ValidatedClaim = {
  id: string
  key: string
  text: string
  importance: string
  consequenceLevel: string
  conceptKey: string
  weaklySourced: boolean
  volatile: boolean
  escalatable: boolean
  escalationReply: string | null
}

export type ValidatedVerificationPaths = {
  source_trace?: { document_id: string; passage: string; dated_on: string; author: string }
  replication_check?: { result: string }
  decomposition_check?: { steps: Array<{ label: string; result: string }> }
}

export type ValidatedClaimState = {
  id: string
  claimId: string
  evidenceStatus: string
  failureFamily: string | null
  warrantedStance: string
  verificationPaths: ValidatedVerificationPaths
  planted: boolean
}

export type ValidatedVariant = { key: string; claimStates: readonly ValidatedClaimState[] }

export type ValidatedTurn = { id: string }

export type ValidatedDefenseQuestion = {
  kind: string
  claimId: string | null
  assumptionIndex: number | null
  template: string
}

export type ValidatedReadinessItem = {
  id: string
  key: string
  category: string
  stem: string
  options: readonly { key: string; text: string }[]
  answerKey: string
}

export type ValidatedSeedRecord = { reskinLog: readonly { kind: string }[] }

/** The whole version, as every rule of the table reads it. `VersionFull` satisfies this. */
export type ValidatedVersion = {
  conceptSet: readonly string[]
  brief: string
  turnDelaySeconds: number
  generalEscalationReply: string
  debriefCounterfactual: string
  seedRecord?: ValidatedSeedRecord | null
  documents: readonly ValidatedDocument[]
  stakeholders: readonly ValidatedStakeholder[]
  answerSpacePositions: readonly ValidatedAnswerSpacePosition[]
  namedFields: readonly ValidatedNamedField[]
  claims: readonly ValidatedClaim[]
  variants: readonly ValidatedVariant[]
  turn?: ValidatedTurn | null
  defenseQuestions: readonly ValidatedDefenseQuestion[]
  readinessItems: readonly ValidatedReadinessItem[]
}

// ---------------------------------------------------------------------------------------------
// Derived context (computed once, read by many rules)
// ---------------------------------------------------------------------------------------------

type PlantedDefect = { claim: ValidatedClaim; state: ValidatedClaimState }

type Context = {
  version: ValidatedVersion
  documentById: ReadonlyMap<string, ValidatedDocument>
  stakeholderIds: ReadonlySet<string>
  claimById: ReadonlyMap<string, ValidatedClaim>
  variantByKey: ReadonlyMap<string, ValidatedVariant>
  /** Every state of a claim, across both variants; empty when the claim has none. */
  statesByClaimId: ReadonlyMap<string, readonly ValidatedClaimState[]>
  /**
   * The one planted defective claim of the defective variant, when there is exactly one and it
   * names a claim this version holds. The three `DEFECT_*` rules are questions about that claim,
   * so when it is absent or ambiguous they stay silent and `DEFECTIVE_VARIANT_PLANT` carries the
   * whole report — one broken plant should not produce four failures the author cannot tell apart.
   *
   * `plant` is the single resolution both sides read. The rule reports exactly the faults that
   * made this undefined, so "the plant is broken" and "the defect rules are silent" are one
   * condition rather than two counts that can drift apart.
   */
  planted: PlantedDefect | undefined
  plant: PlantAudit
}

/**
 * What the two variants say about the plant, in one place.
 *
 * A package's variants are one scenario with a single difference: PRD §12 and §7.18 (9) define the
 * defective variant as carrying one consequential planted defect and the sound one as carrying
 * none. Everything downstream keys on `planted` — the three `DEFECT_*` rules here, the debrief's
 * missed defects, the Verification band — so a flag left on a state nobody scored is not cosmetic:
 * it manufactures a defect the student could never have found.
 */
type PlantAudit = {
  /** Set only when exactly one planted defective state names a claim this version holds. */
  resolved: PlantedDefect | undefined
  /** One sentence per fault, in reading order; empty when the plant is well formed. */
  faults: readonly string[]
  /** The claim each fault points at, or the state itself when it names no claim. */
  elementIds: readonly string[]
}

function auditPlant(
  variantByKey: ReadonlyMap<string, ValidatedVariant>,
  claimById: ReadonlyMap<string, ValidatedClaim>,
): PlantAudit {
  const defective = variantByKey.get('defective')
  const sound = variantByKey.get('sound')

  if (defective === undefined) {
    return {
      resolved: undefined,
      faults: [
        'The package has no defective variant; it must carry exactly one planted defective claim.',
      ],
      elementIds: [],
    }
  }

  const faults: string[] = []
  const elementIds: string[] = []
  const nameOf = (state: ValidatedClaimState): string =>
    claimById.get(state.claimId)?.key ?? `an unknown claim (${state.claimId})`
  const named = (states: readonly ValidatedClaimState[]): string => joinList(states.map(nameOf))

  // A state naming no claim of this version: the row can exist, because the foreign key only asks
  // that the claim exist somewhere. Unreported, such a state satisfied the count while resolving to
  // nothing, which let a package with no real defect validate clean.
  const orphaned = [...defective.claimStates, ...(sound?.claimStates ?? [])].filter(
    (state) => !claimById.has(state.claimId),
  )
  if (orphaned.length > 0) {
    faults.push(
      `${plural(orphaned.length, 'claim state')} name${orphaned.length === 1 ? 's' : ''} no claim in this version; every state belongs to one of its claims.`,
    )
    elementIds.push(...orphaned.map((state) => state.id))
  }

  const plantedDefective = defective.claimStates.filter(
    (state) =>
      state.planted && state.evidenceStatus === 'defective' && claimById.has(state.claimId),
  )
  const plantedNotDefective = defective.claimStates.filter(
    (state) => state.planted && state.evidenceStatus !== 'defective',
  )
  const defectiveInSound = (sound?.claimStates ?? []).filter(
    (state) => state.evidenceStatus === 'defective',
  )
  const plantedInSound = (sound?.claimStates ?? []).filter((state) => state.planted)

  if (plantedDefective.length === 0) {
    faults.push(
      plantedNotDefective.length > 0
        ? `The defective variant marks ${named(plantedNotDefective)} planted but not defective; the planted claim must be defective.`
        : 'The defective variant plants no defective claim; exactly one claim must be planted and defective.',
    )
    elementIds.push(...plantedNotDefective.map((state) => state.claimId))
  } else if (plantedDefective.length > 1) {
    faults.push(
      `The defective variant plants ${plural(plantedDefective.length, 'defective claim')} (${named(plantedDefective)}); exactly one must be planted.`,
    )
    elementIds.push(...plantedDefective.map((state) => state.claimId))
  } else if (plantedNotDefective.length > 0) {
    // The real plant is fine, but a second flag is still a defect nobody can find.
    faults.push(
      `The defective variant also marks ${named(plantedNotDefective)} planted without a defect; only the planted defective claim carries the flag.`,
    )
    elementIds.push(...plantedNotDefective.map((state) => state.claimId))
  }

  if (defectiveInSound.length > 0) {
    faults.push(
      `The sound variant marks ${named(defectiveInSound)} defective; the sound variant carries no defect.`,
    )
    elementIds.push(...defectiveInSound.map((state) => state.claimId))
  }
  if (plantedInSound.length > 0) {
    faults.push(
      `The sound variant marks ${named(plantedInSound)} planted; nothing is planted in the sound variant.`,
    )
    elementIds.push(...plantedInSound.map((state) => state.claimId))
  }

  const only = plantedDefective.length === 1 ? plantedDefective[0] : undefined
  const claim = only ? claimById.get(only.claimId) : undefined
  return {
    resolved:
      faults.length === 0 && only !== undefined && claim !== undefined
        ? { claim, state: only }
        : undefined,
    faults,
    elementIds: [...new Set(elementIds)],
  }
}

function buildContext(version: ValidatedVersion): Context {
  const documentById = new Map(version.documents.map((document) => [document.id, document]))
  const claimById = new Map(version.claims.map((claim) => [claim.id, claim]))
  const variantByKey = new Map(version.variants.map((variant) => [variant.key, variant]))

  const statesByClaimId = new Map<string, ValidatedClaimState[]>()
  for (const variant of version.variants) {
    for (const state of variant.claimStates) {
      const states = statesByClaimId.get(state.claimId)
      if (states) states.push(state)
      else statesByClaimId.set(state.claimId, [state])
    }
  }

  const plant = auditPlant(variantByKey, claimById)

  return {
    version,
    documentById,
    stakeholderIds: new Set(version.stakeholders.map((stakeholder) => stakeholder.id)),
    claimById,
    variantByKey,
    statesByClaimId,
    planted: plant.resolved,
    plant,
  }
}

/** The state of `claim` in the variant `variantKey`, or undefined when the package has none. */
function stateIn(
  context: Context,
  variantKey: string,
  claimId: string,
): ValidatedClaimState | undefined {
  return context.variantByKey
    .get(variantKey)
    ?.claimStates.find((state) => state.claimId === claimId)
}

/** The claim's state in each variant, in `VARIANT_KEYS` order; undefined entries are missing states. */
function statesAcrossVariants(
  context: Context,
  claimId: string,
): (ValidatedClaimState | undefined)[] {
  return VARIANT_KEYS.map((key) => stateIn(context, key, claimId))
}

/** True when the claim is authored sound in both variants — the precondition of two claim-mix rules. */
function isSoundInBothVariants(context: Context, claimId: string): boolean {
  const states = statesAcrossVariants(context, claimId)
  return states.every((state) => state !== undefined && state.evidenceStatus === 'sound')
}

// ---------------------------------------------------------------------------------------------
// Message helpers
// ---------------------------------------------------------------------------------------------

/** `A`, `A and B`, `A, B and C` — a list a reader can read aloud. */
function joinList(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

function keysOf(elements: readonly { key: string }[]): string {
  return joinList(elements.map((element) => element.key))
}

function plural(count: number, singular: string, many = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : many}`
}

function idsOf(elements: readonly { id: string }[]): string[] {
  return elements.map((element) => element.id)
}

// ---------------------------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------------------------

/** What a rule returns when it fails; `elementIds` is empty when no single element is at fault. */
type RuleFailure = { elementIds?: string[]; message: string }

type Rule = { code: ValidationRuleCode; check: (context: Context) => RuleFailure | null }

const RULES: readonly Rule[] = [
  {
    // 10 §4: brief ≤ 200 words and non-empty (PRD §7.2).
    code: 'BRIEF_TOO_LONG',
    check: ({ version }) => {
      const words = countWords(stripMarkup(version.brief))
      if (words === 0) {
        return {
          message: `The scenario brief is empty; it must be 1 to ${BRIEF_WORD_LIMIT} words.`,
        }
      }
      if (words > BRIEF_WORD_LIMIT) {
        return {
          message: `The scenario brief is ${plural(words, 'word')}; the limit is ${BRIEF_WORD_LIMIT} words.`,
        }
      }
      return null
    },
  },
  {
    // 10 §4: 6 ≤ documents ≤ 12 (PRD §7.2).
    code: 'DOCUMENT_COUNT',
    check: ({ version }) => {
      const count = version.documents.length
      if (count >= DOCUMENT_COUNT_MIN && count <= DOCUMENT_COUNT_MAX) return null
      return {
        message: `The Evidence Room holds ${plural(count, 'document')}; it must hold between ${DOCUMENT_COUNT_MIN} and ${DOCUMENT_COUNT_MAX}.`,
      }
    },
  },
  {
    // 10 §4: each document body ≤ 2000 words (D-081, "at most four pages").
    code: 'DOCUMENT_TOO_LONG',
    check: ({ version }) => {
      const overLimit = version.documents.filter(
        (document) => countWords(stripMarkup(document.body)) > DOCUMENT_WORD_LIMIT,
      )
      if (overLimit.length === 0) return null
      return {
        elementIds: idsOf(overLimit),
        message: `${overLimit.length === 1 ? 'Document' : 'Documents'} ${keysOf(overLimit)} exceed${overLimit.length === 1 ? 's' : ''} the ${DOCUMENT_WORD_LIMIT}-word limit; shorten the ${overLimit.length === 1 ? 'body' : 'bodies'}.`,
      }
    },
  },
  {
    // 10 §4: ≥ 1 superseded (naming a document in the room with a later date), ≥ 1 interpretation
    // presented as fact, ≥ 1 accurate and irrelevant (PRD §7.2, §7.18 (4)).
    code: 'DOCUMENT_ROLES_MISSING',
    check: ({ version, documentById }) => {
      const superseded = version.documents.filter((document) => document.role === 'superseded')
      const brokenSupersession = superseded.filter((document) => {
        const later =
          document.supersededByDocumentId === null
            ? undefined
            : documentById.get(document.supersededByDocumentId)
        // Dates are ISO `YYYY-MM-DD`, so a string comparison is a date comparison.
        return later === undefined || later.datedOn <= document.datedOn
      })
      const hasValidSupersession = superseded.length > brokenSupersession.length

      const missing: string[] = []
      if (!hasValidSupersession) {
        missing.push('a superseded document named by a later document in the room')
      }
      if (!version.documents.some((document) => document.role === 'interpretation_as_fact')) {
        missing.push('an interpretation presented as fact')
      }
      if (!version.documents.some((document) => document.role === 'irrelevant')) {
        missing.push('an accurate and irrelevant document')
      }
      if (missing.length === 0) return null

      const sentences = [`The Evidence Room is missing ${joinList(missing)}.`]
      if (brokenSupersession.length > 0) {
        sentences.push(
          `${brokenSupersession.length === 1 ? 'Document' : 'Documents'} ${keysOf(brokenSupersession)} ${brokenSupersession.length === 1 ? 'is' : 'are'} marked superseded but name${brokenSupersession.length === 1 ? 's' : ''} no later document in the room.`,
        )
      }
      return { elementIds: idsOf(brokenSupersession), message: sentences.join(' ') }
    },
  },
  {
    // 10 §4: every stakeholder has ≥ 1 document (PRD §7.3, §7.18 (5)).
    code: 'STAKEHOLDER_NO_DOCUMENT',
    check: ({ version }) => {
      const documented = new Set(
        version.documents
          .map((document) => document.stakeholderId)
          .filter((id): id is string => id !== null),
      )
      const undocumented = version.stakeholders.filter(
        (stakeholder) => !documented.has(stakeholder.id),
      )
      if (undocumented.length === 0) return null
      return {
        elementIds: idsOf(undocumented),
        message: `${undocumented.length === 1 ? 'Stakeholder' : 'Stakeholders'} ${keysOf(undocumented)} ${undocumented.length === 1 ? 'has' : 'have'} no document in the Evidence Room; every stakeholder needs at least one.`,
      }
    },
  },
  {
    // 10 §4: at least one pair with `contradicts_stakeholder_id` and a `contradiction_point`
    // (PRD §7.3: "the point on which two contradict").
    code: 'STAKEHOLDER_NO_CONTRADICTION',
    check: ({ version, stakeholderIds }) => {
      const contradicts = version.stakeholders.some(
        (stakeholder) =>
          stakeholder.contradictsStakeholderId !== null &&
          stakeholder.contradictsStakeholderId !== stakeholder.id &&
          stakeholderIds.has(stakeholder.contradictsStakeholderId) &&
          stripMarkup(stakeholder.contradictionPoint ?? '') !== '',
      )
      if (contradicts) return null
      return {
        message:
          'No two stakeholders contradict each other; one stakeholder must name another and the point they disagree on.',
      }
    },
  },
  {
    // 10 §4: ≥ 2 defensible positions (PRD §7.18 Rules: one-answer scenarios are rejected).
    code: 'ANSWER_SPACE_SINGLE',
    check: ({ version }) => {
      const defensible = version.answerSpacePositions.filter(
        (position) => position.kind === 'defensible',
      )
      if (defensible.length >= DEFENSIBLE_POSITIONS_MIN) return null
      return {
        message: `The answer space has ${plural(defensible.length, 'defensible position')}; it needs at least ${DEFENSIBLE_POSITIONS_MIN}.`,
      }
    },
  },
  {
    // 10 §4: ≥ 1 `evidence_inconsistent` position with `ignored_evidence` (PRD §7.18 (6)).
    code: 'ANSWER_SPACE_NO_INCONSISTENT',
    check: ({ version }) => {
      const inconsistent = version.answerSpacePositions.filter(
        (position) => position.kind === 'evidence_inconsistent',
      )
      const complete = inconsistent.filter(
        (position) => stripMarkup(position.ignoredEvidence ?? '') !== '',
      )
      if (complete.length > 0) return null

      const incomplete = inconsistent.filter((position) => !complete.includes(position))
      if (incomplete.length > 0) {
        return {
          elementIds: idsOf(incomplete),
          message: `${incomplete.length === 1 ? 'Position' : 'Positions'} ${keysOf(incomplete)} ${incomplete.length === 1 ? 'is' : 'are'} evidence-inconsistent but name${incomplete.length === 1 ? 's' : ''} no ignored evidence.`,
        }
      }
      return {
        message:
          'The answer space has no evidence-inconsistent position; add one and name the evidence it ignores.',
      }
    },
  },
  {
    // 10 §4: exactly one position `is_minimum_commitment` (PRD §7.10).
    code: 'ANSWER_SPACE_NO_MINIMUM',
    check: ({ version }) => {
      const minimum = version.answerSpacePositions.filter(
        (position) => position.isMinimumCommitment,
      )
      if (minimum.length === MINIMUM_COMMITMENT_COUNT) return null
      if (minimum.length === 0) {
        return {
          message:
            'No answer-space position is marked the minimum defensible commitment; exactly one must be.',
        }
      }
      return {
        elementIds: idsOf(minimum),
        message: `Positions ${keysOf(minimum)} are all marked the minimum defensible commitment; exactly one must be.`,
      }
    },
  },
  {
    // 10 §4: ≥ 1 named field (PRD §7.10, the named numeric fields of the Decision Brief).
    code: 'NAMED_FIELDS_MISSING',
    check: ({ version }) => {
      if (version.namedFields.length >= NAMED_FIELDS_MIN) return null
      return {
        message:
          'The Decision Brief has no named numeric field; add at least one field the student must fill in.',
      }
    },
  },
  {
    // 10 §4: ≥ 6 consequential claims (PRD §7.18 (9)).
    code: 'CLAIMS_TOO_FEW',
    check: ({ version }) => {
      if (version.claims.length >= CLAIMS_MIN) return null
      return {
        message: `The package has ${plural(version.claims.length, 'consequential claim')}; it needs at least ${CLAIMS_MIN}.`,
      }
    },
  },
  {
    // 10 §4: every claim has a state in both variants (PRD §7.18 (9): the variants share the ids).
    code: 'CLAIM_STATE_MISSING',
    check: (context) => {
      const { version, variantByKey } = context
      const missingVariants = VARIANT_KEYS.filter((key) => !variantByKey.has(key))
      const incompleteClaims = version.claims.filter((claim) =>
        VARIANT_KEYS.some(
          (key) => variantByKey.has(key) && stateIn(context, key, claim.id) === undefined,
        ),
      )
      if (missingVariants.length === 0 && incompleteClaims.length === 0) return null

      const sentences: string[] = []
      if (missingVariants.length > 0) {
        sentences.push(
          `The package has no ${joinList(missingVariants.map((key) => `${key} variant`))}; every claim needs a state in both variants.`,
        )
      }
      if (incompleteClaims.length > 0) {
        sentences.push(
          `${incompleteClaims.length === 1 ? 'Claim' : 'Claims'} ${keysOf(incompleteClaims)} ${incompleteClaims.length === 1 ? 'has' : 'have'} no state in one of the variants.`,
        )
      }
      return { elementIds: idsOf(incompleteClaims), message: sentences.join(' ') }
    },
  },
  {
    // 10 §4: the defective variant has exactly one `planted` defective claim; the sound variant has
    // none defective (PRD §12: the two variants differ only in the planted claim).
    code: 'DEFECTIVE_VARIANT_PLANT',
    check: ({ plant }) =>
      plant.faults.length === 0
        ? null
        : { elementIds: [...plant.elementIds], message: plant.faults.join(' ') },
  },
  {
    // PRD §7.18 (9) and §12: the two variants are one scenario and "differ only in the evidence
    // status and verification results of the planted claim". Nothing in the table said so, and
    // without it a defective variant could carry three defective claims (one planted) while every
    // rule stayed silent — which breaks the scored core the two variants are supposed to share and
    // skews the Verification band for whoever drew that variant (D-203).
    //
    // Verification paths are deliberately not compared: the planted claim's paths differ by design,
    // and a sound claim's paths are authored per variant, so a diff there is noise rather than a
    // finding. The four scalar fields are what scoring reads.
    code: 'VARIANTS_DIFFER_BEYOND_PLANT',
    check: ({ version, variantByKey, plant }) => {
      const defective = variantByKey.get('defective')
      const sound = variantByKey.get('sound')
      if (!defective || !sound) return null // DEFECTIVE_VARIANT_PLANT / CLAIM_STATE_MISSING report this
      // A broken plant already has its report, and every claim would look like a difference next to
      // it; this rule speaks only once the plant is well formed and other claims still disagree.
      if (plant.faults.length > 0) return null

      const plantedClaimId = plant.resolved?.claim.id
      const offenders: string[] = []
      const sentences: string[] = []

      for (const claim of version.claims) {
        if (claim.id === plantedClaimId) continue
        const here = defective.claimStates.find((state) => state.claimId === claim.id)
        const there = sound.claimStates.find((state) => state.claimId === claim.id)
        if (!here || !there) continue // CLAIM_STATE_MISSING owns the missing-state report

        const differences: string[] = []
        if (here.evidenceStatus !== there.evidenceStatus) differences.push('evidence status')
        if (here.failureFamily !== there.failureFamily) differences.push('failure family')
        // A stance that is missing on one side is WARRANTED_STANCE_UNSET, not a difference between
        // the variants; reporting it twice would send the author looking for two problems.
        if (
          here.warrantedStance !== there.warrantedStance &&
          here.warrantedStance !== '' &&
          there.warrantedStance !== ''
        ) {
          differences.push('warranted stance')
        }
        if (here.planted !== there.planted) differences.push('planted flag')
        if (differences.length === 0) continue

        offenders.push(claim.id)
        sentences.push(`${claim.key} differs between the variants in its ${joinList(differences)}.`)
      }

      if (offenders.length === 0) return null
      return {
        elementIds: offenders,
        message: `${sentences.join(' ')} The two variants are the same scenario apart from the planted claim, so every other claim carries the same state in both.`,
      }
    },
  },
  {
    // 10 §4: the planted claim has a `source_trace` path, or a `replication_check` when its failure
    // family is `uncomputed_number` or `misapplied_method` (PRD §12: the defect must be catchable).
    code: 'PLANTED_PATH_MISSING',
    check: ({ planted, documentById }) => {
      if (!planted) return null
      const paths = planted.state.verificationPaths
      const replicable = REPLICATION_CHECK_FAMILIES.some(
        (family) => family === planted.state.failureFamily,
      )
      // The path has to be walkable, not merely present: a Source Trace whose document is not in
      // the Evidence Room renders nothing, and the defect becomes uncatchable in exactly the way
      // this rule exists to prevent. `verificationPaths` is jsonb, so an imported document can
      // carry null or a stale id here and no column would refuse it.
      const trace = paths.source_trace
      const traceDocument = trace ? documentById.get(trace.document_id) : undefined
      if (trace && traceDocument) return null
      if (replicable && paths.replication_check) return null

      if (trace && !traceDocument) {
        return {
          elementIds: [planted.claim.id],
          message: `The Source Trace on the planted claim ${planted.claim.key} points at a document that is not in the Evidence Room; the student must be able to open what the trace names.`,
        }
      }
      return {
        elementIds: [planted.claim.id],
        message: replicable
          ? `The planted claim ${planted.claim.key} has neither a Source Trace nor a Replication Check path; a defect in the ${planted.state.failureFamily} family needs one of them.`
          : `The planted claim ${planted.claim.key} has no Source Trace path; the student must be able to catch the defect.`,
      }
    },
  },
  {
    // 10 §4: the planted claim's `concept_key` ∈ `concept_set` (PRD §7.18 Rules: a defect that
    // depends on knowledge outside the declared concept set is rejected).
    code: 'DEFECT_OUTSIDE_CONCEPTS',
    check: ({ planted, version }) => {
      if (!planted) return null
      if (version.conceptSet.includes(planted.claim.conceptKey)) return null
      return {
        elementIds: [planted.claim.id],
        message: `The planted claim ${planted.claim.key} needs the concept "${planted.claim.conceptKey}", which is not in the declared concept set; a defect may not depend on knowledge outside it.`,
      }
    },
  },
  {
    // 10 §4: the planted claim is `load_bearing` with `consequence_level ≠ low` (PRD §7.18 Rules:
    // a defect that does not change the decision is rejected).
    code: 'DEFECT_NOT_CONSEQUENTIAL',
    check: ({ planted }) => {
      if (!planted) return null
      const loadBearing = planted.claim.importance === 'load_bearing'
      const consequential = planted.claim.consequenceLevel !== 'low'
      if (loadBearing && consequential) return null

      const faults: string[] = []
      if (!loadBearing) faults.push('is not load-bearing')
      if (!consequential) faults.push('has low consequence')
      return {
        elementIds: [planted.claim.id],
        message: `The planted claim ${planted.claim.key} ${joinList(faults)}; a planted defect must change the decision.`,
      }
    },
  },
  {
    // 10 §4: ≥ 1 non-planted claim with a `source_trace` path and `weakly_sourced` or `volatile`
    // (PRD §7.18 (9): "a claim whose Source Trace result would change a reasonable stance").
    code: 'NO_STANCE_CHANGING_TRACE',
    check: ({ version, statesByClaimId }) => {
      const found = version.claims.some((claim) => {
        const states = statesByClaimId.get(claim.id) ?? []
        // "Non-planted" is read off the states themselves, not off the resolved plant: when the
        // plant is broken the resolution is undefined, and comparing against it would quietly let
        // the planted claim satisfy a rule that exists to guarantee a second one.
        if (states.some((state) => state.planted)) return false
        if (!claim.weaklySourced && !claim.volatile) return false
        return states.some((state) => state.verificationPaths.source_trace !== undefined)
      })
      if (found) return null
      return {
        message:
          'No claim outside the plant carries a Source Trace that would change a stance; mark a claim weakly sourced or volatile and give it a Source Trace path.',
      }
    },
  },
  {
    // 10 §4: ≥ 1 claim `escalatable` with a reply (PRD §7.9, §7.18 (9)).
    code: 'NO_ESCALATABLE_CLAIM',
    check: ({ version }) => {
      const escalatable = version.claims.filter((claim) => claim.escalatable)
      const withReply = escalatable.filter(
        (claim) => stripMarkup(claim.escalationReply ?? '') !== '',
      )
      if (withReply.length > 0) return null
      if (escalatable.length > 0) {
        return {
          elementIds: idsOf(escalatable),
          message: `${escalatable.length === 1 ? 'Claim' : 'Claims'} ${keysOf(escalatable)} ${escalatable.length === 1 ? 'is' : 'are'} escalatable but ${escalatable.length === 1 ? 'has' : 'have'} no authored colleague reply.`,
        }
      }
      return {
        message:
          'No claim is escalatable; at least one claim needs an authored colleague reply for an escalation.',
      }
    },
  },
  {
    // 10 §4: ≥ 2 claims sound in both variants with `consequence_level = low` and a warranted
    // `accept` or `verify` (PRD §7.18 (9): a Challenge on them counts as a false challenge).
    code: 'NO_LOW_STAKES_SOUND',
    check: (context) => {
      const lowStakes = context.version.claims.filter((claim) => {
        if (claim.consequenceLevel !== 'low') return false
        if (!isSoundInBothVariants(context, claim.id)) return false
        return statesAcrossVariants(context, claim.id).every(
          (state) =>
            state !== undefined &&
            (state.warrantedStance === 'accept' || state.warrantedStance === 'verify'),
        )
      })
      if (lowStakes.length >= LOW_STAKES_SOUND_CLAIMS_MIN) return null
      return {
        message: `The package has ${plural(lowStakes.length, 'low-stakes sound claim')} warranting Accept or Verify; it needs at least ${LOW_STAKES_SOUND_CLAIMS_MIN}, so that a Challenge on one counts as a false alarm.`,
      }
    },
  },
  {
    // 10 §4: ≥ 1 claim sound in both variants with warranted `accept` (PRD §12 step 16).
    code: 'NO_ACCEPT_WARRANTED_SOUND',
    check: (context) => {
      const accepted = context.version.claims.filter(
        (claim) =>
          isSoundInBothVariants(context, claim.id) &&
          statesAcrossVariants(context, claim.id).every(
            (state) => state !== undefined && state.warrantedStance === 'accept',
          ),
      )
      if (accepted.length >= ACCEPT_WARRANTED_SOUND_CLAIMS_MIN) return null
      return {
        message: `No claim is sound in both variants with a warranted stance of Accept; the package needs at least ${ACCEPT_WARRANTED_SOUND_CLAIMS_MIN}.`,
      }
    },
  },
  {
    // 10 §4: every state has a warranted stance (PRD §7.8: the stance is derived and authored).
    code: 'WARRANTED_STANCE_UNSET',
    check: ({ version, claimById }) => {
      const unset = version.variants.flatMap((variant) =>
        variant.claimStates
          .filter((state) => !STANCES.some((stance) => stance === state.warrantedStance))
          .map((state) => ({ variant, state })),
      )
      if (unset.length === 0) return null
      const named = joinList(
        unset.map(
          ({ variant, state }) =>
            `${claimById.get(state.claimId)?.key ?? state.claimId} in the ${variant.key} variant`,
        ),
      )
      return {
        elementIds: unset.map(({ state }) => state.id),
        message: `No warranted stance is set for ${named}; every claim state needs one.`,
      }
    },
  },
  {
    // 10 §4: the Turn exists (PRD §7.11).
    code: 'TURN_MISSING',
    check: ({ version }) => {
      if (version.turn !== null && version.turn !== undefined) return null
      return {
        message:
          'The package has no Turn; author the message the world sends and the response it warrants.',
      }
    },
  },
  {
    // 10 §4: the Turn's arrival delay is 60 to 120 seconds (PRD §7.11).
    code: 'TURN_DELAY',
    check: ({ version }) => {
      const delay = version.turnDelaySeconds
      if (delay >= TURN_DELAY_SECONDS_MIN && delay <= TURN_DELAY_SECONDS_MAX) return null
      return {
        message: `The Turn arrives after ${plural(delay, 'second')}; the delay must be between ${TURN_DELAY_SECONDS_MIN} and ${TURN_DELAY_SECONDS_MAX} seconds.`,
      }
    },
  },
  {
    // 10 §4: for every claim one `provenance` and one `verification` question; for frame assumption
    // indexes 0–2 one `assumption` each; one `confidence`; one `frame_vs_response`; ≥ 1
    // `counterfactual`; ≥ 1 `figure_provenance` (template with `{figure}`, no claim) when the
    // package has named fields (FR-025, D-135); ≥ 6 `default` (PRD §7.18 (12), §7.12).
    code: 'QUESTION_BANK_INCOMPLETE',
    check: ({ version }) => {
      const ofKind = (kind: string) =>
        version.defenseQuestions.filter((question) => question.kind === kind)
      const forClaim = (kind: string, claimId: string) =>
        ofKind(kind).some((question) => question.claimId === claimId)

      const missingProvenance = version.claims.filter((claim) => !forClaim('provenance', claim.id))
      const missingVerification = version.claims.filter(
        (claim) => !forClaim('verification', claim.id),
      )
      const missingAssumptions = FRAME_ASSUMPTION_INDEXES.filter(
        (index) => !ofKind('assumption').some((question) => question.assumptionIndex === index),
      )
      const figureProvenance = ofKind('figure_provenance').filter(
        (question) => question.claimId === null && question.template.includes(FIGURE_PLACEHOLDER),
      )
      const defaults = ofKind('default')

      const missing: string[] = []
      if (missingProvenance.length > 0) {
        missing.push(`a provenance question for ${keysOf(missingProvenance)}`)
      }
      if (missingVerification.length > 0) {
        missing.push(`a verification question for ${keysOf(missingVerification)}`)
      }
      if (missingAssumptions.length > 0) {
        missing.push(
          `an assumption question for frame ${missingAssumptions.length === 1 ? 'assumption' : 'assumptions'} ${joinList(missingAssumptions.map(String))}`,
        )
      }
      if (ofKind('confidence').length === 0) missing.push('a confidence question')
      if (ofKind('frame_vs_response').length === 0) missing.push('a frame-versus-response question')
      if (ofKind('counterfactual').length === 0) missing.push('a counterfactual question')
      if (
        version.namedFields.length > 0 &&
        figureProvenance.length < FIGURE_PROVENANCE_QUESTIONS_MIN
      ) {
        missing.push(
          `a figure-provenance question with a ${FIGURE_PLACEHOLDER} placeholder and no claim`,
        )
      }
      if (defaults.length < DEFAULT_QUESTIONS_MIN) {
        missing.push(
          `${DEFAULT_QUESTIONS_MIN - defaults.length} more default ${DEFAULT_QUESTIONS_MIN - defaults.length === 1 ? 'question' : 'questions'} (${defaults.length} of ${DEFAULT_QUESTIONS_MIN})`,
        )
      }
      if (missing.length === 0) return null

      const claimsAtFault = [
        ...missingProvenance,
        ...missingVerification.filter((claim) => !missingProvenance.includes(claim)),
      ]
      return {
        elementIds: idsOf(claimsAtFault),
        message: `The defense question bank is missing ${joinList(missing)}.`,
      }
    },
  },
  {
    // 10 §4: the debrief counterfactual is exactly three sentences (PRD §7.14).
    code: 'COUNTERFACTUAL_SENTENCES',
    check: ({ version }) => {
      const sentences = countSentences(stripMarkup(version.debriefCounterfactual))
      if (sentences === COUNTERFACTUAL_SENTENCE_COUNT) return null
      return {
        message: `The debrief counterfactual is ${plural(sentences, 'sentence')}; it must be exactly ${COUNTERFACTUAL_SENTENCE_COUNT}.`,
      }
    },
  },
  {
    // 10 §4: 16 readiness items split 6 foundation / 4 defect_concept / 6 ai_behavior, each with 4
    // options and an answer key naming one of them, and no stem repeating eight or more consecutive
    // words of a claim (PRD §7.1, AI-005).
    code: 'READINESS_SPLIT',
    check: ({ version, claimById }) => {
      const items = version.readinessItems
      const sentences: string[] = []

      if (items.length !== READINESS_ITEM_TOTAL) {
        sentences.push(
          `The Readiness Check has ${plural(items.length, 'item')}; it needs exactly ${READINESS_ITEM_TOTAL}.`,
        )
      }
      const wrongCounts = Object.entries(READINESS_ITEM_COUNTS)
        .map(([category, required]) => ({
          category,
          required,
          actual: items.filter((item) => item.category === category).length,
        }))
        .filter(({ required, actual }) => required !== actual)
      if (wrongCounts.length > 0) {
        sentences.push(
          `It needs ${joinList(wrongCounts.map(({ category, required, actual }) => `${required} ${category} items and has ${actual}`))}.`,
        )
      }

      const malformed = items.filter(
        (item) =>
          item.options.length !== READINESS_OPTION_COUNT ||
          new Set(item.options.map((option) => option.key)).size !== item.options.length ||
          !item.options.some((option) => option.key === item.answerKey),
      )
      if (malformed.length > 0) {
        sentences.push(
          `${malformed.length === 1 ? 'Item' : 'Items'} ${keysOf(malformed)} need${malformed.length === 1 ? 's' : ''} ${READINESS_OPTION_COUNT} distinctly keyed options and an answer key naming one of them.`,
        )
      }

      const echoes = noItemNamesAClaim(items, version.claims).echoes
      if (echoes.length > 0) {
        const itemKeyById = new Map(items.map((item) => [item.id, item.key]))
        sentences.push(
          `${echoes.length === 1 ? 'Item' : 'Items'} ${joinList(echoes.map((echo) => `${itemKeyById.get(echo.itemId) ?? echo.itemId} (repeating ${claimById.get(echo.claimId)?.key ?? echo.claimId})`))} repeat eight or more consecutive words of a claim; rewrite the ${echoes.length === 1 ? 'stem' : 'stems'}.`,
        )
      }

      if (sentences.length === 0) return null
      const atFault = [
        ...malformed.map((item) => item.id),
        ...echoes.map((echo) => echo.itemId).filter((id) => !malformed.some((i) => i.id === id)),
      ]
      return { elementIds: atFault, message: sentences.join(' ') }
    },
  },
  {
    // 10 §4: every claim's `concept_key` is in the declared concept set (PRD §7.18 (3)).
    code: 'CLAIM_CONCEPT_UNKNOWN',
    check: ({ version }) => {
      const unknown = version.claims.filter(
        (claim) => !version.conceptSet.includes(claim.conceptKey),
      )
      if (unknown.length === 0) return null
      return {
        elementIds: idsOf(unknown),
        message: `${unknown.length === 1 ? 'Claim' : 'Claims'} ${joinList(unknown.map((claim) => `${claim.key} ("${claim.conceptKey}")`))} name${unknown.length === 1 ? 's' : ''} a concept that is not in the declared concept set.`,
      }
    },
  },
  {
    // 10 §4: a non-empty general escalation reply (PRD §7.9: the reply used when a claim has none).
    code: 'GENERAL_REPLY_MISSING',
    check: ({ version }) => {
      if (stripMarkup(version.generalEscalationReply) !== '') return null
      return {
        message:
          'The package has no general escalation reply; author the colleague reply returned when an escalated claim has none of its own.',
      }
    },
  },
  {
    // 10 §4: when a seed record exists, ≥ 3 re-skin entries with at least one of each kind
    // (PRD §7.2, §7.18 (1): the adaptation must be recorded).
    code: 'RESKIN_LOG_EMPTY',
    check: ({ version }) => {
      const seedRecord = version.seedRecord
      if (seedRecord === null || seedRecord === undefined) return null

      const entries = seedRecord.reskinLog
      const missingKinds = RESKIN_KINDS_REQUIRED.filter(
        (kind) => !entries.some((entry) => entry.kind === kind),
      )
      if (entries.length >= RESKIN_LOG_MIN_ENTRIES && missingKinds.length === 0) return null

      const sentences: string[] = []
      if (entries.length < RESKIN_LOG_MIN_ENTRIES) {
        sentences.push(
          `The re-skin log has ${plural(entries.length, 'entry', 'entries')}; it needs at least ${RESKIN_LOG_MIN_ENTRIES}.`,
        )
      }
      if (missingKinds.length > 0) {
        sentences.push(
          `It records no ${joinList(missingKinds.map((kind) => kind.replace(/_/g, ' ')))}.`,
        )
      }
      return { message: sentences.join(' ') }
    },
  },
]

// ---------------------------------------------------------------------------------------------
// The validator
// ---------------------------------------------------------------------------------------------

/**
 * Every rule of `10-backend-spec-modules.md` §4, run over one version.
 *
 * Pure and total: the same version always yields the same failures, in the order of the rule table,
 * and every rule is evaluated even after one has failed. A rule reports at most one failure, whose
 * `elementIds` name every element at fault, so the code set of the result is the set of rules the
 * package breaks.
 */
export function validatePackage(version: ValidatedVersion): PackageValidationResult {
  const context = buildContext(version)

  const failures: PackageValidationFailure[] = []
  for (const rule of RULES) {
    const failure = rule.check(context)
    if (failure === null) continue
    failures.push({
      code: rule.code,
      elementIds: failure.elementIds ?? [],
      message: failure.message,
    })
  }

  return { ok: failures.length === 0, failures }
}
