// The elements of one version, in the order the confirmation workspace lists them
// (docs/tech/10-backend-spec-modules.md §4; 06-data-model.md §3.3 `element_confirmations`).
//
// This is the list `confirmVersion` counts, `listVersionElements` renders, and FR-198's measures
// divide by. It lives in its own file rather than inside `service.ts` because two modules need the
// same list and only one of them may hold it: `authoring.computeAuthoringMeasures` (10 §5) reports
// an edit rate and a rejected share over the *elements of the version*, and a second copy of this
// walk would let the two answers drift — the package view saying one edit rate and the analytics
// event another, for the same package, with nothing to say which was right.
//
// Pure and structural, like `validate.ts` and `authoring/checks.ts`: a `VersionFull` satisfies
// `UnitVersion`, and so does a literal in a test. An internal module file may not reach a
// repository (04 §2), which is what makes the structural parameter the only shape available — and
// also the right one, because nothing here is a query.
import type { ElementTypeValue } from './schema'

/** One thing an author confirms: what the workspace lists and what `confirmVersion` counts. */
export type ElementUnit = {
  elementType: ElementTypeValue
  /** Null for a singleton (06 §3.3 `element_confirmations.element_id`). */
  elementId: string | null
  /** The element's own name — `D4`, `C3`, `defective:C3` — as the workspace shows it. */
  key: string
}

type Keyed = { id: string; key: string }

/** As much of a version as the walk reads; `repo.VersionFull` satisfies it. */
export type UnitVersion = {
  documents: readonly Keyed[]
  stakeholders: readonly Keyed[]
  answerSpacePositions: readonly Keyed[]
  namedFields: readonly Keyed[]
  claims: readonly Keyed[]
  variants: readonly { key: string; claimStates: readonly { id: string; claimId: string }[] }[]
  probe: { id: string } | null | undefined
  turn: { id: string } | null | undefined
  defenseQuestions: readonly Keyed[]
  readinessItems: readonly Keyed[]
  seedRecord: { id: string } | null | undefined
}

/** Every unit of the version, in the order the confirmation workspace lists them (10 §4). */
export function elementUnits(version: UnitVersion): ElementUnit[] {
  const units: ElementUnit[] = []
  const singleton = (elementType: ElementTypeValue): ElementUnit => ({
    elementType,
    elementId: null,
    key: elementType,
  })

  units.push(singleton('brief'))
  for (const row of version.documents) {
    units.push({ elementType: 'document', elementId: row.id, key: row.key })
  }
  for (const row of version.stakeholders) {
    units.push({ elementType: 'stakeholder', elementId: row.id, key: row.key })
  }
  for (const row of version.answerSpacePositions) {
    units.push({ elementType: 'answer_space_position', elementId: row.id, key: row.key })
  }
  for (const row of version.namedFields) {
    units.push({ elementType: 'named_field', elementId: row.id, key: row.key })
  }
  for (const row of version.claims) {
    units.push({ elementType: 'claim', elementId: row.id, key: row.key })
  }
  const claimKeyById = new Map(version.claims.map((claim) => [claim.id, claim.key]))
  for (const variant of version.variants) {
    for (const state of variant.claimStates) {
      units.push({
        elementType: 'variant_claim_state',
        elementId: state.id,
        key: `${variant.key}:${claimKeyById.get(state.claimId) ?? state.claimId}`,
      })
    }
  }
  if (version.probe) units.push(singleton('probe'))
  if (version.turn) units.push(singleton('turn'))
  for (const row of version.defenseQuestions) {
    units.push({ elementType: 'defense_question', elementId: row.id, key: row.key })
  }
  for (const row of version.readinessItems) {
    units.push({ elementType: 'readiness_item', elementId: row.id, key: row.key })
  }
  units.push(singleton('counterfactual'))
  units.push(singleton('general_escalation_reply'))
  units.push(singleton('clock_and_difficulty'))
  if (version.seedRecord) units.push(singleton('seed_reskin'))
  return units
}
