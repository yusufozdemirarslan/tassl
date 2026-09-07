// Module `authoring` — the warranted-stance table (D-032; docs/tech/10-backend-spec-modules.md §5;
// PRD §7.8, §7.18 (9), Appendix A.8).
//
// The warranted stance is what a competent person *should* have done with a claim: accept it, verify
// it, challenge it, refuse it outright, or hand it to someone else. It is an authored per-variant
// attribute — `variant_claim_states.warranted_stance` — and scoring reads it directly, so it is the
// single most consequential field in a package.
//
// This file is where D-032 says the table lives, and the decision's own note ("Edit the table in
// `src/server/modules/authoring/warranted-stance.ts`") is the whole design: generation *proposes* a
// stance from the claim's structural facts, and the academic authority confirms or edits it element
// by element (FR-194). Nothing here decides anything a person cannot overrule, which is why the
// table can be as blunt as it is.
//
// Three properties, and each is why a line below is written the way it is.
//
//   *Pure* — no database, no clock, no provider. `gen-claims-states` proposes stances inside the
//            model's own answer and the pipeline can propose one for a claim state the model left
//            unset, before any row exists; the confirmation workspace proposes one beside an
//            author's edit. All three call this.
//   *Total* — every combination of inputs yields a stance, including combinations D-032's four rows
//             do not name. A proposer that could decline would leave `WARRANTED_STANCE_UNSET` for a
//             person to notice, and the point of proposing is that they do not have to.
//   *Explained* — `explainWarrantedStance` returns which row fired. The proposal is shown to an
//                 author who is about to confirm or edit it, and "Verify, because the claim is
//                 load-bearing" is a thing they can disagree with; "Verify" alone is not.
//
// Structural input types, like `checks.ts`: a `scenario_claims` row satisfies `StanceProposalClaim`
// and a `variant_claim_states` row satisfies `StanceProposalState`, and so does a literal in a test
// or an unsaved element straight out of a generation step.
import { STANCES, type StanceValue } from '@/server/modules/scenarios/schema'

/** What the table reads from a claim; a `scenario_claims` row satisfies it. */
export type StanceProposalClaim = {
  /** `load_bearing` or `supporting` (06 §3.3). */
  importance: string
  /** `low`, `medium` or `high`. */
  consequenceLevel: string
  /** `cheap`, `moderate` or `expensive`. */
  verificationCost: string
  weaklySourced: boolean
  volatile: boolean
  /** Checked against the version's declared concept set; see `DEFECT_OUTSIDE_COMPETENCE`. */
  conceptKey: string
}

/** What the table reads from one variant's state of that claim. */
export type StanceProposalState = {
  /** `sound` or `defective`. Anything that is not `defective` is read as sound (see below). */
  evidenceStatus: string
  /** The family a defective state fails under; null on a sound state. */
  failureFamily: string | null
}

/**
 * Which row of D-032's table produced the proposal. The codes are the rows in order, and the
 * confirmation workspace names them beside the stance it is proposing.
 */
export const WARRANTED_STANCE_RULES = [
  /** Defective, and the family is a route that may not be taken at all → Reject. */
  'DEFECT_UNACCEPTABLE_ROUTE',
  /** Defective, and the concept it turns on is one the course declared → Challenge. */
  'DEFECT_IN_CONCEPT_SET',
  /** Defective, and it turns on a concept outside what the student is expected to know → Escalate. */
  'DEFECT_OUTSIDE_COMPETENCE',
  /** Sound, but load-bearing or high consequence → Verify. */
  'SOUND_CONSEQUENTIAL',
  /** Sound, cheap to check, and weakly sourced or volatile → Verify. */
  'SOUND_CHEAP_AND_SHAKY',
  /** Sound, carries nothing, and well sourced → Accept. */
  'SOUND_INCONSEQUENTIAL',
  /** Sound and none of the above: the Accept conditions were not all met → Verify. */
  'SOUND_UNSETTLED',
] as const

export type WarrantedStanceRule = (typeof WARRANTED_STANCE_RULES)[number]

export type WarrantedStanceProposal = {
  stance: StanceValue
  rule: WarrantedStanceRule
  /** One sentence an author can disagree with; not UI copy, a reason (see `checks.ts` on messages). */
  because: string
}

/**
 * The family whose defect is not a mistake to challenge but a route not to take (06 §3.3): the
 * evidence would support the decision and the decision is still one nobody may make. Rejecting is a
 * different act from challenging, so it is a different stance.
 */
const UNACCEPTABLE_ROUTE = 'unacceptable_route'

/** The two enum values that mean "checking this is nearly free". */
const CHEAP = 'cheap'
const LOAD_BEARING = 'load_bearing'
const HIGH = 'high'
const LOW = 'low'
const DEFECTIVE = 'defective'

/**
 * D-032's table, as a total function of the two rows and the version's declared concept set.
 *
 * The order of the branches is the table's order with one exception, and it is the one place the
 * decision is ambiguous. D-032's Accept row ("sound + not load-bearing + low consequence + not
 * weakly sourced") and its Verify row ("sound + … or cheap to check and weakly sourced or volatile")
 * both match a claim that is *volatile*, inconsequential and cheap to check: the Accept row does not
 * mention volatility, and the Verify row does. The Verify branch is evaluated first, so the
 * overlapping case proposes Verify. That is the conservative reading and the one the product means:
 * a claim whose truth moves with time, when checking it costs almost nothing, is checked.
 *
 * The final `SOUND_UNSETTLED` branch is the totality. D-032 names four rows and they do not cover a
 * sound claim that is merely middling — supporting, medium consequence, well sourced, expensive to
 * check. Accept is a positive claim that nothing turns on this and the source is fine; a claim that
 * misses any of those conditions has not earned it, so what is left is Verify.
 *
 * `conceptSet` is required rather than optional, and it is the third argument 10 §5's
 * `proposeWarrantedStance(claim, state)` does not name: "outside the student's expected competence"
 * is not a property of the claim, it is the claim's concept measured against what the course
 * declared. Defaulting it would silently make every concept "outside", which turns every planted
 * defect into an Escalate — the one wrong answer that looks like a considered one.
 */
export function explainWarrantedStance(
  claim: StanceProposalClaim,
  state: StanceProposalState,
  conceptSet: readonly string[],
): WarrantedStanceProposal {
  // Anything that is not `defective` is read as sound. `evidence_status` is a two-valued Postgres
  // enum, so the only way a third value arrives is an imported document (FR-186) or an unsaved
  // element from a generation step, and treating an unknown status as a defect would propose
  // Challenge on a claim nobody said was broken.
  if (state.evidenceStatus === DEFECTIVE) {
    if (state.failureFamily === UNACCEPTABLE_ROUTE) {
      return {
        stance: 'reject',
        rule: 'DEFECT_UNACCEPTABLE_ROUTE',
        because:
          'The claim is defective and its failure family is a route that may not be taken, which is refused rather than challenged.',
      }
    }
    if (conceptSet.includes(claim.conceptKey)) {
      return {
        stance: 'challenge',
        rule: 'DEFECT_IN_CONCEPT_SET',
        because: `The claim is defective and turns on ${claim.conceptKey}, which this course declared, so a student is expected to be able to catch it.`,
      }
    }
    return {
      stance: 'escalate',
      rule: 'DEFECT_OUTSIDE_COMPETENCE',
      because: `The claim is defective and turns on ${claim.conceptKey}, which is outside the declared concept set, so the competent move is to hand it on rather than to settle it.`,
    }
  }

  if (claim.importance === LOAD_BEARING || claim.consequenceLevel === HIGH) {
    return {
      stance: 'verify',
      rule: 'SOUND_CONSEQUENTIAL',
      because:
        claim.importance === LOAD_BEARING
          ? 'The claim is sound but load-bearing, so the decision fails if it is wrong and it is worth checking.'
          : 'The claim is sound but carries high consequence, so it is worth checking.',
    }
  }

  if (claim.verificationCost === CHEAP && (claim.weaklySourced || claim.volatile)) {
    return {
      stance: 'verify',
      rule: 'SOUND_CHEAP_AND_SHAKY',
      because: `The claim is sound but ${claim.weaklySourced ? 'weakly sourced' : 'volatile'} and cheap to check, so checking it costs almost nothing.`,
    }
  }

  if (claim.importance !== LOAD_BEARING && claim.consequenceLevel === LOW && !claim.weaklySourced) {
    return {
      stance: 'accept',
      rule: 'SOUND_INCONSEQUENTIAL',
      because:
        'The claim is sound, carries low consequence, is not load-bearing and is well sourced, so a challenge on it would be a false alarm.',
    }
  }

  return {
    stance: 'verify',
    rule: 'SOUND_UNSETTLED',
    because:
      'The claim is sound but does not meet every condition for accepting it outright, so it is worth checking before it is relied on.',
  }
}

/** 10 §5's `proposeWarrantedStance(claim, state)`, with the concept set the defect rows need. */
export const proposeWarrantedStance = (
  claim: StanceProposalClaim,
  state: StanceProposalState,
  conceptSet: readonly string[],
): StanceValue => explainWarrantedStance(claim, state, conceptSet).stance

/** True when a value is one of the five stances; the proposer only ever returns one of them. */
export const isStance = (value: string): value is StanceValue =>
  STANCES.some((stance) => stance === value)
