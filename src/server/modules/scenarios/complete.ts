// Module `scenarios` — `completePackage` (docs/tech/10-backend-spec-modules.md §4, the rule table;
// §5 the generation pipeline; D-750).
//
// `validate.ts` says what a package must be. This file makes one be it.
//
// Generation asks a model for seven sets of elements and then holds the answer to thirty-three
// rules. A model — any model — satisfies most of them and misses some: the sixteenth readiness
// item, the figure-provenance question with its `{figure}` placeholder, the second low-stakes sound
// claim. Re-prompting recovers a few of those and costs a minute each time, and what reached the
// author when it did not was a rule code on a screen (`QUESTION_BANK_INCOMPLETE`) which is not a
// sentence anyone outside this repository can act on. So the pipeline no longer asks the model to
// be exhaustive: it asks for the *content*, and this file guarantees the *shape*.
//
// The contract, which `tests/unit/scenarios/complete.test.ts` holds it to:
//
//     validateExport(completePackage(anything)).ok === true
//
// for every document the export schema parses — including the empty one. That is what lets
// `confirmVersion` stop being a negotiation.
//
// Four properties every fix in here keeps:
//
//   *Pure* — no database, no clock, no randomness. A date the completion has to invent comes from
//            the document or from `options.baseDate`, so the same input always yields the same
//            output and a test can pin it.
//   *Minimal* — it completes, it does not rewrite. An element the model wrote that breaks no rule
//               is returned byte for byte; a claim that is missing one flag gets that one flag.
//               What the author reviews is the model's work, with the gaps filled.
//   *Ordered* — the fixes run in dependency order (stakeholders before documents, documents before
//               claim states, claims before questions), so a later fix reads the earlier one's
//               result rather than the input.
//   *Idempotent* — `completePackage(completePackage(d))` equals `completePackage(d)`. The pipeline
//                  runs it in a loop against the validator, and a fix that undid another one would
//                  never converge.
//
// The prose this file writes is deliberately plain and general: it is the floor a package cannot
// fall below, not a substitute for authored content, and it says only what is true of any decision
// run. The author sees every one of these elements in the confirmation workspace and may rewrite
// any of them.
import { countSentences, splitSentences } from '@/lib/sentences'
import { QUESTION_PLACEHOLDERS, placeholdersIn } from '@/lib/question-template'
import { countWords, stripMarkup } from '@/lib/words'
import { noItemNamesAClaim } from '@/server/modules/authoring/checks'
import {
  BRIEF_WORD_LIMIT,
  CONCEPT_SET_MIN,
  DOCUMENT_WORD_LIMIT,
  TURN_DELAY_SECONDS_MAX,
  TURN_DELAY_SECONDS_MIN,
  VARIANT_KEYS,
  type AnswerSpacePositionExport,
  type ClaimExport,
  type DefenseQuestionExport,
  type DocumentExport,
  type FailureFamilyValue,
  type NamedFieldExport,
  type PackageExport,
  type ReadinessItemExport,
  type ReadinessOption,
  type StakeholderExport,
  type StanceValue,
  type VariantClaimStateExport,
  type VariantExport,
  type VerificationPathsExport,
} from './schema'
import {
  ACCEPT_WARRANTED_SOUND_CLAIMS_MIN,
  CLAIMS_MIN,
  COUNTERFACTUAL_SENTENCE_COUNT,
  DEFAULT_QUESTIONS_MIN,
  DEFENSIBLE_POSITIONS_MIN,
  DOCUMENT_COUNT_MAX,
  DOCUMENT_COUNT_MIN,
  FIGURE_PLACEHOLDER,
  FRAME_ASSUMPTION_INDEXES,
  LOW_STAKES_SOUND_CLAIMS_MIN,
  MINIMUM_COMMITMENT_COUNT,
  NAMED_FIELDS_MIN,
  READINESS_ITEM_COUNTS,
  READINESS_OPTION_COUNT,
  RESKIN_KINDS_REQUIRED,
} from './validate'

// ---------------------------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------------------------

export type CompleteOptions = {
  /**
   * The ISO date any invented document is dated from, so the function stays pure. The caller
   * passes the day the generation ran; a test passes a fixed day and pins the output.
   */
  baseDate?: string
}

/** The anchor a caller that names no date gets. Only ever used by a document nobody authored. */
const FALLBACK_BASE_DATE = '2026-01-05'

/** The family a plant that has to be invented is given: catchable by reading the source. */
const FALLBACK_FAILURE_FAMILY: FailureFamilyValue = 'stale_evidence'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// ---------------------------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------------------------

const isBlank = (value: string | null | undefined): boolean =>
  value === null || value === undefined || stripMarkup(value) === ''

/** `text` cut to at most `max` words, counted the way `countWords` counts them (D-075). */
function toWordLimit(text: string, max: number): string {
  const plain = stripMarkup(text)
  const words = plain.split(/\s+/).filter(Boolean)
  return words.length <= max ? plain : words.slice(0, max).join(' ')
}

/** A key of the given shape that no member of `taken` already holds; `taken` gains it. */
function freeKey(base: string, taken: Set<string>): string {
  const stem = base.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 36) || 'X'
  let candidate = /^[A-Za-z0-9]/.test(stem) ? stem : `X${stem}`
  let n = 1
  while (taken.has(candidate)) {
    n += 1
    candidate = `${stem.slice(0, 36)}${n}`
  }
  taken.add(candidate)
  return candidate
}

/** `days` after `from`, as `YYYY-MM-DD`; used only for a document the completion invents. */
function shiftDate(from: string, days: number): string {
  const base = ISO_DATE.test(from) ? from : FALLBACK_BASE_DATE
  const at = new Date(`${base}T00:00:00Z`)
  at.setUTCDate(at.getUTCDate() + days)
  return at.toISOString().slice(0, 10)
}

/** The latest date in the room, so an invented successor is later than everything already there. */
function latestDate(documents: readonly DocumentExport[], fallback: string): string {
  const dated = documents.map((row) => row.datedOn).filter((value) => ISO_DATE.test(value))
  return dated.length === 0 ? fallback : dated.reduce((a, b) => (a >= b ? a : b))
}

/** A subject the invented prose can name, taken from the package rather than made up. */
function subjectOf(document: PackageExport): string {
  const title = stripMarkup(document.package.title)
  return title === '' ? 'this decision' : title
}

// ---------------------------------------------------------------------------------------------
// The entry point
// ---------------------------------------------------------------------------------------------

/**
 * The document, completed: every rule of `validatePackage` satisfied, everything already sound
 * left exactly as it was.
 *
 * The caller is `runGenerationStep` (10 §5), which runs it against `validateExport` in a loop; it
 * is also what `tests/unit/scenarios/complete.test.ts` drives over degenerate documents. It never
 * throws: a document the export schema parsed is a document this function can complete.
 */
export function completePackage(
  document: PackageExport,
  options: CompleteOptions = {},
): PackageExport {
  const baseDate = ISO_DATE.test(options.baseDate ?? '')
    ? (options.baseDate as string)
    : FALLBACK_BASE_DATE
  const subject = subjectOf(document)

  const conceptSet = completeConceptSet(document)
  const stakeholders = completeStakeholders(document.stakeholders, subject)
  const documents = completeDocuments(
    document.documents,
    stakeholders,
    referencedDocumentKeys(document),
    subject,
    baseDate,
  )
  const answerSpacePositions = completePositions(document.answerSpacePositions, documents, subject)
  const namedFields = completeNamedFields(document.namedFields)
  const claims = completeClaims(document.claims, conceptSet, documents, subject)
  const variants = completeVariants(document.variants, claims, documents)
  const shaped = shapeClaimMix(claims, variants, conceptSet, documents)
  const turn = completeTurn(document.turn, shaped.claims, stakeholders, subject)
  const defenseQuestions = completeQuestions(document.defenseQuestions, shaped.claims, namedFields)
  const readinessItems = completeReadinessItems(document.readinessItems, shaped.claims, conceptSet)
  const probe = keepProbe(document.probe, shaped.claims)

  return {
    ...document,
    version: {
      ...document.version,
      conceptSet,
      brief: completeBrief(document.version.brief, subject, shaped.claims),
      turnDelaySeconds: clampDelay(document.version.turnDelaySeconds),
      generalEscalationReply: completeGeneralReply(document.version.generalEscalationReply),
      debriefCounterfactual: completeCounterfactual(document.version.debriefCounterfactual),
    },
    seedRecord: completeSeedRecord(document.seedRecord, subject),
    documents,
    stakeholders,
    answerSpacePositions,
    namedFields,
    claims: shaped.claims,
    variants: shaped.variants,
    probe,
    turn,
    defenseQuestions,
    readinessItems,
  }
}

// ---------------------------------------------------------------------------------------------
// The concept set (06 §3.3: the version row's own check refuses fewer than four)
// ---------------------------------------------------------------------------------------------

/** The four generic concepts a package that declared too few is topped up with. */
const FALLBACK_CONCEPTS = [
  'evidence quality',
  'provenance',
  'consequential reasoning',
  'assumption testing',
  'measurement basis',
  'decision risk',
] as const

function completeConceptSet(document: PackageExport): string[] {
  const held = document.version.conceptSet.map((concept) => concept.trim()).filter((c) => c !== '')
  const seen = new Set(held.map((concept) => concept.toLowerCase()))
  // A concept a claim already names belongs in the set before an invented one does: it is the
  // author's vocabulary, and adding it is what `CLAIM_CONCEPT_UNKNOWN` would otherwise refuse over.
  for (const claim of document.claims) {
    if (held.length >= CONCEPT_SET_MIN) break
    const concept = claim.conceptKey.trim()
    if (concept.length < 2 || seen.has(concept.toLowerCase())) continue
    held.push(concept)
    seen.add(concept.toLowerCase())
  }
  for (const concept of FALLBACK_CONCEPTS) {
    if (held.length >= CONCEPT_SET_MIN) break
    if (seen.has(concept)) continue
    held.push(concept)
    seen.add(concept)
  }
  return held
}

// ---------------------------------------------------------------------------------------------
// The brief (`BRIEF_TOO_LONG`)
// ---------------------------------------------------------------------------------------------

function completeBrief(brief: string, subject: string, claims: readonly ClaimExport[]): string {
  const words = countWords(stripMarkup(brief))
  if (words > 0 && words <= BRIEF_WORD_LIMIT) return brief
  if (words > BRIEF_WORD_LIMIT) return toWordLimit(brief, BRIEF_WORD_LIMIT)

  const stake = claims[0] ? ` The evidence in the room speaks to ${claims[0].conceptKey}.` : ''
  return toWordLimit(
    `You are the analyst on ${subject}. The decision has to be made today, from the documents in ` +
      `the Evidence Room and whatever you can establish before the clock runs out. The room holds ` +
      `more than one defensible answer and at least one document that no longer holds.${stake} ` +
      `Take a position, say what it rests on, and name the figure you are betting on.`,
    BRIEF_WORD_LIMIT,
  )
}

// ---------------------------------------------------------------------------------------------
// Stakeholders (`STAKEHOLDER_NO_CONTRADICTION`)
// ---------------------------------------------------------------------------------------------

const FALLBACK_STAKEHOLDERS: readonly { key: string; name: string; roleTitle: string }[] = [
  { key: 'finance_lead', name: 'Priya Raman', roleTitle: 'Finance lead' },
  { key: 'growth_lead', name: 'Aisha Nouri', roleTitle: 'Growth lead' },
]

function completeStakeholders(
  stakeholders: readonly StakeholderExport[],
  subject: string,
): StakeholderExport[] {
  const taken = new Set(stakeholders.map((row) => row.key))
  const rows: StakeholderExport[] = stakeholders.map((row) => ({
    ...row,
    positionStatement: isBlank(row.positionStatement)
      ? `Holds a stated position on ${subject}.`
      : row.positionStatement,
    incentives: isBlank(row.incentives)
      ? 'Is measured on the outcome this decision moves, so has a stake in which way it goes.'
      : row.incentives,
    blindSpots: isBlank(row.blindSpots)
      ? 'Reads the evidence that supports the position already held more readily than the evidence against it.'
      : row.blindSpots,
  }))

  for (const template of FALLBACK_STAKEHOLDERS) {
    if (rows.length >= 2) break
    const key = freeKey(template.key, taken)
    rows.push({
      key,
      name: template.name,
      roleTitle: template.roleTitle,
      positionStatement: `Argues that ${subject} should be decided on what has actually been measured rather than on what is expected.`,
      incentives: 'Is accountable for the number this decision is defended with.',
      blindSpots:
        'Treats a figure that has been written down once as a figure that has been checked.',
      contradictionPoint: null,
      contradictsStakeholderKey: null,
    })
  }

  const byKey = new Map(rows.map((row) => [row.key, row]))
  const sound = rows.some(
    (row) =>
      row.contradictsStakeholderKey !== null &&
      row.contradictsStakeholderKey !== row.key &&
      byKey.has(row.contradictsStakeholderKey) &&
      !isBlank(row.contradictionPoint),
  )
  if (sound) return rows

  // One pair has to disagree on a named point (PRD §7.3). The first two rows are the pair, and the
  // point is the one every package of this shape has: whether the figure on the table is measured.
  const first = rows[0]
  const second = rows[1]
  if (!first || !second) return rows
  return rows.map((row) =>
    row.key === first.key
      ? {
          ...row,
          contradictsStakeholderKey: second.key,
          contradictionPoint: isBlank(row.contradictionPoint)
            ? `${first.name} treats the headline figure as established; ${second.name} holds that it has never been measured on the basis being quoted.`
            : row.contradictionPoint,
        }
      : row,
  )
}

// ---------------------------------------------------------------------------------------------
// The Evidence Room (`DOCUMENT_COUNT`, `DOCUMENT_TOO_LONG`, `DOCUMENT_ROLES_MISSING`,
// `STAKEHOLDER_NO_DOCUMENT`)
// ---------------------------------------------------------------------------------------------

type FillerDocument = { title: string; role: DocumentExport['role']; body: string }

function fillerDocuments(subject: string): FillerDocument[] {
  return [
    {
      title: 'Working note on the decision basis',
      role: 'supporting',
      body:
        `This note sets out what is known about ${subject} and what is still assumed. The figures ` +
        `quoted elsewhere in this room come from more than one basis, and the two have not been ` +
        `reconciled. Anyone defending a number should say which basis it is on.`,
    },
    {
      title: 'Earlier estimate, superseded',
      role: 'superseded',
      body:
        `The estimate in this memo was prepared before the later review and has not been restated ` +
        `since. It is kept in the room because it is still quoted. Read it against the later ` +
        `document that replaces it.`,
    },
    {
      title: 'Summary read as a finding',
      role: 'interpretation_as_fact',
      body:
        `This summary states as settled what the underlying work offered as one reading. The ` +
        `wording gives no sign that it is an interpretation, which is how it has come to be quoted ` +
        `as a result.`,
    },
    {
      title: 'Facilities notice',
      role: 'irrelevant',
      body:
        `An accurate notice about premises and scheduling. It is correctly dated and correctly ` +
        `stated, and it bears on nothing in this decision.`,
    },
    {
      title: 'Position statement from the team',
      role: 'supporting',
      body:
        `The team's own account of what it would do about ${subject} and why. It is a position ` +
        `rather than a measurement, and it names the outcome it expects rather than one it has ` +
        `observed.`,
    },
    {
      title: 'Review of the measurement basis',
      role: 'supporting',
      body:
        `A short review of how the headline figures were produced: which population they are over, ` +
        `which period they cover, and what was excluded. It does not restate the figures ` +
        `themselves.`,
    },
    {
      title: 'Later review, current',
      role: 'supporting',
      body:
        `The current review. It restates the earlier estimate on a fuller basis and is the most ` +
        `recent document in the room on this question.`,
    },
  ]
}

/**
 * Every document key something else in the package names: a claim's source, a Source Trace's
 * target, a position's supporting evidence, a supersession.
 *
 * `DOCUMENT_COUNT` caps the room at twelve, and what a cut has to not do is take away a document
 * another element points at — a claim whose `source_document_id` names a row that is gone is a
 * foreign key violation on the way in and an empty passage on the way out (`TRACE_DOCUMENT_MISSING`
 * would catch the trace; nothing would catch the claim).
 */
function referencedDocumentKeys(document: PackageExport): ReadonlySet<string> {
  const keys = new Set<string>()
  for (const row of document.documents) {
    if (row.supersededByKey !== null) keys.add(row.supersededByKey)
  }
  for (const claim of document.claims) {
    if (claim.sourceDocumentKey !== null) keys.add(claim.sourceDocumentKey)
  }
  for (const position of document.answerSpacePositions) {
    for (const key of position.supportingDocumentKeys) keys.add(key)
  }
  for (const variant of document.variants) {
    for (const state of variant.claimStates) {
      const trace = state.verificationPaths.source_trace
      if (trace) keys.add(trace.document_key)
    }
  }
  return keys
}

function completeDocuments(
  documents: readonly DocumentExport[],
  stakeholders: readonly StakeholderExport[],
  referenced: ReadonlySet<string>,
  subject: string,
  baseDate: string,
): DocumentExport[] {
  const taken = new Set(documents.map((row) => row.key))
  let rows: DocumentExport[] = documents.map((row, index) => ({
    ...row,
    title: isBlank(row.title) ? `Document ${index + 1}` : row.title,
    author: isBlank(row.author) ? 'Unattributed' : row.author,
    datedOn: ISO_DATE.test(row.datedOn) ? row.datedOn : shiftDate(baseDate, index),
    body: isBlank(row.body)
      ? `A short note held in the Evidence Room for ${subject}.`
      : countWords(stripMarkup(row.body)) > DOCUMENT_WORD_LIMIT
        ? toWordLimit(row.body, DOCUMENT_WORD_LIMIT)
        : row.body,
  }))

  // Too many: the room is capped at twelve, and what goes is what nothing else points at.
  if (rows.length > DOCUMENT_COUNT_MAX) {
    const keep = rows.filter((row) => referenced.has(row.key))
    const rest = rows.filter((row) => !referenced.has(row.key))
    rows = [...keep, ...rest].slice(0, DOCUMENT_COUNT_MAX)
    // A supersession that pointed out of the room is repaired below, once the set is settled.
    const inRoom = new Set(rows.map((row) => row.key))
    rows = rows.map((row) =>
      row.supersededByKey !== null && !inRoom.has(row.supersededByKey)
        ? {
            ...row,
            role: row.role === 'superseded' ? 'supporting' : row.role,
            supersededByKey: null,
          }
        : row,
    )
  }

  // Too few: the room needs six, and the fillers are chosen to carry the three roles the rule asks
  // for, so a room built entirely from them already satisfies `DOCUMENT_ROLES_MISSING`.
  const fillers = fillerDocuments(subject)
  let filler = 0
  while (rows.length < DOCUMENT_COUNT_MIN) {
    const template = fillers[filler % fillers.length] ?? fillers[0]
    filler += 1
    if (!template) break
    const key = freeKey(`D${rows.length + 1}`, taken)
    rows.push({
      key,
      title: template.title,
      author: 'Unattributed',
      datedOn: shiftDate(baseDate, rows.length),
      role: template.role === 'superseded' ? 'supporting' : template.role,
      position: rows.length,
      body: template.body,
      supersededByKey: null,
      stakeholderKey: null,
    })
  }

  rows = ensureDocumentRoles(rows, taken, subject, baseDate)
  rows = breakSupersessionCycles(rows)
  rows = ensureStakeholderCoverage(rows, stakeholders)
  return rows.map((row, index) => ({ ...row, position: index }))
}

/**
 * Supersession is a forest, not a graph: `writeDocuments` writes the set successor-first and
 * refuses a cycle outright, so a document that reaches itself by following `supersededByKey` has
 * its own pointer cut. The document that loses it is demoted to `supporting`, because the database
 * refuses a row marked superseded that names nobody.
 */
function breakSupersessionCycles(documents: readonly DocumentExport[]): DocumentExport[] {
  const byKey = new Map(documents.map((row) => [row.key, row]))
  const cut = new Set<string>()

  for (const start of documents) {
    const walked = new Set<string>([start.key])
    let at: DocumentExport | undefined = start
    while (at?.supersededByKey != null && !cut.has(at.key)) {
      const next: DocumentExport | undefined = byKey.get(at.supersededByKey)
      if (next === undefined) break
      if (walked.has(next.key)) {
        cut.add(at.key)
        break
      }
      walked.add(next.key)
      at = next
    }
  }

  if (cut.size === 0) return [...documents]
  return documents.map((row) =>
    cut.has(row.key)
      ? {
          ...row,
          role: row.role === 'superseded' ? ('supporting' as const) : row.role,
          supersededByKey: null,
        }
      : row,
  )
}

/**
 * `DOCUMENT_ROLES_MISSING`: a superseded document named by a later one in the room, an
 * interpretation presented as fact, and an accurate irrelevant document.
 *
 * The supersession is the delicate one: the successor must be *in the room* and dated *after* the
 * document it replaces, the database refuses a superseded row that names nobody, and the writer
 * refuses a cycle. So the pair is chosen from two documents that point at nothing, the successor's
 * date is moved past the predecessor's if it is not already, and no row ever points at itself.
 */
function ensureDocumentRoles(
  documents: readonly DocumentExport[],
  taken: Set<string>,
  subject: string,
  baseDate: string,
): DocumentExport[] {
  let rows = [...documents]
  const byKey = () => new Map(rows.map((row) => [row.key, row]))

  const supersessionHolds = (): boolean =>
    rows.some((row) => {
      if (row.role !== 'superseded' || row.supersededByKey === null) return false
      const later = byKey().get(row.supersededByKey)
      return later !== undefined && later.key !== row.key && later.datedOn > row.datedOn
    })

  // A row marked superseded that names nobody, or names somebody outside the room, cannot be
  // written at all (the database check) — so it is demoted before anything else is decided.
  rows = rows.map((row) => {
    if (row.role !== 'superseded') return row
    const later = row.supersededByKey === null ? undefined : byKey().get(row.supersededByKey)
    return later === undefined || later.key === row.key
      ? { ...row, role: 'supporting', supersededByKey: null }
      : row
  })

  if (!supersessionHolds()) {
    // The predecessor is the earliest document nothing already supersedes; the successor is the
    // latest one that is not the predecessor. Both exist: the room holds at least six rows here.
    const candidates = [...rows].sort((a, b) => a.datedOn.localeCompare(b.datedOn))
    const predecessor = candidates.find((row) => row.supersededByKey === null) ?? candidates[0]
    const successor = [...candidates]
      .reverse()
      .find((row) => predecessor !== undefined && row.key !== predecessor.key)
    if (predecessor && successor) {
      const successorDate =
        successor.datedOn > predecessor.datedOn
          ? successor.datedOn
          : shiftDate(latestDate(rows, baseDate), 1)
      rows = rows.map((row) => {
        // Nothing may point at the predecessor once it points at the successor: a chain through it
        // is a cycle, and the writer refuses a set of documents that supersede each other in one.
        if (row.key === successor.key) {
          return {
            ...row,
            datedOn: successorDate,
            ...(row.supersededByKey === predecessor.key ? { supersededByKey: null } : {}),
          }
        }
        if (row.key === predecessor.key) {
          return { ...row, role: 'superseded' as const, supersededByKey: successor.key }
        }
        return row.supersededByKey === predecessor.key ? { ...row, supersededByKey: null } : row
      })
    }
  }

  const has = (role: DocumentExport['role']): boolean => rows.some((row) => row.role === role)

  for (const role of ['interpretation_as_fact', 'irrelevant'] as const) {
    if (has(role)) continue
    // Recast a plain supporting document rather than inventing one where the room is already full.
    const recastable = rows.find(
      (row) =>
        row.role === 'supporting' &&
        row.supersededByKey === null &&
        !rows.some((other) => other.supersededByKey === row.key),
    )
    if (recastable && rows.length >= DOCUMENT_COUNT_MIN) {
      rows = rows.map((row) => (row.key === recastable.key ? { ...row, role } : row))
      continue
    }
    if (rows.length >= DOCUMENT_COUNT_MAX) continue
    const template = fillerDocuments(subject).find((filler) => filler.role === role)
    rows.push({
      key: freeKey(`D${rows.length + 1}`, taken),
      title: template?.title ?? 'Supplementary note',
      author: 'Unattributed',
      datedOn: shiftDate(latestDate(rows, baseDate), 1),
      role,
      position: rows.length,
      body: template?.body ?? `A note held in the Evidence Room for ${subject}.`,
      supersededByKey: null,
      stakeholderKey: null,
    })
  }

  return rows
}

/** `STAKEHOLDER_NO_DOCUMENT`: every stakeholder is heard from at least once. */
function ensureStakeholderCoverage(
  documents: readonly DocumentExport[],
  stakeholders: readonly StakeholderExport[],
): DocumentExport[] {
  const rows = [...documents]
  const covered = new Set(
    rows.flatMap((row) => (row.stakeholderKey === null ? [] : [row.stakeholderKey])),
  )
  const stakeholderKeys = new Set(stakeholders.map((row) => row.key))

  // A document attributed to a stakeholder the version does not hold is attributed to nobody.
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    if (row && row.stakeholderKey !== null && !stakeholderKeys.has(row.stakeholderKey)) {
      rows[index] = { ...row, stakeholderKey: null }
      covered.delete(row.stakeholderKey)
    }
  }

  // The unattributed documents are handed out in order; an irrelevant one is left alone last,
  // because a stakeholder's only document should be one that bears on the decision.
  const spare = rows
    .map((row, index) => ({ row, index }))
    .filter((entry) => entry.row.stakeholderKey === null)
    .sort((a, b) => Number(a.row.role === 'irrelevant') - Number(b.row.role === 'irrelevant'))

  let next = 0
  for (const stakeholder of stakeholders) {
    if (covered.has(stakeholder.key)) continue
    const target = spare[next]
    next += 1
    if (!target) break
    const row = rows[target.index]
    if (!row) continue
    rows[target.index] = { ...row, stakeholderKey: stakeholder.key }
    covered.add(stakeholder.key)
  }

  // A room smaller than the roster: the remaining stakeholders share the documents already handed
  // out, which still satisfies "at least one document" for each of them.
  for (const stakeholder of stakeholders) {
    if (covered.has(stakeholder.key)) continue
    const target = rows.findIndex((row) => row.role !== 'irrelevant')
    const index = target === -1 ? 0 : target
    const row = rows[index]
    if (!row) break
    rows[index] = { ...row, stakeholderKey: stakeholder.key }
    covered.add(stakeholder.key)
  }

  return rows
}

// ---------------------------------------------------------------------------------------------
// The answer space (`ANSWER_SPACE_SINGLE`, `ANSWER_SPACE_NO_INCONSISTENT`, `ANSWER_SPACE_NO_MINIMUM`)
// ---------------------------------------------------------------------------------------------

function completePositions(
  positions: readonly AnswerSpacePositionExport[],
  documents: readonly DocumentExport[],
  subject: string,
): AnswerSpacePositionExport[] {
  const taken = new Set(positions.map((row) => row.key))
  const inRoom = new Set(documents.map((row) => row.key))
  let rows: AnswerSpacePositionExport[] = positions.map((row) => ({
    ...row,
    summary: isBlank(row.summary) ? `A position on ${subject}.` : row.summary,
    supportingDocumentKeys: row.supportingDocumentKeys.filter((key) => inRoom.has(key)),
  }))

  const defensible = () => rows.filter((row) => row.kind === 'defensible')
  const defensibleFillers = [
    {
      key: 'commit_narrow',
      summary: `Commit to ${subject} on the narrowest basis the evidence already supports, and state the figure the commitment rests on.`,
    },
    {
      key: 'test_first',
      summary: `Run one bounded test before committing to ${subject}, with the decision rule written down before the result is seen.`,
    },
  ]
  let filler = 0
  while (defensible().length < DEFENSIBLE_POSITIONS_MIN) {
    const template = defensibleFillers[filler % defensibleFillers.length]
    filler += 1
    if (!template) break
    rows.push({
      key: freeKey(template.key, taken),
      kind: 'defensible',
      summary: template.summary,
      ignoredEvidence: null,
      isMinimumCommitment: false,
      position: rows.length,
      supportingDocumentKeys: [],
    })
  }

  // `ANSWER_SPACE_NO_INCONSISTENT`: one position that is inconsistent with the evidence, and the
  // evidence it ignores said out loud — that sentence is what the debrief shows the student.
  const inconsistent = rows.filter((row) => row.kind === 'evidence_inconsistent')
  const complete = inconsistent.filter((row) => !isBlank(row.ignoredEvidence))
  if (complete.length === 0) {
    const ignored =
      'Ignores the later document in the room, which restates the headline figure on a fuller basis.'
    if (inconsistent[0]) {
      rows = rows.map((row) =>
        row.key === inconsistent[0]?.key ? { ...row, ignoredEvidence: ignored } : row,
      )
    } else {
      rows.push({
        key: freeKey('overcommit', taken),
        kind: 'evidence_inconsistent',
        summary: `Commit to ${subject} at the scale the earliest figure implies, treating the headline number as established.`,
        ignoredEvidence: ignored,
        isMinimumCommitment: false,
        position: rows.length,
        supportingDocumentKeys: [],
      })
    }
  }

  // `ANSWER_SPACE_NO_MINIMUM`: exactly one. The first defensible position carries it when nothing
  // does, and every other flag comes off when more than one does.
  const minimum = rows.filter((row) => row.isMinimumCommitment)
  if (minimum.length !== MINIMUM_COMMITMENT_COUNT) {
    const chosen = minimum[0]?.key ?? defensible()[0]?.key ?? rows[0]?.key
    rows = rows.map((row) => ({ ...row, isMinimumCommitment: row.key === chosen }))
  }

  return rows.map((row, index) => ({ ...row, position: index }))
}

// ---------------------------------------------------------------------------------------------
// Named fields (`NAMED_FIELDS_MISSING`)
// ---------------------------------------------------------------------------------------------

function completeNamedFields(fields: readonly NamedFieldExport[]): NamedFieldExport[] {
  if (fields.length >= NAMED_FIELDS_MIN) {
    return fields.map((row, index) => ({ ...row, position: index }))
  }
  return [
    {
      key: 'decision_basis_value',
      label: 'The figure this decision rests on',
      unit: 'other',
      position: 0,
    },
  ]
}

// ---------------------------------------------------------------------------------------------
// Claims (`CLAIMS_TOO_FEW`, `CLAIM_CONCEPT_UNKNOWN`)
// ---------------------------------------------------------------------------------------------

const FALLBACK_CLAIM_TEXTS = [
  'The headline figure in the brief is the one the team has been planning against.',
  'The later document in the room restates that figure on a fuller basis.',
  'The population the rate is quoted over is not the population that can be reached.',
  'The estimate excludes a cost that is incurred on every unit.',
  'Stated interest has not been tested against an actual offer.',
  'The result holds over the period measured and has not been observed beyond it.',
  'The comparison group differed from the treated group in more than the treatment.',
  'One figure in the pack has never been restated since the basis changed.',
] as const

function completeClaims(
  claims: readonly ClaimExport[],
  conceptSet: readonly string[],
  documents: readonly DocumentExport[],
  subject: string,
): ClaimExport[] {
  const taken = new Set(claims.map((row) => row.key))
  const inRoom = new Set(documents.map((row) => row.key))
  const concepts = conceptSet.length > 0 ? conceptSet : [...FALLBACK_CONCEPTS]
  const conceptAt = (index: number): string =>
    concepts[index % concepts.length] ?? 'evidence quality'

  const rows: ClaimExport[] = claims.map((row, index) => ({
    ...row,
    text: isBlank(row.text)
      ? (FALLBACK_CLAIM_TEXTS[index % FALLBACK_CLAIM_TEXTS.length] ??
        'A consequential claim about the decision.')
      : row.text,
    conceptKey: concepts.includes(row.conceptKey) ? row.conceptKey : conceptAt(index),
    sourceDocumentKey:
      row.sourceDocumentKey !== null && inRoom.has(row.sourceDocumentKey)
        ? row.sourceDocumentKey
        : null,
    escalationReply: row.escalatable && isBlank(row.escalationReply) ? null : row.escalationReply,
  }))

  while (rows.length < CLAIMS_MIN) {
    const index = rows.length
    rows.push({
      key: freeKey(`C${index + 1}`, taken),
      text:
        FALLBACK_CLAIM_TEXTS[index % FALLBACK_CLAIM_TEXTS.length] ??
        `A consequential claim about ${subject}.`,
      sourceKind: 'assistant',
      sourcePassage: '',
      importance: 'supporting',
      consequenceLevel: 'low',
      verificationCost: 'cheap',
      weaklySourced: false,
      volatile: false,
      conceptKey: conceptAt(index),
      carriedValues: [],
      triggerPhrases: [],
      triggerDescription: '',
      escalatable: false,
      escalationReply: null,
      rationale: '',
      position: index,
      sourceDocumentKey: null,
    })
  }

  return rows.map((row, index) => ({ ...row, position: index }))
}

// ---------------------------------------------------------------------------------------------
// Variants and claim states — the sixteen rules of step 4
// ---------------------------------------------------------------------------------------------

const DEFAULT_TRACE_PASSAGE =
  'The passage the claim is drawn from, as it stands in the document named here.'

function traceTo(
  documents: readonly DocumentExport[],
  preferred: string | null,
): VerificationPathsExport['source_trace'] | undefined {
  const target =
    (preferred === null ? undefined : documents.find((row) => row.key === preferred)) ??
    documents.find((row) => row.role === 'superseded') ??
    documents[0]
  if (!target) return undefined
  return {
    document_key: target.key,
    passage: DEFAULT_TRACE_PASSAGE,
    dated_on: target.datedOn,
    author: target.author,
  }
}

/** A path object with every type the pair needs, each side keeping its own authored content. */
function alignPaths(
  paths: VerificationPathsExport,
  types: ReadonlySet<keyof VerificationPathsExport>,
  documents: readonly DocumentExport[],
): VerificationPathsExport {
  const inRoom = new Set(documents.map((row) => row.key))
  const trace =
    paths.source_trace && inRoom.has(paths.source_trace.document_key)
      ? paths.source_trace
      : types.has('source_trace')
        ? traceTo(documents, paths.source_trace?.document_key ?? null)
        : undefined
  const replication =
    paths.replication_check ??
    (types.has('replication_check')
      ? { result: 'Redoing the calculation on the stated basis reproduces the figure as written.' }
      : undefined)
  const decomposition =
    paths.decomposition_check ??
    (types.has('decomposition_check')
      ? {
          steps: [
            {
              label: 'Basis',
              result: 'The basis the figure is quoted on, as stated in the source.',
            },
          ],
        }
      : undefined)

  return {
    ...(trace ? { source_trace: trace } : {}),
    ...(replication ? { replication_check: replication } : {}),
    ...(decomposition ? { decomposition_check: decomposition } : {}),
  }
}

const isStance = (value: string): value is StanceValue =>
  value === 'accept' ||
  value === 'verify' ||
  value === 'challenge' ||
  value === 'reject' ||
  value === 'escalate'

/**
 * Both variants, with a state for every claim and nothing in them a rule would refuse.
 *
 * Every claim carries the same state in both variants except the one planted defect — which is
 * what `VARIANTS_DIFFER_BEYOND_PLANT` says, and what makes the two variants one scenario. The
 * *menu* is the same on both sides even where the content behind it is not (`VARIANT_ACTIONS_DIFFER`),
 * so the path types are unioned across the pair and each side keeps whatever it authored.
 */
function completeVariants(
  variants: readonly VariantExport[],
  claims: readonly ClaimExport[],
  documents: readonly DocumentExport[],
): VariantExport[] {
  const claimKeys = claims.map((row) => row.key)
  const held = new Set(claimKeys)
  const byKey = new Map<string, VariantExport>(variants.map((variant) => [variant.key, variant]))

  const stateOf = (variantKey: string, claimKey: string): VariantClaimStateExport | undefined =>
    byKey.get(variantKey)?.claimStates.find((state) => state.claimKey === claimKey)

  return VARIANT_KEYS.map((variantKey) => {
    const existing = byKey.get(variantKey)
    const claimStates = claimKeys.map((claimKey) => {
      const here = stateOf(variantKey, claimKey)
      const there = VARIANT_KEYS.map((other) => stateOf(other, claimKey)).find(
        (state) => state !== undefined,
      )
      const source = here ?? there
      const types = new Set<keyof VerificationPathsExport>()
      for (const other of VARIANT_KEYS) {
        const state = stateOf(other, claimKey)
        if (!state) continue
        for (const type of ['source_trace', 'replication_check', 'decomposition_check'] as const) {
          if (state.verificationPaths[type] !== undefined) types.add(type)
        }
      }
      const stance =
        source && isStance(source.warrantedStance) ? source.warrantedStance : ('verify' as const)
      return {
        claimKey,
        evidenceStatus: source?.evidenceStatus ?? 'sound',
        failureFamily: source?.failureFamily ?? null,
        warrantedStance: stance,
        planted: here?.planted ?? false,
        verificationPaths: alignPaths(here?.verificationPaths ?? {}, types, documents),
      }
    })

    return {
      key: variantKey,
      label: existing?.label ?? (variantKey === 'defective' ? 'Defective' : 'Sound'),
      claimStates: claimStates.filter((state) => held.has(state.claimKey)),
    }
  })
}

type ShapedClaims = { claims: ClaimExport[]; variants: VariantExport[] }

/** A stance a *sound* claim can warrant. Challenge and Reject are answers to a defect. */
const soundStance = (stance: StanceValue): StanceValue =>
  stance === 'challenge' || stance === 'reject' ? 'verify' : stance

/**
 * The claim mix PRD §7.18 (9) and §12 require, imposed on the set as it stands.
 *
 * One planted defect that is load-bearing, consequential and catchable; one claim outside it whose
 * Source Trace would move a reasonable stance; one escalatable claim with a reply; two low-stakes
 * sound claims warranting Accept, which are also what `NO_ACCEPT_WARRANTED_SOUND` asks for. Six
 * claims is exactly enough room for all four, which is why `CLAIMS_TOO_FEW` sets the floor there.
 *
 * Every claim but the plant carries the *same* state in both variants (`VARIANTS_DIFFER_BEYOND_PLANT`),
 * so the four scalar fields are decided once per claim here and written to both sides, rather than
 * being patched per variant where the two could drift.
 */
function shapeClaimMix(
  claims: readonly ClaimExport[],
  variants: readonly VariantExport[],
  conceptSet: readonly string[],
  documents: readonly DocumentExport[],
): ShapedClaims {
  if (claims.length === 0) return { claims: [...claims], variants: [...variants] }

  const defective = variants.find((variant) => variant.key === 'defective')
  const sound = variants.find((variant) => variant.key === 'sound')
  const held = new Set(claims.map((row) => row.key))

  // The plant: the one the author already marked, when there is exactly one and it names a claim
  // this version holds; otherwise the most consequential claim in the set.
  const marked = (defective?.claimStates ?? []).filter(
    (state) => state.planted && state.evidenceStatus === 'defective' && held.has(state.claimKey),
  )
  const plantKey =
    marked.length === 1 && marked[0]
      ? marked[0].claimKey
      : (claims.find((row) => row.importance === 'load_bearing' && row.consequenceLevel !== 'low')
          ?.key ??
        claims[0]?.key ??
        '')

  const plantFamily =
    defective?.claimStates.find((state) => state.claimKey === plantKey)?.failureFamily ??
    FALLBACK_FAILURE_FAMILY

  // Who carries what. A claim may carry more than one role — the stance-changing trace and the
  // escalatable reply sit happily on one claim — but the plant carries none of them, because every
  // one of them is a statement about a claim that is sound in both variants.
  const others = claims.filter((row) => row.key !== plantKey)
  const traceKey =
    others.find((row) => row.weaklySourced || row.volatile)?.key ?? others[0]?.key ?? ''
  const escalateKey = others.find((row) => row.escalatable)?.key ?? others[0]?.key ?? ''
  const lowStakes = new Set<string>(
    others
      .filter((row) => row.consequenceLevel === 'low')
      .slice(0, LOW_STAKES_SOUND_CLAIMS_MIN)
      .map((row) => row.key),
  )
  const lowStakesWanted = Math.max(LOW_STAKES_SOUND_CLAIMS_MIN, ACCEPT_WARRANTED_SOUND_CLAIMS_MIN)
  // Taken from the end of the set, so a low-stakes flag lands on a supporting claim rather than on
  // the first thing the model wrote, which is usually the one the decision turns on.
  for (const row of [...others].reverse()) {
    if (lowStakes.size >= lowStakesWanted) break
    lowStakes.add(row.key)
  }

  const concepts = conceptSet.length > 0 ? conceptSet : [...FALLBACK_CONCEPTS]
  const shapedClaims: ClaimExport[] = claims.map((row) => {
    if (row.key === plantKey) {
      return {
        ...row,
        importance: 'load_bearing',
        consequenceLevel: row.consequenceLevel === 'low' ? 'high' : row.consequenceLevel,
        conceptKey: concepts.includes(row.conceptKey)
          ? row.conceptKey
          : (concepts[0] ?? row.conceptKey),
      }
    }
    return {
      ...row,
      ...(row.key === traceKey && !row.weaklySourced && !row.volatile
        ? { weaklySourced: true }
        : {}),
      ...(row.key === escalateKey
        ? {
            escalatable: true,
            escalationReply: isBlank(row.escalationReply)
              ? 'I put it to the colleague who owns the figure. They confirm the basis it is quoted on, and they note that nobody has restated it since that basis changed.'
              : row.escalationReply,
          }
        : {}),
      ...(lowStakes.has(row.key) ? { consequenceLevel: 'low' as const } : {}),
    }
  })

  // One decision per claim, written to both sides.
  const stanceByClaim = new Map<string, StanceValue>()
  for (const claim of claims) {
    const authored =
      sound?.claimStates.find((state) => state.claimKey === claim.key)?.warrantedStance ??
      defective?.claimStates.find((state) => state.claimKey === claim.key)?.warrantedStance ??
      'verify'
    const stance = isStance(authored) ? authored : 'verify'
    stanceByClaim.set(claim.key, lowStakes.has(claim.key) ? 'accept' : soundStance(stance))
  }

  const fallbackTrace = traceTo(documents, null)

  const shapedVariants: VariantExport[] = variants.map((variant) => ({
    ...variant,
    claimStates: variant.claimStates.map((state): VariantClaimStateExport => {
      const isDefectiveVariant = variant.key === 'defective'
      const wantsTrace = state.claimKey === plantKey || state.claimKey === traceKey
      const paths: VerificationPathsExport =
        wantsTrace && state.verificationPaths.source_trace === undefined && fallbackTrace
          ? { ...state.verificationPaths, source_trace: fallbackTrace }
          : state.verificationPaths

      if (state.claimKey === plantKey) {
        const authored = isStance(state.warrantedStance) ? state.warrantedStance : 'verify'
        return {
          claimKey: state.claimKey,
          evidenceStatus: isDefectiveVariant ? 'defective' : 'sound',
          failureFamily: isDefectiveVariant ? plantFamily : null,
          warrantedStance: isDefectiveVariant
            ? authored === 'challenge' || authored === 'reject'
              ? authored
              : 'challenge'
            : soundStance(authored),
          planted: isDefectiveVariant,
          verificationPaths: paths,
        }
      }

      return {
        claimKey: state.claimKey,
        evidenceStatus: 'sound',
        failureFamily: null,
        warrantedStance: stanceByClaim.get(state.claimKey) ?? 'verify',
        planted: false,
        verificationPaths: paths,
      }
    }),
  }))

  return { claims: shapedClaims, variants: shapedVariants }
}

// ---------------------------------------------------------------------------------------------
// The probe (no rule of its own; it must simply name a claim that exists)
// ---------------------------------------------------------------------------------------------

function keepProbe(
  probe: PackageExport['probe'],
  claims: readonly ClaimExport[],
): PackageExport['probe'] {
  if (probe === null) return null
  return claims.some((row) => row.key === probe.claimKey) ? probe : null
}

// ---------------------------------------------------------------------------------------------
// The Turn (`TURN_MISSING`, `TURN_DELAY`)
// ---------------------------------------------------------------------------------------------

const clampDelay = (seconds: number): number =>
  Number.isFinite(seconds) && seconds >= TURN_DELAY_SECONDS_MIN && seconds <= TURN_DELAY_SECONDS_MAX
    ? Math.round(seconds)
    : 90

function completeTurn(
  turn: PackageExport['turn'],
  claims: readonly ClaimExport[],
  stakeholders: readonly StakeholderExport[],
  subject: string,
): PackageExport['turn'] {
  const held = new Set(claims.map((row) => row.key))
  const stakeholderKeys = new Set(stakeholders.map((row) => row.key))

  if (turn !== null) {
    return {
      ...turn,
      text: isBlank(turn.text)
        ? `A message arrives about ${subject}: one of the figures the decision rests on has been restated.`
        : turn.text,
      evidence: isBlank(turn.evidence)
        ? 'The restated figure, on the basis the later document sets out.'
        : turn.evidence,
      stakeholderKey:
        turn.stakeholderKey !== null && stakeholderKeys.has(turn.stakeholderKey)
          ? turn.stakeholderKey
          : null,
      windowClaimKeys: turn.windowClaimKeys.filter((key) => held.has(key)),
    }
  }

  return {
    text:
      `A message arrives while you are working: the figure quoted in the pack for ${subject} has ` +
      `been restated on a fuller basis, and the new number is materially different.`,
    voice: 'corrected_number',
    warrantsChange: true,
    proportionateResponse: 'revise',
    evidence: 'The restated figure, on the basis the later document sets out.',
    disruptedAssumptionKeys: [],
    stakeholderKey: stakeholders[0]?.key ?? null,
    windowClaimKeys: claims.slice(0, 1).map((row) => row.key),
  }
}

// ---------------------------------------------------------------------------------------------
// The question bank (`QUESTION_BANK_INCOMPLETE`, `QUESTION_TEMPLATE_PLACEHOLDER`)
// ---------------------------------------------------------------------------------------------

/**
 * A template with nothing in it the renderer cannot fill (D-369).
 *
 * An unknown name that plainly means one of the five is rewritten to that one — `{claim}` and
 * `{claim_statement}` are both `{claim_text}` — and anything else loses its braces and stays as the
 * words the author wrote, which is the one outcome that never shows the machinery to a student.
 */
function sanitizeTemplate(template: string): string {
  let text = template
  for (const name of placeholdersIn(template)) {
    if ((QUESTION_PLACEHOLDERS as readonly string[]).includes(name)) continue
    const mapped = QUESTION_PLACEHOLDERS.find(
      (known) => name.includes(known) || known.includes(name),
    )
    text = text.split(`{${name}}`).join(mapped ? `{${mapped}}` : name.replace(/_/g, ' '))
  }
  return text.replace(/[ \t]{2,}/g, ' ').trim()
}

const DEFAULT_QUESTION_TEMPLATES = [
  'What is the single piece of evidence your decision most depends on, and how do you know it holds?',
  'Which figure in your brief would change your recommendation if it turned out to be wrong?',
  'What did you decide not to do, and what would have had to be true for you to do it instead?',
  'Where did the assistant help you most, and where did you have to check it?',
  'What would you look at first if you had one more hour on this decision?',
  'Who is worse off if you are wrong, and what did you put in place for that case?',
  'Which document in the room did you treat as settled, and why was that reasonable?',
  'What is the weakest part of the position you just defended?',
] as const

function completeQuestions(
  questions: readonly DefenseQuestionExport[],
  claims: readonly ClaimExport[],
  namedFields: readonly NamedFieldExport[],
): DefenseQuestionExport[] {
  const held = new Set(claims.map((row) => row.key))
  const taken = new Set(questions.map((row) => row.key))

  const rows: DefenseQuestionExport[] = questions.map((row) => ({
    ...row,
    claimKey: row.claimKey !== null && held.has(row.claimKey) ? row.claimKey : null,
    template: isBlank(row.template)
      ? 'What did you take this to mean, and what did you check before you relied on it?'
      : sanitizeTemplate(row.template),
    followUp: isBlank(row.followUp) ? '' : sanitizeTemplate(row.followUp),
  }))

  const add = (
    kind: DefenseQuestionExport['kind'],
    template: string,
    extra: Partial<DefenseQuestionExport> = {},
  ): void => {
    rows.push({
      key: freeKey(`Q${rows.length + 1}`, taken),
      kind,
      assumptionIndex: null,
      template,
      condition: {},
      followUp: '',
      expectedAnswerNotes: '',
      isDefault: kind === 'default',
      position: rows.length,
      claimKey: null,
      ...extra,
    })
  }

  const ofKind = (kind: string) => rows.filter((row) => row.kind === kind)
  const forClaim = (kind: string, claimKey: string) =>
    ofKind(kind).some((row) => row.claimKey === claimKey)

  // One provenance and one verification question for every claim (PRD §7.12).
  for (const claim of claims) {
    if (!forClaim('provenance', claim.key)) {
      add('provenance', 'Where did "{claim_text}" come from, and what did you do to place it?', {
        claimKey: claim.key,
      })
    }
    if (!forClaim('verification', claim.key)) {
      add(
        'verification',
        'You ended on {stance} for "{claim_text}". What would have had to come back for you to end somewhere else?',
        { claimKey: claim.key },
      )
    }
  }

  // One question per frame assumption, 0 to 2.
  for (const index of FRAME_ASSUMPTION_INDEXES) {
    if (ofKind('assumption').some((row) => row.assumptionIndex === index)) continue
    add('assumption', 'Your frame assumed {assumption}. What would break if that were not so?', {
      assumptionIndex: index,
    })
  }

  if (ofKind('confidence').length === 0) {
    add(
      'confidence',
      'How confident are you in the figure you committed to, and what is that confidence resting on?',
    )
  }
  if (ofKind('frame_vs_response').length === 0) {
    add(
      'frame_vs_response',
      'Your frame said one thing and the message that arrived said another. Which of the two did your final answer follow, and why?',
    )
  }
  if (ofKind('counterfactual').length === 0) {
    add(
      'counterfactual',
      'If the figure you relied on had been half what you were told, what would you have decided instead?',
    )
  }

  // FR-025 / D-135: a figure-provenance question belongs to no claim and names the figure itself.
  if (namedFields.length > 0) {
    const figure = ofKind('figure_provenance').filter(
      (row) => row.claimKey === null && row.template.includes(FIGURE_PLACEHOLDER),
    )
    if (figure.length === 0) {
      add(
        'figure_provenance',
        `You put ${FIGURE_PLACEHOLDER} in the brief. Where does that number come from, and on what basis is it stated?`,
      )
    }
  }

  // The default set covers a run that selects too few questions (PRD §7.18 (12)).
  let template = 0
  while (ofKind('default').length < DEFAULT_QUESTIONS_MIN) {
    const text = DEFAULT_QUESTION_TEMPLATES[template % DEFAULT_QUESTION_TEMPLATES.length]
    template += 1
    if (!text) break
    if (template > DEFAULT_QUESTION_TEMPLATES.length * 2) break
    add('default', text)
  }

  return rows.map((row, index) => ({ ...row, position: index }))
}

// ---------------------------------------------------------------------------------------------
// The debrief counterfactual (`COUNTERFACTUAL_SENTENCES`)
// ---------------------------------------------------------------------------------------------

const FALLBACK_COUNTERFACTUAL =
  'If the defective claim had been traced before the decision was locked, the figure in the brief ' +
  'would have been stated on the basis the later document sets out. The recommendation itself ' +
  'might well have held, but the number it was defended with would have been different. What ' +
  'changes is not the direction of the decision but what it was known to rest on.'

function completeCounterfactual(text: string): string {
  const plain = stripMarkup(text)
  if (countSentences(plain) === COUNTERFACTUAL_SENTENCE_COUNT) return text

  const sentences = splitSentences(plain)
  if (sentences.length > COUNTERFACTUAL_SENTENCE_COUNT) {
    const trimmed = sentences.slice(0, COUNTERFACTUAL_SENTENCE_COUNT).join(' ')
    // The heuristic has to agree that the cut is three sentences; when it does not, the fallback
    // is what the rule is satisfied with, because a counterfactual nobody can count is no use.
    if (countSentences(trimmed) === COUNTERFACTUAL_SENTENCE_COUNT) return trimmed
  }
  return FALLBACK_COUNTERFACTUAL
}

// ---------------------------------------------------------------------------------------------
// The general escalation reply (`GENERAL_REPLY_MISSING`)
// ---------------------------------------------------------------------------------------------

function completeGeneralReply(reply: string): string {
  return isBlank(reply)
    ? 'I put that to the colleague who owns the figure. They stand by it on the basis it was ' +
        'produced on, and they note that nobody has restated it since that basis changed.'
    : reply
}

// ---------------------------------------------------------------------------------------------
// Readiness Check items (`READINESS_SPLIT`)
// ---------------------------------------------------------------------------------------------

type ItemTemplate = { stem: string; options: readonly string[]; answerIndex: number }

const OPTION_KEYS = ['a', 'b', 'c', 'd'] as const

const READINESS_BANK: Record<keyof typeof READINESS_ITEM_COUNTS, readonly ItemTemplate[]> = {
  foundation: [
    {
      stem: 'A rate is quoted over a population. What has to be true before it can be applied to a different population?',
      options: [
        'The second population has to be reachable and comparable on what drives the rate.',
        'The second population only has to be larger than the first.',
        'Nothing; a rate applies wherever it is quoted.',
        'The rate has to have been measured more than once.',
      ],
      answerIndex: 0,
    },
    {
      stem: 'What distinguishes a measured result from a stated intention?',
      options: [
        'A measured result was observed; an intention was reported by someone who was asked.',
        'A measured result is larger.',
        'An intention is always wrong.',
        'There is no useful difference between them.',
      ],
      answerIndex: 0,
    },
    {
      stem: 'A contribution figure excludes a cost that is incurred on every unit. What does that do to the figure?',
      options: [
        'It overstates it, and by the size of the excluded cost per unit.',
        'It leaves it unchanged, because the cost is fixed.',
        'It understates it.',
        'It has no effect unless the cost is large.',
      ],
      answerIndex: 0,
    },
    {
      stem: 'Two documents give different figures for the same quantity. What is the first thing to establish?',
      options: [
        'Which basis each figure is stated on, and which of the two is later.',
        'Which figure is larger.',
        'Which document is longer.',
        'Which author is more senior.',
      ],
      answerIndex: 0,
    },
    {
      stem: 'What makes a piece of evidence load-bearing for a decision?',
      options: [
        'The decision changes if the evidence turns out to be wrong.',
        'It appears in more than one document.',
        'It is the most recent thing in the room.',
        'It is quoted in the summary.',
      ],
      answerIndex: 0,
    },
    {
      stem: 'A document is accurate and correctly dated but bears on nothing in the decision. How should it be treated?',
      options: [
        'As irrelevant to this decision, however sound it is in itself.',
        'As supporting evidence, because it is accurate.',
        'As contradicting evidence, because it is not about the decision.',
        'As the most reliable document in the room.',
      ],
      answerIndex: 0,
    },
    {
      stem: 'What does it mean for a figure to be superseded?',
      options: [
        'A later document restates it, so the earlier figure no longer stands on its own.',
        'It was wrong when it was written.',
        'It was produced by someone who has left.',
        'It is the smallest of the figures available.',
      ],
      answerIndex: 0,
    },
    {
      stem: 'Before committing to a number in a decision brief, what is the minimum to have established?',
      options: [
        'Where it came from and what basis it is stated on.',
        'That it appears in at least two places.',
        'That it is rounded.',
        'That nobody has objected to it.',
      ],
      answerIndex: 0,
    },
  ],
  defect_concept: [
    {
      stem: 'A number is quoted confidently but was never actually computed from the inputs given. Which kind of defect is that?',
      options: [
        'An uncomputed number.',
        'A stale piece of evidence.',
        'An omitted alternative.',
        'A misattributed source.',
      ],
      answerIndex: 0,
    },
    {
      stem: 'A figure was correct when it was produced but the basis has since changed and nobody restated it. Which kind of defect is that?',
      options: [
        'Stale evidence.',
        'An unstated assumption.',
        'A misapplied method.',
        'A reversal to agree.',
      ],
      answerIndex: 0,
    },
    {
      stem: 'A result measured over one period is projected forward with no basis for expecting it to hold. Which kind of defect is that?',
      options: [
        'Extrapolation.',
        'A near neighbour.',
        'An unacceptable route.',
        'A misattributed source.',
      ],
      answerIndex: 0,
    },
    {
      stem: 'A claim is attributed to a document that does not in fact say it. Which kind of defect is that?',
      options: [
        'A misattributed source.',
        'An omitted alternative.',
        'An uncomputed number.',
        'Stale evidence.',
      ],
      answerIndex: 0,
    },
    {
      stem: 'A technique that is sound in one setting is applied where its conditions do not hold. Which kind of defect is that?',
      options: [
        'A misapplied method.',
        'An unstated assumption.',
        'Extrapolation.',
        'A near neighbour.',
      ],
      answerIndex: 0,
    },
    {
      stem: 'An answer is very close to the right one but turns on a quantity that is not the one asked about. Which kind of defect is that?',
      options: [
        'A near neighbour.',
        'A reversal to agree.',
        'An unacceptable route.',
        'An omitted alternative.',
      ],
      answerIndex: 0,
    },
  ],
  ai_behavior: [
    {
      stem: 'An assistant reverses its position as soon as you push back, without new evidence. What has it told you?',
      options: [
        'Nothing about the question; only that it will agree with pressure.',
        'That your objection was correct.',
        'That its first answer was fabricated.',
        'That it has checked the source again.',
      ],
      answerIndex: 0,
    },
    {
      stem: 'An assistant states a figure with no source. What is the right next move?',
      options: [
        'Ask where it came from and check it against the room before relying on it.',
        'Use it, because assistants are usually right about figures.',
        'Discard the whole answer.',
        'Ask the same question again in different words.',
      ],
      answerIndex: 0,
    },
    {
      stem: 'What does an assistant’s fluency tell you about whether its claim is true?',
      options: [
        'Nothing at all; fluency and accuracy are independent.',
        'That it is more likely to be true.',
        'That it has been verified.',
        'That it came from a document.',
      ],
      answerIndex: 0,
    },
    {
      stem: 'You ask an assistant to check its own claim and it says the claim is correct. What have you learned?',
      options: [
        'Little; self-confirmation is not an independent check.',
        'That the claim is correct.',
        'That the claim came from the room.',
        'That the claim is load-bearing.',
      ],
      answerIndex: 0,
    },
    {
      stem: 'When is it reasonable to accept an assistant’s claim without checking it?',
      options: [
        'When nothing about the decision turns on it.',
        'When it is stated confidently.',
        'When it agrees with the brief.',
        'It is never reasonable.',
      ],
      answerIndex: 0,
    },
    {
      stem: 'An assistant offers one option and defends it well. What is the risk?',
      options: [
        'The alternatives it did not raise are invisible to you.',
        'The option it offered is certainly wrong.',
        'It has read the documents in the wrong order.',
        'It will reverse itself later.',
      ],
      answerIndex: 0,
    },
    {
      stem: 'You delegate a calculation to an assistant. What remains yours?',
      options: [
        'The decision, and the account of what it rests on.',
        'Nothing; the work has been handed over.',
        'Only the arithmetic.',
        'Only the wording of the brief.',
      ],
      answerIndex: 0,
    },
    {
      stem: 'What is the point of asking an assistant for the source of a claim rather than for the claim again?',
      options: [
        'A source can be opened and checked; a restatement cannot.',
        'It produces a shorter answer.',
        'It makes the assistant more confident.',
        'It is the only question assistants answer accurately.',
      ],
      answerIndex: 0,
    },
  ],
}

function completeReadinessItems(
  items: readonly ReadinessItemExport[],
  claims: readonly ClaimExport[],
  conceptSet: readonly string[],
): ReadinessItemExport[] {
  const taken = new Set(items.map((row) => row.key))
  const concepts = conceptSet.length > 0 ? conceptSet : [...FALLBACK_CONCEPTS]

  const wellFormed = (item: ReadinessItemExport): boolean =>
    item.options.length === READINESS_OPTION_COUNT &&
    new Set(item.options.map((option) => option.key)).size === item.options.length &&
    item.options.some((option) => option.key === item.answerKey) &&
    !isBlank(item.stem)

  // AI-005: an item stem may not hand the student the defect by repeating a claim.
  const echoes = new Set(
    noItemNamesAClaim(
      items.map((item) => ({ id: item.key, stem: item.stem })),
      claims.map((claim) => ({ id: claim.key, text: claim.text })),
    ).echoes.map((echo) => echo.itemId),
  )

  const usable = items.filter((item) => wellFormed(item) && !echoes.has(item.key))

  // A bank item that happened to repeat eight words of a claim would fail the same rule the model's
  // items are held to, so the bank is filtered by the same check before anything is drawn from it.
  const quiet = (stem: string): boolean =>
    noItemNamesAClaim(
      [{ id: 'candidate', stem }],
      claims.map((claim) => ({ id: claim.key, text: claim.text })),
    ).ok

  const kept: ReadinessItemExport[] = []
  for (const [category, required] of Object.entries(READINESS_ITEM_COUNTS) as [
    keyof typeof READINESS_ITEM_COUNTS,
    number,
  ][]) {
    const mine = usable.filter((item) => item.category === category).slice(0, required)
    kept.push(...mine)

    const bank = READINESS_BANK[category].filter((template) => quiet(template.stem))
    for (let index = mine.length; index < required; index += 1) {
      const template = bank[(index - mine.length) % Math.max(bank.length, 1)]
      if (!template) break
      // Two items per concept keeps the concept map a reading of a concept rather than of one
      // question (D-251, the `READINESS_CONCEPT_SINGLE_ITEM` warning).
      const concept =
        concepts[Math.floor(index / 2) % concepts.length] ?? concepts[0] ?? 'evidence quality'
      kept.push({
        key: freeKey(`R_${category.slice(0, 4)}_${index + 1}`, taken),
        category,
        conceptKey: concept,
        stem: template.stem,
        options: template.options.map((text, position): ReadinessOption => ({
          key: OPTION_KEYS[position] ?? String(position),
          text,
        })),
        answerKey: OPTION_KEYS[template.answerIndex] ?? 'a',
        position: kept.length,
      })
    }
  }

  return kept.map((item, index) => ({ ...item, position: index }))
}

// ---------------------------------------------------------------------------------------------
// The seed record (`RESKIN_LOG_EMPTY`)
// ---------------------------------------------------------------------------------------------

function completeSeedRecord(
  seedRecord: PackageExport['seedRecord'],
  subject: string,
): PackageExport['seedRecord'] {
  if (seedRecord === null) return null

  const entries = [...seedRecord.reskinLog]
  const kinds = new Set(entries.map((entry) => entry.kind))
  const fallback: Record<
    (typeof RESKIN_KINDS_REQUIRED)[number],
    { from: string; to: string; note: string }
  > = {
    renamed_entity: {
      from: 'the organisation named in the source case',
      to: subject,
      note: 'Every entity in the case was renamed for this package.',
    },
    altered_number: {
      from: 'the figures as the source case states them',
      to: 'figures restated for this package',
      note: 'The quantities were changed so the package does not reproduce the source.',
    },
    restructured_document: {
      from: 'the source case as one continuous text',
      to: 'an Evidence Room of separate dated documents',
      note: 'The case was broken into the documents a decision run is worked from.',
    },
  }

  for (const kind of RESKIN_KINDS_REQUIRED) {
    if (kinds.has(kind)) continue
    entries.push({ kind, ...fallback[kind] })
  }

  return { ...seedRecord, reskinLog: entries }
}
