// The `R` and `C` property groups: docs/tech/17-analytics-events.md §3 and §5.4.
//
// Two pure projections, in `src/server` rather than inside the runs module, because every module
// that fires a run-scoped event needs them and a module may only reach another module through its
// public index (04 §2). Nothing here reads the database: the caller passes the row it already
// loaded, plus the variant key, which `runs.variant_id` resolves to through `scenario_variants`
// (the runs repository's `findVariantKey` is the pattern; a repository that needs it copies it).
//
// What travels is a set of ids and enums. The claim's text, its warranted stance, its evidence
// status, and its defect status are not in `C` and never will be — a claim's identity is a uuid and
// two enums, and that is all a dashboard is owed.

export type VariantKey = 'defective' | 'sound'
export type RunMode = 'guided' | 'standard' | 'open'

/** The columns of a `runs` row the `R` group is built from. */
export type RunContextRow = {
  id: string
  assignmentId: string
  packageVersionId: string
  mode: RunMode
  attemptNo: number
  isWalkthrough: boolean
}

export type RunContext = {
  run_id: string
  assignment_id: string
  package_version_id: string
  variant: VariantKey
  mode: RunMode
  attempt_no: number
  is_walkthrough: boolean
}

export function runContext(run: RunContextRow, variantKey: VariantKey): RunContext {
  return {
    run_id: run.id,
    assignment_id: run.assignmentId,
    package_version_id: run.packageVersionId,
    variant: variantKey,
    mode: run.mode,
    attempt_no: run.attemptNo,
    is_walkthrough: run.isWalkthrough,
  }
}

/** The columns of a claim (joined with its run-scoped surfacing) the `C` group is built from. */
export type ClaimContextRow = {
  id: string
  importance: 'load_bearing' | 'supporting'
  consequenceLevel: 'low' | 'medium' | 'high'
}

export type ClaimContext = {
  claim_id: string
  importance: 'load_bearing' | 'supporting'
  consequence_level: 'low' | 'medium' | 'high'
  in_turn_window: boolean
}

export function claimContext(claim: ClaimContextRow, inTurnWindow: boolean): ClaimContext {
  return {
    claim_id: claim.id,
    importance: claim.importance,
    consequence_level: claim.consequenceLevel,
    in_turn_window: inTurnWindow,
  }
}
