// Service of the `runs` module (docs/tech/10-backend-spec-modules.md §6; 10-backend-spec.md §8, §9,
// §10; 07-api-spec.md §7; 08-auth-authz.md §4, §5). Step 6.2: the lifecycle from `assigned` to
// `readiness`, the run reads every screen polls, and the timer materialization the rest of the
// phase hangs on (FR-201, FR-231, FR-233, FR-235, DATA-028, NFR-003, D-041, D-042, D-123).
//
// The rules that shape every function here, in the order they are applied:
//
//   1. The actor comes first and its permission helper is the first statement (08 §5). A run id
//      does not name its section, so the guard is what resolves the tenant; nothing below trusts an
//      organization id from the input.
//   2. A run the actor neither owns nor reviews answers NOT_FOUND, never FORBIDDEN, so an id cannot
//      be probed for existence (07 §1 "Tenancy", 08 §4). FORBIDDEN is kept for someone who can see
//      the resource and holds the wrong role — an instructor asking to *take* a run, say.
//   3. Every mutation opens one transaction, locks the run row with `findRunForUpdate`, and appends
//      its trace event through `trace.append` before it commits (CLAUDE.md, ADR-017). The lock is
//      what makes the trace sequence gapless, so there is no path that writes a run without it.
//   4. Timers are materialized at the start of every read and every mutation (10 §8), before the
//      state is read, so a run that expired while nobody was looking has already moved on by the
//      time a rule is applied to it. A read takes the writer's lock only when a timer has actually
//      fired — `./timers.ts` answers that from the row the read already holds (D-229).
//   5. Analytics fire after the writing transaction commits (17 §5.4), never inside it.
//
// What this module does *not* own: the assignment and the course it reads. Both come through the
// `courses` module's public interface (`getAssignment`, `getPolicyDisplay`), which is also the
// permission check for them — the policy values written into `policy_displayed` are the same ones
// UI-021 showed, because they come from the same function.
import { isAppError } from '@/lib/errors'
import { flagsFromEnv } from '@/lib/flags'
import { track } from '@/server/analytics/track'
import {
  requireRunInstructor,
  requireRunOwner,
  requireRunReviewer,
  requireSectionRole,
} from '@/server/auth/permissions'
import { assertNoForbiddenKeys } from '@/server/auth/student-view'
import type { SessionUser } from '@/server/auth/types'
import { env } from '@/server/config'
import { audit } from '@/server/modules/admin'
import { getAssignment, getPolicyDisplay } from '@/server/modules/courses'
import { getLogger } from '@/server/http/request-context'
import {
  findReliedOn,
  findUnstancedReliedOn,
  findUnstancedWindowClaims,
  markReliedOnFromNamedFields,
  surfaceClaims,
  surfaceDocumentClaims,
} from '@/server/modules/reliance'
import { getStudentScenario } from '@/server/modules/scenarios'
import { getInstitutionSettings, listMyInstitutions } from '@/server/modules/tenancy'
import { append, type TraceRun } from '@/server/modules/trace'
import {
  credit,
  isInTurnWindow,
  pause as clockPause,
  remainingWindowMs,
  resume as clockResume,
  type ClockRun,
} from './clock'
import {
  addendumExists,
  addendumInvalid,
  addendumNotAvailable,
  assertBriefWritable,
  assertForcedFailureArmable,
  assignmentNotOpen,
  briefAlreadyLocked,
  briefInvalid,
  decisionNotLocked,
  documentNotInRoom,
  documentOpenNotFound,
  frameInvalid,
  illegalTransition,
  lockRefusedUnstancedClaim,
  notSectionStudent,
  pauseRecordMissing,
  readinessClosed,
  readinessItemNotFound,
  readinessNotOpen,
  readinessOptionNotOffered,
  readinessSetUnavailable,
  readinessSkipNotAllowed,
  roomNotOpen,
  runActiveExists,
  runLocked,
  runNotFound,
  testControlsDisabled,
  testRouteUnavailable,
  turnClaimsUnstanced,
  turnNotOpen,
  turnResponseInvalid,
  workspaceNotOpen,
  type FrameInvalidReason,
} from './errors'
import { READINESS_MS } from './limits'

// The Turn window's length, re-exported so the module's public index can hand it to the screen
// that names it in prose (`decision.turnBody`, D-327). An index may reach this file and `schema`
// and nothing else (the `boundaries` policy), and a pilot parameter no page may restate has to
// arrive through the same door every other public value does.
export { TURN_WINDOW_MS } from './limits'
import {
  elapsedWorkingMs,
  isSpeedOutlier,
  planDecisionLock,
  EMPTY_BRIEF,
  type BriefFields,
  type LockMode,
  type LockPlan,
} from './lock'
import {
  correctnessOf,
  isOfferedOption,
  planReadinessClose,
  skipAllowed,
  toConceptViews,
  toReadinessItemViews,
  type ReadinessAnswerRow,
  type ReadinessCloseMode,
  type ReadinessConceptResult,
  type ReadinessItemRow,
} from './readiness'
import * as repo from './repository'
import { AddendumSchema, BriefDraftSchema, LockFrameSchema } from './schema'
import type {
  AddendumInput,
  AddendumView,
  AdvanceClockInput,
  AnswerReadinessItemInput,
  BriefDraftInput,
  BriefInput,
  BriefSignalInput,
  BriefView,
  DecisionRecord,
  DocumentOpened,
  ForcedFailure,
  LockFrame,
  LockFrameInput,
  PauseCauseValue,
  ReadinessResult,
  ReadinessView,
  RunRowForSummary,
  RunStateValue,
  RunStatus,
  RunSummary,
  RunWorkspace,
  RunsQuery,
  TurnResponseInput,
  TurnView,
  VariantKeyValue,
} from './schema'
import { readingOf } from './skim'
import { transition } from './state-machine'
import {
  IMPLICIT_HOLD,
  planTurnDelivery,
  planTurnResponse,
  turnDueAtFrom,
  type TurnResponseFields,
} from './turn'
import { toRunSummary } from './summary'
import { nextTimer, type Timer, type TimerBranch } from './timers'

// The projection is a pure function of a run row and lives beside the clock it reads; the reviewer's
// list in `courses` builds the same shape from it (see ./summary.ts).
export { toRunSummary } from './summary'

// ---------------------------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------------------------

/**
 * The institution the `/me` lists read: the session's active one, or the first the actor belongs to
 * so that someone who has never used the switcher still sees their work. It is the rule the courses
 * module applies to `/me/assignments`, and the two lists are read side by side on UI-020.
 */
async function activeTenant(actor: SessionUser): Promise<string | null> {
  const institutions = await listMyInstitutions(actor)
  const active = actor.activeOrganizationId
  if (active && institutions.some((institution) => institution.id === active)) return active
  return institutions[0]?.id ?? null
}

/** What a run guard proved: the run's tenant, its owner and its section. */
type RunScope = { runId: string; organizationId: string; studentId: string; sectionId: string }

/**
 * Which of the two readers 07 §7 admits the actor is, or NOT_FOUND.
 *
 * `requireRunOwner` answers NOT_FOUND both for a run that does not exist and for one belonging to
 * another student (08 §4), so a reviewer arrives at the second guard and is asked for their role
 * there. That guard answers FORBIDDEN to a section member holding the wrong role, which here means
 * one thing only — a classmate of the run's owner — and passing it through would confirm the run
 * exists to the one reader 08 §4 gives no read of it at all.
 */
async function requireOwnerOrReviewer(
  actor: SessionUser,
  runId: string,
): Promise<{ scope: RunScope; viewer: 'owner' | 'reviewer' }> {
  try {
    return { scope: await requireRunOwner(actor, runId), viewer: 'owner' }
  } catch (error) {
    if (!isAppError(error) || error.code !== 'NOT_FOUND') throw error
  }
  try {
    return { scope: await requireRunReviewer(actor, runId), viewer: 'reviewer' }
  } catch (error) {
    if (isAppError(error) && error.code === 'FORBIDDEN') runNotFound()
    throw error
  }
}

// ---------------------------------------------------------------------------------------------
// Timers (10 §8, ADR-019)
// ---------------------------------------------------------------------------------------------

/**
 * What a branch of 10 §8 does: one state change, its events, and the row it leaves behind.
 *
 * `at` is the instant the timer fired, computed from the run's own columns, and `now` is the
 * instant of the read that noticed. For three of the four branches they are the same thing to write
 * down — the check expired, the clock reached zero, the window closed, and nobody was there — and
 * only `at` is used. The Turn's delivery is the one branch where the difference is the rule (FR-115,
 * D-334): the Turn fired at `at` and reached the student at `now`, and the window starts at the
 * later of the two.
 */
type TimerApplier = (tx: repo.Tx, run: repo.Run, at: Date, now: Date) => Promise<repo.Run>

/**
 * The branches of 10 §8 this build can apply, keyed by the timer that fires them.
 *
 * All four are here from Step 9.1. `dueTimer` still reads the table in both directions, so a branch
 * removed from it would take no lock and write nothing rather than failing.
 *
 *   * `readiness_expired` — auto-submit the check with the unanswered items as `unknown` and move
 *     to `framing` (10 §8 branch 1).
 *   * `decision_auto_lock` — lock the decision at the instant the working clock reached zero, on
 *     whatever the student had written (10 §8 branch 2, FR-105, D-044).
 *   * `turn_delivery` — deliver the Turn, open the twelve-minute window, and surface the claims it
 *     lands on (10 §8 branch 3, FR-110, FR-111, FR-115, D-043, D-077).
 *   * `turn_window_expired` — the window closed unanswered, so the original decision stands as an
 *     implicit hold and the run goes on to the defense (10 §8 branch 4, FR-113).
 *   * `paused` is in none of them, by definition: the clock is frozen (FR-001), so `nextTimer`
 *     answers nothing for it.
 */
const TIMER_APPLIERS: Partial<Record<TimerBranch, TimerApplier>> = {
  readiness_expired: (tx, run, at) => closeReadiness(tx, run, 'expired', at, null),
  decision_auto_lock: (tx, run, at) => autoLockDecision(tx, run, at),
  turn_delivery: (tx, run, at, now) => deliverTurn(tx, run, at, now),
  turn_window_expired: (tx, run, at) => lockTurnResponse(tx, run, IMPLICIT_HOLD, at, null),
}

/** Four branches, each of which fires at most once; the bound is what makes the cascade total. */
const MAX_TIMER_CASCADE = 4

/**
 * The timer that has fired *and* that this build can act on, or null.
 *
 * Pure, and given the row rather than a lock: it is what lets a read decide whether it has any
 * writing to do before it opens a transaction (D-229).
 */
function dueTimer(run: repo.Run, now: Date): Timer | null {
  const timer = nextTimer(run)
  if (!timer) return null
  if (timer.at.getTime() > now.getTime()) return null
  return TIMER_APPLIERS[timer.branch] ? timer : null
}

/**
 * Materializes whatever the clock has made true since the last read, inside the caller's
 * transaction and with the run row already locked.
 *
 * This is the seam every timer in the build hangs on, and it is called at the start of every
 * mutation so that no rule is ever applied to a stale state. It loops because one expiry can put
 * the run into a state whose own timer is already past — a browser closed through the working
 * clock, the Turn delay and the Turn window comes back to three fired timers — and it is bounded
 * because there are four of them and each fires once.
 *
 * The instant a branch stamps is `timer.at`, computed from the run's own columns rather than from
 * `now`, so an event materialized long after it happened still carries the moment it happened
 * (NFR-002).
 */
async function materializeTimersTx(
  tx: repo.Tx,
  run: repo.Run,
  now: Date = new Date(),
): Promise<repo.Run> {
  let current = run
  for (let step = 0; step < MAX_TIMER_CASCADE; step += 1) {
    const timer = dueTimer(current, now)
    if (!timer) return current
    const apply = TIMER_APPLIERS[timer.branch]
    if (!apply) return current
    const applied = await apply(tx, current, timer.at, now)
    // A branch that could not act leaves the row exactly as it found it, and going round again
    // would only ask it the same question. There is one such case — a confirmed package version
    // with no Turn row, which `TURN_MISSING` (10 §4) makes unreachable — and stopping here is what
    // keeps it a logged anomaly rather than four repeats of the same query on every read.
    if (applied === current) return current
    current = applied
  }
  return current
}

/**
 * The read path's half (10 §8): materialize what has fired, and answer whether anything did.
 *
 * The lock is the point. `findRunForUpdate` is `SELECT … FOR UPDATE`, so opening a transaction on
 * every read would put every five-second poll of a run — the student's screen and every reviewer
 * watching it — in a queue behind that run's own writer, each waiting on one of the five pooled
 * connections (NFR-008). So the caller hands over the row it has already read and this asks the
 * pure question first: a run whose next timer is still in the future, or whose branch this build
 * cannot apply, takes no lock at all. Only a run with something to write pays for a transaction,
 * and then it pays once.
 *
 * It is not exported, and its first argument is the scope a guard returned rather than a tenant id,
 * because it is a mutation: filled in, its branches transition runs and append events. Every way in
 * is a service function above that has already named its actor and run its permission helper
 * (08 §5); there is no entry point that takes an organization id from a caller and writes to
 * whatever run it names (D-230).
 */
async function materializeTimers(scope: RunScope, run: repo.Run): Promise<boolean> {
  if (!dueTimer(run, new Date())) return false
  await repo.withTransaction(async (tx) => {
    const locked = await repo.findRunForUpdate(scope.organizationId, scope.runId, tx)
    if (!locked) runNotFound()
    await materializeTimersTx(tx, locked)
  })
  return true
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

/**
 * `GET /runs/{runId}` (07 §7): the run's state, clock and timers, for its owner or a reviewer of
 * its section. Polled every five seconds, which is why it materializes a fired timer before it
 * answers — and why it does that without a lock when none has fired (D-229) — and why the summary
 * carries the version the caller's `If-None-Match` is compared against (D-123).
 */
export async function getRun(actor: SessionUser, runId: string): Promise<RunSummary> {
  const { scope } = await requireOwnerOrReviewer(actor, runId)

  // One plain read, and a second only when the first found a timer that had fired: the poll that
  // finds nothing to do never opens a transaction and never takes the run's row lock (D-229).
  const first = await repo.findRunWithLabels(scope.organizationId, runId)
  if (!first) runNotFound()
  if (!(await materializeTimers(scope, first.run))) return toRunSummary(first.run)

  const row = await repo.findRunWithLabels(scope.organizationId, runId)
  if (!row) runNotFound()
  return toRunSummary(row.run)
}

/**
 * UI-027 `/runs/[runId]`: the same run plus the one thing a student is told about scoring — that a
 * held run is under review (FR-140, 10 §6). No composite score, no rank, no percentile ever
 * appears here or anywhere else.
 */
export async function getRunStatus(actor: SessionUser, runId: string): Promise<RunStatus> {
  const run = await getRun(actor, runId)
  return { run, underReview: run.scoringStatus === 'held' }
}

/**
 * `GET /me/runs` (07 §3): the actor's own runs, newest first. The actor is the whole scope — the
 * query is keyed by their id — so no permission helper appears: another student's run is not
 * reachable from here.
 *
 * Timers are not materialized for a list. Materializing sixty runs would take sixty row locks to
 * answer a table of links, and every link leads to a read that materializes the one run behind it;
 * a state on this screen is at worst one poll stale, and it is never acted on from here.
 */
export async function listMyRuns(
  actor: SessionUser,
  input: RunsQuery = {},
): Promise<repo.Page<RunSummary>> {
  const tenantId = await activeTenant(actor)
  if (!tenantId) return { items: [], nextCursor: null }
  const page = await repo.listRunsForStudent(tenantId, actor.id, {
    ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
    ...(input.state !== undefined ? { state: input.state } : {}),
  })
  return {
    items: page.items.map((item) => toRunSummary(item.run)),
    nextCursor: page.nextCursor,
  }
}

/**
 * The run the actor already has on this assignment, or null.
 *
 * It exists for one caller: `Idempotency-Key` on `POST /assignments/{assignmentId}/runs` (07 §1,
 * 10 §11). A Start whose response was lost is retried with the same key, and this is what the
 * wrapper replays instead of letting the retry meet `RUN_ACTIVE_EXISTS` — the run the first attempt
 * created, as it now stands rather than as it was, which is what a client about to start polling
 * wants. It carries the same two guards as `startRun`, in the same order, so a key cannot be used
 * to read a run on an assignment the actor may not take.
 *
 * Timers are not materialized: a run reached this way is being handed to a client that polls
 * `GET /runs/{runId}` next, and that read is where a fired timer is applied.
 */
export async function findMyRunOnAssignment(
  actor: SessionUser,
  assignmentId: string,
): Promise<RunSummary | null> {
  const assignment = await getAssignment(actor, assignmentId)
  const scope = await requireStudentOnSection(actor, assignment.sectionId)
  const run = await repo.findActiveRunForStudent(scope.organizationId, assignmentId, actor.id)
  return run ? toRunSummary(run) : null
}

// ---------------------------------------------------------------------------------------------
// Starting a run (FR-231, FR-235, D-041)
// ---------------------------------------------------------------------------------------------

/**
 * Creates the run a student takes an assignment with (10 §6).
 *
 * Four rules, in the order the reader meets them: the assignment must be one the actor can see (the
 * courses module answers NOT_FOUND otherwise, which is also the cross-tenant rule); the actor must
 * be a *student* on its section, so an instructor who can read the assignment is refused with
 * FORBIDDEN rather than told it does not exist; the assignment must have opened; and the student
 * must not already have a run on it that is not voided (D-041). A second attempt exists only
 * through a re-offer, which writes its own run (FR-183, Phase 11).
 *
 * The run copies the two numbers it will be judged under — the working clock, taken from the
 * assignment's override or the package version, and the Turn delay from the package version — so
 * that a later edit to either cannot change a run that has already begun. It starts in `assigned`:
 * the policy display comes next, and acknowledging it is what opens the Readiness Check.
 */
export async function startRun(actor: SessionUser, assignmentId: string): Promise<RunSummary> {
  const assignment = await getAssignment(actor, assignmentId)
  const scope = await requireStudentOnSection(actor, assignment.sectionId)

  if (assignment.opensAt && new Date(assignment.opensAt).getTime() > Date.now()) {
    assignmentNotOpen()
  }

  const tenantId = scope.organizationId
  const run = await repo
    .withTransaction(async (tx) => {
      const active = await repo.findActiveRunForStudent(tenantId, assignmentId, actor.id, tx)
      if (active) runActiveExists()

      const attemptNo = await repo.nextAttemptNo(tenantId, assignmentId, actor.id, tx)
      return repo.insertRun(
        tenantId,
        {
          assignmentId,
          studentId: actor.id,
          packageVersionId: assignment.packageVersionId,
          variantId: assignment.variantId,
          attemptNo,
          state: 'assigned',
          isWalkthrough: assignment.isWalkthrough,
          workingClockSeconds: assignment.effectiveWorkingClockSeconds,
          turnDelaySeconds: assignment.turnDelaySeconds,
        },
        tx,
      )
    })
    .catch(asSecondStart)

  // AN-002, AN-003 (17 §3.1): fired after the row exists, never before. `run_index_for_student` is
  // the count of runs this student has started anywhere, this one included, which `attempt_no`
  // cannot answer — it counts attempts on one assignment.
  const runIndex = await repo.countRunsForStudent(tenantId, actor.id)
  // The variant the run was started on, read from the package rather than from the assignment view:
  // that view stopped naming it, because a student may not know which one they drew (D-254).
  const variantKey = (await repo.findVariantKey(assignment.variantId)) ?? 'defective'
  track(
    'run_started',
    {
      ...runContext(run, variantKey),
      is_reoffer: run.reOfferedFromRunId !== null,
      run_index_for_student: runIndex,
    },
    { userId: actor.id, organizationId: tenantId },
  )
  return toRunSummary(run)
}

/**
 * Two Start presses that arrive together both read "no active run" and both insert attempt 1; the
 * unique index `(assignment_id, student_id, attempt_no)` lets exactly one of them commit. The loser
 * is the same refusal the check above makes, so it is answered the same way rather than as a 500 —
 * a double-clicked button is not a server fault.
 */
function asSecondStart(error: unknown): never {
  for (let cause: unknown = error; cause; cause = (cause as { cause?: unknown }).cause) {
    if ((cause as { code?: unknown }).code === '23505') runActiveExists()
  }
  throw error
}

/**
 * The section membership 08 §4 requires to start a run: `student`, and only `student`. An
 * instructor or TA of the same section reaches this having already read the assignment, so the
 * refusal is FORBIDDEN — they can see it, they simply do not take it — while anyone outside the
 * section never got past `getAssignment`.
 */
async function requireStudentOnSection(
  actor: SessionUser,
  sectionId: string,
): Promise<{ organizationId: string }> {
  try {
    const scope = await requireSectionRole(actor, sectionId, ['student'])
    return { organizationId: scope.organizationId }
  } catch (error) {
    if (isAppError(error) && error.code === 'FORBIDDEN') notSectionStudent()
    throw error
  }
}

// ---------------------------------------------------------------------------------------------
// Acknowledging the policy display (FR-201, FR-010)
// ---------------------------------------------------------------------------------------------

/**
 * Records that the student was shown what the run counts for, and opens the Readiness Check
 * (10 §6, PRD §7.19).
 *
 * The values written into `policy_displayed` are read through `courses.getPolicyDisplay`, the same
 * function UI-021 renders from, so the event records what was actually on the screen rather than a
 * second reading of the course. `counts_statement` is the literal `true`: the sentence is always
 * made, and the event records that it was.
 *
 * Two writes, one transaction, in the order they happened: the display was acknowledged, then the
 * run moved. A second acknowledgement is refused by the transition table with `ILLEGAL_TRANSITION`
 * rather than writing a second `policy_displayed`, which is what makes a double-clicked Begin
 * button harmless.
 */
export async function acknowledgePolicy(actor: SessionUser, runId: string): Promise<RunSummary> {
  const scope = await requireRunOwner(actor, runId)
  const tenantId = scope.organizationId

  const row = await repo.findRunWithLabels(tenantId, runId)
  if (!row) runNotFound()
  const policy = await getPolicyDisplay(actor, row.run.assignmentId)

  const updated = await repo.withTransaction(async (tx) => {
    const locked = await repo.findRunForUpdate(tenantId, runId, tx)
    if (!locked) runNotFound()
    const run = await materializeTimersTx(tx, locked)

    const now = new Date()
    const moved = transition(run, 'readiness', { cause: 'policy_acknowledged', at: now })

    await append(
      tx,
      run,
      'policy_displayed',
      {
        outside_ai_policy: policy.outsideAiPolicy,
        weight: policy.weight,
        mapping: policy.mapping,
        run_type: policy.runType,
        counts_statement: true,
      },
      { actorId: actor.id, occurredAt: now },
    )
    await append(tx, run, 'lifecycle', moved.payload, { actorId: actor.id, occurredAt: now })

    const next = await repo.updateRun(
      tenantId,
      runId,
      {
        ...moved.patch,
        policyDisplayedAt: now,
        readinessExpiresAt: new Date(now.getTime() + READINESS_MS),
      },
      tx,
    )
    if (!next) runNotFound()
    return next
  })

  // AN-002 (17 §3.1): the mirror of the trace event, fired after the commit. The policy text itself
  // never travels — only which of the three policies the course sets, and what the run is worth.
  const settings = await getInstitutionSettings(actor, tenantId)
  track(
    'policy_displayed',
    {
      ...runContext(updated, row.variant.key),
      outside_ai_policy: policy.outsideAiPolicy,
      weight_percent: policy.weight,
      mapping_is_default: sameMapping(policy.mapping, settings.settings.defaultMapping),
    },
    { userId: actor.id, organizationId: tenantId },
  )
  return toRunSummary(updated)
}

/** The course's mapping against the institution's default (17 §3.1 `mapping_is_default`). */
function sameMapping(
  a: { novice: number; developing: number; proficient: number; professional: number },
  b: { novice: number; developing: number; proficient: number; professional: number },
): boolean {
  return (
    a.novice === b.novice &&
    a.developing === b.developing &&
    a.proficient === b.proficient &&
    a.professional === b.professional
  )
}

// ---------------------------------------------------------------------------------------------
// The Readiness Check (FR-010 to FR-018, PRD §7.1, 10 §6)
//
// The rules are in `./readiness.ts` and every one of them is pure: what the student may see of an
// item, whether an answer is right, what the concept map says, and what closing the check writes.
// What is here is the four transactions that carry them out, and the one thing correctness is
// allowed to touch — the database.
//
// Read the four functions with one sentence in mind: **nothing below returns an item's correctness
// as a field, and nothing below returns a count, a total, a threshold or a rank (FR-012).**
// `getReadiness` hands back items whose only key is the one the student chose;
// `answerReadinessItem` computes correctness, stores it, and answers 204; `submitReadiness` and
// `skipReadiness` answer the concept map, which names concepts and says held, not held or unknown.
//
// That is a narrower claim than "correctness is never returned in any shape", which this file used
// to make and which is not true: the concept map *is* a reading of correctness, aggregated by
// concept and returned before the run is scored, because PRD §7.1 asks the check to produce one. On
// a concept carried by a single item the aggregate and the item coincide. `./readiness.ts` states
// exactly how much the map discloses; the authoring floor that bounds it, and the warning that
// carries it to a package's author, live in `scenarios/validate.ts` (D-251).
// ---------------------------------------------------------------------------------------------

/** The run's check, refused rather than served when its version is not confirmed (FR-011). */
async function readinessSetFor(
  tenantId: string,
  runId: string,
  dbx?: repo.Tx,
): Promise<readonly ReadinessItemRow[]> {
  const set = await repo.findReadinessSet(tenantId, runId, dbx)
  if (!set) runNotFound()
  // FR-011: items are drawn only from a confirmed set, and an unconfirmed item is never drawn. The
  // assignment already refused an unconfirmed version (10 §3); this is the same rule read again at
  // the moment the items are drawn, so a version retired or reopened underneath a run cannot serve
  // one. An empty set is the same refusal: there is no check to take.
  if (set.versionStatus !== 'confirmed' || set.items.length === 0) readinessSetUnavailable()
  return set.items
}

/**
 * Closes the check: the item events, the skip event when it closed incomplete, the result row, and
 * the transition to `framing`, all at `at` and all in the caller's transaction with the run row
 * locked.
 *
 * The three ways in — a submit, the eight minutes running out, and a skip after a failed submit —
 * differ only in the `mode` they pass and the actor they name. `planReadinessClose` decides what
 * each of them writes; this writes it, in the order it happened, so the trace reads as the check
 * closing and then the run moving on.
 *
 * `actorId` is null for the expiry: nobody did it (10 §10).
 */
async function closeReadiness(
  tx: repo.Tx,
  run: repo.Run,
  mode: ReadinessCloseMode,
  at: Date,
  actorId: string | null,
): Promise<repo.Run> {
  const tenantId = run.organizationId
  const items = await readinessSetFor(tenantId, run.id, tx)
  const answers: readonly ReadinessAnswerRow[] = await repo.listReadinessAnswers(run.id, tx)
  const plan = planReadinessClose(items, answers, mode, at)

  // Sequential, not `Promise.all`: `append` allocates the next sequence from the row it is handed,
  // so sixteen events in one transaction are sixteen numbers in the order they are written (NFR-005).
  for (const payload of plan.itemEvents) {
    await append(tx, run, 'readiness_item', payload, { actorId, occurredAt: at })
  }
  if (plan.skippedEvent) {
    await append(tx, run, 'readiness_skipped', plan.skippedEvent, { actorId, occurredAt: at })
  }

  await repo.insertReadinessResult(
    run.id,
    {
      submittedAt: plan.submittedAt,
      skipped: plan.skipped,
      concepts: plan.concepts as ReadinessConceptResult[],
    },
    tx,
  )

  const moved = transition(run, 'framing', { cause: plan.cause, at })
  await append(tx, run, 'lifecycle', moved.payload, { actorId, occurredAt: at })
  const next = await repo.updateRun(tenantId, run.id, moved.patch, tx)
  if (!next) runNotFound()
  return next
}

/** The result row as the student receives it: named concepts, and whether the check was completed. */
function toReadinessResult(row: { skipped: boolean; concepts: ReadinessConceptResult[] }) {
  return { skipped: row.skipped, concepts: toConceptViews(row.concepts) }
}

/** The closed check's result, read back inside the transaction that has just written it. */
async function readinessResultOf(runId: string, tx: repo.Tx): Promise<ReadinessResult> {
  const row = await repo.findReadinessResult(runId, tx)
  if (!row) runNotFound()
  return toReadinessResult(row)
}

/**
 * `GET /runs/{runId}/readiness` (07 §7, FR-010): the sixteen items and the instant the check closes.
 *
 * Only while the check is open. A run that has not reached it, or has already closed it, is refused
 * with the state it is actually in, and the screen follows the run's own `links.next` from there —
 * serving the items of a closed check would be an exercise the student can no longer take.
 *
 * The answers travel with the items so a check reopened after the browser closed comes back as it
 * was left (FR-017). The item's own key does not: `toReadinessItemViews` never carries it.
 */
export async function getReadiness(actor: SessionUser, runId: string): Promise<ReadinessView> {
  const scope = await requireRunOwner(actor, runId)
  const tenantId = scope.organizationId

  // A poll that arrives after the eight minutes must find the check closed, not take a lock to
  // discover that it is not (D-229): the read below only opens a transaction when a timer has fired.
  const first = await repo.findRunWithLabels(tenantId, runId)
  if (!first) runNotFound()
  let run = first.run
  if (await materializeTimers(scope, run)) {
    const again = await repo.findRunWithLabels(tenantId, runId)
    if (!again) runNotFound()
    run = again.run
  }

  if (run.state !== 'readiness' || !run.readinessExpiresAt) readinessNotOpen(run.state)

  const [items, answers] = await Promise.all([
    readinessSetFor(tenantId, runId),
    repo.listReadinessAnswers(runId),
  ])
  return {
    expiresAt: run.readinessExpiresAt.toISOString(),
    items: toReadinessItemViews(items, answers),
  }
}

/**
 * `PUT /runs/{runId}/readiness/answers/{itemId}` (07 §7): records one answer, and answers 204.
 *
 * Correctness is computed here, from the item's key, and stored on the answer row. It is not in the
 * response, and there is no response to put it in — which is the point of the 204 (FR-012). The
 * `readiness_item` events that carry it are written when the check closes, not now: an answer is a
 * scratchpad row until then, because FR-017 lets the student change it, and an event per keystroke
 * would make the trace a record of typing rather than of the check.
 *
 * The whole thing runs under the run's row lock, so an answer cannot land in the moment between the
 * eight minutes running out and the expiry being materialized.
 */
export async function answerReadinessItem(
  actor: SessionUser,
  runId: string,
  itemId: string,
  input: AnswerReadinessItemInput,
): Promise<void> {
  const scope = await requireRunOwner(actor, runId)
  const tenantId = scope.organizationId

  await repo.withTransaction(async (tx) => {
    const locked = await repo.findRunForUpdate(tenantId, runId, tx)
    if (!locked) runNotFound()
    const run = await materializeTimersTx(tx, locked)
    if (run.state !== 'readiness') readinessClosed()

    const items = await readinessSetFor(tenantId, runId, tx)
    const item = items.find((candidate) => candidate.id === itemId)
    if (!item) readinessItemNotFound()
    if (!isOfferedOption(item, input.answerKey)) readinessOptionNotOffered(input.answerKey)

    await repo.insertReadinessAnswer(
      runId,
      {
        itemId: item.id,
        answerKey: input.answerKey,
        correct: correctnessOf(item, input.answerKey),
        answeredAt: new Date(),
      },
      tx,
    )
  })
}

/**
 * `POST /runs/{runId}/readiness/submit` (07 §7, FR-012): closes the check and answers the concept
 * map.
 *
 * A failure here is the one thing FR-018's skip exists for, so it is recorded rather than only
 * thrown: an unexpected error — the database, not the student — sets `flags.readiness_submit_failed`
 * on the run it left in `readiness`, which is what makes "Skip the check" appear on UI-022. A
 * refusal the student caused (they have already submitted, the check has closed) is not a failed
 * submission and does not arm the skip.
 */
export async function submitReadiness(actor: SessionUser, runId: string): Promise<ReadinessResult> {
  const scope = await requireRunOwner(actor, runId)
  const tenantId = scope.organizationId

  try {
    return await repo.withTransaction(async (tx) => {
      const locked = await repo.findRunForUpdate(tenantId, runId, tx)
      if (!locked) runNotFound()
      const run = await materializeTimersTx(tx, locked)
      if (run.state !== 'readiness') readinessNotOpen(run.state)

      await closeReadiness(tx, run, 'submitted', new Date(), actor.id)
      return readinessResultOf(runId, tx)
    })
  } catch (error) {
    if (isUnexpected(error)) await markSubmitFailed(tenantId, runId)
    throw error
  }
}

/** Whether the failure was ours rather than the caller's: anything but a refusal below 500. */
function isUnexpected(error: unknown): boolean {
  return !isAppError(error) || error.status >= 500
}

/**
 * Arms the skip after a submission failed (FR-018, `runs.flags.readiness_submit_failed`).
 *
 * Its own transaction, because the one that failed has rolled back, and best-effort: a student
 * whose submit did not go through must not also be shown a second failure for the bookkeeping that
 * records the first. If this write is lost the skip stays unavailable and the student's next submit
 * is the one that succeeds, which is the outcome they wanted anyway.
 */
async function markSubmitFailed(tenantId: string, runId: string): Promise<void> {
  try {
    await repo.withTransaction(async (tx) => {
      const locked = await repo.findRunForUpdate(tenantId, runId, tx)
      // A run that moved on has no check left to skip; the flag would be a button on a closed page.
      if (!locked || locked.state !== 'readiness') return
      await repo.updateRun(
        tenantId,
        runId,
        { flags: { ...locked.flags, readiness_submit_failed: true } },
        tx,
      )
    })
  } catch (error) {
    getLogger().warn(
      { event: 'readiness_submit_flag_failed', runId, err: error },
      'readiness submit failure was not recorded on the run',
    )
  }
}

/**
 * `POST /runs/{runId}/readiness/skip` (07 §7, FR-018): closes the check without a result.
 *
 * Allowed only once a submission has failed. Every concept comes out `unknown` — the check could not
 * be completed, so it found nothing out (PRD §7.1, "competence marked unknown") — and the run goes
 * on to `framing` in Standard Mode exactly as a submitted check does, because the result never
 * blocks entry (FR-013).
 */
export async function skipReadiness(actor: SessionUser, runId: string): Promise<ReadinessResult> {
  const scope = await requireRunOwner(actor, runId)
  const tenantId = scope.organizationId

  return repo.withTransaction(async (tx) => {
    const locked = await repo.findRunForUpdate(tenantId, runId, tx)
    if (!locked) runNotFound()
    const run = await materializeTimersTx(tx, locked)
    if (run.state !== 'readiness') readinessNotOpen(run.state)
    if (!skipAllowed(run.flags)) readinessSkipNotAllowed()

    await closeReadiness(tx, run, 'student_skip', new Date(), actor.id)
    return readinessResultOf(runId, tx)
  })
}

/**
 * The closed check's result, or null while it is still open (UI-022's result page reads
 * `run_readiness_results`). It has no endpoint of its own in 07 §7: the result travels back from
 * the submit and the skip, and this is how the page a student returns to reads it again.
 *
 * Timers first, so a student who lands on the result page at the instant the check expired is shown
 * the result the expiry wrote rather than an empty page.
 */
export async function getReadinessResult(
  actor: SessionUser,
  runId: string,
): Promise<ReadinessResult | null> {
  const scope = await requireRunOwner(actor, runId)
  const row = await repo.findRunWithLabels(scope.organizationId, runId)
  if (!row) runNotFound()
  await materializeTimers(scope, row.run)

  const result = await repo.findReadinessResult(runId)
  return result ? toReadinessResult(result) : null
}

// ---------------------------------------------------------------------------------------------
// The Scenario Brief, the Evidence Room and the frame (FR-020 to FR-024, FR-031, FR-040 to FR-044,
// FR-117, PRD §7.2, §7.4, 10 §6)
//
// Three rules run through everything below, on top of the five in the file header.
//
//   1. **The workspace is a projection, built by picking.** Not one field reaches the student by
//      surviving a delete: `RunWorkspaceSchema` lists what the room shows, the document list has no
//      body, and the package read behind it (`scenarios.getStudentScenario`) is the same discipline
//      one module along (12 §8, D-117). `tests/integration/security/student-view-invariants.test.ts`
//      is where that is proven rather than asserted.
//   2. **A body is only ever handed over by an open, and an open is a trace event.** FR-022 is a
//      claim about the record — which documents were opened, in what order, for how long, and
//      whether the read came before the first delegation — and the only way that claim stays true
//      is for the read and the event to be one transaction (D-243).
//   3. **The frame is irreversible.** `run_frames` has no update path in this service and none in
//      the database (`tassl_app` holds INSERT and SELECT alone, migration 0009), so FR-043's "never
//      restored, edited, or replaced, including by an instructor" is a grant rather than a habit.
// ---------------------------------------------------------------------------------------------

/** The states in which `/runs/[runId]/work` has something to draw (UI-023). */
const WORKSPACE_STATES: readonly RunStateValue[] = ['framing', 'working', 'paused', 'turn_open']

/**
 * D-117's stage, as a run state: the point past which the debrief and the record may show what was
 * withheld while the run was live.
 *
 * `scored` is the moment; `confirmed` and `recorded` are after it. Everything earlier is
 * `{ scored: false }`, which is the wider of the two key sets and the one every screen the student
 * works on is swept against.
 */
const SCORED_STATES: readonly RunStateValue[] = ['scored', 'confirmed', 'recorded']

/**
 * Step 2 of `student-view.ts`'s discipline, applied where that file says it belongs: the guard on a
 * picked payload at the seam between a service and the route, action or RSC page that hands it over
 * (D-329).
 *
 * The pick is the braces and this is the belt. `getRunWorkspace` and `getDecision` compose seven
 * projections between them — the scenario view, the frame, the opens, the brief, the named fields,
 * the addendum and the pause — and a nested element spread whole rather than picked is the failure
 * this catches and a reviewer does not. It throws `INTERNAL_ERROR`, so a leak never leaves the
 * server; see the note at the top of `student-view.ts` for why it does not redact.
 *
 * The workspace is polled every five seconds (D-274), so the cost is worth naming: the walk visits
 * a few hundred keys of an object already in memory and takes no query and no allocation beyond the
 * findings array, against four database reads on the same request (16 §3). It is not measurable
 * beside them.
 */
function guardStudentPayload<T>(payload: T, run: repo.Run): T {
  assertNoForbiddenKeys(payload, { scored: SCORED_STATES.includes(run.state) })
  return payload
}

/**
 * The states in which a document may be opened (10 §6).
 *
 * `framing` and `working` are the room's own life; `turn_open` is the Turn window, where the room
 * is open again for the twelve minutes the student has to respond (PRD §7.11). `paused` is not
 * among them: the clock is frozen while a component failure is waited out (FR-001), and an open
 * recorded against a frozen clock would be a duration nothing bounds.
 */
const ROOM_STATES: readonly RunStateValue[] = ['framing', 'working', 'turn_open']

/** The states in which the assistant answers (PRD §7.5: frame lock to Decision Lock, and the window). */
const ASSISTANT_STATES: readonly RunStateValue[] = ['working', 'turn_open']

/** After these the room is closed for good; the refusal says so rather than "not yet" (07 §7). */
const AFTER_LOCK_STATES: readonly RunStateValue[] = [
  'decision_locked',
  'turn_locked',
  'defense_pending',
  'defense_complete',
  'scored',
  'confirmed',
  'recorded',
]

/**
 * The room's gate, with the two different things a refusal can mean (07 §7, 10 §6).
 *
 * A run that has not reached `framing` is refused with the state it is in, because the student's
 * next step is somewhere else and their screen follows `links.next` to find it. A run past the
 * Decision Lock is refused with `RUN_LOCKED`, because nothing about it will open the room again.
 */
function assertRoomOpen(state: RunStateValue): void {
  if (ROOM_STATES.includes(state)) return
  if (AFTER_LOCK_STATES.includes(state)) runLocked()
  roomNotOpen(state)
}

/**
 * `GET /runs/{runId}/workspace` (07 §7, FR-020): the brief, the Evidence Room, and the frame.
 *
 * The owner alone — there is no reviewer's read of a room in progress; a reviewer replays the run
 * from its trace after it is scored (FR-180).
 *
 * Timers first, as everywhere, and without a lock when nothing has fired (D-229): this is the read
 * behind the screen a student sits on for the whole working period, and it is polled beside
 * `GET /runs/{runId}`.
 */
export async function getRunWorkspace(actor: SessionUser, runId: string): Promise<RunWorkspace> {
  const scope = await requireRunOwner(actor, runId)
  const tenantId = scope.organizationId

  const first = await repo.findRunWithLabels(tenantId, runId)
  if (!first) runNotFound()
  let run = first.run
  if (await materializeTimers(scope, run)) {
    const again = await repo.findRunWithLabels(tenantId, runId)
    if (!again) runNotFound()
    run = again.run
  }
  if (!WORKSPACE_STATES.includes(run.state)) workspaceNotOpen(run.state)

  const [scenario, frame, opens, brief, addendum, pause] = await Promise.all([
    getStudentScenario(actor, runId),
    repo.findFrame(runId),
    repo.listOpenDocumentOpens(runId),
    repo.findBrief(runId),
    repo.findAddendum(runId),
    // Only when the run is actually paused: an open pause row and a state of `paused` are the same
    // fact, and reading the row for every poll of a running run is a query that always answers
    // nothing.
    run.state === 'paused' ? repo.findOpenPause(runId) : Promise.resolve(undefined),
  ])

  return guardStudentPayload(
    {
      run: toRunSummary(run),
      brief: { text: scenario.brief },
      // Picked again rather than passed through: `scenarios` picks these five fields too, and a field
      // added to that view tomorrow must not appear here because two projections were one object
      // (12 §8). The cost of the rule is this map.
      documents: scenario.documents.map((document) => ({
        id: document.id,
        key: document.key,
        title: document.title,
        author: document.author,
        datedOn: document.datedOn,
      })),
      openDocuments: opens.map((open) => ({
        openId: open.id,
        documentId: open.documentId,
        openedAt: open.openedAt.toISOString(),
      })),
      frame: frame
        ? {
            decision: frame.decision,
            assumptions: frame.assumptions,
            position: frame.position,
            confidence: frame.confidence,
            lockedAt: frame.lockedAt.toISOString(),
          }
        : null,
      briefDraft: brief ? toBriefView(brief) : null,
      // Picked field by field for the reason the documents above are (12 §8): the scenarios view and
      // this one are two projections, never one object shared between them.
      namedFields: scenario.namedFields.map((field) => ({
        key: field.key,
        label: field.label,
        unit: field.unit,
      })),
      addendum: addendum ? toAddendumView(addendum) : null,
      pause: pause ? { cause: pause.cause, pausedAt: pause.pausedAt.toISOString() } : null,
      capabilities: {
        canOpenDocuments: ROOM_STATES.includes(run.state),
        canLockFrame: run.state === 'framing',
        assistantUnlocked: ASSISTANT_STATES.includes(run.state),
        canWriteBrief: run.state === 'working',
      },
    },
    run,
  )
}

/**
 * Closes one open: the row, and the `document_close` event that records it (FR-022, FR-024).
 *
 * `duration_ms` is capped at the clock the open was running against and `skim` is D-082's threshold
 * over the document's own length, both from `readingOf` (`./skim.ts`) and both computed here, from
 * the run row this transaction holds, so the number stored and the number in the trace are one
 * number. They are taken together and never derived from each other: the cap is about the clock,
 * the flag is about the reading, and reading the flag off the capped number marks a long read as a
 * skim wherever the cap bites (D-250).
 *
 * `before_first_delegation` and `in_turn_window` are read off the *open* row rather than recomputed:
 * they are facts about when the reading started, and a delegation made while the document was open
 * must not rewrite the flag that says the read came first.
 *
 * A row somebody else has already closed answers `undefined` from the repository and writes no
 * second event, which is what makes a close idempotent — the client sends one on unmount, one on
 * `visibilitychange`, and one on `beforeunload`.
 */
async function closeOneOpen(
  tx: repo.Tx,
  run: repo.Run,
  open: repo.RunDocumentOpen,
  wordCount: number,
  at: Date,
  actorId: string | null,
): Promise<void> {
  const { durationMs, skim } = readingOf(run, open.openedAt, at, wordCount)
  const closed = await repo.closeDocumentOpen(
    run.id,
    open.id,
    { closedAt: at, durationMs, skim },
    tx,
  )
  if (!closed) return

  await append(
    tx,
    run,
    'document_close',
    {
      open_id: open.id,
      document_id: open.documentId,
      duration_ms: durationMs,
      before_first_delegation: open.beforeFirstDelegation,
      skim,
      in_turn_window: open.inTurnWindow,
    },
    { actorId, occurredAt: at },
  )
}

/**
 * Closes every open the run still has outstanding (10 §6: "a document open without a close is
 * closed by the next open or by lock").
 *
 * Two things reach it: the next open, because a student reading a second document is no longer
 * reading the first, and the frame lock, because the framing period ends there. Without it a tab
 * closed on an open document (FR-117) would leave a read with no end, and the reading segment of
 * the clock timeline would be missing the longest one.
 *
 * The word counts come from one read of the room rather than one per open, and only when there is
 * something to close.
 */
async function closeOpenDocuments(
  tx: repo.Tx,
  run: repo.Run,
  tenantId: string,
  at: Date,
  actorId: string | null,
): Promise<void> {
  const opens = await repo.listOpenDocumentOpens(run.id, tx)
  if (opens.length === 0) return

  const documents = await repo.listRunDocuments(tenantId, run.id, tx)
  const words = new Map(documents.map((document) => [document.id, document.wordCount]))
  for (const open of opens) {
    await closeOneOpen(tx, run, open, words.get(open.documentId) ?? 0, at, actorId)
  }
}

/**
 * `POST /runs/{runId}/documents/{documentId}/open` (07 §7, FR-022, FR-031): opens a document and
 * records that it was opened.
 *
 * The body is in the response and the event is in the transaction that produced it, so there is no
 * way to read a document without the run recording the read. The two flags the payload carries are
 * facts about *when* the reading started: `before_first_delegation` is whether the student has yet
 * used the assistant at all (FR-022 — it is the measure that separates reading the room from asking
 * about it), and `in_turn_window` is whether the read happened inside the Turn's twelve minutes.
 *
 * Opening also surfaces the claims the document carries (FR-031): a stakeholder claim read from a
 * document requires a stance like any other, so it joins the run's claims the moment the student
 * could have read it — no delegation, and no assistant.
 *
 * The state is read inside the transaction, from the row the timers have just been materialized
 * against, rather than from the row the request arrived with: the working clock can run out between
 * the two, and a run whose decision has auto-locked has no room left to open.
 */
export async function openDocument(
  actor: SessionUser,
  runId: string,
  documentId: string,
): Promise<DocumentOpened> {
  const scope = await requireRunOwner(actor, runId)
  const tenantId = scope.organizationId

  const document = await repo.findRunDocument(tenantId, runId, documentId)
  if (!document) documentNotInRoom()

  const openId = await repo.withTransaction(async (tx) => {
    const locked = await repo.findRunForUpdate(tenantId, runId, tx)
    if (!locked) runNotFound()
    const run = await materializeTimersTx(tx, locked)
    assertRoomOpen(run.state)

    const now = new Date()
    await closeOpenDocuments(tx, run, tenantId, now, actor.id)

    const open = await repo.insertDocumentOpen(
      runId,
      {
        documentId: document.id,
        openedAt: now,
        beforeFirstDelegation: run.firstDelegationAt === null,
        inTurnWindow: isInTurnWindow(run),
      },
      tx,
    )

    await append(
      tx,
      run,
      'document_open',
      {
        open_id: open.id,
        document_id: document.id,
        document_key: document.key,
        before_first_delegation: open.beforeFirstDelegation,
        in_turn_window: open.inTurnWindow,
      },
      { actorId: actor.id, occurredAt: now },
    )

    await surfaceDocumentClaims(tx, run, document.id, now)
    return open.id
  })

  return {
    openId,
    document: {
      id: document.id,
      key: document.key,
      title: document.title,
      author: document.author,
      datedOn: document.datedOn,
      body: document.body,
    },
  }
}

/**
 * `POST /runs/{runId}/document-opens/{openId}/close` (07 §7): ends one reading.
 *
 * **No state gate.** A close is bookkeeping about something that already happened, and the states it
 * can arrive in are exactly the ones FR-117 describes: a laptop closed during `working` comes back
 * to a run whose clock has run out and whose decision has auto-locked, and the close that finally
 * arrives must still be recorded — capped at the clock, which is what `cappedDurationMs` is for.
 * Refusing it would lose the longest read of the run.
 *
 * A second close for the same open is a no-op rather than a refusal: the client sends one on
 * unmount, one when the tab is hidden and one on `beforeunload`, and two of the three arriving is
 * the normal case rather than an error.
 */
export async function closeDocument(
  actor: SessionUser,
  runId: string,
  openId: string,
): Promise<void> {
  const scope = await requireRunOwner(actor, runId)
  const tenantId = scope.organizationId

  await repo.withTransaction(async (tx) => {
    const locked = await repo.findRunForUpdate(tenantId, runId, tx)
    if (!locked) runNotFound()
    const run = await materializeTimersTx(tx, locked)

    const open = await repo.findDocumentOpen(runId, openId, tx)
    if (!open) documentOpenNotFound()
    if (open.closedAt) return

    const document = await repo.findRunDocument(tenantId, runId, open.documentId, tx)
    await closeOneOpen(tx, run, open, document?.wordCount ?? 0, new Date(), actor.id)
  })
}

/**
 * The frame's rules (FR-040, FR-042), applied where 10 §6 puts them.
 *
 * `LockFrameInputSchema` is what the route accepts — four fields of the right kinds — and this is
 * the rule: every field filled once markup is stripped, 50 / 25 / 100 words, exactly three
 * assumptions, confidence 0 to 100. Applying it here rather than at the route is what lets a broken
 * frame answer `FRAME_INVALID` naming the field (10 §6) instead of the generic validation failure,
 * and it is the shape `courses` uses for `MAPPING_INVALID`.
 *
 * The value returned is the *parsed* one, so what is stored is the stripped, trimmed text the word
 * count was taken over (10 §5, D-075) — the student's words, and no markup they pasted.
 */
function validateFrame(input: LockFrameInput): LockFrame {
  const parsed = LockFrameSchema.safeParse(input)
  if (parsed.success) return parsed.data

  const issue = parsed.error.issues[0]
  if (!issue) frameInvalid('frame', 'invalid')
  // `assumptions.1` rather than `assumptions`: the path is what the form binds its controls to, so
  // the refusal lands on the field that caused it (FR-040, "naming the field").
  const field = issue.path.length > 0 ? issue.path.join('.') : 'frame'
  frameInvalid(field, frameReasonOf(issue.code, issue.message, field))
}

/**
 * Which of FR-040's rules the frame broke, for a client with no form to show it on.
 *
 * `WORD_LIMIT` is the message `wordLimit(n)` sets (10 §17), so an over-long field is distinguishable
 * from an empty one — which matters, because they are different mistakes: one is a paste to trim,
 * the other is a field nobody filled in.
 */
function frameReasonOf(code: string, message: string, field: string): FrameInvalidReason {
  if (message === 'WORD_LIMIT') return 'word_limit'
  if (code === 'too_small' && !field.startsWith('confidence')) return 'required'
  return 'invalid'
}

/**
 * `POST /runs/{runId}/frame` (07 §7, FR-040, FR-041): locks the frame and starts the working clock.
 *
 * This is the moment the run turns from reading into deciding, and it is irreversible in three
 * senses at once. The row is immutable (`run_frames` has no update grant, migration 0009), the
 * transition `framing → working` is one-way (10 §9), and the working clock starts here and cannot
 * be restarted — `paused → working` is a resume and stamps nothing (D-227).
 *
 * Tassl locks it "without evaluating or commenting" (FR-041): nothing is scored here, nothing is
 * said back, and the only thing the response carries is the run, now in `working`, with a clock.
 *
 * The state is required to be `framing` rather than left to the transition table, which is the one
 * place in this module where a check duplicates that table on purpose: 10 §9 also lists
 * `paused → working`, so a paused run reaching here would be moved by the table into `working` with
 * a fresh `working_started_at` and a frame written after the fact. A run cannot in fact be paused
 * before its frame — nothing pauses in `framing` — and this is what keeps that true if something
 * one day does.
 */
export async function lockFrame(
  actor: SessionUser,
  runId: string,
  input: LockFrameInput,
): Promise<RunSummary> {
  const scope = await requireRunOwner(actor, runId)
  const tenantId = scope.organizationId
  const frame = validateFrame(input)

  const updated = await repo.withTransaction(async (tx) => {
    const locked = await repo.findRunForUpdate(tenantId, runId, tx)
    if (!locked) runNotFound()
    const run = await materializeTimersTx(tx, locked)
    if (run.state !== 'framing') illegalTransition(run.state, 'working')

    const now = new Date()
    // The framing period ends here, so a document still open ends with it. It is closed before the
    // clock starts, so no clock caps its duration — there was none to run against (FR-117). The one
    // bound it has is `ABANDONED_OPEN_MS`: a run left in `framing` for a month is an ordinary thing,
    // and the document it left open was not read for a month (D-249).
    await closeOpenDocuments(tx, run, tenantId, now, actor.id)

    await repo.insertFrame(runId, { ...frame, lockedAt: now }, tx)
    await append(
      tx,
      run,
      'frame_locked',
      {
        decision: frame.decision,
        assumptions: frame.assumptions,
        position: frame.position,
        confidence: frame.confidence,
      },
      { actorId: actor.id, occurredAt: now },
    )

    const moved = transition(run, 'working', { cause: 'frame_locked', at: now })
    await append(tx, run, 'lifecycle', moved.payload, { actorId: actor.id, occurredAt: now })

    // `confidence_at_frame` is the first of the run's three confidence readings (06 §3.4): the
    // Confidence Line is drawn from it, the lock, and the Turn (FR-133).
    const next = await repo.updateRun(
      tenantId,
      runId,
      { ...moved.patch, confidenceAtFrame: frame.confidence },
      tx,
    )
    if (!next) runNotFound()
    return next
  })

  return toRunSummary(updated)
}

// ---------------------------------------------------------------------------------------------
// The Decision Brief, the Decision Lock, the addendum and the auto-lock (FR-084, FR-100 to FR-108,
// PRD §7.10, 10 §6, 10 §8)
//
// This is the end of the working period, and three rules run through all of it.
//
//   1. **The gate is an order, not a set of checks.** `./lock.ts` holds it: validate, then mark
//      reliance from the named fields, then read the relied-on claims with no stance. Every function
//      below goes through `planDecisionLock`, so the student's lock and the clock's own auto-lock
//      cannot drift apart (FR-084, FR-101, D-044).
//   2. **A refusal is part of the record.** A lock the student asked for and did not get writes
//      `lock_refused` and commits it, then throws. The alternative — rolling the refusal back — would
//      lose both the event and the reliance FR-101 has just recorded from their own figures, and a
//      reader of the trace would see a student who locked first time.
//   3. **What is locked is immutable.** `run_briefs` has no update path past `locked_at` in this
//      service *and* none in the database: the `run_briefs_locked` trigger (migration 0006) refuses
//      any UPDATE of a locked row, and `run_addenda` and `run_frames` have no UPDATE grant at all
//      (migration 0009). FR-102's "the lock is irreversible" is a grant rather than a habit.
// ---------------------------------------------------------------------------------------------

/**
 * The brief as the student reads it back (07 §10); `autoLocked` and `speedOutlier` never travel.
 *
 * The column is `rationale` and the field is `briefRationale` (D-329): the short name belongs to a
 * claim's authored rationale in every student payload, and this is the student's own prose. The
 * translation happens here, in the one constructor of the view, so no caller has to know.
 */
function toBriefView(row: repo.RunBrief): BriefView {
  return {
    recommendation: row.recommendation,
    briefRationale: row.rationale,
    assumptions: row.assumptions,
    changeMyMind: row.changeMyMind,
    confidence: row.confidence,
    namedValues: row.namedValues,
    updatedAt: row.draftUpdatedAt.toISOString(),
    lockedAt: row.lockedAt ? row.lockedAt.toISOString() : null,
  }
}

/** The addendum, rendered separately from the brief on every screen (FR-107). */
function toAddendumView(row: repo.RunAddendum): AddendumView {
  return { text: row.text, createdAt: row.createdAt.toISOString() }
}

/** The stored brief as the lock's candidate, or the empty one when nothing was ever saved. */
function briefFieldsOf(row: repo.RunBrief | undefined): BriefFields {
  if (!row) return EMPTY_BRIEF
  return {
    recommendation: row.recommendation,
    rationale: row.rationale,
    assumptions: row.assumptions,
    changeMyMind: row.changeMyMind,
    confidence: row.confidence,
    namedValues: row.namedValues,
  }
}

/**
 * The draft's rules (FR-100, FR-103), applied where every other input rule is: in the service.
 *
 * The limits are the lock's own limits, and that is the decision rather than an oversight (D-291):
 * a field the student is over the limit on is a field they cannot file, the editor counts the same
 * words from the same schema as it types, and a save that arrived over the limit came from a client
 * that ignored its own counter. What the draft does *not* require is that a field be filled — a
 * brief is written a paragraph at a time.
 */
function validateBriefDraft(input: BriefDraftInput): repo.BriefDraft {
  const parsed = BriefDraftSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    if (!issue) briefInvalid('brief', 'invalid')
    const field = issue.path.length > 0 ? issue.path.join('.') : 'brief'
    briefInvalid(field, briefReasonOf(issue.code, issue.message, field))
  }

  // Only the keys the editor sent: an autosave carries the field that changed, and spreading an
  // `undefined` into the update would blank a column the student never touched.
  const draft: repo.BriefDraft = {}
  const value = parsed.data
  if (value.recommendation !== undefined) draft.recommendation = value.recommendation
  if (value.rationale !== undefined) draft.rationale = value.rationale
  if (value.assumptions !== undefined) draft.assumptions = value.assumptions
  if (value.changeMyMind !== undefined) draft.changeMyMind = value.changeMyMind
  if (value.confidence !== undefined) draft.confidence = value.confidence
  if (value.namedValues !== undefined) draft.namedValues = value.namedValues
  return draft
}

/** Which of FR-100's rules a draft field broke; the same three words `frameReasonOf` answers. */
function briefReasonOf(code: string, message: string, field: string): FrameInvalidReason {
  if (message === 'WORD_LIMIT') return 'word_limit'
  if (code === 'too_small' && !field.startsWith('confidence')) return 'required'
  return 'invalid'
}

/**
 * `PUT /runs/{runId}/brief` (07 §7, FR-100): saves the draft, and answers 204.
 *
 * It writes no trace event. A draft is a scratchpad row until the Decision Lock — the same reading
 * `answerReadinessItem` makes of an answer — and an event per keystroke would make the trace a
 * record of typing rather than of the decision. What the trace does hold about the editor is
 * `brief_opened` and `brief_closed`, which is how long it was open rather than what was in it.
 */
export async function saveBriefDraft(
  actor: SessionUser,
  runId: string,
  input: BriefDraftInput,
): Promise<void> {
  const scope = await requireRunOwner(actor, runId)
  const tenantId = scope.organizationId
  const draft = validateBriefDraft(input)

  await repo.withTransaction(async (tx) => {
    const run = await lockRunForMutation(tx, tenantId, runId)
    assertBriefWritable(run.state)

    // `undefined` when the row is already locked. The state gate above has just answered the same
    // question from the run, and the two cannot disagree under the row lock — but the row is what
    // the database trigger protects, so this is the answer that cannot be wrong.
    const row = await repo.upsertBriefDraft(runId, draft, tx)
    if (!row) briefAlreadyLocked()
  })
}

/**
 * `POST /runs/{runId}/brief/signals` (07 §7, FR-100): the editor was opened, or closed.
 *
 * Two events with no row behind them: how long the student spent on the brief is a reading the
 * replay's clock timeline draws, and it comes from the instants these two are stamped at.
 *
 * Both are refused outside `working`, and a `brief_closed` that arrives after the clock ran out is
 * lost with the state it belonged to. That is the honest record rather than a gap: the auto-lock
 * happened while the editor was open, and an event written after it saying the editor closed would
 * put a moment of the working period after the moment the working period ended.
 */
export async function briefSignal(
  actor: SessionUser,
  runId: string,
  input: BriefSignalInput,
): Promise<void> {
  const scope = await requireRunOwner(actor, runId)
  const tenantId = scope.organizationId

  await repo.withTransaction(async (tx) => {
    const run = await lockRunForMutation(tx, tenantId, runId)
    assertBriefWritable(run.state)

    const now = new Date()
    const opts = { actorId: actor.id, occurredAt: now }
    if ('opened' in input) await append(tx, run, 'brief_opened', {}, opts)
    else await append(tx, run, 'brief_closed', { duration_ms: input.durationMs }, opts)
  })
}

/** What one attempt at the lock came to: the run as it now stands, or the refusal to raise. */
type LockOutcome =
  | { kind: 'locked'; run: repo.Run }
  | { kind: 'refused'; plan: Exclude<LockPlan, { outcome: 'lock' }> }

/**
 * `POST /runs/{runId}/lock` (07 §7, FR-084, FR-102): the Decision Lock.
 *
 * The order is `./lock.ts`'s and the two refusals are FR-084's and FR-100's. Both are committed
 * before they are thrown (rule 2 of this section's header), which is why the transaction answers a
 * `LockOutcome` instead of throwing from inside it: a `lock_refused` event rolled back is a refusal
 * that never happened, and the `claim_used` marks FR-101 wrote from the student's own figures would
 * roll back with it — so the same brief sent again would meet a different gate.
 *
 * FR-108 is what is *not* here: nothing writes the draft. A refused lock leaves the row exactly as
 * the student's last autosave left it, and the screen they are returned to is the one they were on.
 */
export async function lockDecision(
  actor: SessionUser,
  runId: string,
  input: BriefInput,
): Promise<RunSummary> {
  const scope = await requireRunOwner(actor, runId)
  const tenantId = scope.organizationId

  const outcome = await repo.withTransaction<LockOutcome>(async (tx) => {
    const run = await lockRunForMutation(tx, tenantId, runId)
    assertBriefWritable(run.state)

    const now = new Date()
    const plan = await planDecisionLock({ ...input }, 'student', lockSteps(tx, run, actor.id, now))
    if (plan.outcome !== 'lock') {
      await append(tx, run, 'lock_refused', refusalPayload(plan), {
        actorId: actor.id,
        occurredAt: now,
      })
      return { kind: 'refused', plan }
    }
    return {
      kind: 'locked',
      run: await commitDecisionLock(tx, run, plan, 'student', now, actor.id),
    }
  })

  if (outcome.kind === 'refused') raiseLockRefusal(outcome.plan)
  return toRunSummary(outcome.run)
}

/** The two effects the gate performs, bound to this transaction's run (see `./lock.ts`). */
function lockSteps(tx: repo.Tx, run: repo.Run, actorId: string | null, at: Date) {
  return {
    markNamedFields: (namedValues: Record<string, number>) =>
      markReliedOnFromNamedFields(tx, run, namedValues, { actorId, at }),
    findUnstanced: () => findUnstancedReliedOn(tx, run),
  }
}

/** `lock_refused` (10 §10): why the lock did not happen, in the payload the replay reads. */
function refusalPayload(plan: Exclude<LockPlan, { outcome: 'lock' }>) {
  if (plan.outcome === 'unstanced') {
    return {
      reason: 'unstanced_relied_on' as const,
      claim_id: plan.claim.claimId,
      claim_text: plan.claim.claimText,
    }
  }
  return { reason: 'brief_invalid' as const, field: plan.field }
}

/** The refusal itself, raised after the event that recorded it has committed. */
function raiseLockRefusal(plan: Exclude<LockPlan, { outcome: 'lock' }>): never {
  if (plan.outcome === 'unstanced') {
    lockRefusedUnstancedClaim(plan.claim.claimId, plan.claim.claimText)
  }
  briefInvalid(plan.field, plan.reason)
}

/**
 * Writes the lock: the frozen brief, the `decision_locked` event, the transition, and the Turn's
 * clock (FR-102, FR-106, FR-110).
 *
 * One function for both ways in, because the record must not be able to tell them apart except by
 * the two fields that say so — `auto` on the event and `auto_locked` on the row. Everything else is
 * the same: the same brief fields, the same relied-on lists, the same elapsed reading, the same
 * Turn delay measured from the same instant.
 *
 * `at` is that instant, and for the auto-lock it is the moment the clock reached zero rather than
 * the moment somebody looked (NFR-002, 10 §8). `turn_due_at` is measured from it too, so a run
 * whose browser was shut for an hour comes back with the Turn already due and the cascade in
 * `materializeTimersTx` delivers it — which is what would have happened had anyone been watching.
 */
async function commitDecisionLock(
  tx: repo.Tx,
  run: repo.Run,
  plan: Extract<LockPlan, { outcome: 'lock' }>,
  mode: LockMode,
  at: Date,
  actorId: string | null,
): Promise<repo.Run> {
  const tenantId = run.organizationId
  const auto = mode === 'auto'
  const brief = plan.brief

  // 10 §6: "a document open without a close is closed by the next open or by lock" — and only by a
  // lock the student pressed. An explicit lock is an act by someone who is present: whatever they
  // had open, they stopped reading it to file the decision, so `at` is the instant the reading
  // ended and `readingOf` answers about a reading that is over.
  //
  // The auto-lock's instant is not that. The clock ran out on a student who may be absent (FR-117)
  // or may still be reading, and closing at the expiry would read D-082's skim flag off the part of
  // the open the clock happened to see — a document opened two seconds before zero and read for an
  // hour would be filed as a two-second skim, which is exactly the mistake D-250 exists to prevent.
  // So an auto-lock leaves an open open, and the close that eventually arrives records the reading
  // it was, capped at the clock by `cappedDurationMs`'s fall back to `decision_locked_at`. That is
  // what `closeDocument`'s missing state gate is for, and losing it would lose the longest read of
  // the run (D-299).
  if (!auto) await closeOpenDocuments(tx, run, tenantId, at, actorId)

  const elapsedMs = elapsedWorkingMs(run, at)
  const speedOutlier = isSpeedOutlier(elapsedMs)

  const locked = await repo.lockBrief(
    run.id,
    { ...brief, lockedAt: at, autoLocked: auto, speedOutlier },
    tx,
  )
  if (!locked) briefAlreadyLocked()

  const relied = await findReliedOn(tx, run)
  await append(
    tx,
    run,
    'decision_locked',
    {
      recommendation: brief.recommendation,
      rationale: brief.rationale,
      assumptions: brief.assumptions,
      change_my_mind: brief.changeMyMind,
      named_values: brief.namedValues,
      confidence: brief.confidence,
      auto,
      speed_outlier: speedOutlier,
      relied_on_claim_ids: relied.map((claim) => claim.claimId),
      unstanced_relied_on_claim_ids: plan.unstanced.map((claim) => claim.claimId),
      elapsed_ms: elapsedMs,
    },
    { actorId, occurredAt: at },
  )

  const moved = transition(run, 'decision_locked', {
    cause: auto ? 'clock_expired' : 'decision_locked',
    at,
  })
  await append(tx, run, 'lifecycle', moved.payload, { actorId, occurredAt: at })

  const next = await repo.updateRun(
    tenantId,
    run.id,
    {
      ...moved.patch,
      confidenceAtLock: brief.confidence,
      turnDueAt: turnDueAtFrom(at, run.turnDelaySeconds),
    },
    tx,
  )
  if (!next) runNotFound()
  return next
}

/**
 * 10 §8 branch 2: the working clock reached zero, so the decision locks itself (FR-105, D-044).
 *
 * It locks *whatever exists*. An empty brief is recorded empty — this is the only way a brief with
 * no recommendation is ever stored, because `BriefSchema` refuses one from a student — and the
 * relied-on claims with no stance are recorded unstanced rather than accepted, which is FR-105's
 * own sentence and the thing that keeps a run out of time from being read as a run that agreed.
 *
 * Nobody did it, so `actorId` is null on every event it writes.
 */
async function autoLockDecision(tx: repo.Tx, run: repo.Run, at: Date): Promise<repo.Run> {
  const draft = await repo.findBrief(run.id, tx)
  const plan = await planDecisionLock(briefFieldsOf(draft), 'auto', lockSteps(tx, run, null, at))
  return commitDecisionLock(tx, run, plan, 'auto', at, null)
}

// ---------------------------------------------------------------------------------------------
// The addendum (FR-107)
// ---------------------------------------------------------------------------------------------

/**
 * The states an addendum may be written in: after the lock, before the record (10 §6).
 *
 * Read from `decision_locked_at` rather than from a list of state names, because that column *is*
 * the fact the rule is about — the decision was filed — and a list would have to be revisited every
 * time the machine gains a state. `recorded` is the end of it, and a voided run is excluded because
 * it counts for nothing (FR-002): an addendum to a discarded attempt is a note nobody will read.
 */
function addendumOpen(run: repo.Run): boolean {
  if (run.decisionLockedAt === null) return false
  return run.state !== 'recorded' && run.state !== 'voided'
}

/**
 * The frozen record of a filed decision, for UI-024 (`/runs/[runId]/locked`; D-302).
 *
 * The owner alone, like the workspace: a reviewer replays a run from its trace after it is scored
 * (FR-180), and this is the screen the student stands on while they wait for the Turn.
 *
 * Timers first, and that is the point of doing it here rather than trusting the caller: a student
 * who left the page open through the Turn delay is moved on by this read, so the page they get back
 * is the one their run is actually on (D-042). A run that has not locked a decision has no record to
 * show, and is refused with the state it is in so a stale screen can follow `links.next`.
 *
 * It writes nothing and it is not an endpoint. Nothing polls it — the RunFrame's poll of
 * `GET /runs/{runId}` is what notices the Turn falling due and refreshes this tree — so adding a
 * route would publish a shape no client asks for.
 */
export async function getDecision(actor: SessionUser, runId: string): Promise<DecisionRecord> {
  const scope = await requireRunOwner(actor, runId)
  const tenantId = scope.organizationId

  const first = await repo.findRunWithLabels(tenantId, runId)
  if (!first) runNotFound()
  let run = first.run
  if (await materializeTimers(scope, run)) {
    const again = await repo.findRunWithLabels(tenantId, runId)
    if (!again) runNotFound()
    run = again.run
  }
  if (run.decisionLockedAt === null) decisionNotLocked(run.state)

  const [scenario, frame, brief, addendum] = await Promise.all([
    getStudentScenario(actor, runId),
    repo.findFrame(runId),
    repo.findBrief(runId),
    repo.findAddendum(runId),
  ])

  return guardStudentPayload(
    {
      run: toRunSummary(run),
      frame: frame
        ? {
            decision: frame.decision,
            assumptions: frame.assumptions,
            position: frame.position,
            confidence: frame.confidence,
            lockedAt: frame.lockedAt.toISOString(),
          }
        : null,
      brief: brief ? toBriefView(brief) : null,
      namedFields: scenario.namedFields.map((field) => ({
        key: field.key,
        label: field.label,
        unit: field.unit,
      })),
      addendum: addendum ? toAddendumView(addendum) : null,
      canAddAddendum: addendumOpen(run) && addendum === undefined,
      turnRemainingMs:
        run.turnDueAt === null ? null : Math.max(0, run.turnDueAt.getTime() - Date.now()),
    },
    run,
  )
}

/**
 * `POST /runs/{runId}/addendum` (07 §7, FR-107): the one fifty-word note after the lock.
 *
 * It is not an edit and is never shown as one. The brief stays exactly as it was filed, the
 * addendum is its own row with its own timestamp, and every screen renders the two apart — which is
 * the whole of FR-107's "never part of the original decision".
 *
 * One per run. The second attempt is refused by the primary key rather than by a read-then-write,
 * so two presses of the same button cannot both land.
 */
export async function addAddendum(
  actor: SessionUser,
  runId: string,
  input: AddendumInput,
): Promise<void> {
  const scope = await requireRunOwner(actor, runId)
  const tenantId = scope.organizationId

  const parsed = AddendumSchema.safeParse(input)
  if (!parsed.success) {
    addendumInvalid(parsed.error.issues[0]?.message === 'WORD_LIMIT' ? 'word_limit' : 'required')
  }
  const text = parsed.data.text

  await repo.withTransaction(async (tx) => {
    const run = await lockRunForMutation(tx, tenantId, runId)
    if (!addendumOpen(run)) addendumNotAvailable(run.state)

    const row = await repo.insertAddendum(runId, text, tx)
    if (!row) addendumExists()

    await append(tx, run, 'addendum', { text }, { actorId: actor.id, occurredAt: new Date() })
  })
}

// ---------------------------------------------------------------------------------------------
// The Turn (FR-110 to FR-115, PRD §7.11, 10 §6, 10 §8 branches 3 and 4)
//
// The run's last act before it is on its own. Four rules run through everything below; the
// arithmetic behind them is `./turn.ts` and the reasons are there.
//
//   1. **The Turn fires on a clock and is delivered by a read.** `turn_delivered` is stamped at
//      `turn_due_at` however long afterwards the read arrives (NFR-002); the window's twelve
//      minutes start at the read, so a student who was offline gets all of them (FR-115, D-043).
//   2. **The window is a room with its own clock.** The assistant, the Evidence Room and the
//      interrogation actions reopen (FR-111) and each of them reads `turn_open` for itself —
//      `ROOM_STATES` and `ASSISTANT_STATES` here, `RELIANCE_STATES` one module along — and charges
//      the window rather than the working clock, which ended at the Decision Lock (D-132). Nothing
//      in this section had to be added for that: the states were already listed.
//   3. **A claim the window raises is relied on by rule** (D-077), which `reliance.surfaceClaims`
//      applies from the run's own clock, and the response is refused while any of them has no
//      stance (FR-111) — FR-084's gate one state later.
//   4. **The response and the implicit hold are one function.** `lockTurnResponse` writes both, so
//      the record cannot tell them apart except by the field that says so, exactly as the student's
//      lock and the clock's auto-lock share `commitDecisionLock`.
// ---------------------------------------------------------------------------------------------

/**
 * 10 §8 branch 3: the Turn falls due, so it is delivered and the window opens (FR-110, FR-115).
 *
 * Three writes and a surfacing, in the order they happened and all under the run's row lock.
 *
 * `turn_delivered` is appended **before** the run moves, so the event carries the run as it was when
 * the Turn fired — the state was `decision_locked` and no clock was running, which is the honest
 * `clock_remaining_ms` for an instant the window had not opened at (D-334). The claims are surfaced
 * **after** it, from the row this transaction has just written, because `surfaceClaims` reads the
 * run's state to decide whether the window's rule applies: surfaced against the old row they would
 * be ordinary claims, and D-077's "relied on by rule" would silently not happen.
 *
 * `actorId` is null on every event: nobody did this, the clock did.
 */
async function deliverTurn(tx: repo.Tx, run: repo.Run, at: Date, now: Date): Promise<repo.Run> {
  const tenantId = run.organizationId
  const turn = await repo.findRunTurn(tenantId, run.id, tx)
  // Unreachable through the product: `TURN_MISSING` (10 §4) refuses to confirm a version without a
  // Turn, and an assignment refuses an unconfirmed version (10 §3). If it happens anyway, the run
  // stays in `decision_locked` — a window with nothing in it is worse than a Turn that is late —
  // and the anomaly is logged where it will be read rather than turned into a 500 on a poll.
  if (!turn) {
    getLogger().warn(
      { event: 'turn_missing', runId: run.id, packageVersionId: run.packageVersionId },
      'the run’s package version has no Turn, so none was delivered',
    )
    return run
  }

  const plan = planTurnDelivery(at, now)
  await append(
    tx,
    run,
    'turn_delivered',
    {
      turn_id: turn.id,
      text: turn.text,
      voice: turn.voice,
      window_ends_at: plan.windowEndsAt.toISOString(),
      window_claim_ids: turn.windowClaimIds,
    },
    { actorId: null, occurredAt: plan.firedAt },
  )

  const moved = transition(run, 'turn_open', { cause: 'turn_due', at: plan.deliveredAt })
  await append(tx, run, 'lifecycle', moved.payload, {
    actorId: null,
    occurredAt: plan.deliveredAt,
  })

  const next = await repo.updateRun(
    tenantId,
    run.id,
    { ...moved.patch, turnWindowEndsAt: plan.windowEndsAt },
    tx,
  )
  if (!next) runNotFound()

  await surfaceClaims(tx, next, turn.windowClaimIds, 'turn', turn.id, plan.deliveredAt)
  return next
}

/**
 * The end of the Turn, whoever ended it: the student's response (FR-112) or the window running out
 * (FR-113).
 *
 * One function for both, because the record must not be able to tell them apart except by the two
 * fields that say so — `implicit` on the row and on the event — and because the transitions are the
 * same pair either way. `turn_open → turn_locked → defense_pending` happens **in one transaction**
 * (10 §6): `turn_locked` is not a state a student ever sits in, it is the instant the response
 * became immutable, and a run left there by a crash between two transactions would be a run with no
 * screen to be on.
 *
 * `confidence_after_turn` is the third reading of the Confidence Line (FR-133) and is written only
 * when there is one. An implicit hold leaves it null: nobody gave a confidence, and carrying the
 * lock's forward would draw a line through a point the student never marked.
 */
async function lockTurnResponse(
  tx: repo.Tx,
  run: repo.Run,
  fields: TurnResponseFields,
  at: Date,
  actorId: string | null,
): Promise<repo.Run> {
  const tenantId = run.organizationId

  await repo.insertTurnResponse(
    run.id,
    {
      response: fields.response,
      justification: fields.justification,
      confidence: fields.confidence,
      implicit: fields.implicit,
      lockedAt: at,
    },
    tx,
  )

  await append(
    tx,
    run,
    'turn_response_locked',
    {
      response: fields.response,
      justification: fields.justification,
      confidence: fields.confidence,
      implicit: fields.implicit,
    },
    { actorId, occurredAt: at },
  )

  const locked = transition(run, 'turn_locked', {
    cause: fields.implicit ? 'turn_window_expired' : 'turn_response_locked',
    at,
  })
  await append(tx, run, 'lifecycle', locked.payload, { actorId, occurredAt: at })

  // 10 §9: `turn_locked → defense_pending` is automatic and stamps nothing. It is applied to the
  // state the first transition just produced rather than to the run row, which this transaction has
  // not written yet — the two patches are merged and committed once.
  const pending = transition({ state: locked.patch.state }, 'defense_pending', {
    cause: 'automatic',
    at,
  })
  await append(tx, run, 'lifecycle', pending.payload, { actorId, occurredAt: at })

  const next = await repo.updateRun(
    tenantId,
    run.id,
    {
      ...locked.patch,
      ...pending.patch,
      ...(fields.confidence === null ? {} : { confidenceAfterTurn: fields.confidence }),
    },
    tx,
  )
  if (!next) runNotFound()
  return next
}

/**
 * `GET /runs/{runId}/turn` (07 §7, FR-110 to FR-112): the Turn, its window, and the frozen record.
 *
 * Timers first and without a lock when nothing has fired (D-229): this is the read that *delivers*
 * the Turn for a student who navigated straight to it, and it is polled beside `GET /runs/{runId}`
 * for the countdown. A run that is not in the window is refused with the state it is in, so the
 * screen follows the run's own `links.next` — before `turn_due_at` that is `/runs/[id]/locked` and
 * after the response it is `/runs/[id]/defense`.
 *
 * The claims are not on it, and the authored `window_claim_ids` never is (D-336): the student meets
 * the claims through `GET /runs/{runId}/claims`, which is the shape that carries a stance, the
 * actions run on it and the escalation reply, and which the Turn screen composes beside this one
 * exactly as the workspace does (D-268). What is here is the Turn itself, the window, and what the
 * student decided before it arrived.
 */
export async function getTurn(actor: SessionUser, runId: string): Promise<TurnView> {
  const scope = await requireRunOwner(actor, runId)
  const tenantId = scope.organizationId

  const first = await repo.findRunWithLabels(tenantId, runId)
  if (!first) runNotFound()
  let run = first.run
  if (await materializeTimers(scope, run)) {
    const again = await repo.findRunWithLabels(tenantId, runId)
    if (!again) runNotFound()
    run = again.run
  }
  if (run.state !== 'turn_open' || !run.turnWindowEndsAt) turnNotOpen(run.state)

  const [turn, scenario, frame, brief] = await Promise.all([
    repo.findRunTurn(tenantId, runId),
    getStudentScenario(actor, runId),
    repo.findFrame(runId),
    repo.findBrief(runId),
  ])
  // The delivery that put this run in `turn_open` read the same row, so there is one.
  if (!turn) runNotFound()

  return guardStudentPayload(
    {
      run: toRunSummary(run),
      text: turn.text,
      voice: turn.voice,
      windowEndsAt: run.turnWindowEndsAt.toISOString(),
      remainingMs: Math.max(0, remainingWindowMs(run) ?? 0),
      frozen: {
        frame: frame
          ? {
              decision: frame.decision,
              assumptions: frame.assumptions,
              position: frame.position,
              confidence: frame.confidence,
              lockedAt: frame.lockedAt.toISOString(),
            }
          : null,
        brief: brief ? toBriefView(brief) : null,
      },
      namedFields: scenario.namedFields.map((field) => ({
        key: field.key,
        label: field.label,
        unit: field.unit,
      })),
    },
    run,
  )
}

/**
 * `POST /runs/{runId}/turn/response` (07 §7, FR-112): hold, revise or reverse, and the run moves on
 * to the defense.
 *
 * The order is the rule. The state gate is first, under the run's row lock and after the timers have
 * been materialized, so a response that arrives a moment after the window closed meets the implicit
 * hold its own read has just written rather than overwriting it (`TURN_NOT_OPEN` with
 * `details.state`). The response's own rules come next, and FR-111's gate last: a student whose
 * justification is 300 words is told about their justification, not about a claim.
 *
 * `TURN_CLAIMS_UNSTANCED` is thrown rather than recorded, and that is the difference from the
 * Decision Lock's refusal (D-293). FR-084's gate has an effect to preserve — the reliance
 * `markReliedOnFromNamedFields` wrote from the student's own figures — so its refusal commits and is
 * raised afterwards. This one has nothing to preserve: it reads the claims and writes nothing, so
 * the transaction rolls back with the run exactly where it was, and the student takes the stance
 * their claim cards are already asking for and files again.
 */
export async function respondToTurn(
  actor: SessionUser,
  runId: string,
  input: TurnResponseInput,
): Promise<RunSummary> {
  const scope = await requireRunOwner(actor, runId)
  const tenantId = scope.organizationId

  const updated = await repo.withTransaction(async (tx) => {
    const run = await lockRunForMutation(tx, tenantId, runId)
    if (run.state !== 'turn_open') turnNotOpen(run.state)

    const plan = planTurnResponse(input)
    if (!plan.ok) turnResponseInvalid(plan.field, plan.reason)

    const unstanced = await findUnstancedWindowClaims(tx, run)
    if (unstanced.length > 0) turnClaimsUnstanced(unstanced.map((claim) => claim.claimId))

    return lockTurnResponse(tx, run, plan.fields, new Date(), actor.id)
  })

  return toRunSummary(updated)
}

// ---------------------------------------------------------------------------------------------
// The forced-failure test control (FR-118, 12 §4 A04)
// ---------------------------------------------------------------------------------------------

/**
 * `POST /review/runs/{runId}/test-controls/force-assistant-failure` (07 §7, FR-118): arms one
 * assistant failure on a live run.
 *
 * Three gates, in this order and no other. `requireRunInstructor` first, so a student — who holds a
 * membership on the section and therefore reaches FORBIDDEN rather than NOT_FOUND — is refused
 * before the environment is consulted; `flags.testControls` second, because whether the
 * installation offers test controls is a fact about the deployment and telling somebody who may not
 * use them is telling them something about the run (08 §4, 12 §4). The run's own state third, under
 * the row lock, because it is the only one of the three that can change while the request is in
 * flight (D-332): a run whose decision is filed, or one that has not unlocked the assistant, has no
 * delegation for the outage to land on, and arming there wrote a flag mutation and an audit row
 * against a run nothing would ever read them on.
 *
 * It writes no trace event. Nothing has happened *in the run*: the flag is armed, and what the run
 * records is the outage it causes — the `pause` event the next delegation writes, with its cause and
 * the delegation it belongs to (FR-001). The audit row is where the instructor's act is recorded,
 * which is 08 §4's "test-control use" and 12 §4's A04.
 *
 * **The student is never told a control did this.** The paused overlay says the assistant did not
 * answer, that their clock stopped and that nothing is lost, in those words and no others.
 */
export async function forceAssistantFailure(
  actor: SessionUser,
  runId: string,
): Promise<ForcedFailure> {
  const scope = await requireRunInstructor(actor, runId)
  if (!flagsFromEnv(env).testControls) testControlsDisabled()
  const tenantId = scope.organizationId

  await repo.withTransaction(async (tx) => {
    const run = await lockRunForMutation(tx, tenantId, runId)
    assertForcedFailureArmable(run.state)
    const updated = await repo.updateRun(
      tenantId,
      runId,
      { flags: { ...run.flags, forced_failure_armed: true } },
      tx,
    )
    if (!updated) runNotFound()

    await audit(tx, {
      actorId: actor.id,
      orgId: tenantId,
      action: 'test_control.force_failure',
      targetType: 'run',
      targetId: runId,
      metadata: { armed: true },
    })
  })

  return { armed: true }
}

// ---------------------------------------------------------------------------------------------
// Pause and resume (FR-001, 10 §6, 10 §10, D-133)
//
// "When the assistant, a document, or an interrogation action fails to return, the run enters
// Paused, the working clock (or Turn window) stops, and the cost charged for the failed action is
// credited back on resume." It is one of the PRD's standing rules, and it is the reason this
// section exists in the module that owns the clock rather than in each module that can fail.
//
// The three functions below are the seam other modules reach it through, and they come in two
// shapes for a reason 08 §5 fixes.
//
//   * `pauseRun`, `lockRunForMutation` and `noteFirstDelegation` take a transaction and a run row
//     rather than an actor, exactly like `trace.append` and `reliance.surfaceClaims`: they are
//     called from inside another module's mutation, which has already named its actor, run its
//     permission helper, and taken the run row's lock. None of them is reachable from a route.
//   * `resumeRun` takes an actor, because the student presses Resume (07 §7). It is an ordinary
//     service function and starts with its guard.
// ---------------------------------------------------------------------------------------------

/**
 * The run columns a pause reads and writes: the trace's three, the clock's, and the state the
 * transition table is applied to.
 *
 * Structural rather than the Drizzle row, for the reason `reliance.SurfacingRun` is: a caller in
 * another module holds a `Run` from `lockRunForMutation` and this says which parts of it are used.
 */
export type PausingRun = TraceRun & ClockRun & { state: RunStateValue }

export type PauseOptions = {
  /** The delegation whose failure caused it, when there was one (06 §3.4, FR-001). */
  relatedDelegationId?: string | null
  /**
   * What the resume gives back to the clock (10 §10): a delegation 0, an interrogation action its
   * cost, an escalation 300,000 ms.
   *
   * It is recorded at the pause rather than computed at the resume because this is where the number
   * is known — the caller is the code that just charged it — and because `run_pauses.credited_ms`
   * is then the whole answer to "what did this outage cost the student", readable without
   * reconstructing which action was in flight.
   */
  creditMs?: number
  actorId?: string | null
  at?: Date
}

/**
 * The locked run row a mutation in another module may act on: `select … for update`, with every
 * timer that has already fired applied to it (rule 4 of this file's header).
 *
 * Handing this out rather than the raw `findRunForUpdate` is what keeps the timer rule total. A
 * module that locked the row itself would be applying its own rules to a run that should already
 * have auto-locked, and the defect would show up as a delegation answered after the clock ran out.
 */
export async function lockRunForMutation(
  tx: repo.Tx,
  tenantId: string,
  runId: string,
  now: Date = new Date(),
): Promise<repo.Run> {
  const locked = await repo.findRunForUpdate(tenantId, runId, tx)
  if (!locked) runNotFound()
  return materializeTimersTx(tx, locked, now)
}

/**
 * Stamps `first_delegation_at` the first time the assistant is used (10 §7), and answers the row.
 *
 * It writes no event, because nothing happened in the run that the `delegation` event does not
 * already say. The column exists for the flag on the other side: `document_open` records
 * `before_first_delegation`, which is FR-022's measure of reading the room rather than asking about
 * it, and that flag is read off this column at the instant the document is opened.
 */
export async function noteFirstDelegation(
  tx: repo.Tx,
  run: repo.Run,
  at: Date = new Date(),
): Promise<repo.Run> {
  if (run.firstDelegationAt !== null) return run
  const updated = await repo.updateRun(run.organizationId, run.id, { firstDelegationAt: at }, tx)
  if (!updated) runNotFound()
  return updated
}

/**
 * Reads and clears `flags.forced_failure_armed` (FR-118), and says whether it was set.
 *
 * The test control that arms it is `forceAssistantFailure`, which an instructor presses from the
 * replay (Phase 8). It is consumed here rather than read, so one arming produces one outage: an
 * instructor demonstrating the standing rule to a class gets a paused run and a resume, not an
 * assistant that fails on every request until somebody remembers to turn it off.
 *
 * It lives in this module because `runs.flags` is this module's column and 12 §8.1 keeps the whole
 * container out of every student view — the flag says something about the run that its own student
 * may not read, and the fewer places that touch it the better.
 */
export async function consumeForcedAssistantFailure(
  tx: repo.Tx,
  run: repo.Run,
): Promise<{ run: repo.Run; armed: boolean }> {
  if (run.flags.forced_failure_armed !== true) return { run, armed: false }
  const flags = { ...run.flags }
  delete flags.forced_failure_armed
  const updated = await repo.updateRun(run.organizationId, run.id, { flags }, tx)
  if (!updated) runNotFound()
  return { run: updated, armed: true }
}

/**
 * Stops the clock on a component failure (FR-001, 10 §10) and records why.
 *
 * Three writes in the caller's transaction: the `run_pauses` row that says what failed, the `pause`
 * event, and the transition — `working → paused`, or `turn_open → paused` when the failure lands
 * inside the Turn window (D-133). The clock stops in both cases because both readings add the open
 * paused span back (`clock.ts`), so nothing here has to know which clock was running.
 *
 * It does not decide *whether* to pause: the caller has already failed, and a pause on a run that is
 * not in one of those two states is `ILLEGAL_TRANSITION` from the table rather than a silent no-op.
 */
export async function pauseRun(
  tx: repo.Tx,
  run: PausingRun,
  cause: PauseCauseValue,
  options: PauseOptions = {},
): Promise<repo.Run> {
  const at = options.at ?? new Date()
  const moved = transition(run, 'paused', { cause: 'component_failure', at })

  const pause = await repo.insertPause(
    run.id,
    {
      cause,
      pausedAt: at,
      creditedMs: Math.max(0, Math.round(options.creditMs ?? 0)),
      relatedDelegationId: options.relatedDelegationId ?? null,
    },
    tx,
  )

  await append(
    tx,
    run,
    'pause',
    {
      pause_id: pause.id,
      cause,
      related_delegation_id: options.relatedDelegationId ?? null,
    },
    { actorId: options.actorId ?? null, occurredAt: at },
  )
  await append(tx, run, 'lifecycle', moved.payload, {
    actorId: options.actorId ?? null,
    occurredAt: at,
  })

  const updated = await repo.updateRun(
    run.organizationId,
    run.id,
    { ...moved.patch, ...clockPause(run, at) },
    tx,
  )
  if (!updated) runNotFound()
  return updated
}

/**
 * `POST /runs/{runId}/resume` (07 §7, FR-001): the student takes the run back off Paused.
 *
 * The clock is given back the span the pause took — into `total_paused_ms` on the working clock, or
 * by moving `turn_window_ends_at` out when the failure landed inside the Turn window (D-133) — and
 * the failed component's cost is credited on top. **For a delegation that cost is zero**, and that
 * is not an omission: a delegation charges no clock at all (10 §7), so there is nothing to give
 * back, and the `resume` event says so with `clock_credited_ms: 0`. What the student gets back is
 * the wall-clock time the outage took, which is the whole of what it took from them.
 *
 * The run returns to the state it paused from, which the clock's own reading answers: a run paused
 * with the Turn delivered and its response not yet locked was in the window (D-133).
 */
export async function resumeRun(actor: SessionUser, runId: string): Promise<RunSummary> {
  const scope = await requireRunOwner(actor, runId)
  const tenantId = scope.organizationId

  const updated = await repo.withTransaction(async (tx) => {
    const run = await lockRunForMutation(tx, tenantId, runId)
    if (run.state !== 'paused') illegalTransition(run.state, 'working')

    const pause = await repo.findOpenPause(runId, tx)
    // A run reaches `paused` only through `pauseRun`, which writes the row in the same transaction,
    // so an open pause is always there. If it is not, the run's record is inconsistent and a
    // `resume` event with no pause to point at would make it worse.
    if (!pause) pauseRecordMissing(runId)

    const now = new Date()
    const target: RunStateValue = isInTurnWindow(run) ? 'turn_open' : 'working'
    const moved = transition(run, target, { cause: 'resumed', at: now })

    const { patch: clockPatch, pausedMs } = clockResume(run, now)
    const creditedMs = Math.max(0, pause.creditedMs)
    const creditPatch = credit(run, creditedMs)

    await repo.resumePause(runId, pause.id, { resumedAt: now, creditedMs }, tx)
    await append(
      tx,
      run,
      'resume',
      { pause_id: pause.id, paused_ms: pausedMs, clock_credited_ms: creditedMs },
      { actorId: actor.id, occurredAt: now },
    )
    await append(tx, run, 'lifecycle', moved.payload, { actorId: actor.id, occurredAt: now })

    const next = await repo.updateRun(
      tenantId,
      runId,
      { ...moved.patch, ...clockPatch, ...creditPatch },
      tx,
    )
    if (!next) runNotFound()
    return next
  })

  return toRunSummary(updated)
}

// ---------------------------------------------------------------------------------------------
// Test control: advancing the clock (D-109)
// ---------------------------------------------------------------------------------------------

/**
 * The environment gate on the test-only clock control (D-109).
 *
 * Both readings must say `test`. `env.APP_ENV` is the configuration the process was started with and
 * is parsed once; `process.env.APP_ENV` is read again on every call, so the route cannot outlive the
 * process's own declaration of itself as a test process — and so the guard is provable rather than
 * merely asserted, which is what `tests/integration/runs/readiness.test.ts` does with it. Neither
 * reading can be made *more* permissive than the other: both are required.
 *
 * Exported for the route, which applies it before `defineRoute` looks for a session, so that outside
 * a test process the path answers 404 rather than 401. Both call it: a guard that lives only in a
 * route is a guard one refactor away from being gone.
 */
export function assertTestEnvironment(): void {
  if (env.APP_ENV !== 'test' || process.env.APP_ENV !== 'test') testRouteUnavailable()
}

/**
 * Moves a run's clock columns back by `ms` and materializes whatever that makes true (D-109).
 *
 * It exists so a test can reach an expiry without waiting for one: timers are server timestamps
 * materialized lazily on read (ADR-019), so shifting the timestamps is the only honest way to make
 * one fire. It writes no event of its own, because nothing happened in the run — everything the
 * shift makes true is written by `materializeTimersTx` in the same transaction, stamped at the
 * instant the timer fired rather than now (NFR-002).
 *
 * Every deadline the run stores moves together, which is what makes one call able to reach a timer
 * two branches away: `readiness_started_at` moves with `readiness_expires_at` so the eight minutes
 * keep their length, `working_started_at` moves the working clock, and `turn_due_at` and
 * `turn_window_ends_at` move the Turn's two (D-109). A shift long enough to expire the working clock
 * therefore also brings the Turn delay forward by the same span, and the cascade in
 * `materializeTimersTx` applies each branch in turn — the same run a closed browser would come back
 * to (FR-117).
 */
export async function advanceRunClock(
  actor: SessionUser,
  runId: string,
  input: AdvanceClockInput,
): Promise<RunSummary> {
  assertTestEnvironment()
  const scope = await requireRunOwner(actor, runId)
  const tenantId = scope.organizationId

  const updated = await repo.withTransaction(async (tx) => {
    const locked = await repo.findRunForUpdate(tenantId, runId, tx)
    if (!locked) runNotFound()

    const shiftBack = (at: Date | null): Date | undefined =>
      at === null ? undefined : new Date(at.getTime() - input.ms)
    const patch: repo.RunPatch = {
      readinessStartedAt: shiftBack(locked.readinessStartedAt),
      readinessExpiresAt: shiftBack(locked.readinessExpiresAt),
      workingStartedAt: shiftBack(locked.workingStartedAt),
      turnDueAt: shiftBack(locked.turnDueAt),
      turnWindowEndsAt: shiftBack(locked.turnWindowEndsAt),
    }

    // A run whose clocks have not started has nothing to shift — `assigned`, before the policy
    // display is acknowledged. There is no write to make, and Drizzle refuses an empty `set`.
    const shifting = Object.values(patch).some((value) => value !== undefined)
    const shifted = shifting ? await repo.updateRun(tenantId, runId, patch, tx) : locked
    if (!shifted) runNotFound()
    return materializeTimersTx(tx, shifted)
  })
  return toRunSummary(updated)
}

/** The `R` property group every run event carries (17 §3). */
function runContext(
  run: RunRowForSummary & { packageVersionId: string },
  variantKey: VariantKeyValue,
): {
  run_id: string
  assignment_id: string
  package_version_id: string
  variant: VariantKeyValue
  mode: RunSummary['mode']
  attempt_no: number
  is_walkthrough: boolean
} {
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
