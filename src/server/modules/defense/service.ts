// Service of the `defense` module (docs/tech/10-backend-spec-modules.md §9; 07-api-spec.md §7;
// 08-auth-authz.md §4). Step 9.2: the typed defense — six to nine questions drawn from the run's own
// record, one authored follow-up each, an answer per question, and the completion that hands the run
// to scoring (FR-025, FR-120 to FR-126, DATA-039, D-031, D-046, D-080, D-090, D-106).
//
// **The defense is what the student can say with no room in front of them.** That sentence is the
// whole design and it is enforced in three places, none of them here:
//
//   1. The trace, the Delegation Log and the claim table are all sealed for the owner through
//      `defense_pending` and `defense_complete`, by one rule in the module that owns them
//      (`trace.requireOwnerReadAccess`, D-279). There is no second tab that hands the room back.
//   2. The assistant and the Evidence Room refuse in these states from their own gates
//      (`ASSISTANT_STATES`, `ROOM_STATES` in `runs/service.ts`), which were already written that
//      way; nothing here had to be added for it.
//   3. What this module *does* hand over is the student's own work — the frame they locked, the
//      brief they filed, the addendum, the Turn response — read through the one function that owns
//      the frozen record (`runs.getDecision`, D-341), so the defense cannot show a field that read
//      does not.
//
// And what a *question* quotes is audited as carefully as what a payload carries. A rendered
// question necessarily quotes the run, so `selection.ts` is written so that nothing about which
// question is asked, in which order, or in which words, is a function of a claim's evidence status,
// its failure family or its plantedness — the reasons are in that file's header, and the invariant
// sweep in `tests/integration/security/student-view-invariants.test.ts` reads the payload back.
//
// Three imports need a word.
//
//   * `runs` (public) — `lockRunForMutation` is the seam every in-run mutation starts at; it takes
//     the row lock and materializes the run's timers, so a student whose Turn window expired while
//     they were away reaches the defense on the read that opens it rather than on some later poll.
//     `getDecision` is the frozen record (D-341); `markDefenseOpened` and `markDefenseComplete`
//     write the `runs` columns this module moves, because the state machine and `runs.flags` are
//     that module's (12 §8.1 keeps `flags` out of every student payload).
//   * `trace` — every run mutation appends its events in the transaction that made it (CLAUDE.md),
//     and `readEvents` is the record selection is a pure function of (10 §9).
//   * `jobs/enqueue` — D-046: `defense_complete` enqueues `score_run`, after the commit, so a job
//     never runs against a transaction that rolled back.
import { AppError, isAppError } from '@/lib/errors'
import { countWords, stripMarkup } from '@/lib/words'
import { assertNoForbiddenKeys } from '@/server/auth/student-view'
import { requireRunOwner } from '@/server/auth/permissions'
import type { SessionUser } from '@/server/auth/types'
import { enqueueAfterCommit } from '@/server/jobs/enqueue'
import {
  getDecision,
  lockRunForMutation,
  markDefenseComplete,
  markDefenseOpened,
  toRunSummary,
  type DecisionRecord,
  type RunSummary,
} from '@/server/modules/runs'
import { append, readEvents } from '@/server/modules/trace'
import {
  answerTooLong,
  defenseIncomplete,
  defenseNotOpen,
  questionAlreadyAnswered,
  questionNotFound,
  runNotFound,
} from './errors'
import { followUpReasonFor } from './follow-up'
import * as repo from './repository'
import { withTransaction, type Tx } from './repository'
import {
  DefenseAnswerSchema,
  type DefenseAnswerInput,
  type DefenseAnswerResult,
  type DefenseQuestion,
  type DefenseView,
} from './schema'
import { selectQuestions } from './selection'

/**
 * The states the defense exists in (10 §9).
 *
 * The read is served in both: a student who finishes and refreshes sees the interview they gave
 * rather than a 409 about a run that has done exactly what they asked it to. Every *mutation*
 * requires `defense_pending`, which is what makes the completion the end of it.
 */
const DEFENSE_STATES: readonly string[] = ['defense_pending', 'defense_complete']

/** FR-125: an answer of fewer than this many words counts as nothing said. */
const NOTHING_ANSWERED_WORDS = 3

// ---------------------------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------------------------

function toQuestionView(row: repo.RunQuestionWithAnswer): DefenseQuestion {
  return {
    runQuestionId: row.question.id,
    seq: row.question.seq,
    kind: row.kind,
    text: row.question.renderedText,
    answered: row.answer !== null,
    followUpOf: row.question.followUpOf,
    answer:
      row.answer === null
        ? null
        : { text: row.answer.text, answeredAt: row.answer.answeredAt.toISOString() },
  }
}

/**
 * The frozen record as the artifacts panel shows it (UI-026).
 *
 * Picked field by field from `DecisionRecord` rather than spread from it (12 §8): the two shapes
 * agree today, and the rule is that a field added to the locked screen tomorrow does not appear in
 * the defense because nobody had to name it. `canAddAddendum` and `turnRemainingMs` are the locked
 * screen's own controls and are deliberately not carried: neither means anything here.
 */
function toArtifacts(record: DecisionRecord): DefenseView['artifacts'] {
  return {
    frame: record.frame,
    brief: record.brief,
    addendum: record.addendum,
    turnResponse: record.turnResponse,
    namedFields: record.namedFields,
  }
}

/** Guards a student payload the way every run read does; no run here has been scored. */
function guarded<T>(payload: T): T {
  assertNoForbiddenKeys(payload, { scored: false })
  return payload
}

/**
 * The frozen record, with a run that has not filed a decision answered in this module's terms.
 *
 * `getDecision` is the one read of the record (D-341) and it refuses a run with no
 * `decision_locked_at` as `ILLEGAL_TRANSITION` with the state, which is the right answer for
 * UI-024's own screen and the wrong one here: 10 §9 gives every refusal of this module one code, and
 * a screen that arrived at `/defense` too early has to be sent to the run's `links.next` by the same
 * `details.state` whether the run is in `framing` or in `scored`. It is translated rather than
 * pre-empted by a state read of our own, because `getDecision` is also what materializes the run's
 * timers: a student whose Turn window expired while they were away must reach `defense_pending`
 * before anything asks what state they are in (10 §8).
 */
async function frozenRecord(actor: SessionUser, runId: string): Promise<DecisionRecord> {
  try {
    return await getDecision(actor, runId)
  } catch (error) {
    if (isAppError(error) && error.code === 'ILLEGAL_TRANSITION') {
      const details = error.opts.details as { state?: unknown } | undefined
      if (typeof details?.state === 'string') defenseNotOpen(details.state)
    }
    throw error
  }
}

// ---------------------------------------------------------------------------------------------
// Opening (FR-120, FR-121, FR-126)
// ---------------------------------------------------------------------------------------------

/**
 * Selects the interview once, inside the caller's transaction.
 *
 * Idempotent by the run's own column and not by a read-then-write: `defense_opened_at` is checked
 * under the row lock `lockRunForMutation` is holding, so two tabs that open the defense at the same
 * instant produce one set of questions and one set of `defense_question` events — the second waits
 * for the row, finds the column stamped, and writes nothing.
 *
 * The events are written **before** the run column is stamped, in the order the trace should read:
 * one `defense_question` per question, in the sequence the student meets them. `trace.append` stamps
 * the clock reading itself from the row the transaction has, which in `defense_pending` is null —
 * no clock runs in the defense, and none should be recorded as running.
 */
async function selectOnce(
  tx: Tx,
  tenantId: string,
  runId: string,
  actorId: string,
): Promise<boolean> {
  const run = await lockRunForMutation(tx, tenantId, runId)
  if (run.state !== 'defense_pending') defenseNotOpen(run.state)
  if (run.defenseOpenedAt !== null) return false

  const [events, claims, documents, namedFields, bank] = await Promise.all([
    readEvents(runId, tx),
    repo.listVersionClaims(run.packageVersionId, tx),
    repo.listVersionDocuments(run.packageVersionId, tx),
    repo.listVersionNamedFields(run.packageVersionId, tx),
    repo.listQuestionBank(run.packageVersionId, tx),
  ])

  const selected = selectQuestions({ events, claims, documents, namedFields, bank })
  const askedAt = new Date()
  const inserted = await repo.insertRunQuestions(
    runId,
    selected.map((question, index) => ({
      questionId: question.questionId,
      seq: index + 1,
      renderedText: question.renderedText,
      followUpOf: null,
      selectingEventSeq: question.selectingEventSeq,
      askedAt,
    })),
    tx,
  )

  const bySeq = [...inserted].sort((a, b) => a.seq - b.seq)
  for (const [index, row] of bySeq.entries()) {
    await append(
      tx,
      run,
      'defense_question',
      {
        run_question_id: row.id,
        question_id: row.questionId,
        kind: selected[index]?.kind ?? 'default',
        seq: row.seq,
        rendered_text: row.renderedText,
        follow_up_of: null,
        selecting_event_seq: row.selectingEventSeq,
      },
      { actorId, occurredAt: askedAt },
    )
  }

  await markDefenseOpened(tx, run, askedAt)
  return true
}

/**
 * `GET /runs/{runId}/defense` (07 §7, FR-120, FR-126): the interview and the record it is about.
 *
 * It is the read that *opens*: the first call selects the questions and writes them, and every call
 * after that returns what was written. There is no separate "start" control on UI-026, and there
 * should not be — the defense begins by arriving at it, and a student who loses their connection and
 * comes back gets exactly the same questions with the ones they have answered already marked
 * (FR-126). "Resume at the first unanswered question" is then the screen's reading of `answered`,
 * over a list in `seq` order, rather than a cursor the server keeps.
 *
 * The frozen record is read first and the transaction is opened only when there is something to
 * write, the same shape as `materializeTimers`' cheap path (D-229): `getDecision` materializes the
 * run's timers, so a student whose Turn window expired while they were away arrives in
 * `defense_pending` here, and a resumed defense takes no writer's lock at all.
 */
export async function openDefense(actor: SessionUser, runId: string): Promise<DefenseView> {
  const scope = await requireRunOwner(actor, runId)

  const record = await frozenRecord(actor, runId)
  if (!DEFENSE_STATES.includes(record.run.state)) defenseNotOpen(record.run.state)

  let questions = await repo.listRunQuestions(runId)
  if (questions.length === 0 && record.run.state === 'defense_pending') {
    await withTransaction((tx) => selectOnce(tx, scope.organizationId, runId, actor.id))
    questions = await repo.listRunQuestions(runId)
  }

  return guarded({
    questions: questions.map(toQuestionView),
    artifacts: toArtifacts(record),
  })
}

// ---------------------------------------------------------------------------------------------
// Answering (FR-123, FR-124, FR-125)
// ---------------------------------------------------------------------------------------------

/** The brief as D-090 reads it: the recommendation and the rationale, joined. */
function briefTextOf(record: DecisionRecord): string {
  return record.brief === null
    ? ''
    : `${record.brief.recommendation} ${record.brief.briefRationale}`
}

/**
 * `POST /runs/{runId}/defense/questions/{runQuestionId}/answer` (07 §7, FR-123 to FR-125).
 *
 * One answer per question and it is the record: a second submission is refused rather than
 * overwriting, because the `defense_answer` event carries the duration from focus to submit and an
 * answer written after thinking about it for a while is a different fact about the run.
 *
 * The follow-up is decided in the same transaction, from the answer that was just stored, and is
 * inserted **at most once per question**: `findRunQuestion` returns the follow-up already asked, and
 * a question that has one is never given a second. It carries `follow_up_of` and writes its own
 * `defense_question` event (FR-123), so the trace records that the student was pressed and what
 * they were pressed with. A bank question whose author wrote no follow-up text asks none — the
 * event's `rendered_text` may not be empty, and an empty prompt is not a question.
 *
 * The follow-up is placed at the end of the sequence rather than after its parent. `seq` is unique
 * per run and the rows already written are the record of what was asked and when; renumbering them
 * to make room would rewrite that. UI-026 draws a follow-up beneath its parent from `followUpOf`,
 * which is the field that says where it belongs, and `next` skips it because it is returned in its
 * own right.
 */
export async function answerQuestion(
  actor: SessionUser,
  runId: string,
  runQuestionId: string,
  input: DefenseAnswerInput,
): Promise<DefenseAnswerResult> {
  const scope = await requireRunOwner(actor, runId)
  const tenantId = scope.organizationId

  // The rule, not the wire shape, and applied here so it holds for every caller (D-287). Markup is
  // stripped first, so the text the limit was measured over is the text that is stored (10 §5).
  const parsed = DefenseAnswerSchema.safeParse({
    text: stripMarkup(input.text),
    durationMs: Math.max(0, Math.round(input.durationMs)),
  })
  if (!parsed.success) answerTooLong()
  const { text, durationMs } = parsed.data

  const record = await frozenRecord(actor, runId)
  if (record.run.state !== 'defense_pending') defenseNotOpen(record.run.state)

  const pkg = await repo.findRunPackage(tenantId, runId)
  if (!pkg) runNotFound()
  const documents = await repo.listVersionDocuments(pkg.packageVersionId)
  const context = {
    documentTitles: documents.map((document) => document.title),
    brief: briefTextOf(record),
  }

  const written = await withTransaction(async (tx) => {
    const run = await lockRunForMutation(tx, tenantId, runId)
    if (run.state !== 'defense_pending') defenseNotOpen(run.state)

    const detail = await repo.findRunQuestion(runId, runQuestionId, tx)
    if (!detail) questionNotFound()
    if (detail.answer !== null) questionAlreadyAnswered()

    const answeredAt = new Date()
    await repo.insertAnswer(
      { runId, runDefenseQuestionId: runQuestionId, text, durationMs, answeredAt },
      tx,
    )
    await append(
      tx,
      run,
      'defense_answer',
      { run_question_id: runQuestionId, text, duration_ms: durationMs },
      { actorId: actor.id, occurredAt: answeredAt },
    )

    const followUp = await insertFollowUp(tx, run, detail, text, context, answeredAt, actor.id)

    const all = await repo.listRunQuestions(runId, tx)
    const next = all.find((row) => row.answer === null && row.question.id !== followUp?.id) ?? null
    return {
      next: next ? toQuestionView(next) : null,
      followUpQuestion:
        followUp === null
          ? null
          : toQuestionView({ question: followUp, kind: detail.kind, answer: null }),
    }
  })

  return guarded(written)
}

/**
 * Inserts the question's one authored follow-up when the answer earned it (D-031, D-090).
 *
 * Answers `null` in four cases, and they are different: the question **is** a follow-up (FR-123's
 * "one authored follow-up" per question, and PRD §7.12 puts deeper follow-up in future-state — a
 * chain would also re-ask the same authored sentence, because a follow-up carries its parent's bank
 * row), the question already has one, the answer named a source, a number or a reason and was not
 * the brief read back, or the author wrote no follow-up for this bank question.
 */
async function insertFollowUp(
  tx: Tx,
  run: Parameters<typeof append>[1],
  detail: repo.RunQuestionDetail,
  text: string,
  context: { documentTitles: string[]; brief: string },
  askedAt: Date,
  actorId: string,
): Promise<repo.RunDefenseQuestion | null> {
  if (detail.question.followUpOf !== null) return null
  if (detail.followUp !== null) return null
  if (followUpReasonFor(text, context) === null) return null

  const prompts = await repo.findFollowUpTexts([detail.question.questionId], tx)
  const prompt = stripMarkup(prompts.get(detail.question.questionId) ?? '')
  if (prompt === '') return null

  const seq = await repo.nextQuestionSeq(detail.question.runId, tx)
  const [row] = await repo.insertRunQuestions(
    detail.question.runId,
    [
      {
        questionId: detail.question.questionId,
        seq,
        renderedText: prompt,
        followUpOf: detail.question.id,
        // The follow-up is asked because of the *answer*, and the answer is not an event this
        // module can name a sequence for from inside the transaction that wrote it; the parent
        // question's `follow_up_of` is the link the replay reads it back by (10 §10).
        selectingEventSeq: null,
        askedAt,
      },
    ],
    tx,
  )
  if (!row) throw new AppError('INTERNAL_ERROR', 'The follow-up insert returned no row.')

  await append(
    tx,
    run,
    'defense_question',
    {
      run_question_id: row.id,
      question_id: row.questionId,
      kind: detail.kind,
      seq: row.seq,
      rendered_text: row.renderedText,
      follow_up_of: row.followUpOf,
      selecting_event_seq: null,
    },
    { actorId, occurredAt: askedAt },
  )
  return row
}

// ---------------------------------------------------------------------------------------------
// Completing (FR-120, FR-125, D-046)
// ---------------------------------------------------------------------------------------------

/**
 * `POST /runs/{runId}/defense/complete` (07 §7, FR-120): the student is done, and scoring begins.
 *
 * Every question needs an answer row and an **empty** answer is one (FR-124): a student who pressed
 * submit on a question they had nothing to say to has said something about the run, and the record
 * keeps it. What is refused is finishing while a question has never been submitted at all, which
 * UI-026 turns into the confirm dialog that offers to file the remainder empty.
 *
 * `nothing_answered` is FR-125's instructor flag, set when every answer is empty or under three
 * words. It is a flag and never a penalty applied here: the rubric reads it in Phase 10, the student
 * is never shown it (12 §8.1 keeps `flags` out of every student payload), and the debrief's job is
 * to separate not knowing the content from not knowing one's own work.
 *
 * The job is enqueued **after the commit** (D-046). A `score_run` sent inside the transaction would
 * be a job racing the run's own state: the worker could fetch it, read a run still in
 * `defense_pending`, and fail — or worse, succeed against a transaction that then rolled back.
 */
export async function completeDefense(actor: SessionUser, runId: string): Promise<RunSummary> {
  const scope = await requireRunOwner(actor, runId)
  const tenantId = scope.organizationId

  const updated = await withTransaction(async (tx) => {
    const run = await lockRunForMutation(tx, tenantId, runId)
    if (run.state !== 'defense_pending') defenseNotOpen(run.state)

    const questions = await repo.listRunQuestions(runId, tx)
    // A defense nobody opened has no interview to finish, and "every question is answered" would be
    // vacuously true of it. That is the read Phase 8 shipped a sweep with and is exactly the shape
    // of mistake this refusal exists to make impossible.
    if (questions.length === 0) defenseNotOpen(run.state)

    const unanswered = questions.filter((row) => row.answer === null).length
    if (unanswered > 0) defenseIncomplete(unanswered)

    const nothingAnswered = questions.every(
      (row) => countWords(row.answer?.text ?? '') < NOTHING_ANSWERED_WORDS,
    )

    const next = await markDefenseComplete(tx, run, {
      at: new Date(),
      actorId: actor.id,
      nothingAnswered,
    })
    await enqueueAfterCommit(tx, 'score_run', { runId })
    return next
  })

  return guarded(toRunSummary(updated))
}
