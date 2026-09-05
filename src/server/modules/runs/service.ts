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
import { track } from '@/server/analytics/track'
import { requireRunOwner, requireRunReviewer, requireSectionRole } from '@/server/auth/permissions'
import type { SessionUser } from '@/server/auth/types'
import { getAssignment, getPolicyDisplay } from '@/server/modules/courses'
import { getInstitutionSettings, listMyInstitutions } from '@/server/modules/tenancy'
import { append } from '@/server/modules/trace'
import { assignmentNotOpen, notSectionStudent, runActiveExists, runNotFound } from './errors'
import { READINESS_MS } from './limits'
import * as repo from './repository'
import type { RunRowForSummary, RunStatus, RunSummary, RunsQuery, VariantKeyValue } from './schema'
import { transition } from './state-machine'
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

/** What a branch of 10 §8 does: one state change, its events, and the row it leaves behind. */
type TimerApplier = (tx: repo.Tx, run: repo.Run, at: Date) => Promise<repo.Run>

/**
 * The branches of 10 §8 this build can apply, keyed by the timer that fires them.
 *
 * A branch with no entry is one no step has landed yet, and the table is read in both directions:
 * `dueTimer` will not report a timer nothing can act on, so a poll of a run waiting on an
 * unimplemented branch takes no lock and writes nothing, and the run stays where it is until the
 * step that lands the branch — which is what would have happened anyway.
 *
 *   * `readiness_expired` — auto-submit the check with the unanswered items as `unknown` and move
 *     to `framing`. Step 6.3, with the items, the answers and the concept map: an expiry that
 *     transitioned without writing `run_readiness_results` would leave a run nothing can score.
 *   * `decision_auto_lock` — auto-lock the decision at the instant the clock reached zero. Step 6.4
 *     opens `working`; Phase 8 writes the lock, which needs the brief draft and the relied-on claims.
 *   * `turn_delivery`, `turn_window_expired` — Phase 9.
 *   * `paused` is in none of them, by definition: the clock is frozen (FR-001), so `nextTimer`
 *     answers nothing for it.
 */
const TIMER_APPLIERS: Partial<Record<TimerBranch, TimerApplier>> = {}

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
    current = await apply(tx, current, timer.at)
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
  track(
    'run_started',
    {
      ...runContext(run, assignment.variantKey),
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
