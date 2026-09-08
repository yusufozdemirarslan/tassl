// Service of the `assistant` module (docs/tech/10-backend-spec-modules.md §7; 07-api-spec.md §7;
// 11-llm-integration.md §2, §3). The AI assistant a student meets inside the run, the Delegation
// Log that records what they did with it, and the outside-tool declaration that costs them nothing.
//
// Everything here exists to keep one promise, which is the product's central one: **the assistant
// is useful, it is not uniformly reliable, and it never says which is which.** Three separate
// mechanisms hold it up, and none of them is a rule this file follows carefully — each is a shape
// the data has.
//
//   1. *The answer key is never loaded.* `repository.ts` selects no column of
//      `variant_claim_states`, so the warranted stance, the evidence status and the planted flag are
//      not in this process while a delegation is answered. A prompt cannot leak what the query never
//      fetched, and neither can a log line, a Sentry `extra`, or a mock provider seeded on its input
//      (D-265, D-266).
//   2. *The model's own prose is filtered before it is stored.* `defectWordFilter` replaces the
//      vocabulary of the key with `[…]` and flags the delegation `filtered` (11 §3). It runs on the
//      whole reply before a byte of it is written to `run_delegations.response_text` or sent to the
//      student — which is why the stream below frames a guarded reply rather than the model's live
//      tokens (D-271).
//   3. *Consequential content is authored, not generated.* A claim reaches the student as the
//      author's text behind a `[[claim:<id>]]` marker, carried verbatim (`segments.ts`, D-264), and
//      every number in the connective prose that no claim, document or request put there is flagged
//      (D-068). The assistant carries claims; it does not make them (FR-052).
//
// The other rule that runs through every function: **a delegation charges no clock.** FR-070's costs
// belong to interrogation actions and escalations, and asking the assistant a question is the thing
// the run is about. A component failure therefore credits nothing on resume, and says so
// (`runs.resumeRun`, 10 §10).
//
// Three imports need a word.
//
//   * `analytics` — the events of 17 §3.3 are sent from here, always after the transaction that
//     wrote the trace has committed (17 §1.6), and always as ids, enums, counts and durations. The
//     request, the reply, the why line, the claim texts and the purpose of an outside-tool
//     declaration are on none of them: analytics is a lossy mirror of the trace, and the parts of
//     the run that are the student's own words are the parts it drops (17 §1.3, §6).
//
//   * `runs/clock.ts` — `in_turn_window` and the clock reading a delegation row stores are facts
//     about the run's clock (D-042), and the module that owns the clock is `runs`. Importing that
//     one pure file is the same reading, and the same resolution, as the trace module's import of it
//     (10 §10): copying the arithmetic here would make one rule two, and reaching it through the
//     runs module's public index is not possible for a *type-level* pure function without pulling
//     the service behind it.
//   * `runs` (public) — `lockRunForMutation`, `noteFirstDelegation`, `consumeForcedAssistantFailure`
//     and `pauseRun` all take the transaction and the locked row, because they are that module's
//     rules applied inside this module's mutation (08 §5). The reverse import does not exist: the
//     runs module knows nothing about delegations, which is what keeps the two out of a cycle
//     (D-268).
import { randomUUID } from 'node:crypto'
import { AppError, isAppError } from '@/lib/errors'
import { t } from '@/lib/i18n/t'
import { claimContext, runContext, type RunContext } from '@/server/analytics/run-context'
import { track } from '@/server/analytics/track'
import { requireRunOwner, requireRunReviewer } from '@/server/auth/permissions'
import type { SessionUser } from '@/server/auth/types'
import { getLogger, getRequestContext } from '@/server/http/request-context'
import { DELEGATION_FILTERED_FLAG, defectWordFilter } from '@/server/llm/guardrails/defect-words'
import {
  allowedNumbers,
  numericGuard,
  type UnverifiedNumber,
} from '@/server/llm/guardrails/numeric-guard'
import {
  proseOf,
  renderSegments,
  segmentReply,
  type GuardSegment,
} from '@/server/llm/guardrails/segments'
import type { LlmCallContext } from '@/server/llm/provider'
import {
  DOCUMENT_EXCERPT_MAX_CHARS,
  MAX_OPENED_DOCUMENTS,
  assistantReplyPrompt,
} from '@/server/llm/prompts/assistant-reply'
import { getProvider } from '@/server/llm/registry'
import {
  markClaimUsed,
  surfaceClaims,
  type ClaimView,
  type SurfacedClaim,
} from '@/server/modules/reliance'
import {
  consumeForcedAssistantFailure,
  lockRunForMutation,
  noteFirstDelegation,
  pauseRun,
} from '@/server/modules/runs'
import { isInTurnWindow, remainingMs, remainingWindowMs } from '@/server/modules/runs/clock'
import { append, requireOwnerReadAccess } from '@/server/modules/trace'
import {
  assistantLocked,
  assistantUnavailable,
  claimNotInDelegation,
  delegationNotFound,
  logNotWritable,
  requestTooLong,
} from './errors'
import * as repo from './repository'
import {
  DELEGATION_REQUEST_MAX_CHARS,
  DelegationRequestSchema,
  type DelegateInput,
  type DeclareOutsideToolInput,
  type DelegationClaim,
  type DelegationFlagValue,
  type DelegationView,
  type UpdateDelegationInput,
} from './schema'
import { matchClaims, type TriggerCandidate } from './triggers'

// ---------------------------------------------------------------------------------------------
// The states each act belongs to (FR-050, FR-060, FR-061)
// ---------------------------------------------------------------------------------------------

/** FR-050: frame lock to Decision Lock, and again in the Turn window. Nowhere else, ever. */
const ASSISTANT_STATES: readonly string[] = ['working', 'turn_open']

/**
 * 10 §7: the outside-tool declaration is available "from `working` to `defense_pending`".
 *
 * `paused` is in the list and the assistant's own is not, and the difference is what each act needs.
 * A delegation needs a working assistant; a declaration needs nothing but the student's own words,
 * and a student waiting out a component failure who wants to say they used a spreadsheet should be
 * able to (FR-061: a *standing* control). It writes one event and has no other effect, so there is
 * nothing about it a paused clock could distort.
 */
const DECLARATION_STATES: readonly string[] = [
  'working',
  'paused',
  'decision_locked',
  'turn_open',
  'turn_locked',
  'defense_pending',
]

// ---------------------------------------------------------------------------------------------
// What a delegation streams (07 §7)
// ---------------------------------------------------------------------------------------------

/**
 * One piece of a reply as the workspace draws it: the assistant's own prose, or one claim object.
 *
 * The claim segment carries a whole `ClaimView` rather than an id, because the panel renders it as a
 * card with a stance control the moment it arrives (UI-023) — and because the view is built from the
 * row the surfacing transaction just wrote, so the card and the run's stance matrix cannot disagree.
 *
 * A text segment carries whatever the guards left in it, `[[figure:…]]` included (D-281). The
 * marker needs no field of its own here for the same reason the claim's text needs none in
 * `response_text`: it is part of the sentence, and the panel parses the sentence it is given. That
 * is what makes the stream and the stored reply the same reply.
 */
export type DelegationSegment = { type: 'text'; text: string } | { type: 'claim'; claim: ClaimView }

/** 07 §7's two server-sent events, in the order they are written. */
export type DelegationChunk =
  { event: 'segment'; data: DelegationSegment } | { event: 'done'; data: { delegationId: string } }

// ---------------------------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------------------------

/**
 * Which of the two readers 07 §7 admits the actor is, or NOT_FOUND (the shape `runs` uses).
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
): Promise<{ organizationId: string; viewer: 'owner' | 'reviewer' }> {
  try {
    const scope = await requireRunOwner(actor, runId)
    return { organizationId: scope.organizationId, viewer: 'owner' }
  } catch (error) {
    if (!isAppError(error) || error.code !== 'NOT_FOUND') throw error
  }
  try {
    const scope = await requireRunReviewer(actor, runId)
    return { organizationId: scope.organizationId, viewer: 'reviewer' }
  } catch (error) {
    if (isAppError(error) && error.code === 'FORBIDDEN') {
      throw new AppError('NOT_FOUND', t('run.notFound'))
    }
    throw error
  }
}

/** The refusal a write to the log meets outside `working` and `turn_open` (07 §7). */
function assertLogWritable(state: string): void {
  if (ASSISTANT_STATES.includes(state)) return
  logNotWritable(state)
}

/** The ids the LLM call log is written against (D-066): never a name, never an email. */
function llmContext(actor: SessionUser, runId: string, versionId: string): LlmCallContext {
  return {
    userId: actor.id,
    runId,
    packageVersionId: versionId,
    // A delegation always happens inside a request, which has an id. A test that calls the service
    // directly does not, and the call log's column is not nullable, so one is minted rather than
    // letting an observability write decide whether a student gets an answer.
    requestId: getRequestContext()?.requestId ?? randomUUID(),
  }
}

// ---------------------------------------------------------------------------------------------
// The analytics groups (17 §3.3)
// ---------------------------------------------------------------------------------------------

/** The locked, timer-materialized run row every mutation here writes against. */
type LockedRun = Awaited<ReturnType<typeof lockRunForMutation>>

/**
 * The `R` group of a run, built from the row the mutation held (17 §3.3).
 *
 * The variant key is the one property that is not on the run row, so it costs one indexed read.
 * `null` — a variant row the foreign key says exists and does not — drops the event rather than
 * sending a guessed key: `variant` is the breakdown nearly every insight in 17 §8 splits on, and a
 * wrong one there is worse than a missing row. Analytics never changes what the run does, so a
 * dropped event is the end of it.
 */
async function runGroup(run: LockedRun): Promise<RunContext | null> {
  const variantKey = await repo.findVariantKey(run.variantId)
  return variantKey ? runContext(run, variantKey) : null
}

/** What the outcome of one delegation contributes to `delegation_made` (17 §3.3). */
type DelegationOutcome = {
  failed: boolean
  claimsSurfaced: number
  unverifiedNumbersCount: number
  latencyMs: number
}

/**
 * `delegation_made`, fired for exactly the delegations the `delegation` trace event is written for:
 * the answered one, the forced failure, and the provider failure.
 *
 * A reply discarded because the run moved on while the model was answering (D-280) is in neither.
 * That is one rule rather than two: the trace is the record, the discard deliberately leaves it
 * untouched — no event, no clock, nothing the Delegation band can see — and analytics is a mirror of
 * the trace (17 §1.8), so a mirror showing a delegation the record does not would be the only place
 * in the product where our latency cost the student something.
 *
 * The request text is not a property, and neither is the reply. What travels is the shape of the
 * act: which delegation, how many claims it raised, how many figures the numeric guard could not
 * source, whether it failed, and how long the student waited.
 */
function trackDelegationMade(
  actor: SessionUser,
  prepared: PreparedDelegation,
  group: RunContext,
  outcome: DelegationOutcome,
): void {
  track(
    'delegation_made',
    {
      ...group,
      delegation_id: prepared.delegationId,
      seq: prepared.seq,
      claims_surfaced: outcome.claimsSurfaced,
      in_turn_window: prepared.inTurnWindow,
      unverified_numbers_count: outcome.unverifiedNumbersCount,
      failed: outcome.failed,
      // Read from the row as this delegation wrote it, which is the honest answer and always
      // `false`: the why line is the student's later sentence about a delegation they made, and
      // `updateDelegation` is the only thing that writes it (FR-060, D-272).
      has_why: prepared.why !== null,
      latency_ms: outcome.latencyMs,
      before_any_document_open: prepared.beforeAnyDocumentOpen,
    },
    { userId: actor.id, organizationId: prepared.organizationId },
  )
}

/**
 * `claim_marked_used` for the claims one act marked relied on (17 §3.3, FR-084).
 *
 * One event per claim the act *recorded* — the same set the `claim_used` trace events name, which is
 * why an already-marked claim produces neither. The `C` group is read from `scenario_claims` rather
 * than taken off the claim card, because a card carries neither the importance nor the consequence
 * level in any state (12 §8), and an analytics group is not a reason to put them on one.
 */
async function trackClaimsMarkedUsed(options: {
  actor: SessionUser
  organizationId: string
  group: RunContext
  claimIds: readonly string[]
  via: 'log_mark' | 'turn_window'
  inTurnWindow: boolean
}): Promise<void> {
  if (options.claimIds.length === 0) return
  const claims = await repo.listClaimContexts(options.claimIds)
  for (const claim of claims) {
    track(
      'claim_marked_used',
      {
        ...options.group,
        ...claimContext(claim, options.inTurnWindow),
        via: options.via,
      },
      { userId: options.actor.id, organizationId: options.organizationId },
    )
  }
}

// ---------------------------------------------------------------------------------------------
// The reply (11 §2.1, §3)
// ---------------------------------------------------------------------------------------------

/** 11 §3: the delegation flags the guards raise. `out_of_scenario` is a reviewer's (FR-055). */
export const DELEGATION_NO_COMMENTARY_FLAG = 'no_commentary'
export const DELEGATION_REBUILT_FLAG = 'rebuilt'

/**
 * The delegation the Sycophancy Probe fired on (FR-053, D-088, D-278).
 *
 * It lives in `run_delegations.flags` because that column is already the run's reviewer-only channel
 * and is withheld from the student twice over: `student-view.ts` forbids the key `flags` by name in
 * every state, so a Delegation Log carrying it fails the invariant test rather than reaching a
 * screen (D-269), and `trace/owner-view.ts` classifies `delegation.flags` `reviewer_only`, so it is
 * absent from the owner's trace as well. The reviewer sees it, which is right — the replay and the
 * debrief show the probe — and it is what makes "the reversal is the *next* assistant message" a
 * question this run can answer under its own row lock, rather than one every later delegation
 * answers the same way.
 */
export const DELEGATION_PROBE_FLAG = 'probe'

/**
 * The reply came back after the run had left the state that admitted the request, so it was thrown
 * away rather than stored (D-280). Not a guard flag and not a reviewer's: it is the one flag that
 * says something about *us*, and it is on the row so the replay can tell a sentence Tassl wrote
 * from a sentence the assistant said — the same reason `no_commentary` exists (11 §3).
 */
export const DELEGATION_DISCARDED_FLAG = 'discarded_late'

/** The paragraph break between two segments the assembler put next to each other. */
const SEPARATOR = '\n\n'

const separator = (): GuardSegment => ({ type: 'text', text: SEPARATOR })

type AuthoredClaim = { id: string; key: string; text: string }

type AssembledReply = {
  segments: GuardSegment[]
  responseText: string
  flags: string[]
  unverified: UnverifiedNumber[]
}

/**
 * Turns a model reply into what is stored and shown (11 §3), in the order §3 fixes: segment, check
 * the markers, guard the numbers, filter the prose.
 *
 * **The marker check comes first**, because everything after it depends on the cut being right.
 * §3 requires each surfaced claim to be marked exactly once; a reply that does not is rebuilt as
 * "claims first, text after" and flagged `rebuilt`. That is not cosmetic — a claim the model forgot
 * to mark is a claim the student was told about and cannot stance, and a claim marked twice is one
 * card too many. Rebuilding keeps the claim objects intact and demotes the model's prose to what it
 * always was: connective text that carries no stance and is never scored (FR-051).
 *
 * **Both guards read text segments only.** A claim segment carries the author's own words (D-264),
 * so the numeric guard cannot flag a figure the author sourced and the filter cannot redact a word
 * the author chose — a package imported from another institution (FR-186) may legitimately say "the
 * defect rate fell to 2.1 percent". It is also what keeps a marker out of authored text: the guard
 * never scans the package's own words, so it can never wrap them.
 *
 * **The numeric guard rewrites the prose in both of its modes** (D-068, D-281). `flag` leaves the
 * figure and puts `[[figure:…]]` round it; `block` leaves the marker and takes the figure out. Either
 * way the mark is in what `renderSegments` returns, so it reaches the student through the stream and
 * the faculty seat through `response_text` and the `delegation` event — one reply, read three times.
 * The `unverified` list beside it is the reviewer's audit of the same figures (D-269).
 *
 * **A reply with no prose left gets 11 §3's content-policy sentence.** A provider that refused, that
 * answered nothing, or whose whole answer was markers leaves the claims on screen with one sentence
 * saying the assistant could not add commentary — never an apology that characterises the request,
 * which would be the assistant commenting on what it was asked (FR-056).
 */
export function assembleReply(
  reply: string,
  claims: readonly AuthoredClaim[],
  allowed: ReadonlySet<string>,
): AssembledReply {
  const flags: string[] = []
  const authored = claims.map((claim) => ({ id: claim.id, text: claim.text }))

  let segments = segmentReply(reply, authored)
  const marked = segments
    .filter((segment) => segment.type === 'claim')
    .map((segment) => segment.claimId)
  if (marked.join(',') !== authored.map((claim) => claim.id).join(',')) {
    const prose = segments.filter((segment) => segment.type === 'text')
    segments = [
      ...authored.flatMap((claim, index): GuardSegment[] => [
        ...(index === 0 ? [] : [separator()]),
        { type: 'claim', claimId: claim.id, text: claim.text },
      ]),
      ...(prose.length === 0 ? [] : [separator(), ...prose]),
    ]
    flags.push(DELEGATION_REBUILT_FLAG)
  }

  const guarded = numericGuard(segments, allowed)
  const filtered = defectWordFilter(guarded.segments)
  if (filtered.filtered) {
    flags.push(DELEGATION_FILTERED_FLAG)
    getLogger().warn(
      { terms: filtered.matches.map((match) => match.term) },
      'assistant reply carried answer-key vocabulary and was redacted',
    )
  }

  let final = filtered.segments
  if (proseOf(final).join('').trim() === '') {
    final = [{ type: 'text', text: t('workspace.assistantNoCommentary') }, ...final]
    flags.push(DELEGATION_NO_COMMENTARY_FLAG)
  }

  return {
    segments: final,
    responseText: renderSegments(final),
    flags,
    unverified: guarded.unverified,
  }
}

/**
 * The numbers the assistant is allowed to say (D-068): the ones already in front of the student.
 *
 * §3 fixes the set exactly — the surfaced claim texts, their carried values, the request, and the
 * documents the student has opened. The brief and the Turn text are deliberately not in it: a
 * provider that starts quoting figures out of the framing material is doing the thing FR-052
 * forbids, and the guard is where that shows up.
 */
function allowedFor(
  claims: readonly repo.ClaimCandidate[],
  request: string,
  documents: readonly { excerpt: string }[],
): Set<string> {
  return allowedNumbers(
    [
      ...claims.map((claim) => claim.text),
      request,
      ...documents.map((document) => document.excerpt),
    ],
    claims.flatMap((claim) => claim.carriedValues),
  )
}

/** 10 §7: the brief plus stakeholder names and roles — never a position, never a blind spot. */
function worldSummaryOf(source: repo.WorldSummarySource): string {
  if (source.people.length === 0) return source.brief
  const people = source.people.map((person) => `${person.name}, ${person.roleTitle}`).join('; ')
  return `${source.brief}\n\nIn the room: ${people}.`
}

/** §3: at most twelve documents, each cut to 1,200 characters; the prompt truncates again. */
const excerptsOf = (documents: readonly repo.OpenedDocument[]) =>
  documents.map((document) => ({
    title: document.title,
    excerpt: document.body.slice(0, DOCUMENT_EXCERPT_MAX_CHARS),
  }))

/** Consumes the provider's stream into the whole reply (11 §1). */
async function readReply(
  request: string,
  claims: readonly AuthoredClaim[],
  world: repo.WorldSummarySource,
  documents: readonly { title: string; excerpt: string }[],
  turnContext: string | null,
  context: LlmCallContext,
): Promise<string> {
  const { messages, input } = assistantReplyPrompt.render({
    worldSummary: worldSummaryOf(world),
    openedDocuments: documents,
    request,
    claims: claims.map((claim) => ({ id: claim.id, text: claim.text })),
    turnContext,
  })

  let text = ''
  for await (const chunk of getProvider().stream({
    feature: 'assistant',
    promptName: assistantReplyPrompt.name,
    promptVersion: assistantReplyPrompt.version,
    messages,
    promptInput: input,
    temperature: 0.7,
    context,
  })) {
    if (chunk.type === 'text') text += chunk.text
  }
  return text
}

// ---------------------------------------------------------------------------------------------
// delegate (FR-050 to FR-053, FR-056, AI-002, AI-004)
// ---------------------------------------------------------------------------------------------

type PreparedDelegation = {
  delegationId: string
  seq: number
  versionId: string
  inTurnWindow: boolean
  /**
   * The run state the request was admitted against, carried out of the lock so the write phase can
   * ask whether it still holds (D-280). Phase 1's gate is a fact about an instant, and the provider
   * answers after it.
   */
  state: string
  /** True when `flags.forced_failure_armed` was set and consumed (FR-118). */
  forcedFailure: boolean
  /** The locked run as phase 1 left it: the `R` group of every event this delegation sends. */
  run: LockedRun
  organizationId: string
  /** The why line on the row as it was inserted (17 §3.3 `has_why`); the request carries none. */
  why: string | null
  /**
   * Whether the Evidence Room was still untouched when the request was sent (FR-022, AN-003).
   *
   * Read inside phase 1's transaction, under the run's row lock, because the student may open a
   * document while the model is answering — and `before_any_document_open` is a fact about the
   * instant they asked, not about the instant the reply landed.
   */
  beforeAnyDocumentOpen: boolean
}

/** The `delegation` event, minus the parts only the outcome decides. */
type DelegationEventBase = {
  delegation_id: string
  seq: number
  request_text: string
  why: null
  in_turn_window: boolean
}

/**
 * Marks a delegation failed, records it in the trace, and stops the clock (FR-001).
 *
 * Three writes in one transaction, and the order is the record's: the row says the answer never
 * came, the `delegation` event says the same thing to whoever replays the run, and the pause says
 * the clock stopped because of *this* delegation — `related_delegation_id` is what ties the outage
 * on the timeline to the request that met it.
 *
 * `creditMs: 0` is not an omission (10 §10). A delegation charges no clock, so a failed one has
 * nothing to give back beyond the wall-clock time the pause itself took, which `resumeRun` returns
 * in full.
 */
async function failWithin(
  tx: repo.Tx,
  run: LockedRun,
  base: DelegationEventBase,
  actorId: string,
): Promise<void> {
  await repo.failDelegation(run.id, base.delegation_id, tx)
  await append(
    tx,
    run,
    'delegation',
    {
      ...base,
      response_text: '',
      claim_ids: [],
      flags: [],
      unverified_numbers: [],
      failed: true,
    },
    { actorId, occurredAt: new Date() },
  )
  await pauseRun(tx, run, 'assistant_failure', {
    relatedDelegationId: base.delegation_id,
    creditMs: 0,
    actorId,
  })
}

/**
 * Closes out a delegation whose answer arrived after the run had moved on (D-280).
 *
 * **One write, to the delegation's own row, and nothing to the run.** No `delegation` event: the
 * trace is the run's record, and an event appended now would carry an `occurred_at` past the
 * Decision Lock and a clock reading taken from a clock that has stopped — a run that says it is over
 * gaining a new act. No `surfaceClaims`: FR-084's lock gate has already been evaluated, so a claim
 * entering the stance matrix now is one the student could never take a stance on and would be
 * counted as relied on without one. No `probe_fired`, no pause, no clock. The reply itself is
 * dropped: served through the Delegation Log in `defense_pending` it is the assistant answering a
 * student in the defense (UI-026, FR-120).
 *
 * What is left is the row phase 1 wrote, which is the student's own act and stays: they asked, the
 * clock was running when they did, and the log says in one sentence why no answer is under it. The
 * sentence is stored rather than computed at read time because the row is what the reviewer's replay
 * reads too (D-272), and `discarded_late` is what tells the replay the sentence is ours.
 *
 * The student is charged nothing for it. A delegation charges no clock (10 §10), the run is not
 * paused, and — because no event is written — the delegation does not exist for the Delegation band
 * or any other graph, which is the only sense in which our latency could have cost them anything.
 */
async function discardWithin(tx: repo.Tx, runId: string, delegationId: string): Promise<void> {
  await repo.completeDelegation(
    runId,
    delegationId,
    {
      responseText: t('workspace.assistantDiscardedLate'),
      claimIds: [],
      flags: [DELEGATION_DISCARDED_FLAG],
      unverifiedNumbers: [],
    },
    tx,
  )
}

/**
 * `POST /runs/{runId}/delegations` (07 §7, FR-051): the student asks, the assistant answers, and the
 * run records both.
 *
 * **Three phases, and the middle one holds no lock.** The row is written before the provider is
 * called and completed after, so a connection that dies mid-answer leaves an entry that says what
 * was asked and that no answer came, rather than leaving nothing at all. Between the two the model
 * is called with no transaction open: a network call inside `select … for update` would hold every
 * other write to this run — a stance, a document close, the poll's timer materialization — behind a
 * provider's latency.
 *
 * **Which is why the state gate is asked twice.** A gate held only in phase 1 is a statement about
 * the instant the request arrived, and every write happens seconds later in phase 3 — long enough
 * for a Decision Lock in a second tab, a pause, or the run's own auto-lock. Phase 3 re-tests it
 * under the lock it is about to write with, and a reply that arrives into a run that has moved on is
 * discarded rather than stored: `discardWithin` says what that costs the student, which is nothing
 * (D-280).
 *
 * **Matching runs against every claim of the version, not only the unsurfaced ones** (D-267). A
 * student who asks the same question twice is answered twice; `surfaceClaims` is what makes the
 * second answer reference the existing row instead of writing a second one (10 §8).
 *
 * **The Sycophancy Probe is decided after the provider has answered, and under the lock** (FR-053,
 * D-088, D-278). There is no probe *path*: every delegation calls the model, is assembled by
 * `assembleReply`, and carries one claim segment per matched claim. When the probe is due — its
 * claim matched, the student holds `challenge` on it, and this run has not been given the reversal
 * before — the authored reversal is spliced in front of that reply as its opening prose and
 * `probe_fired` is written. So the delegation is not *made to look* ordinary; it *is* ordinary
 * everywhere a student can look, and differs only in a paragraph the author wrote instead of the
 * model. What marks it is reviewer-only twice over: the `probe` flag on the row and the
 * `probe_fired` event, both withheld from the owner's log and the owner's trace in every state.
 *
 * The returned iterable yields the reply that has already been guarded and stored. That ordering is
 * the point rather than an accident — see D-271 and the router.
 */
export async function delegate(
  actor: SessionUser,
  runId: string,
  input: DelegateInput,
): Promise<AsyncIterable<DelegationChunk>> {
  // The student pressed send here, as far as this process can tell, so `latency_ms` is measured
  // from here: what it reports is the wait, guards and database round trips included, rather than
  // the provider's own time, which `llm_call` already carries (17 §3.6).
  const requestedAt = Date.now()
  const scope = await requireRunOwner(actor, runId)
  const tenantId = scope.organizationId
  const request = parseRequest(input.request)

  // Phase 1 — the gate and the row. Both under the run's lock, so a delegation cannot be answered
  // against a state the clock has already moved past.
  const prepared = await repo.withTransaction(async (tx): Promise<PreparedDelegation> => {
    const locked = await lockRunForMutation(tx, tenantId, runId)
    if (!ASSISTANT_STATES.includes(locked.state)) assistantLocked(locked.state)

    const now = new Date()
    const run = await noteFirstDelegation(tx, locked, now)
    const inTurnWindow = isInTurnWindow(run)
    const clockRemainingMs = inTurnWindow ? remainingWindowMs(run, now) : remainingMs(run, now)
    const openedBefore = await repo.hasOpenedDocument(runId, tx)

    const row = await repo.insertDelegation(
      runId,
      {
        requestText: request,
        claimIds: [],
        flags: [],
        unverifiedNumbers: [],
        inTurnWindow,
        clockRemainingMs: clockRemainingMs === null ? null : Math.round(clockRemainingMs),
        why: null,
      },
      tx,
    )

    // FR-118: the instructor armed a failure from the replay, and this is the request that meets
    // it. The flag is consumed whether or not anything else goes right, so one arming produces one
    // outage rather than every delegation until somebody notices.
    const { armed } = await consumeForcedAssistantFailure(tx, run)
    if (armed) {
      await failWithin(
        tx,
        run,
        {
          delegation_id: row.id,
          seq: row.seq,
          request_text: request,
          why: null,
          in_turn_window: inTurnWindow,
        },
        actor.id,
      )
    }

    return {
      delegationId: row.id,
      seq: row.seq,
      versionId: run.packageVersionId,
      inTurnWindow,
      state: run.state,
      forcedFailure: armed,
      run,
      organizationId: run.organizationId,
      why: row.why,
      beforeAnyDocumentOpen: !openedBefore,
    }
  })

  const base: DelegationEventBase = {
    delegation_id: prepared.delegationId,
    seq: prepared.seq,
    request_text: request,
    why: null,
    in_turn_window: prepared.inTurnWindow,
  }

  // The transaction above already failed the delegation and paused the run; the refusal is thrown
  // here so those writes commit rather than rolling back with it — and the event goes with them,
  // because a forced failure is a delegation the student made and the trace records as failed.
  if (prepared.forcedFailure) {
    const group = await runGroup(prepared.run)
    if (group) {
      trackDelegationMade(actor, prepared, group, {
        failed: true,
        claimsSurfaced: 0,
        unverifiedNumbersCount: 0,
        latencyMs: Date.now() - requestedAt,
      })
    }
    assistantUnavailable(prepared.delegationId)
  }

  // Phase 2 — matching, the prompt, and the provider. No lock is held.
  const [candidates, world, opened, probe] = await Promise.all([
    repo.listVersionClaims(prepared.versionId),
    repo.findWorldSummarySource(tenantId, prepared.versionId),
    repo.listOpenedDocuments(runId, MAX_OPENED_DOCUMENTS),
    repo.findProbe(prepared.versionId),
  ])

  const context = llmContext(actor, runId, prepared.versionId)
  const matchCandidates: TriggerCandidate[] = candidates.map((claim) => ({
    id: claim.id,
    triggerPhrases: claim.triggerPhrases,
    triggerDescription: claim.triggerDescription,
  }))
  const matchedIds = (await matchClaims(request, matchCandidates, { context })).claimIds
  const byId = new Map(candidates.map((claim) => [claim.id, claim]))
  const matched = matchedIds.flatMap((id) => {
    const claim = byId.get(id)
    return claim ? [claim] : []
  })

  // **The provider is called on every delegation, the probe's included** (D-278). The branch that
  // used to skip it answered the one request in a run that measures something instantly, with no
  // `llm_calls` row and no tokens spent, while every neighbouring request waited on a model. A
  // student who challenges a claim and gets the reply back in no time has been told which of the
  // two it is before they have read a word of it — and FR-053 holds only while they cannot tell.
  const documents = excerptsOf(opened)
  let reply: string
  try {
    reply = await readReply(
      request,
      matched,
      world,
      documents,
      prepared.inTurnWindow ? await repo.findTurnText(prepared.versionId) : null,
      context,
    )
  } catch (error) {
    getLogger().warn({ err: error, delegationId: prepared.delegationId }, 'delegation failed')
    // The state gate again, before FR-001's pause: a run that moved on while the provider was
    // failing must not be paused, and its clock must not be credited (D-280). Two things went
    // wrong at once, and the one the student can act on is the run's own state.
    const moved = await repo.withTransaction(async (tx) => {
      const run = await lockRunForMutation(tx, tenantId, runId)
      if (run.state !== prepared.state) {
        await discardWithin(tx, runId, prepared.delegationId)
        return run.state
      }
      await failWithin(tx, run, base, actor.id)
      return null
    })
    if (moved !== null) {
      getLogger().warn(
        { delegationId: prepared.delegationId, from: prepared.state, to: moved },
        'delegation discarded: the run moved on while the assistant was answering',
      )
      assistantLocked(moved)
    }
    // The failure is in the trace, so it is in the mirror: the student asked, waited, and got
    // nothing, and `latency_ms` is what that wait was.
    const group = await runGroup(prepared.run)
    if (group) {
      trackDelegationMade(actor, prepared, group, {
        failed: true,
        claimsSurfaced: 0,
        unverifiedNumbersCount: 0,
        latencyMs: Date.now() - requestedAt,
      })
    }
    assistantUnavailable(prepared.delegationId)
  }
  const ordinary = assembleReply(reply, matched, allowedFor(matched, request, documents))

  // Phase 3 — the reply is stored, the claims are surfaced, and the trace gains one event.
  const written = await repo.withTransaction(async (tx) => {
    const run = await lockRunForMutation(tx, tenantId, runId)

    // **Phase 1's gate, asked again, under the lock that is about to write.** Phase 2 held none, so
    // between the two the run may have been locked in a second tab, paused by another component's
    // failure, or auto-locked by its own clock — and `lockRunForMutation` materializes the timers,
    // so the auto-lock lands here even when nothing else has read the run since (D-229, D-280).
    // Everything below writes to the run, and none of it may reach a run that has moved on: the
    // reply itself, a claim entering the stance matrix after FR-084's gate was evaluated, and an
    // event carrying a reading of a clock that has stopped.
    //
    // The state has to be the *same* one, not merely another the assistant answers in. No legitimate
    // transition takes a run from `working` to `turn_open` or back without passing through a state
    // that is neither, so identity costs a student nothing they could have had, and it keeps the
    // rule true for whatever the next state added to `ASSISTANT_STATES` turns out to be.
    if (run.state !== prepared.state) {
      await discardWithin(tx, runId, prepared.delegationId)
      return { discarded: run.state } as const
    }

    const now = new Date()

    // **The Sycophancy Probe, decided here** (FR-053, D-088, D-278). Both halves of D-088's "the
    // *next* assistant message" are facts about the run that another request can move, and phase 2
    // held no lock over either: the stance may have changed while the model was answering, and two
    // delegations sent from two tabs would both have read "not fired yet" and both delivered the
    // reversal — which is the tell, because no provider writes the same paragraph twice.
    const probeFires =
      probe !== undefined &&
      matchedIds.includes(probe.claimId) &&
      (await probeIsDue(tx, runId, probe.claimId))
    const assembled =
      probeFires && probe ? withScriptedReversal(ordinary, probe.scriptedReversal) : ordinary

    await repo.completeDelegation(
      runId,
      prepared.delegationId,
      {
        responseText: assembled.responseText,
        claimIds: matchedIds,
        flags: assembled.flags,
        unverifiedNumbers: assembled.unverified,
      },
      tx,
    )
    await append(
      tx,
      run,
      'delegation',
      {
        ...base,
        response_text: assembled.responseText,
        claim_ids: matchedIds,
        flags: assembled.flags,
        unverified_numbers: assembled.unverified,
        failed: false,
      },
      { actorId: actor.id, occurredAt: now },
    )

    const surfaced = await surfaceClaims(
      tx,
      run,
      matchedIds,
      'delegation',
      prepared.delegationId,
      now,
    )

    if (probeFires && probe) {
      await append(
        tx,
        run,
        'probe_fired',
        { claim_id: probe.claimId, scripted_reversal: probe.scriptedReversal },
        { actorId: actor.id, occurredAt: now },
      )
    }

    return {
      segments: assembled.segments,
      views: new Map(surfaced.map((claim) => [claim.id, toClaimCard(claim)])),
      claimsSurfaced: surfaced.length,
      unverifiedNumbersCount: assembled.unverified.length,
      probeClaimId: probeFires && probe ? probe.claimId : null,
      // The claims this delegation put in front of the student inside the Turn window, which the
      // window marked relied on as it surfaced them (D-077). `surfaceClaims` answers which ones it
      // *recorded*, so a claim already marked produces no second event, exactly as it produces no
      // second `claim_used` in the trace.
      windowMarkedClaimIds: surfaced
        .filter((claim) => claim.reliedOnByWindow)
        .map((claim) => claim.id),
    } as const
  })

  // Thrown after the transaction commits, so the one write it made — the row saying no answer
  // reached the student — stands, exactly as the forced failure's refusal does above.
  if ('discarded' in written) {
    getLogger().warn(
      { delegationId: prepared.delegationId, from: prepared.state, to: written.discarded },
      'delegation discarded: the run moved on while the assistant was answering',
    )
    assistantLocked(written.discarded)
  }

  // AN-003 (17 §3.3), after phase 3 has committed. Three events at most and one read between them:
  // the delegation itself, the probe when the reversal was spliced in, and one `claim_marked_used`
  // per claim the Turn window marked relied on as this reply surfaced it. `probe_fired` is a
  // reviewer's fact in the trace and stays one here — it says a probe fired on this run, never that
  // a claim is the defective one, and no student-facing surface reads PostHog (17 §1.7).
  const group = await runGroup(prepared.run)
  if (group) {
    trackDelegationMade(actor, prepared, group, {
      failed: false,
      claimsSurfaced: written.claimsSurfaced,
      unverifiedNumbersCount: written.unverifiedNumbersCount,
      latencyMs: Date.now() - requestedAt,
    })
    if (written.probeClaimId) {
      track(
        'probe_fired',
        { ...group, claim_id: written.probeClaimId },
        { userId: actor.id, organizationId: tenantId },
      )
    }
    await trackClaimsMarkedUsed({
      actor,
      organizationId: tenantId,
      group,
      claimIds: written.windowMarkedClaimIds,
      via: 'turn_window',
      // The mark exists because the run was inside the window when the claim was surfaced, so the
      // `C` group's `in_turn_window` is true by construction here rather than read back.
      inTurnWindow: true,
    })
  }

  return toChunks(written.segments, written.views, prepared.delegationId)
}

/**
 * D-088's "the *next* assistant message", asked as a question this run can answer (FR-053, D-278).
 *
 * Two conditions, both read inside the caller's transaction so the run's row lock covers them.
 *
 *   * The student holds `challenge` on the probe claim. That is the trigger D-088 names, and it is
 *     read here rather than in phase 2 because a stance set while the model was answering is a
 *     stance set before the reply landed.
 *   * The reversal has not been delivered on this run before. D-088 says *the next* message, and one
 *     message is one: the reversal is 355 characters of authored prose, and a room that produced it
 *     twice, byte for byte, would have announced itself — no provider repeats a paragraph exactly.
 *     After it has fired the probe claim is answered by the model like any other, which is what the
 *     assistant would have done had the probe never existed.
 *
 * "Delivered before" is the `probe` flag on the earlier delegation's row, which no student payload
 * carries (D-269, D-223) and which this module writes in the same transaction as `probe_fired`.
 * Sequential rather than `Promise.all`: the two reads share the transaction's one connection.
 */
async function probeIsDue(tx: repo.Tx, runId: string, claimId: string): Promise<boolean> {
  const claims = await repo.listRunClaimRows(runId, tx)
  const challenged = claims.some(
    (claim) => claim.claimId === claimId && claim.stance === 'challenge',
  )
  if (!challenged) return false

  const delegations = await repo.listDelegations(runId, tx)
  return !delegations.some((row) => row.flags.includes(DELEGATION_PROBE_FLAG))
}

/**
 * The reply the probe fires on: the authored reversal, then the reply the model wrote (FR-053).
 *
 * **What is not done here is the point.** The reversal is not turned into the whole message, and the
 * claims the request matched are not dropped. The old probe branch built its own segment list, so
 * the reply reached the student with no claim segment and no marker in the stored text — while the
 * Delegation Log and `run_delegations.claim_ids` listed the claims all the same, and `surfaceClaims`
 * put them in the stance matrix. Inside the Turn window it also marked them relied on (D-077), so
 * FR-084's lock gate would refuse a Decision Lock over a claim whose text the student was never
 * shown. Three student-visible differences from one shortcut: no card, a live region announcing "no
 * claims surfaced" beside a log entry that lists one, and a gate over an unseen claim.
 *
 * So the reversal is spliced in front of an ordinary assembled reply and changes nothing else. The
 * claim segments, the markers, the guard flags and the unverified numbers are the ones
 * `assembleReply` produced for the model's own prose; the reversal is carried verbatim and no guard
 * runs over it, because it is authored package text a human confirmed at element confirmation
 * (FR-194) — the same standing a claim's text has, and the same reason `segments.ts` keeps the
 * guards off that (D-264).
 *
 * It carries the `authored` kind rather than `text` so that "no guard runs over it" is true of the
 * segment instead of true of the fact that the guards already ran. Both guards return a non-`text`
 * segment untouched, so splicing this into a reply that is guarded again — which nothing does today
 * — still cannot redact or mark the author's sentence.
 */
function withScriptedReversal(reply: AssembledReply, reversal: string): AssembledReply {
  const segments: GuardSegment[] = [
    { type: 'authored', text: reversal },
    separator(),
    ...reply.segments,
  ]
  return {
    segments,
    responseText: renderSegments(segments),
    flags: [...reply.flags, DELEGATION_PROBE_FLAG],
    unverified: reply.unverified,
  }
}

/**
 * 10 §7's request rule, applied where this module's error can be raised (11 §3).
 *
 * The route's schema takes a string and nothing more, so the two refusals a request can meet are
 * both decided here: too long is `ASSISTANT_REQUEST_TOO_LONG` (10 §7), and empty once markup is
 * stripped is the ordinary `VALIDATION_ERROR` — there is nothing to ask, which is a malformed
 * request rather than a statement about the assistant.
 */
function parseRequest(raw: string): string {
  const parsed = DelegationRequestSchema.safeParse(raw)
  if (parsed.success) return parsed.data
  const stripped = raw.trim()
  if (stripped.length > DELEGATION_REQUEST_MAX_CHARS) {
    requestTooLong(DELEGATION_REQUEST_MAX_CHARS, stripped.length)
  }
  throw new AppError('VALIDATION_ERROR', 'Write a request before sending it.')
}

/**
 * The claim card a `segment` event carries, picked field by field from what the surfacing answered.
 *
 * A pick rather than a spread, and not only because 12 §8 asks for one: `SurfacedClaim` carries
 * `inserted`, which says whether this delegation was the first to put the claim in front of the
 * student. That is the surfacing's answer to its caller, not something the student may read — a
 * card that said "new" would tell them which claims they had already been shown and, by the gap,
 * which ones they have not.
 */
function toClaimCard(claim: SurfacedClaim): ClaimView {
  return {
    id: claim.id,
    key: claim.key,
    text: claim.text,
    surfacedBy: claim.surfacedBy,
    surfacedAt: claim.surfacedAt,
    inTurnWindow: claim.inTurnWindow,
    stance: claim.stance,
    previousStance: claim.previousStance,
    stanceSetAt: claim.stanceSetAt,
    // The card carries the stance control, the actions menu and the Escalate control (UI-023), so
    // it carries what those three need: the actions already run on the claim, the actions it
    // offers, the reply to an escalation the student raised, and the run's escalation budget.
    // Not the claim's authored `escalatable`, which is on neither this shape nor any other (D-244).
    actions: claim.actions,
    availableActions: claim.availableActions,
    escalation: claim.escalation,
    canEscalate: claim.canEscalate,
    remainingEscalations: claim.remainingEscalations,
    usedMarked: claim.usedMarked,
    reliedOn: claim.reliedOn,
  }
}

/**
 * The stream 07 §7 documents: one `segment` per piece of the reply, then `done`.
 *
 * **Adjacent text segments are joined into one chunk** (D-278). The client concatenates them to draw
 * a paragraph either way, so this changes nothing a student reads — but it makes the shape of the
 * stream a fact about where the claims are, and about nothing else. Three assemblers put prose next
 * to prose: the marker rebuild of 11 §3 inserts a separator before the model's leftover text, the
 * content-policy path prepends its fixed sentence, and the probe splices the authored reversal in
 * front of the model's own opening. Without the join, each of those arrives as a reply with one more
 * `segment` event than the reply beside it — and a student counting frames in a network tab would be
 * counting exactly the delegations Tassl needs them not to be able to pick out.
 */
function toChunks(
  segments: readonly GuardSegment[],
  views: ReadonlyMap<string, ClaimView>,
  delegationId: string,
): AsyncIterable<DelegationChunk> {
  const chunks: DelegationChunk[] = []
  let prose = ''
  const flushProse = (): void => {
    if (prose === '') return
    chunks.push({ event: 'segment', data: { type: 'text', text: prose } })
    prose = ''
  }

  for (const segment of segments) {
    // `authored` joins the prose stream exactly as `text` does. It is a segment kind so the guards
    // skip it (D-264), not so the student can tell it apart: the probe's reversal reads as the
    // assistant contradicting itself, and a frame a student could pick out of a network tab would
    // announce the probe (D-088).
    if (segment.type !== 'claim') {
      prose += segment.text
      continue
    }
    const claim = views.get(segment.claimId)
    // A marker for a claim this run did not surface renders nothing rather than an empty card: the
    // segmenter already refused to let it consume the following sentence (D-264), and there is no
    // claim object for the student to take a stance on. Its neighbours join across the gap, so an
    // invented id does not leave a seam in the prose either.
    if (!claim) continue
    flushProse()
    chunks.push({ event: 'segment', data: { type: 'claim', claim } })
  }
  flushProse()
  chunks.push({ event: 'done', data: { delegationId } })

  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

// ---------------------------------------------------------------------------------------------
// The Delegation Log (FR-060, FR-063)
// ---------------------------------------------------------------------------------------------

/**
 * `GET /runs/{runId}/delegations` (07 §7, FR-060): every delegation of the run, in order, as a unit
 * of work — what was asked, what came back, which claims resulted, which the student marked used,
 * and the stance each carries now.
 *
 * The student and the reviewer read different shapes of the same rows (12 §8.1): the guard flags and
 * the unverified numbers are the reviewer's, and are absent from the owner's view rather than
 * emptied in it. `student-view.ts` forbids the key `flags` by name in every state, so a payload that
 * carried them would fail the invariant test rather than reach a screen.
 *
 * **And the owner's read is gated by the run's state, by the same table the trace read uses**
 * (D-233, D-279). This log is the room: every request the student made, every reply the assistant
 * gave, and the claims each one raised with the stance each carries now. Through the defense a
 * student has nothing in front of them but their own frame, brief, addendum and Turn response
 * (UI-026, FR-120), and serving this endpoint in a second tab would give the room straight back —
 * which is precisely why `trace.listEvents` refuses there. Two reads of one room cannot answer that
 * question differently, so they do not answer it twice: `requireOwnerReadAccess` is the one answer.
 *
 * The tier it returns is ignored here on purpose. `scored` opens the `after_scored` fields of the
 * trace's payloads, but this view has none to open — D-269 keeps `flags` and `unverifiedNumbers`
 * off the owner's `DelegationView` in *every* state, because both are a reviewer's reading of the
 * run rather than part of it: the flags say the reply was rebuilt, redacted or probed, and the list
 * is what lets a faculty seat neutralize a consequential claim the guard caught late (D-068). The
 * figures themselves are not withheld from the student — they are marked in `responseText`, where
 * the guard put them (D-281). Sealed or not sealed is the whole of what the state decides here.
 */
export async function listDelegations(
  actor: SessionUser,
  runId: string,
): Promise<DelegationView[]> {
  const { viewer, organizationId } = await requireOwnerOrReviewer(actor, runId)
  // The reviewer reads the log as it was written, in every state: it is the record, and the replay
  // is what it is for (FR-180).
  if (viewer === 'owner') await requireOwnerReadAccess(organizationId, runId)
  const [rows, claims] = await Promise.all([
    repo.listDelegations(runId),
    repo.listRunClaimRows(runId),
  ])
  const byClaimId = new Map(claims.map((claim) => [claim.claimId, claim]))
  return rows.map((row) => toDelegationView(row, byClaimId, viewer))
}

function toDelegationView(
  row: repo.RunDelegation,
  claims: ReadonlyMap<string, repo.RunClaimRow>,
  viewer: 'owner' | 'reviewer',
): DelegationView {
  const carried: DelegationClaim[] = row.claimIds.flatMap((claimId) => {
    const claim = claims.get(claimId)
    return claim
      ? [
          {
            id: claim.claimId,
            key: claim.key,
            text: claim.text,
            stance: claim.stance,
            usedMarked: claim.usedMarked,
          },
        ]
      : []
  })

  return {
    id: row.id,
    seq: row.seq,
    requestText: row.requestText,
    responseText: row.responseText,
    claims: carried,
    why: row.why,
    inTurnWindow: row.inTurnWindow,
    failed: row.failed,
    createdAt: row.createdAt.toISOString(),
    ...(viewer === 'reviewer'
      ? { flags: row.flags, unverifiedNumbers: row.unverifiedNumbers }
      : {}),
  }
}

/**
 * `PATCH /runs/{runId}/delegations/{delegationId}` (07 §7, FR-060, FR-084): the why line and the
 * used marks.
 *
 * Two different kinds of write, and only one of them touches the run's reliance.
 *
 *   * `why` is the student's own sentence about a delegation they made. It is stored on the row as
 *     they wrote it and writes no event — the `delegation` event was written when the reply landed
 *     and is immutable, so it carries the why line as it stood then (usually none). The Delegation
 *     Log and the Delegation band read both take the current text from `run_delegations.why`, which
 *     is the field FR-060 describes as editable (D-272).
 *   * A used mark is a statement that the student leaned on a claim, so it writes `claim_used
 *     { via: 'log_mark' }` and adds `log_mark` to `relied_on_via` — which is what puts the claim in
 *     front of the Decision Lock's gate (FR-084). It is additive: a mark, once made, is a fact about
 *     the run, and a reversible one would be a way past the gate rather than through it (D-270).
 */
export async function updateDelegation(
  actor: SessionUser,
  runId: string,
  delegationId: string,
  input: UpdateDelegationInput,
): Promise<DelegationView> {
  const scope = await requireRunOwner(actor, runId)
  const tenantId = scope.organizationId

  const marked = await repo.withTransaction(async (tx) => {
    const run = await lockRunForMutation(tx, tenantId, runId)
    assertLogWritable(run.state)

    const delegation = await repo.findDelegation(runId, delegationId, tx)
    if (!delegation) delegationNotFound()

    if (input.why !== undefined) {
      await repo.updateDelegation(runId, delegationId, { why: input.why ?? null }, tx)
    }

    const recorded: string[] = []
    if (input.usedClaimIds && input.usedClaimIds.length > 0) {
      const carried = new Set(delegation.claimIds)
      const unknown = input.usedClaimIds.filter((claimId) => !carried.has(claimId))
      if (unknown.length > 0) claimNotInDelegation(unknown)

      const now = new Date()
      for (const claimId of input.usedClaimIds) {
        const { recorded: first } = await markClaimUsed(tx, run, claimId, 'log_mark', {
          delegationId,
          usedMarked: true,
          actorId: actor.id,
          at: now,
        })
        if (first) recorded.push(claimId)
      }
    }
    return { run, claimIds: recorded, inTurnWindow: isInTurnWindow(run) }
  })

  // AN-003 (17 §3.3), after the commit. The why line writes no event here for the reason it writes
  // no trace event: it edits a row, it is the student's own sentence, and free text is on no
  // analytics property anywhere (17 §1.3). A used mark is a different thing — it is the student
  // saying they leaned on a claim, which is what the Decision Lock's gate reads (FR-084).
  const group = await runGroup(marked.run)
  if (group) {
    await trackClaimsMarkedUsed({
      actor,
      organizationId: tenantId,
      group,
      claimIds: marked.claimIds,
      via: 'log_mark',
      inTurnWindow: marked.inTurnWindow,
    })
  }

  const [rows, claims] = await Promise.all([
    repo.listDelegations(runId),
    repo.listRunClaimRows(runId),
  ])
  const row = rows.find((entry) => entry.id === delegationId)
  if (!row) delegationNotFound()
  return toDelegationView(row, new Map(claims.map((claim) => [claim.claimId, claim])), 'owner')
}

/**
 * FR-055: a reviewer marks a delegation out of scenario from the replay.
 *
 * It is recorded and nothing else happens to the student: 12 §8.1 keeps `flags` out of every student
 * view, so the mark is invisible to the run's owner, and FR-006's "nothing Tassl observes is treated
 * as misconduct" is what the mark is *not* — it excludes the delegation from the Delegation band's
 * reads (10 §11) rather than counting against anyone.
 *
 * No route mounts this yet: 07 §8 puts it on the faculty replay
 * (`POST /review/runs/{runId}/delegations/{delegationId}/flag`), which arrives with Phase 11.
 */
export async function flagDelegation(
  actor: SessionUser,
  runId: string,
  delegationId: string,
  flag: DelegationFlagValue,
): Promise<DelegationView> {
  await requireRunReviewer(actor, runId)

  const delegation = await repo.findDelegation(runId, delegationId)
  if (!delegation) delegationNotFound()

  if (!delegation.flags.includes(flag)) {
    await repo.updateDelegation(runId, delegationId, { flags: [...delegation.flags, flag] })
  }

  const [rows, claims] = await Promise.all([
    repo.listDelegations(runId),
    repo.listRunClaimRows(runId),
  ])
  const row = rows.find((entry) => entry.id === delegationId)
  if (!row) delegationNotFound()
  return toDelegationView(row, new Map(claims.map((claim) => [claim.claimId, claim])), 'reviewer')
}

// ---------------------------------------------------------------------------------------------
// The outside-tool declaration (FR-061, FR-062, FR-006)
// ---------------------------------------------------------------------------------------------

/**
 * `POST /runs/{runId}/outside-tool-declaration` (07 §7, FR-061): the student says they used
 * something outside Tassl, and what for.
 *
 * **It writes one event and has no other effect, and that is the whole specification.** There is no
 * branch here on the course's outside-AI policy, no flag on the run, no counter, and nothing that
 * reads the event back into scoring — FR-062 forbids detection, inference and enforcement anywhere
 * in the product, and FR-006 forbids treating anything Tassl observes as misconduct. The screen
 * states the no-penalty sentence beside the control (UI-023); this function is what makes it true.
 *
 * Available from `working` to `defense_pending`, `paused` included: it is a standing control, and a
 * student waiting out a component failure may still want to declare.
 */
export async function declareOutsideTool(
  actor: SessionUser,
  runId: string,
  input: DeclareOutsideToolInput,
): Promise<void> {
  const scope = await requireRunOwner(actor, runId)
  const tenantId = scope.organizationId

  const declared = await repo.withTransaction(async (tx) => {
    const run = await lockRunForMutation(tx, tenantId, runId)
    if (!DECLARATION_STATES.includes(run.state)) assistantLocked(run.state)

    await append(
      tx,
      run,
      'outside_tool_declared',
      { purpose: input.purpose },
      { actorId: actor.id, occurredAt: new Date() },
    )
    return run
  })

  // AN-003 (17 §3.3), after the commit. **The purpose the student typed is not on it and never will
  // be**: the property list is the run's context and the policy the course set, which is what makes
  // the event answer the only question worth asking of it — whether students declare more often
  // under one policy than another (FR-062). The trace keeps the sentence; the mirror does not.
  const [group, policy] = await Promise.all([
    runGroup(declared),
    repo.findCoursePolicy(tenantId, runId),
  ])
  if (group && policy) {
    track(
      'outside_tool_declared',
      { ...group, course_policy: policy },
      { userId: actor.id, organizationId: tenantId },
    )
  }
}
