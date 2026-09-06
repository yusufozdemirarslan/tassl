// Generates tests/fixtures/scoring/*.json — the thirteen scoring fixtures of 14 §5.
// Every fixture is a complete `GraphInput`: the authored package version, the variant's claim
// states, and the run's whole event list with sequences and clock readings that a real run would
// have written. `tests/unit/scoring/graphs/fixtures.test.ts` parses each one through
// `EVENT_PAYLOAD_SCHEMAS`, so a drifting payload here fails there.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import prettier from 'prettier'

const OUT = join(process.cwd(), 'tests', 'fixtures', 'scoring')
mkdirSync(OUT, { recursive: true })

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const CLAIM = (i) => uuid(i)
const DOC = (i) => uuid(100 + i)
const DELEG = (i) => uuid(200 + i)
const ACTION = (i) => uuid(300 + i)
const ESC = (i) => uuid(400 + i)
const OPEN = (i) => uuid(500 + i)
const PAUSE = (i) => uuid(600 + i)
const TURN = uuid(700)
const QUESTION = (i) => uuid(800 + i)
const RUNQ = (i) => uuid(900 + i)
const NEUT = (i) => uuid(1000 + i)
const ITEM = (i) => uuid(1100 + i)

const MAPPING = { novice: 1, developing: 2, proficient: 3, professional: 4 }

const DOCUMENTS = [
  { id: DOC(1), key: 'market_review_2026', title: 'Premium line market review, March 2026' },
  { id: DOC(2), key: 'supplier_letter', title: 'Supplier letter on lead times' },
  { id: DOC(3), key: 'finance_model', title: 'Finance payback model' },
]

const NAMED_FIELDS = [
  { key: 'unit_margin', label: 'Unit margin', unit: 'percent' },
  { key: 'payback_months', label: 'Payback', unit: 'months' },
]

const CONCEPTS = ['price_elasticity', 'evidence_recency', 'payback_arithmetic', 'supplier_risk']

const CLAIM_TEXTS = [
  'Premium demand grew 6 percent in each of the last three quarters.',
  'The March review shows unit margin at 34 percent on the premium line.',
  'Supplier lead times have held at four weeks since January.',
  'A two-quarter payback is within the board’s stated tolerance.',
  'Competitor pricing moved less than 2 percent over the period.',
  'The finance model assumes no change in freight cost.',
  'Retail partners have absorbed the last two price increases.',
  'Churn among premium subscribers is under 3 percent a quarter.',
  'The March review supersedes the January demand estimate.',
  'Trade promotion spend is flat year on year.',
  'The premium line carries no regulatory review requirement.',
]

/** One claim of the authored package version. */
function claim(index, options) {
  const sourceKind = options.sourceKind ?? 'assistant'
  return {
    id: CLAIM(index),
    key: `claim_${String(index).padStart(2, '0')}`,
    text: CLAIM_TEXTS[(index - 1) % CLAIM_TEXTS.length],
    sourceKind,
    sourceDocumentId: sourceKind === 'document' ? (options.documentId ?? DOC(1)) : null,
    importance: options.importance ?? 'supporting',
    consequenceLevel: options.consequenceLevel ?? 'medium',
    conceptKey: options.conceptKey ?? CONCEPTS[(index - 1) % CONCEPTS.length],
    weaklySourced: options.weaklySourced ?? false,
    position: index,
  }
}

function variantState(index, options) {
  return {
    claimId: CLAIM(index),
    evidenceStatus: options.evidenceStatus,
    failureFamily:
      options.evidenceStatus === 'defective' ? (options.failureFamily ?? 'stale_evidence') : null,
    warrantedStance: options.warrantedStance,
    planted: options.planted ?? false,
  }
}

const FRAME_ASSUMPTIONS = [
  'Demand for the premium line grows at six percent a year.',
  'Supplier lead times hold at four weeks.',
  'The board will accept a two-quarter payback.',
]

const BRIEF_ASSUMPTIONS = [
  'Demand growth continues at six percent.',
  'Lead times stay at four weeks through the launch.',
  'Payback lands inside two quarters.',
]

const TURN_SPEC = {
  text: 'Your supplier has written to say lead times move to nine weeks from next month.',
  warrantsChange: true,
  proportionateResponse: 'revise',
  disruptedAssumptionKeys: ['supplier_lead_times', 'regulatory_review_window'],
}

const MARGINAL_TURN_SPEC = {
  text: 'A trade title reports that one regional competitor trimmed list prices by half a point.',
  warrantsChange: false,
  proportionateResponse: 'hold',
  disruptedAssumptionKeys: ['competitor_pricing_stability'],
}

// ---------------------------------------------------------------------------------------------
// The run writer
// ---------------------------------------------------------------------------------------------

class Run {
  constructor(spec) {
    this.spec = spec
    this.events = []
    this.seq = 1
    this.start = Date.parse('2026-09-01T14:00:00.000Z')
    this.t = 0
    this.workingStart = null
    this.charged = 0
    this.credited = 0
    this.pausedTotal = 0
    this.locked = false
    this.windowEnd = null
    this.inWindow = false
    this.clockMs = spec.workingClockSeconds * 1000
    this.delegationCount = 0
  }

  now() {
    return this.start + this.t
  }

  iso(at = this.now()) {
    return new Date(at).toISOString()
  }

  clock() {
    if (this.inWindow) return Math.round(this.windowEnd - this.now())
    if (this.workingStart === null || this.locked) return null
    return Math.round(
      this.clockMs -
        (this.now() - this.workingStart) +
        this.pausedTotal +
        this.credited -
        this.charged,
    )
  }

  wait(ms) {
    this.t += ms
    return this
  }

  push(type, payload) {
    this.events.push({
      seq: this.seq++,
      type,
      occurredAt: this.iso(),
      clockRemainingMs: this.clock(),
      payload,
    })
    return this.events[this.events.length - 1]
  }
}

function buildRun(spec) {
  const run = new Run(spec)

  run.push('policy_displayed', {
    outside_ai_policy: 'declared',
    weight: 0.1,
    mapping: MAPPING,
    run_type: 'decision',
    counts_statement: true,
  })
  run.push('lifecycle', { from: 'assigned', to: 'readiness', cause: 'run_started' })

  run.wait(30_000)
  spec.readiness.forEach((item, index) => {
    run.push('readiness_item', {
      item_id: ITEM(index + 1),
      item_key: `item_${String(index + 1).padStart(2, '0')}`,
      category: index === 0 ? 'foundation' : index === 1 ? 'defect_concept' : 'ai_behavior',
      concept_key: item.conceptKey,
      answer_key: item.answerKey,
      correct: item.correct,
    })
    run.wait(5_000)
  })
  run.push('lifecycle', { from: 'readiness', to: 'framing', cause: 'readiness_submitted' })

  // Evidence Room reading before the assistant unlocks (FR-030, Appendix A.1).
  let openIndex = 0
  for (const read of spec.preFrameReads ?? []) {
    openIndex += 1
    const openId = OPEN(openIndex)
    run.wait(10_000)
    run.push('document_open', {
      open_id: openId,
      document_id: read.documentId,
      document_key: read.documentKey,
      before_first_delegation: true,
      in_turn_window: false,
    })
    run.wait(read.durationMs)
    run.push('document_close', {
      open_id: openId,
      document_id: read.documentId,
      duration_ms: read.durationMs,
      before_first_delegation: true,
      skim: read.skim ?? false,
      in_turn_window: false,
    })
  }

  run.wait(20_000)
  run.workingStart = run.now()
  run.push('frame_locked', {
    decision: spec.frame.decision,
    assumptions: spec.frame.assumptions,
    position: spec.frame.position,
    confidence: spec.frame.confidence,
  })
  run.push('lifecycle', { from: 'framing', to: 'working', cause: 'frame_locked' })

  // The working period.
  const actionIdsByClaim = new Map()
  let actionIndex = 0
  let escalationIndex = 0

  for (const step of spec.work) {
    run.wait(step.afterMs ?? 30_000)
    if (step.kind === 'delegation') {
      run.delegationCount += 1
      run.push('delegation', {
        delegation_id: DELEG(run.delegationCount),
        seq: run.delegationCount,
        request_text: step.request,
        response_text: step.response,
        claim_ids: step.claimIndexes.map(CLAIM),
        why: step.why ?? null,
        in_turn_window: false,
        flags: step.flags ?? [],
        unverified_numbers: [],
        failed: false,
      })
    } else if (step.kind === 'read') {
      openIndex += 1
      const openId = OPEN(openIndex)
      run.push('document_open', {
        open_id: openId,
        document_id: step.documentId,
        document_key: step.documentKey,
        before_first_delegation: false,
        in_turn_window: false,
      })
      run.wait(step.durationMs)
      run.push('document_close', {
        open_id: openId,
        document_id: step.documentId,
        duration_ms: step.durationMs,
        before_first_delegation: false,
        skim: step.skim ?? false,
        in_turn_window: false,
      })
    } else if (step.kind === 'action') {
      actionIndex += 1
      const actionId = ACTION(actionIndex)
      run.charged += step.costMs
      run.push('action', {
        action_id: actionId,
        type: step.type,
        claim_id: CLAIM(step.claimIndex),
        clock_cost_ms: step.costMs,
        result: step.result ?? { passage: 'The March review, page 4.', dated_on: '2026-03-11' },
        in_turn_window: false,
      })
      const list = actionIdsByClaim.get(step.claimIndex) ?? []
      list.push(actionId)
      actionIdsByClaim.set(step.claimIndex, list)
    } else if (step.kind === 'escalation') {
      escalationIndex += 1
      run.charged += step.costMs ?? 300_000
      run.push('escalation', {
        escalation_id: ESC(escalationIndex),
        claim_id: CLAIM(step.claimIndex),
        statement: step.statement,
        response_id: 'claim',
        response_text: 'Your colleague replies with the authored note.',
        clock_cost_ms: step.costMs ?? 300_000,
        counts_against_limit: true,
        in_turn_window: false,
      })
    } else if (step.kind === 'stance') {
      run.push('stance_set', {
        claim_id: CLAIM(step.claimIndex),
        stance: step.stance,
        previous_stance: step.previousStance ?? null,
        action_ids: actionIdsByClaim.get(step.claimIndex) ?? [],
        in_turn_window: false,
      })
    } else if (step.kind === 'used') {
      run.push('claim_used', {
        claim_id: CLAIM(step.claimIndex),
        via: step.via ?? 'log_mark',
        ...(step.via === 'named_field' ? { field_key: step.fieldKey } : {}),
        ...(step.via === 'log_mark' || step.via === undefined
          ? { delegation_id: DELEG(step.delegation ?? 1) }
          : {}),
      })
    } else if (step.kind === 'pause') {
      const pauseId = PAUSE(step.index)
      run.push('pause', { pause_id: pauseId, cause: step.cause, related_delegation_id: null })
      run.wait(step.pausedMs)
      run.pausedTotal += step.pausedMs
      run.credited += step.creditedMs ?? 0
      run.push('resume', {
        pause_id: pauseId,
        paused_ms: step.pausedMs,
        clock_credited_ms: step.creditedMs ?? 0,
      })
    } else if (step.kind === 'declare') {
      run.push('outside_tool_declared', { purpose: step.purpose })
    } else if (step.kind === 'probe') {
      run.push('probe_fired', {
        claim_id: CLAIM(step.claimIndex),
        scripted_reversal: step.reversal,
      })
    }
  }

  run.wait(20_000)
  run.push('brief_opened', {})
  run.wait(spec.briefMs ?? 180_000)
  run.push('brief_closed', { duration_ms: spec.briefMs ?? 180_000 })

  run.wait(5_000)
  const elapsed = run.now() - run.workingStart
  run.push('decision_locked', {
    recommendation: spec.brief.recommendation,
    rationale: spec.brief.rationale,
    assumptions: spec.brief.assumptions,
    change_my_mind: spec.brief.changeMyMind,
    named_values: spec.brief.namedValues,
    confidence: spec.brief.confidence,
    auto: spec.brief.auto ?? false,
    speed_outlier: elapsed < 240_000,
    relied_on_claim_ids: (spec.brief.reliedOn ?? []).map(CLAIM),
    unstanced_relied_on_claim_ids: [],
    elapsed_ms: elapsed,
  })
  run.locked = true
  run.push('lifecycle', { from: 'working', to: 'decision_locked', cause: 'decision_locked' })

  if (spec.addendum) {
    run.wait(60_000)
    run.push('addendum', { text: spec.addendum })
  }

  if (spec.turn) {
    // D-334: the Turn fires at `turn_due_at` and carries that instant; everything the window is
    // made of is stamped when the student came back and read it.
    run.wait(spec.turn.delayMs ?? 90_000)
    const dueAt = run.now()
    run.wait(spec.turn.absentMs ?? 0)
    const openedAt = run.now()
    const windowEnd = openedAt + 12 * 60 * 1000
    const delivered = {
      seq: run.seq++,
      type: 'turn_delivered',
      occurredAt: run.iso(dueAt),
      clockRemainingMs: null,
      payload: {
        turn_id: TURN,
        text: spec.turn.text,
        voice: spec.turn.voice ?? 'supplier_notice',
        window_ends_at: new Date(windowEnd).toISOString(),
        window_claim_ids: (spec.turn.windowClaimIndexes ?? []).map(CLAIM),
      },
    }
    run.events.push(delivered)
    run.windowEnd = windowEnd
    run.inWindow = true
    run.push('lifecycle', { from: 'decision_locked', to: 'turn_open', cause: 'turn_delivered' })
    for (const index of spec.turn.windowClaimIndexes ?? []) {
      run.push('claim_used', { claim_id: CLAIM(index), via: 'turn_window' })
    }
    for (const step of spec.turn.work ?? []) {
      run.wait(step.afterMs ?? 60_000)
      if (step.kind === 'stance') {
        run.push('stance_set', {
          claim_id: CLAIM(step.claimIndex),
          stance: step.stance,
          previous_stance: step.previousStance ?? null,
          action_ids: actionIdsByClaim.get(step.claimIndex) ?? [],
          in_turn_window: true,
        })
      } else if (step.kind === 'action') {
        actionIndex += 1
        run.push('action', {
          action_id: ACTION(actionIndex),
          type: step.type,
          claim_id: CLAIM(step.claimIndex),
          clock_cost_ms: step.costMs,
          result: step.result ?? {
            passage: 'The supplier letter, page 1.',
            dated_on: '2026-08-30',
          },
          in_turn_window: true,
        })
      }
    }
    if (spec.turn.response.implicit) {
      run.t = windowEnd - run.start
    } else {
      run.wait(spec.turn.response.afterMs ?? 240_000)
    }
    run.push('turn_response_locked', {
      response: spec.turn.response.response,
      justification: spec.turn.response.justification ?? null,
      confidence: spec.turn.response.confidence ?? null,
      implicit: spec.turn.response.implicit ?? false,
    })
    run.inWindow = false
    run.push('lifecycle', { from: 'turn_open', to: 'turn_locked', cause: 'turn_response_locked' })
  }

  run.wait(10_000)
  run.push('lifecycle', { from: 'turn_locked', to: 'defense_pending', cause: 'defense_opened' })
  spec.defense.forEach((question, index) => {
    run.wait(15_000)
    run.push('defense_question', {
      run_question_id: RUNQ(index + 1),
      question_id: QUESTION(index + 1),
      kind: question.kind,
      seq: index + 1,
      rendered_text: question.text,
      follow_up_of: null,
      selecting_event_seq: null,
    })
    run.wait(question.durationMs ?? 60_000)
    run.push('defense_answer', {
      run_question_id: RUNQ(index + 1),
      text: question.answer,
      duration_ms: question.durationMs ?? 60_000,
    })
  })
  run.push('lifecycle', {
    from: 'defense_pending',
    to: 'defense_complete',
    cause: 'defense_completed',
  })

  for (const neutralization of spec.neutralizations ?? []) {
    run.wait(3_600_000)
    run.push('claim_neutralized', {
      neutralization_id: NEUT(neutralization.index),
      claim_id: CLAIM(neutralization.claimIndex),
      reason: neutralization.reason,
      credit_challenge: neutralization.creditChallenge ?? false,
      note: neutralization.note,
      recompute: {
        dimensions: ['verification', 'calibration'],
        bands_before: { verification: null, calibration: null },
        bands_after: { verification: null, calibration: null },
        points_before: null,
        points_after: null,
      },
    })
  }

  return run.events
}

// ---------------------------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------------------------

const READINESS = CONCEPTS.map((conceptKey, index) => ({
  conceptKey,
  answerKey: `option_${String.fromCharCode(97 + (index % 4))}`,
  correct: index !== 2,
}))

const PRE_FRAME_READS = [
  { documentId: DOC(1), documentKey: 'market_review_2026', durationMs: 240_000 },
  { documentId: DOC(2), documentKey: 'supplier_letter', durationMs: 120_000 },
]

const FRAME = {
  decision: 'Whether to launch the premium line at the higher price point this quarter.',
  assumptions: FRAME_ASSUMPTIONS,
  position: 'I expect to launch, unless the supplier picture has changed.',
  confidence: 55,
}

const BRIEF = {
  recommendation: 'Launch the premium line at the higher price point in the coming quarter.',
  rationale: 'Demand growth and margin both support the move, and the payback is inside tolerance.',
  assumptions: BRIEF_ASSUMPTIONS,
  changeMyMind: 'A confirmed change in supplier lead times would change my mind.',
  namedValues: { unit_margin: 34, payback_months: 6 },
  confidence: 60,
  reliedOn: [],
}

const DEFENSE = [
  {
    kind: 'provenance',
    text: 'Where did the figure of 34 percent unit margin come from?',
    answer: 'From the March market review, which I opened before I asked the assistant anything.',
  },
  {
    kind: 'verification',
    text: 'You did not check the supplier claim. Why not?',
    answer: 'I had traced the margin figure and judged the lead-time claim less load-bearing.',
  },
]

const EMPTY_DEFENSE = DEFENSE.map((question) => ({ ...question, answer: '' }))

function packageVersion(claims, turn) {
  return {
    workingClockSeconds: 1500,
    claims,
    documents: DOCUMENTS,
    namedFields: NAMED_FIELDS,
    turn,
  }
}

// Written through Prettier, not `JSON.stringify` alone: `pnpm lint` checks these files, and
// Prettier reflows a short array onto one line where `stringify` always expands it. A generator
// whose output the linter rejects makes every regeneration dirty the tree.
async function write(name, purpose, pkg, variantStates, events) {
  const document = { name, purpose, packageVersion: pkg, variantStates, events }
  const file = join(OUT, `${name}.json`)
  const formatted = await prettier.format(JSON.stringify(document), {
    ...(await prettier.resolveConfig(file)),
    filepath: file,
  })
  writeFileSync(file, formatted, 'utf8')
  console.log(`${name}: ${events.length} events, ${pkg.claims.length} claims`)
}

/** A run in which every surfaced claim is stanced in one pass, with one delegation carrying them. */
function simpleWork(claimIndexes, stances, options = {}) {
  const work = [
    {
      kind: 'delegation',
      afterMs: 45_000,
      request: 'What does the evidence say about the premium launch?',
      response: 'Here is what the room supports, claim by claim.',
      claimIndexes,
      why: options.why ?? 'To assemble the case before I write the brief.',
    },
  ]
  for (const step of options.before ?? []) work.push(step)
  for (const [index, stance] of stances) {
    work.push({ kind: 'stance', afterMs: 20_000, claimIndex: index, stance })
  }
  for (const index of options.reliedOn ?? []) {
    work.push({ kind: 'used', afterMs: 2_000, claimIndex: index, via: 'log_mark', delegation: 1 })
  }
  return work
}

// ---------------------------------------------------------------------------------------------
// 1. accept-everything-defective
// ---------------------------------------------------------------------------------------------
{
  const claims = [
    claim(1, { importance: 'load_bearing', consequenceLevel: 'high' }),
    claim(2, { sourceKind: 'document', documentId: DOC(1) }),
    claim(3, {}),
    claim(4, { importance: 'load_bearing' }),
    claim(5, {}),
    claim(6, {}),
    claim(7, {}),
    claim(8, {}),
  ]
  const states = [
    variantState(1, { evidenceStatus: 'defective', warrantedStance: 'challenge', planted: true }),
    ...[2, 3, 4, 5, 6, 7, 8].map((i) =>
      variantState(i, { evidenceStatus: 'sound', warrantedStance: i === 5 ? 'verify' : 'accept' }),
    ),
  ]
  const events = buildRun({
    workingClockSeconds: 1500,
    readiness: READINESS,
    preFrameReads: PRE_FRAME_READS,
    frame: { ...FRAME, confidence: 60 },
    work: simpleWork(
      [1, 2, 3, 4, 5, 6, 7, 8],
      [1, 2, 3, 4, 5, 6, 7, 8].map((i) => [i, 'accept']),
      { reliedOn: [1, 2, 4] },
    ),
    brief: { ...BRIEF, confidence: 70, reliedOn: [1, 2, 4] },
    turn: {
      ...TURN_SPEC,
      windowClaimIndexes: [3],
      response: { response: 'hold', justification: 'Nothing here moves the case.', confidence: 70 },
    },
    defense: DEFENSE,
  })
  await write(
    'accept-everything-defective',
    'Every surfaced claim accepted in a variant that plants a consequential defect (PRD §7.8): Calibration Novice, False Challenge Rate zero.',
    packageVersion(claims, TURN_SPEC),
    states,
    events,
  )
}

// ---------------------------------------------------------------------------------------------
// 2. accept-everything-sound
// ---------------------------------------------------------------------------------------------
{
  const claims = [1, 2, 3, 4, 5, 6, 7, 8].map((i) =>
    claim(i, { importance: i === 1 || i === 4 ? 'load_bearing' : 'supporting' }),
  )
  const states = [1, 2, 3, 4, 5, 6, 7, 8].map((i) =>
    variantState(i, { evidenceStatus: 'sound', warrantedStance: i === 5 ? 'verify' : 'accept' }),
  )
  const events = buildRun({
    workingClockSeconds: 1500,
    readiness: READINESS,
    preFrameReads: PRE_FRAME_READS,
    frame: { ...FRAME, confidence: 65 },
    work: simpleWork(
      [1, 2, 3, 4, 5, 6, 7, 8],
      [1, 2, 3, 4, 5, 6, 7, 8].map((i) => [i, 'accept']),
      { reliedOn: [1, 4, 5] },
    ),
    brief: { ...BRIEF, confidence: 72, reliedOn: [1, 4, 5] },
    turn: {
      ...MARGINAL_TURN_SPEC,
      windowClaimIndexes: [5],
      response: {
        response: 'hold',
        justification: 'Half a point is inside the noise.',
        confidence: 72,
      },
    },
    defense: DEFENSE,
  })
  await write(
    'accept-everything-sound',
    'Every claim accepted in the defect-free variant (PRD §7.8, Appendix A.4): nothing to catch and nothing caught, which is high Calibration.',
    packageVersion(claims, MARGINAL_TURN_SPEC),
    states,
    events,
  )
}

// ---------------------------------------------------------------------------------------------
// 3. both-defects-escalated
// ---------------------------------------------------------------------------------------------
{
  const claims = [1, 2, 3, 4, 5, 6, 7, 8].map((i) =>
    claim(i, {
      importance: i === 1 || i === 3 ? 'load_bearing' : 'supporting',
      consequenceLevel: i === 1 ? 'high' : 'medium',
    }),
  )
  const states = [
    variantState(1, { evidenceStatus: 'defective', warrantedStance: 'challenge', planted: true }),
    variantState(3, {
      evidenceStatus: 'defective',
      warrantedStance: 'reject',
      failureFamily: 'near_neighbor',
    }),
    ...[2, 4, 5, 6, 7, 8].map((i) =>
      variantState(i, { evidenceStatus: 'sound', warrantedStance: 'accept' }),
    ),
  ].sort((a, b) => a.claimId.localeCompare(b.claimId))
  const events = buildRun({
    workingClockSeconds: 1500,
    readiness: READINESS,
    preFrameReads: PRE_FRAME_READS,
    frame: { ...FRAME, confidence: 50 },
    work: [
      ...simpleWork([1, 2, 3, 4, 5, 6, 7, 8], [], {}),
      {
        kind: 'escalation',
        afterMs: 60_000,
        claimIndex: 1,
        statement: 'Judging this demand series needs a market analyst, not me.',
      },
      { kind: 'stance', afterMs: 10_000, claimIndex: 1, stance: 'escalate' },
      {
        kind: 'escalation',
        afterMs: 60_000,
        claimIndex: 3,
        statement: 'The lead-time question is outside what I can settle here.',
      },
      { kind: 'stance', afterMs: 10_000, claimIndex: 3, stance: 'escalate' },
      ...[2, 4, 5, 6, 7, 8].map((i) => ({
        kind: 'stance',
        afterMs: 15_000,
        claimIndex: i,
        stance: 'accept',
      })),
      { kind: 'used', afterMs: 2_000, claimIndex: 2, via: 'log_mark', delegation: 1 },
      { kind: 'used', afterMs: 2_000, claimIndex: 4, via: 'log_mark', delegation: 1 },
    ],
    brief: { ...BRIEF, confidence: 55, reliedOn: [2, 4] },
    turn: {
      ...TURN_SPEC,
      windowClaimIndexes: [3],
      response: {
        response: 'revise',
        justification:
          'Nine weeks pushes the launch a quarter out; I revise the timing, not the case.',
        confidence: 60,
      },
    },
    defense: DEFENSE,
  })
  await write(
    'both-defects-escalated',
    'Both consequential defects kept from the decision by escalation (PRD §7.9, Appendix A.4): top of Calibration even with no personal detection.',
    packageVersion(claims, TURN_SPEC),
    states,
    events,
  )
}

// ---------------------------------------------------------------------------------------------
// 4. outside-answer-space
// ---------------------------------------------------------------------------------------------
{
  const claims = [1, 2, 3, 4, 5, 6, 7, 8].map((i) =>
    claim(i, { importance: i === 1 ? 'load_bearing' : 'supporting' }),
  )
  const states = [
    variantState(1, { evidenceStatus: 'defective', warrantedStance: 'challenge', planted: true }),
    ...[2, 3, 4, 5, 6, 7, 8].map((i) =>
      variantState(i, { evidenceStatus: 'sound', warrantedStance: 'accept' }),
    ),
  ]
  const events = buildRun({
    workingClockSeconds: 1500,
    readiness: READINESS,
    preFrameReads: [PRE_FRAME_READS[0]],
    frame: { ...FRAME, confidence: 70 },
    work: simpleWork(
      [1, 2, 3, 4, 5, 6, 7, 8],
      [1, 2, 3, 4, 5, 6, 7, 8].map((i) => [i, i === 1 ? 'accept' : 'accept']),
      { reliedOn: [1, 2] },
    ),
    brief: {
      recommendation:
        'Discontinue the standard line entirely and move the whole business to premium next month.',
      rationale: 'The premium numbers are better, so the rest of the range is a distraction.',
      assumptions: BRIEF_ASSUMPTIONS,
      changeMyMind: 'Nothing in the room would change this.',
      namedValues: { unit_margin: 34, payback_months: 2 },
      confidence: 90,
      reliedOn: [1, 2],
    },
    turn: {
      ...TURN_SPEC,
      windowClaimIndexes: [3],
      response: { response: 'hold', justification: 'The plan stands.', confidence: 90 },
    },
    defense: DEFENSE,
  })
  await write(
    'outside-answer-space',
    'A recommendation that sits outside the authored answer space and ignores the evidence it rests on (PRD §7.10, Appendix A.5): Decision Quality Novice.',
    packageVersion(claims, TURN_SPEC),
    states,
    events,
  )
}

// ---------------------------------------------------------------------------------------------
// 5. marco-8-of-11 — the False Challenge Rate fixture (PRD §6, §7.13, D-107)
// ---------------------------------------------------------------------------------------------
{
  const claims = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) =>
    claim(i, {
      importance: i === 1 || i === 2 || i === 11 ? 'load_bearing' : 'supporting',
      consequenceLevel: i === 1 ? 'high' : 'medium',
      sourceKind: i === 9 ? 'document' : 'assistant',
      documentId: DOC(1),
      weaklySourced: i === 5 || i === 8,
    }),
  )
  // c1 is the planted defect; everything else is sound. c5 and c11 warrant a check.
  const warranted = {
    1: 'challenge',
    2: 'accept',
    3: 'accept',
    4: 'accept',
    5: 'verify',
    6: 'accept',
    7: 'accept',
    8: 'accept',
    9: 'accept',
    10: 'accept',
    11: 'verify',
  }
  const states = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) =>
    variantState(i, {
      evidenceStatus: i === 1 ? 'defective' : 'sound',
      warrantedStance: warranted[i],
      planted: i === 1,
    }),
  )
  // Seven challenges and two rejections — nine acts, one of which catches the defect and eight of
  // which land on sound claims warranting reliance. Eight over eleven is 0.727 (PRD §6).
  // c3 is stanced `accept` in the working period and moved to `challenge` inside the Turn window,
  // which is what keeps both stances on the record (FR-081) and still leaves the final split at
  // seven challenges and two rejections.
  const taken = {
    1: 'challenge',
    2: 'challenge',
    3: 'accept',
    4: 'challenge',
    5: 'challenge',
    6: 'challenge',
    7: 'challenge',
    8: 'reject',
    9: 'reject',
    10: 'accept',
    11: 'verify',
  }
  const events = buildRun({
    workingClockSeconds: 1500,
    readiness: READINESS,
    preFrameReads: PRE_FRAME_READS,
    frame: { ...FRAME, confidence: 55 },
    work: [
      {
        kind: 'delegation',
        afterMs: 40_000,
        request: 'Give me everything the room supports on the premium launch.',
        response: 'Here is the case as the documents carry it.',
        claimIndexes: [1, 2, 3, 4, 5, 6],
        why: 'To see the whole case before I start checking it.',
      },
      {
        kind: 'read',
        afterMs: 20_000,
        documentId: DOC(1),
        documentKey: 'market_review_2026',
        durationMs: 90_000,
      },
      {
        kind: 'action',
        afterMs: 15_000,
        type: 'source_trace',
        claimIndex: 1,
        costMs: 60_000,
        result: {
          document_id: DOC(1),
          passage: 'Premium demand grew 6 percent in each of the last three quarters.',
          dated_on: '2025-11-02',
          author: 'Market Insight Unit',
        },
      },
      { kind: 'stance', afterMs: 25_000, claimIndex: 1, stance: 'challenge' },
      {
        kind: 'delegation',
        afterMs: 40_000,
        request: 'What else does the finance model rest on?',
        response: 'Three further claims, with their sources.',
        claimIndexes: [7, 8, 9, 10, 11],
        why: 'To finish the sweep before the brief.',
      },
      {
        kind: 'action',
        afterMs: 20_000,
        type: 'source_trace',
        claimIndex: 11,
        costMs: 60_000,
        result: {
          document_id: DOC(3),
          passage: 'The premium line carries no regulatory review requirement.',
          dated_on: '2026-02-18',
          author: 'Regulatory Affairs',
        },
      },
      ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => ({
        kind: 'stance',
        afterMs: 18_000,
        claimIndex: i,
        stance: taken[i],
      })),
      { kind: 'used', afterMs: 2_000, claimIndex: 10, via: 'log_mark', delegation: 2 },
      { kind: 'used', afterMs: 2_000, claimIndex: 11, via: 'log_mark', delegation: 2 },
      { kind: 'used', afterMs: 2_000, claimIndex: 2, via: 'named_field', fieldKey: 'unit_margin' },
      { kind: 'declare', afterMs: 5_000, purpose: 'A calculator for the payback arithmetic.' },
    ],
    briefMs: 240_000,
    brief: {
      recommendation:
        'Launch, but hold the higher price point until the demand series has been re-based.',
      rationale:
        'Most of the case survives, but the demand claim did not trace clean and the margin figure is the only number I checked.',
      assumptions: BRIEF_ASSUMPTIONS,
      changeMyMind: 'A re-based demand series that still shows six percent would settle it.',
      namedValues: { unit_margin: 34, payback_months: 6 },
      confidence: 60,
      reliedOn: [2, 10, 11],
    },
    addendum: 'I should have said explicitly that the demand series is the load-bearing number.',
    turn: {
      ...TURN_SPEC,
      // The Turn fires ninety seconds after the lock and Marco comes back twenty minutes later
      // (D-334): the window opens when he reads it, not when it fired.
      delayMs: 90_000,
      absentMs: 20 * 60 * 1000,
      windowClaimIndexes: [3, 11],
      work: [
        {
          kind: 'action',
          afterMs: 90_000,
          type: 'source_trace',
          claimIndex: 3,
          costMs: 60_000,
        },
        {
          kind: 'stance',
          afterMs: 30_000,
          claimIndex: 3,
          stance: 'challenge',
          previousStance: 'accept',
        },
      ],
      response: {
        afterMs: 180_000,
        response: 'revise',
        justification:
          'Nine-week lead times move the launch a quarter out; the price point stands, the timing does not.',
        confidence: 60,
      },
    },
    defense: DEFENSE,
  })
  await write(
    'marco-8-of-11',
    'PRD §6 and §7.13: nine challenge-or-reject acts on eleven consequential claims, one of which catches the planted defect and eight of which are false alarms — a False Challenge Rate of 0.727 against a professional reference band under 0.15.',
    packageVersion(claims, TURN_SPEC),
    states,
    events,
  )
}

// ---------------------------------------------------------------------------------------------
// 6. nadia-run-one — confidence 40 → 85 with accuracy at lock below 0.5, and two claims never met
// ---------------------------------------------------------------------------------------------
{
  const claims = [1, 2, 3, 4, 5, 6, 7, 8].map((i) =>
    claim(i, {
      importance: i <= 3 ? 'load_bearing' : 'supporting',
      consequenceLevel: i === 1 ? 'high' : 'medium',
    }),
  )
  const states = [
    variantState(1, { evidenceStatus: 'defective', warrantedStance: 'challenge', planted: true }),
    variantState(2, {
      evidenceStatus: 'defective',
      warrantedStance: 'challenge',
      failureFamily: 'unstated_assumption',
    }),
    variantState(3, {
      evidenceStatus: 'defective',
      warrantedStance: 'reject',
      failureFamily: 'near_neighbor',
    }),
    variantState(4, { evidenceStatus: 'sound', warrantedStance: 'accept' }),
    variantState(5, { evidenceStatus: 'sound', warrantedStance: 'verify' }),
    variantState(6, { evidenceStatus: 'sound', warrantedStance: 'accept' }),
    variantState(7, { evidenceStatus: 'sound', warrantedStance: 'accept' }),
    variantState(8, { evidenceStatus: 'sound', warrantedStance: 'accept' }),
  ]
  const events = buildRun({
    workingClockSeconds: 1500,
    readiness: READINESS,
    preFrameReads: [],
    frame: { ...FRAME, confidence: 40 },
    work: [
      {
        kind: 'delegation',
        afterMs: 30_000,
        request: 'Build me the case for the premium launch.',
        response: 'Here it is, claim by claim.',
        claimIndexes: [1, 2, 3, 4, 5, 6],
        why: null,
      },
      { kind: 'stance', afterMs: 15_000, claimIndex: 1, stance: 'accept' },
      { kind: 'stance', afterMs: 15_000, claimIndex: 2, stance: 'accept' },
      { kind: 'stance', afterMs: 15_000, claimIndex: 3, stance: 'accept' },
      { kind: 'stance', afterMs: 15_000, claimIndex: 4, stance: 'accept' },
      { kind: 'stance', afterMs: 15_000, claimIndex: 5, stance: 'challenge' },
      { kind: 'stance', afterMs: 15_000, claimIndex: 6, stance: 'accept' },
      { kind: 'used', afterMs: 2_000, claimIndex: 1, via: 'log_mark', delegation: 1 },
      { kind: 'used', afterMs: 2_000, claimIndex: 2, via: 'log_mark', delegation: 1 },
      { kind: 'used', afterMs: 2_000, claimIndex: 3, via: 'log_mark', delegation: 1 },
      { kind: 'used', afterMs: 2_000, claimIndex: 4, via: 'log_mark', delegation: 1 },
      { kind: 'used', afterMs: 2_000, claimIndex: 6, via: 'log_mark', delegation: 1 },
    ],
    brief: {
      recommendation: 'Launch the premium line at the higher price point this quarter.',
      rationale: 'The assistant’s case is consistent and the numbers line up.',
      assumptions: BRIEF_ASSUMPTIONS,
      changeMyMind: 'I cannot see what would.',
      namedValues: { unit_margin: 34, payback_months: 6 },
      confidence: 85,
      reliedOn: [1, 2, 3, 4, 6],
    },
    turn: {
      ...TURN_SPEC,
      windowClaimIndexes: [5],
      response: { response: 'hold', justification: 'The case still holds.', confidence: 85 },
    },
    defense: DEFENSE,
  })
  await write(
    'nadia-run-one',
    'Confidence rising from 40 at the frame to 85 at the lock while the accuracy of the claims relied on sits at 0.4 — the `rising_unchecked` shape of 10 §11.2. Two consequential claims are never surfaced and still count in the False Challenge Rate denominator (D-107).',
    packageVersion(claims, TURN_SPEC),
    states,
    events,
  )
}

// ---------------------------------------------------------------------------------------------
// 7 to 10 — the four Turn responses
// ---------------------------------------------------------------------------------------------

async function turnFixture(name, purpose, turnSpec, response) {
  const claims = [1, 2, 3, 4, 5, 6].map((i) =>
    claim(i, { importance: i === 1 ? 'load_bearing' : 'supporting' }),
  )
  const states = [
    variantState(1, { evidenceStatus: 'defective', warrantedStance: 'challenge', planted: true }),
    ...[2, 3, 4, 5, 6].map((i) =>
      variantState(i, { evidenceStatus: 'sound', warrantedStance: 'accept' }),
    ),
  ]
  const events = buildRun({
    workingClockSeconds: 1500,
    readiness: READINESS,
    preFrameReads: PRE_FRAME_READS,
    frame: { ...FRAME, confidence: 55 },
    work: [
      ...simpleWork([1, 2, 3, 4, 5, 6], [], {}),
      {
        kind: 'action',
        afterMs: 30_000,
        type: 'source_trace',
        claimIndex: 1,
        costMs: 60_000,
      },
      { kind: 'stance', afterMs: 20_000, claimIndex: 1, stance: 'challenge' },
      ...[2, 3, 4, 5, 6].map((i) => ({
        kind: 'stance',
        afterMs: 15_000,
        claimIndex: i,
        stance: 'accept',
      })),
      { kind: 'used', afterMs: 2_000, claimIndex: 2, via: 'log_mark', delegation: 1 },
      { kind: 'used', afterMs: 2_000, claimIndex: 4, via: 'log_mark', delegation: 1 },
    ],
    brief: { ...BRIEF, confidence: 62, reliedOn: [2, 4] },
    turn: { ...turnSpec, windowClaimIndexes: [3], response },
    defense: DEFENSE,
  })
  await write(name, purpose, packageVersion(claims, turnSpec), states, events)
}

await turnFixture(
  'implicit-hold-no-change',
  'The Turn window closes unanswered on a Turn that does not warrant a change (FR-115, D-108): an implicit hold that was the proportionate response.',
  MARGINAL_TURN_SPEC,
  { implicit: true, response: 'hold', justification: null, confidence: null },
)

await turnFixture(
  'implicit-hold-change-warranted',
  'The Turn window closes unanswered on a Turn that warranted a revision (FR-115, Appendix A.6): an implicit hold that failed.',
  TURN_SPEC,
  { implicit: true, response: 'hold', justification: null, confidence: null },
)

await turnFixture(
  'full-reversal-marginal',
  'A full reversal in answer to a marginal Turn (Appendix A.6): over-adaptation.',
  MARGINAL_TURN_SPEC,
  {
    response: 'reverse',
    justification: 'A competitor moved, so the whole plan is off.',
    confidence: 30,
  },
)

await turnFixture(
  'hold-with-reason',
  'An explicit hold with a stated reason on a Turn that did not warrant a change (PRD §7.11, D-108): a hold and a warranted revision are scored identically.',
  MARGINAL_TURN_SPEC,
  {
    response: 'hold',
    justification: 'Half a point on one regional list price does not move a two-quarter payback.',
    confidence: 60,
  },
)

// ---------------------------------------------------------------------------------------------
// 11. nothing-answered
// ---------------------------------------------------------------------------------------------
{
  const claims = [1, 2, 3, 4, 5, 6].map((i) =>
    claim(i, { importance: i === 1 ? 'load_bearing' : 'supporting' }),
  )
  const states = [
    variantState(1, { evidenceStatus: 'defective', warrantedStance: 'challenge', planted: true }),
    ...[2, 3, 4, 5, 6].map((i) =>
      variantState(i, { evidenceStatus: 'sound', warrantedStance: 'accept' }),
    ),
  ]
  const events = buildRun({
    workingClockSeconds: 1500,
    readiness: READINESS,
    preFrameReads: [],
    frame: { ...FRAME, confidence: 50 },
    work: simpleWork(
      [1, 2, 3, 4, 5, 6],
      [
        [1, 'accept'],
        [2, 'accept'],
        [3, 'accept'],
        [4, 'accept'],
        [5, 'accept'],
        [6, 'accept'],
      ],
      {
        reliedOn: [2],
      },
    ),
    brief: { ...BRIEF, confidence: 50, reliedOn: [2] },
    turn: {
      ...TURN_SPEC,
      windowClaimIndexes: [3],
      response: { implicit: true, response: 'hold', justification: null, confidence: null },
    },
    defense: EMPTY_DEFENSE,
  })
  await write(
    'nothing-answered',
    'Every defense question answered with nothing (FR-124, Appendix A.7): Ownership Novice and the `nothing_answered` flag.',
    packageVersion(claims, TURN_SPEC),
    states,
    events,
  )
}

// ---------------------------------------------------------------------------------------------
// 12 and 13 — stance records lost (FR-087)
// ---------------------------------------------------------------------------------------------

async function lostFixture(name, purpose, claimCount, lostIndexes) {
  const all = Array.from({ length: claimCount }, (_, index) => index + 1)
  const claims = all.map((i) => claim(i, { importance: i === 1 ? 'load_bearing' : 'supporting' }))
  const states = all.map((i) =>
    variantState(i, {
      evidenceStatus: i === 1 ? 'defective' : 'sound',
      warrantedStance: i === 1 ? 'challenge' : 'accept',
      planted: i === 1,
    }),
  )
  const events = buildRun({
    workingClockSeconds: 1500,
    readiness: READINESS,
    preFrameReads: PRE_FRAME_READS,
    frame: { ...FRAME, confidence: 55 },
    work: [
      ...simpleWork(all, [], {}),
      {
        kind: 'action',
        afterMs: 30_000,
        type: 'source_trace',
        claimIndex: 1,
        costMs: 60_000,
      },
      { kind: 'stance', afterMs: 20_000, claimIndex: 1, stance: 'challenge' },
      ...all
        .slice(1)
        .map((i) => ({ kind: 'stance', afterMs: 12_000, claimIndex: i, stance: 'accept' })),
      { kind: 'used', afterMs: 2_000, claimIndex: 2, via: 'log_mark', delegation: 1 },
    ],
    brief: { ...BRIEF, confidence: 58, reliedOn: [2] },
    turn: {
      ...TURN_SPEC,
      windowClaimIndexes: [3],
      response: {
        response: 'revise',
        justification: 'The timing moves out a quarter.',
        confidence: 58,
      },
    },
    defense: DEFENSE,
    neutralizations: lostIndexes.map((claimIndex, order) => ({
      index: order + 1,
      claimIndex,
      reason: 'record_lost',
      note: 'The stance record for this claim was lost and cannot be reconstructed.',
    })),
  })
  await write(name, purpose, packageVersion(claims, TURN_SPEC), states, events)
}

await lostFixture(
  'stance-records-lost-third',
  'Three of nine consequential claims lose their stance record (FR-087): a third or fewer, so the run stands and Verification and Calibration are unassessed.',
  9,
  [4, 5, 6],
)

await lostFixture(
  'stance-records-lost-half',
  'Four of eight consequential claims lose their stance record (FR-087): more than a third, so the run is unscoreable and the faculty seat is prompted to void it.',
  8,
  [3, 4, 5, 6],
)
