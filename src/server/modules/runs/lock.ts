// The Decision Lock's gate (docs/tech/10-backend-spec-modules.md §6; 10-backend-spec.md §8;
// FR-084, FR-100, FR-102, FR-103, FR-105, FR-106, FR-108, D-044, D-076).
//
// The lock is the one irreversible act of the working period, and its order is the specification:
//
//   1. **Validate the brief.** A brief that breaks FR-100's limits never reaches the gate, so a
//      student who pasted 300 words into the rationale is not also told about a claim.
//   2. **Mark reliance from the named fields** (FR-101). Typing a claim's figure into a named
//      numeric field is the student saying they leaned on it, and it has to be recorded *before*
//      the gate reads reliance or the gate would be reading a set the brief has just changed.
//   3. **Read the relied-on claims with no stance** (FR-084) and refuse over the first of them.
//
// This file is that order and the arithmetic beside it, and nothing else: no database, no run row,
// no events. The two effects the sequence needs are handed in as `LockSteps`, which is what lets
// `tests/unit/runs/lock-gate.test.ts` assert the *order* rather than only the outcome — a gate that
// read reliance before it marked it would pass every outcome test and still let a student lock over
// a claim they had just named a figure from.
//
// The two modes are the whole of D-044. A student's lock requires a filled brief and refuses over an
// unstanced relied-on claim; the clock's own auto-lock at expiry requires nothing and refuses over
// nothing — it records the draft as it stands, empty fields as empty, and the unstanced claims as
// unstanced (FR-105). "Empty is allowed only at auto-lock" is one branch in one function here.
import type { FrameInvalidReason } from './errors'
import { BriefSchema } from './schema'
import { SPEED_OUTLIER_MS } from './limits'

/** Who is locking: the student, or the clock reaching zero (FR-102, FR-105). */
export type LockMode = 'student' | 'auto'

/**
 * The brief's six fields as they are stored and as the `decision_locked` event carries them.
 *
 * `confidence` is nullable because an auto-locked run may never have had one; a student's lock
 * always does (`BriefSchema`).
 */
export type BriefFields = {
  recommendation: string
  rationale: string
  assumptions: string[]
  changeMyMind: string
  confidence: number | null
  namedValues: Record<string, number>
}

/** The brief of a run whose student never opened the editor (FR-105: "empty fields recorded empty"). */
export const EMPTY_BRIEF: BriefFields = {
  recommendation: '',
  rationale: '',
  assumptions: ['', '', ''],
  changeMyMind: '',
  confidence: null,
  namedValues: {},
}

/**
 * A relied-on claim with no stance, in the shape the gate needs.
 *
 * Structural rather than `reliance.UnstancedReliedOnClaim`: a module-internal file may not import
 * another module (04 §2), and the gate needs two of that type's four fields — the id the refusal
 * carries and the words it names the claim by.
 */
export type UnstancedClaim = { claimId: string; claimText: string }

/** The two effects the sequence performs, in the order it performs them. */
export type LockSteps = {
  /** FR-101: mark every claim whose figure the brief names as relied on. */
  markNamedFields: (namedValues: Record<string, number>) => Promise<unknown>
  /** FR-084: the relied-on claims with no stance, oldest first. */
  findUnstanced: () => Promise<readonly UnstancedClaim[]>
}

/** What the gate decided, and what the caller writes because of it. */
export type LockPlan =
  /** FR-100, FR-103: the brief broke a limit. Nothing was marked and nothing was read. */
  | { outcome: 'brief_invalid'; field: string; reason: FrameInvalidReason }
  /** FR-084: the student leaned on a claim and took no position on it. */
  | { outcome: 'unstanced'; claim: UnstancedClaim; unstanced: readonly UnstancedClaim[] }
  /** The lock stands. `unstanced` is empty for a student and whatever the clock caught for an auto-lock. */
  | { outcome: 'lock'; brief: BriefFields; unstanced: readonly UnstancedClaim[] }

/**
 * Applies FR-100's rules to a brief a student is filing, and answers the parsed value.
 *
 * The parsed value is what gets stored, so the text the word count was taken over, the text the
 * limit was applied to, and the text in the trace are one string with the markup already gone
 * (10 §5, D-075). The refusal names the field the form binds to — `rationale`, `assumptions.2`,
 * `confidence` — which is what FR-108's "returns the student to the brief" is drawn on.
 */
export function validateBrief(
  candidate: BriefFields,
): { ok: true; brief: BriefFields } | { ok: false; field: string; reason: FrameInvalidReason } {
  const parsed = BriefSchema.safeParse(candidate)
  if (parsed.success) return { ok: true, brief: parsed.data }

  const issue = parsed.error.issues[0]
  if (!issue) return { ok: false, field: 'brief', reason: 'invalid' }
  const field = issue.path.length > 0 ? issue.path.join('.') : 'brief'
  return { ok: false, field, reason: reasonOf(issue.code, issue.message, field) }
}

/**
 * Which of FR-100's rules the field broke, for a client with no form to mark it on.
 *
 * `WORD_LIMIT` is the message `wordLimit(n)` sets (10 §17), so a pasted essay is distinguishable
 * from an empty box — different mistakes with different fixes. The same reading `frameReasonOf`
 * makes of the frame, and deliberately the same three words, because both refusals reach the same
 * kind of form.
 */
function reasonOf(code: string, message: string, field: string): FrameInvalidReason {
  if (message === 'WORD_LIMIT') return 'word_limit'
  if (code === 'too_small' && !field.startsWith('confidence')) return 'required'
  return 'invalid'
}

/**
 * The Decision Lock's gate, in the order 10 §6 fixes (see the file header).
 *
 * `auto` skips the validation and the refusal but not the marking: the clock ran out on a brief the
 * student had already typed figures into, and FR-101's reliance is a fact about what they wrote,
 * not about how the lock came about. That is what makes an auto-locked run's
 * `unstanced_relied_on_claim_ids` the honest list D-044 asks for rather than an empty one.
 */
export type LockedPlan = Extract<LockPlan, { outcome: 'lock' }>

export async function planDecisionLock(
  candidate: BriefFields,
  mode: 'auto',
  steps: LockSteps,
): Promise<LockedPlan>
export async function planDecisionLock(
  candidate: BriefFields,
  mode: LockMode,
  steps: LockSteps,
): Promise<LockPlan>
export async function planDecisionLock(
  candidate: BriefFields,
  mode: LockMode,
  steps: LockSteps,
): Promise<LockPlan> {
  let brief = candidate
  if (mode === 'student') {
    const validated = validateBrief(candidate)
    if (!validated.ok) {
      return { outcome: 'brief_invalid', field: validated.field, reason: validated.reason }
    }
    brief = validated.brief
  }

  await steps.markNamedFields(brief.namedValues)
  const unstanced = await steps.findUnstanced()

  const first = unstanced[0]
  if (mode === 'student' && first) return { outcome: 'unstanced', claim: first, unstanced }
  return { outcome: 'lock', brief, unstanced }
}

// ---------------------------------------------------------------------------------------------
// The working time a lock took (FR-106)
// ---------------------------------------------------------------------------------------------

/** The run columns the elapsed reading needs. A `Run` row satisfies it; so does a test's literal. */
export type ElapsedRun = {
  workingStartedAt: Date | null
  pausedAt: Date | null
  totalPausedMs: number
}

/**
 * Working time from the frame lock to `at`: wall time, less every span the run spent paused.
 *
 * The paused spans come out because a pause is a component failure the student did not cause
 * (FR-001), and a run that waited out a two-minute outage has not been thinking for two minutes.
 * Charged action costs stay *in*: they are deductions from the clock the student is spending, not
 * time that did not pass, and FR-106 is about how long the student took rather than how much clock
 * they had left. The open paused span is subtracted too, for a reading taken while paused; at a
 * Decision Lock there is none, because the lock is refused in `paused`.
 *
 * Never negative, and zero for a run with no working clock: `elapsed_ms` is a duration in the trace
 * and a negative one would be a number nobody can read.
 */
export function elapsedWorkingMs(run: ElapsedRun, at: Date): number {
  if (!run.workingStartedAt) return 0
  const openPause = run.pausedAt ? at.getTime() - run.pausedAt.getTime() : 0
  return Math.max(0, at.getTime() - run.workingStartedAt.getTime() - run.totalPausedMs - openPause)
}

/**
 * FR-106: a lock under four minutes of working time is flagged for the instructor.
 *
 * A signal, not a penalty — scoring ignores it, and no student view carries it (`BriefViewSchema`).
 * An auto-lock can be one too: a run whose clock was already nearly spent when the frame was locked
 * reaches expiry in under four minutes, and that is exactly the reading the flag is for.
 */
export function isSpeedOutlier(elapsedMs: number): boolean {
  return elapsedMs < SPEED_OUTLIER_MS
}
