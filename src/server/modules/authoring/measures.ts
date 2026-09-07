// FR-198's operating measures, as arithmetic (docs/tech/10-backend-spec-modules.md §5
// `computeAuthoringMeasures`; 17-analytics-events.md §3.2 `package_confirmed`).
//
// Pure, and structural in its inputs like `checks.ts` and `warranted-stance.ts`: an
// `element_confirmations` row satisfies `MeasuredDecision` and a `generation_runs` row satisfies
// `MeasuredRun`, and so does a literal in a test. The service reads the rows; this decides what
// they mean.
//
// Three of the five are questions about *elements*, not about decisions, which is why the unit list
// is a parameter. An element with no decision at all is still an element the author has to get
// through, so it counts in every denominator: an edit rate computed over the elements somebody
// happened to open would rise as the review went on and read 1.0 after the first edit, which is the
// opposite of what PRD §11 watches it for ("an edit rate near zero is approving rather than
// reviewing").

/** One element of the version, addressed the way its confirmation rows are (06 §3.3). */
export type MeasuredUnit = { elementType: string; elementId: string | null }

/** One decision, as `element_confirmations` records it. */
export type MeasuredDecision = {
  elementType: string
  elementId: string | null
  revision: number
  decision: string
  openedAt: Date
  decidedAt: Date
}

/** One generation step run, as `generation_runs` records it. */
export type MeasuredRun = { passNumber: number }

export type AuthoringMeasureValues = {
  seedToConfirmedMs: number | null
  editRate: number
  rejectedShare: number
  /** 17 §3.2: the count of `generation_runs` rows — every pass of every step. */
  generationPasses: number
  /** 17 §3.2: the deepest retry any step needed; 1 when nothing was retried, 0 with no runs. */
  generationMaxPass: number
  reviewMsPerElement: number | null
  elementsCount: number
  reviewMsTotal: number
  editedCount: number
  rejectedCount: number
}

const nonNegativeInt = (value: number): number => Math.max(0, Math.round(value))

const share = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : Math.min(1, Math.max(0, numerator / denominator))

/** The address a decision is filed under; singletons carry a null element id (06 §3.3). */
const keyOf = (elementType: string, elementId: string | null): string =>
  `${elementType}:${elementId ?? ''}`

/** A clock skewed into the future cannot make a review span negative (the same rule `decideElement` applies). */
const reviewMs = (row: MeasuredDecision): number =>
  Math.max(0, row.decidedAt.getTime() - row.openedAt.getTime())

export function computeMeasures(input: {
  units: readonly MeasuredUnit[]
  decisions: readonly MeasuredDecision[]
  runs: readonly MeasuredRun[]
  seedCreatedAt: Date | null
  confirmedAt: Date | null
}): AuthoringMeasureValues {
  const latest = new Map<string, MeasuredDecision>()
  const everRejected = new Set<string>()
  for (const row of input.decisions) {
    const key = keyOf(row.elementType, row.elementId)
    if (row.decision === 'rejected') everRejected.add(key)
    const seen = latest.get(key)
    if (!seen || seen.revision < row.revision) latest.set(key, row)
  }

  let edited = 0
  let rejected = 0
  let reviewTotal = 0
  let reviewed = 0
  for (const unit of input.units) {
    const key = keyOf(unit.elementType, unit.elementId)
    const decision = latest.get(key)
    // An author's edit *is* their confirmation (10 §4), so the edit rate is the share of elements
    // whose decision that stands is `edited` — not the share that were ever touched.
    if (decision?.decision === 'edited') edited += 1
    if (everRejected.has(key)) rejected += 1
    if (decision) {
      reviewTotal += reviewMs(decision)
      reviewed += 1
    }
  }

  const seedToConfirmedMs =
    input.confirmedAt && input.seedCreatedAt
      ? nonNegativeInt(input.confirmedAt.getTime() - input.seedCreatedAt.getTime())
      : null

  return {
    seedToConfirmedMs,
    editRate: share(edited, input.units.length),
    rejectedShare: share(rejected, input.units.length),
    generationPasses: input.runs.length,
    generationMaxPass: input.runs.reduce((max, run) => Math.max(max, run.passNumber), 0),
    reviewMsPerElement: reviewed === 0 ? null : nonNegativeInt(reviewTotal / reviewed),
    elementsCount: input.units.length,
    reviewMsTotal: nonNegativeInt(reviewTotal),
    editedCount: edited,
    rejectedCount: rejected,
  }
}
