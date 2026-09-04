// Student-facing key sets (docs/tech/DECISIONS.md D-117; 12-security.md §8; 08-auth-authz.md §4).
// `permissions.ts` next door answers "may this actor touch this row"; this file answers the other
// half of the same question — what may appear *inside* a payload once they may. A student who can
// read their own run must still never read the answer key it was built from, and the two are
// different failures with different fixes.
//
// The invariant these sets protect (CLAUDE.md): students never see warranted stances, evidence
// status, failure families, planted flags, or verification results before their run is scored; and
// never, in any state, the question bank, expected-answer notes, the seed record, or another
// student's run.
//
// How the sets are meant to be used, in order of preference:
//
//   1. Build every student projection by *picking* the allowed fields (12 §8) — a Zod view schema
//      such as `StudentScenarioViewSchema`, or an explicit object literal. A projection that lists
//      what it shows cannot leak a field added to a table later.
//   2. Guard the picked payload with `assertNoForbiddenKeys` where a service hands it to a route,
//      an action, or an RSC page — the belt to the pick's braces, and the thing that fires when a
//      nested element is spread in whole ("…doc" rather than the six fields the Evidence Room
//      shows).
//   3. Never delete forbidden keys from a wide payload. Deleting hides the defect: the next field
//      the table grows is shipped, because nobody had to name it.
//
// The guard throws rather than redacting for the same reason. A leak is a server defect, not
// something the reader can act on, so it answers `INTERNAL_ERROR` (500) and the response never
// leaves; `details` carries the key names and their paths, never their values, so the report is
// readable in Sentry without repeating the leak.
import { AppError } from '@/lib/errors'

// ---------------------------------------------------------------------------------------------
// The two spellings
// ---------------------------------------------------------------------------------------------

/**
 * Both spellings of one field name. Every payload in this codebase names a field one of two ways:
 * the camelCase of a Drizzle row, a Zod view and an export document, and the snake_case of the
 * Postgres column, the jsonb bodies (`verification_paths`, `runs.flags`) and the trace payloads a
 * raw `select *` returns. Deriving the second from the first keeps a pair from being half updated,
 * which is the failure mode of a hand-written list and the one that silently reopens a leak.
 *
 * `warrantedStance` → `['warrantedStance', 'warranted_stance']`; a single-word name such as
 * `planted` yields itself twice and the set absorbs the duplicate.
 */
function bothSpellings(name: string): readonly string[] {
  return [name, name.replace(/[A-Z]/g, (upper) => `_${upper.toLowerCase()}`)]
}

/** The frozen union of the groups, each name in both spellings. */
function keySet(...groups: readonly (readonly string[])[]): readonly string[] {
  return Object.freeze([...new Set(groups.flat().flatMap(bothSpellings))])
}

// ---------------------------------------------------------------------------------------------
// Never, in any state (12 §8.1)
// ---------------------------------------------------------------------------------------------

/**
 * Keys that may not appear in a student payload at any point in the run's life, scored or not.
 * Each group is one row of the 12 §8.1 table, named as this codebase names it.
 *
 * "Any other student's run" is the one row of that table with no key to forbid: it is a row-level
 * rule, enforced by `requireRunOwner` (a foreign run answers NOT_FOUND) and by never loading
 * another student's row into a query. It is recorded here so a reader of D-117 who comes looking
 * for it finds where it lives instead of assuming it was forgotten.
 */
export const STUDENT_FORBIDDEN_KEYS_ALWAYS: readonly string[] = keySet(
  // The seed record (FR-028): the licensed case the package was re-skinned from, and the log of
  // what was changed. Authors and reviewers read it; a student reading it reads the source case.
  // The container is forbidden too, so `seedRecord: null` on a version view is a leak of shape.
  [
    'seedRecord',
    'caseTitle',
    'publisher',
    'licenseTerms',
    'licensePermitsAdaptation',
    'seedText',
    'reskinLog',
  ],
  // The defense question bank and its machinery (FR-123). A student meets one rendered question at
  // a time during the defense; the bank, what selected it, and what a good answer looks like are
  // the instrument, not the interview.
  [
    'defenseQuestions',
    'condition',
    'followUp',
    'expectedAnswerNotes',
    'isDefault',
    'selectingEventSeq',
  ],
  // Escalation (FR-093): the reply text reaches the student only as the response to an escalation
  // they actually raised, never as a package field and never as a flag on a claim that says which
  // claims are worth escalating.
  ['generalEscalationReply', 'escalatable', 'escalationReply'],
  // Claim internals: the fields that would let a student enumerate the claim set, or map a claim to
  // the assistant utterance that carries it, without reading the transcript.
  ['triggerPhrases', 'triggerDescription', 'carriedValues', 'weaklySourced', 'volatile'],
  // Stakeholder internals (FR-030): stakeholders reach a student as documents and as interview
  // answers. Their incentives, blind spots and the contradiction the author planted between two of
  // them are the reading the student is being asked to do.
  [
    'incentives',
    'blindSpots',
    'contradictsStakeholderId',
    // The export names references by element key rather than id (SYS-026); a snapshot handed to a
    // student route would carry the key form, so both forms are forbidden.
    'contradictsStakeholderKey',
    'contradictionPoint',
  ],
  // Turn internals (FR-114): whether the Turn warrants a change, what response is proportionate,
  // and which claims it lands on are precisely what the student's response is measured against.
  //
  // `evidence` is the Turn's own column. It is a short word and the constraint it implies is
  // deliberate: no student payload may name a field `evidence` for anything else — the Evidence
  // Room's documents are `documents`.
  [
    'warrantsChange',
    'proportionateResponse',
    'evidence',
    'disruptedAssumptionKeys',
    'windowClaimIds',
    'windowClaimKeys',
  ],
  // Probe internals (FR-053): the scripted reversal only works if the student cannot see it coming.
  ['originalPosition', 'scriptedReversal'],
  // Readiness answer keys (FR-012).
  ['answerKey'],
  // Instructor flags (FR-106, FR-118, FR-141): observations about the run, for the instructor.
  // The `flags` container is forbidden as well, so a flag added to `runs.flags` later is caught
  // without anyone having to remember this file.
  [
    'flags',
    'forcedFailureArmed',
    'speedOutlier',
    'allNovice',
    'allProfessional',
    'nothingAnswered',
  ],
)

// ---------------------------------------------------------------------------------------------
// Never before the run is scored (12 §8.2)
// ---------------------------------------------------------------------------------------------

/**
 * Keys the student's own debrief and record reveal *after* scoring, and nothing reveals before
 * (D-117). Pass `{ scored: true }` to the guard once the run has reached `scored`; the debrief and
 * record projections are then the only student views that may carry them, and only for that
 * student's own run — the row-level half stays with `requireRunOwner`.
 */
export const STUDENT_FORBIDDEN_KEYS_BEFORE_SCORED: readonly string[] = keySet(
  // `variant_claim_states`: what each claim deserved and why it was defective. The whole point of
  // the exercise is that the student decides this for themselves first.
  //
  // Only the map is forbidden, not the individual paths inside it (`source_trace`,
  // `replication_check`, `decomposition_check`): a student who runs an interrogation action
  // receives that path's result the moment they run it (FR-151), so the path names are legitimate
  // in an action response while the map of every path never is.
  ['warrantedStance', 'evidenceStatus', 'failureFamily', 'planted', 'verificationPaths'],
  // Claim authoring: the authored "what it deserved and why", and the concept the claim teaches.
  ['rationale', 'conceptKey'],
  // Document roles (12 §8.2): which document is superseded, which reads interpretation as fact,
  // which is irrelevant, and which stakeholder wrote it. The missed-defect section names them after
  // scoring; before it, sorting the Evidence Room is the work.
  //
  // `role` is short and load-bearing: no student payload may name a field `role` for anything else
  // — the actor's own section role travels as `viewerRole` or `sectionRole`.
  [
    'role',
    'documentRole',
    'supersededByDocumentId',
    'supersededByKey',
    'stakeholderId',
    'stakeholderKey',
  ],
  // The answer space (FR-109): the defensible positions, the evidence-inconsistent one and the
  // evidence it ignores, and which position is the minimum commitment.
  ['answerSpacePositions', 'ignoredEvidence', 'isMinimumCommitment'],
  // Escalation bookkeeping: which authored reply answered, and whether it counted against the
  // limit. The clock timeline shows both after scoring.
  ['responseId', 'countsAgainstLimit'],
  // The three-sentence counterfactual (PRD §7.14), read in the debrief's counterfactual section.
  ['debriefCounterfactual'],
)

// ---------------------------------------------------------------------------------------------
// Never in the record export form (FR-170, FR-243)
// ---------------------------------------------------------------------------------------------

/**
 * The three course-only keys the record export form must not carry (12 §8.1, last row).
 *
 * They are a third set rather than part of `STUDENT_FORBIDDEN_KEYS_ALWAYS`, which is how 12 §8.3
 * applies them: the debrief *does* show a student their weight, the band mapping and the points
 * their bands map to (FR-170) — it is the record, the artifact that leaves Tassl for the course,
 * that carries bands without the course's arithmetic. A set that fired everywhere would forbid the
 * debrief the PRD requires. Ask for them with `{ form: 'record' }`.
 */
export const STUDENT_FORBIDDEN_KEYS_RECORD_FORM: readonly string[] = keySet([
  'weight',
  'mapping',
  'points',
])

// ---------------------------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------------------------

/** Which set a finding came from, so a failure names the rule it broke. */
export type ForbiddenKeySet = 'always' | 'before_scored' | 'record_form'

/** Where the payload sits in the run's life, and which form it is. */
export type StudentViewStage = {
  /** True once the run this payload describes has reached `scored` (D-117). */
  scored: boolean
  /** `'record'` adds the three keys FR-170 keeps out of the record export form. */
  form?: 'record'
}

/** One forbidden key found in a payload. The value is deliberately absent: reporting it repeats the leak. */
export type ForbiddenKeyFinding = {
  key: string
  /** Where it sits, e.g. `documents[0].role`. */
  path: string
  set: ForbiddenKeySet
}

const ALWAYS = new Set(STUDENT_FORBIDDEN_KEYS_ALWAYS)
const BEFORE_SCORED = new Set(STUDENT_FORBIDDEN_KEYS_BEFORE_SCORED)
const RECORD_FORM = new Set(STUDENT_FORBIDDEN_KEYS_RECORD_FORM)

/**
 * Every forbidden key in `payload`, walked deeply through objects and arrays, with the path it was
 * found at. Returns the findings rather than throwing, so a caller can report all of them at once:
 * `assertNoForbiddenKeys` is the throwing form and is what a service guard uses.
 *
 * Plain JSON is what it understands, which is what every student view is — a `Map` or a `Set` would
 * hide its contents from `Object.entries`, and no projection is built from one. A cycle is walked
 * once (an RSC payload can carry one) and every object is visited once.
 */
export function findForbiddenKeys(
  payload: unknown,
  stage: StudentViewStage,
): ForbiddenKeyFinding[] {
  const sets: [ForbiddenKeySet, ReadonlySet<string>][] = [['always', ALWAYS]]
  if (!stage.scored) sets.push(['before_scored', BEFORE_SCORED])
  if (stage.form === 'record') sets.push(['record_form', RECORD_FORM])

  const findings: ForbiddenKeyFinding[] = []
  const seen = new WeakSet<object>()

  const walk = (value: unknown, path: string): void => {
    if (value === null || typeof value !== 'object') return
    if (seen.has(value)) return
    seen.add(value)
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${path}[${index}]`))
      return
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const at = path === '' ? key : `${path}.${key}`
      for (const [name, set] of sets) {
        if (set.has(key)) findings.push({ key, path: at, set: name })
      }
      walk(child, at)
    }
  }

  walk(payload, '')
  return findings
}

/**
 * Refuses a payload that carries a key a student may not see. Throws `INTERNAL_ERROR` (500) with
 * the findings in `details`: the leak is a defect in the projection above it, the reader can do
 * nothing about it, and the response must not be sent. Redacting instead would ship the payload and
 * hide the defect — see the note at the top of this file.
 */
export function assertNoForbiddenKeys(payload: unknown, stage: StudentViewStage): void {
  const findings = findForbiddenKeys(payload, stage)
  if (findings.length === 0) return
  throw new AppError('INTERNAL_ERROR', 'This payload carries fields a student may not see.', {
    details: { forbiddenKeys: findings },
  })
}
