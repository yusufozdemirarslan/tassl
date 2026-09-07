// The debrief's assembly (10-backend-spec-modules.md §13, §13.1; FR-151, FR-153, FR-155).
//
// Three claims, and the third is the one this file exists for.
//
//   1. **The order is fixed and total.** Twelve sections in the order FR-151 walks the run in, and a
//      section a run cannot support is present with `available: false` and a reason — never omitted.
//      A run that recorded less is a shorter page with named gaps, not a page missing something.
//   2. **"One thing done well" is a ladder** (§13.1), and the first rung the run supports is the one
//      shown. Every rung is exercised here against a run that supports it and nothing above it, and
//      the last is the fallback, which is true of every run that reaches this page (FR-153: the
//      debrief "always names at least one thing done well").
//   3. **The voice is a product invariant, and it is scanned for.** PRD §7's standing rules and
//      FR-153 forbid three vocabularies on this surface: misconduct ("nothing Tassl observes is
//      treated as misconduct"; the debrief "never uses the word cheating"), character and motive
//      ("never characterizes motives"; failures are attributed to actions and omissions), and
//      ranking (FR-131: "no composite judgment score, rank, percentile"). Every value *and* every
//      key under `debrief.` in the catalogue is scanned against all three, on word boundaries so
//      that "means", "meaning" and "default" are not false positives while "mean", "rank" and
//      "fault" are found.
//
// The last describe block proves the scan can still fail: it is re-run over the same catalogue with
// one planted string per vocabulary, and each must be found. A guard that cannot fail is not a
// guard (D-430's property, one namespace along).
import { describe, expect, it } from 'vitest'
import { debrief } from '@/lib/i18n/messages/debrief'
import { t } from '@/lib/i18n/t'
import {
  buildSections,
  claimWalkthrough,
  missedDefects,
  selectDoneWell,
  DEBRIEF_SECTION_ORDER,
  type AssemblyInput,
  type ClaimFacts,
} from '@/server/modules/debrief/assembly'
import type { DebriefBand, DebriefPoints, DebriefQuestions } from '@/server/modules/debrief/schema'

// ---------------------------------------------------------------------------------------------
// Fixtures: a run that supports every section, so a "not available" below is the test's doing
// ---------------------------------------------------------------------------------------------

const graph = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  available: true,
  missing_event_types: [],
  data_table: { caption: '', columns: [], rows: [] },
  description: '',
  ...extra,
})

const GRAPHS = (): Record<string, unknown> => ({
  confidence_line: graph({ points: [] }),
  clock_timeline: graph({ tracks: [] }),
  stance_matrix: graph({ rows: [] }),
  frame_beside_decision: graph({
    frame: { decision: 'Hold the spend', assumptions: ['a', 'b', 'c'], position: 'lean hold' },
    brief: { recommendation: 'Hold' },
    addendum: null,
    turn: { text: 'A stakeholder writes', response: 'revise', implicit: false },
    disrupted_assumption_indexes: [1],
    unmatched_disrupted_keys: [],
  }),
})

const band = (dimension: DebriefBand['dimension'], value: DebriefBand['band']): DebriefBand => ({
  dimension,
  band: value,
  status: value === null ? 'unassessed' : 'drafted',
  reason: value === null ? 'no evidence' : '',
  decision: null,
  note: null,
  rationale: 'The run recorded three interrogation actions.',
  graphKeys: ['stance_matrix'],
  raisedByCorrection: false,
})

const BANDS = (framing: DebriefBand['band'] = 'developing'): DebriefBand[] => [
  band('framing', framing),
  band('delegation', 'developing'),
  band('verification', 'developing'),
  band('calibration', 'developing'),
  band('decision_quality', 'developing'),
  band('adaptation', 'developing'),
  band('ownership', 'developing'),
]

const POINTS: DebriefPoints = {
  mapping: { novice: 1, developing: 2, proficient: 3, professional: 4 },
  weight: 2.5,
  assessed: 7,
  draft: 2,
  confirmed: null,
  effective: null,
}

const QUESTIONS: DebriefQuestions = {
  answered: false,
  canAnswer: true,
  stanceToChange: null,
  doDifferently: null,
  answeredAt: null,
}

function claim(over: Partial<ClaimFacts> = {}): ClaimFacts {
  return {
    claimId: '11111111-1111-4111-8111-111111111111',
    key: 'C1',
    text: 'Premium payback is eleven months.',
    importance: 'supporting',
    rationale: 'The figure predates the pricing change.',
    evidenceStatus: 'sound',
    failureFamily: null,
    warrantedStance: 'accept',
    planted: false,
    surfaced: true,
    stanceTaken: 'accept',
    previousStance: null,
    stanceSetAt: '2026-09-01T10:00:00.000Z',
    reliedOn: false,
    neutralized: false,
    inconsistencyCredited: false,
    stanceRecordLost: false,
    actions: [],
    document: { title: 'Cohort table', author: 'Ana Ruiz', datedOn: '2025-11-02' },
    passage: 'Premium payback of eleven months.',
    check: { type: 'source_trace', sentence: 'A Source Trace on this claim reaches Cohort table.' },
    ...over,
  }
}

function input(over: Partial<AssemblyInput> = {}): AssemblyInput {
  return {
    version: 'draft',
    viewer: 'owner',
    graphs: GRAPHS(),
    frame: { decision: 'Hold the spend', assumptions: ['a', 'b', 'c'], position: 'lean hold' },
    turnResponse: { response: 'revise' },
    turnStandard: { warrantsChange: true, proportionateResponse: 'revise' },
    counterfactual: 'One. Two. Three.',
    claims: [
      claim({
        key: 'C3',
        claimId: '33333333-3333-4333-8333-333333333333',
        evidenceStatus: 'defective',
        failureFamily: 'stale_evidence',
        warrantedStance: 'verify',
        planted: true,
        stanceTaken: 'accept',
        reliedOn: true,
      }),
    ],
    probe: {
      claimId: '33333333-3333-4333-8333-333333333333',
      claimKey: 'C3',
      reversal: 'You are right to question that figure.',
      occurredAt: '2026-09-01T10:05:00.000Z',
      stanceAfter: 'accept',
    },
    escalations: [],
    bands: BANDS(),
    points: POINTS,
    questions: QUESTIONS,
    ...over,
  }
}

// ---------------------------------------------------------------------------------------------
// 1. The order (FR-151, FR-155)
// ---------------------------------------------------------------------------------------------

describe('section order', () => {
  it('is the twelve sections FR-151 walks the run in, in that order', () => {
    expect(DEBRIEF_SECTION_ORDER).toEqual([
      'frame_beside_decision',
      'stance_matrix',
      'missed_defects',
      'probe',
      'confidence_line',
      'turn_beside_frame',
      'clock_timeline',
      'counterfactual',
      'bands',
      'points',
      'done_well',
      'questions',
    ])
  })

  it('assembles every section in that order, whatever the run supports', () => {
    const full = buildSections(input()).map((section) => section.key)
    const bare = buildSections(
      input({ graphs: null, counterfactual: '', probe: null, claims: [], bands: [] }),
    ).map((section) => section.key)
    expect(full).toEqual([...DEBRIEF_SECTION_ORDER])
    expect(bare).toEqual([...DEBRIEF_SECTION_ORDER])
  })

  it('draws every section for a run that supports them all', () => {
    const withheld = buildSections(input()).filter((section) => !section.available)
    expect(withheld).toEqual([])
  })

  it('names a section it cannot draw with a reason, and never omits it (FR-155)', () => {
    const sections = buildSections(
      input({ graphs: null, counterfactual: '', probe: null, claims: [], bands: [] }),
    )
    for (const section of sections) {
      if (section.available) continue
      expect(section.reason, section.key).toBeTruthy()
      expect(section.data, section.key).toBeNull()
    }
    const withheld = sections.filter((section) => !section.available).map((s) => s.key)
    expect(withheld).toEqual([
      'frame_beside_decision',
      'stance_matrix',
      'missed_defects',
      'probe',
      'confidence_line',
      'turn_beside_frame',
      'clock_timeline',
      'counterfactual',
      'bands',
      'points',
    ])
  })

  it('names the graph and the events it is missing when a graph could not be plotted', () => {
    const graphs = GRAPHS()
    graphs.confidence_line = graph({ available: false, missing_event_types: ['frame_locked'] })
    const section = buildSections(input({ graphs })).find((s) => s.key === 'confidence_line')
    expect(section?.available).toBe(false)
    expect(section?.reason).toContain(t('graph.confidenceLine.title'))
    expect(section?.reason).toContain('frame_locked')
  })

  it('withholds the Turn section when the run has no Turn, with the graph intact', () => {
    const graphs = GRAPHS()
    graphs.frame_beside_decision = graph({ frame: null, brief: null, turn: null })
    const sections = buildSections(input({ graphs }))
    expect(sections.find((s) => s.key === 'frame_beside_decision')?.available).toBe(true)
    const turn = sections.find((s) => s.key === 'turn_beside_frame')
    expect(turn?.available).toBe(false)
    expect(turn?.reason).toBe(t('debrief.unavailable.noTurn'))
  })

  it('withholds the missed-defect section when the decision carried no authored defect', () => {
    const sound = input({ claims: [claim({ reliedOn: true })] })
    const section = buildSections(sound).find((s) => s.key === 'missed_defects')
    expect(section?.available).toBe(false)
    expect(section?.reason).toBe(t('debrief.unavailable.noDefects'))
  })
})

// ---------------------------------------------------------------------------------------------
// The missed-defect selection (10 §13, 10 §11.2's "kept from the decision")
// ---------------------------------------------------------------------------------------------

describe('defects the decision rested on', () => {
  const planted = (over: Partial<ClaimFacts> = {}): ClaimFacts =>
    claim({
      key: 'C3',
      evidenceStatus: 'defective',
      failureFamily: 'stale_evidence',
      warrantedStance: 'verify',
      planted: true,
      reliedOn: true,
      stanceTaken: 'accept',
      ...over,
    })

  it('lists a planted defect the decision rested on and never checked', () => {
    const [defect] = missedDefects([planted()])
    expect(defect?.key).toBe('C3')
    expect(defect?.stanceLine).toContain(t('stance.verify'))
    expect(defect?.actionLine).toBe(t('debrief.defect.notChecked'))
    expect(defect?.failureFamilyLabel).toBe(t('debrief.defect.family.stale_evidence'))
  })

  it('leaves out a defect the student challenged, rejected or escalated', () => {
    expect(missedDefects([planted({ stanceTaken: 'challenge' })])).toEqual([])
    expect(missedDefects([planted({ stanceTaken: 'reject' })])).toEqual([])
    expect(missedDefects([planted({ stanceTaken: 'escalate' })])).toEqual([])
  })

  it('leaves out a defect a check was run on and then not accepted', () => {
    const checked = planted({
      stanceTaken: 'verify',
      actions: [{ type: 'source_trace', completedAt: '2026-09-01T09:00:00.000Z' }],
    })
    expect(missedDefects([checked])).toEqual([])
  })

  it('leaves out a defect the decision did not rest on, and one the instructor neutralized', () => {
    expect(missedDefects([planted({ reliedOn: false })])).toEqual([])
    expect(missedDefects([planted({ neutralized: true })])).toEqual([])
  })

  it('carries the document, the passage and the check that would have shown it', () => {
    const [defect] = missedDefects([planted()])
    expect(defect?.document?.title).toBe('Cohort table')
    expect(defect?.passage).toBe('Premium payback of eleven months.')
    expect(defect?.checkLine).toContain('Source Trace')
  })

  it('says so when no interrogation action returns anything for the claim', () => {
    const [defect] = missedDefects([planted({ check: null })])
    expect(defect?.checkLine).toBe(t('debrief.defect.noPath'))
  })
})

// ---------------------------------------------------------------------------------------------
// The claim-by-claim walk (FR-151)
// ---------------------------------------------------------------------------------------------

describe('claim walkthrough', () => {
  it('says what you did, what it warranted, and carries the authored reason', () => {
    const row = claimWalkthrough(claim({ stanceTaken: 'verify', warrantedStance: 'verify' }))
    expect(row.lines[0]).toBe(t('debrief.claim.youTook', { stance: t('stance.verify') }))
    expect(row.lines).toContain(t('debrief.claim.warranted', { stance: t('stance.verify') }))
    expect(row.match).toBe(true)
    expect(row.rationale).toBe('The figure predates the pricing change.')
  })

  it('says a claim never came up rather than leaving it out (D-107)', () => {
    const row = claimWalkthrough(claim({ surfaced: false, stanceTaken: null }))
    expect(row.lines[0]).toBe(t('debrief.claim.notSurfaced'))
    expect(row.match).toBe(false)
  })

  it('reads a credited challenge as a match, and a lost stance record as neither (D-092, FR-087)', () => {
    const credited = claimWalkthrough(
      claim({ stanceTaken: 'challenge', warrantedStance: 'accept', inconsistencyCredited: true }),
    )
    expect(credited.match).toBe(true)
    expect(credited.lines).toContain(t('debrief.claim.credited'))

    const lost = claimWalkthrough(claim({ stanceRecordLost: true }))
    expect(lost.match).toBe(false)
    expect(lost.lines[0]).toBe(t('debrief.claim.recordLost'))
  })

  it('carries no authored reason as a sentence rather than as an empty string', () => {
    expect(claimWalkthrough(claim({ rationale: '' })).rationale).toBe(
      t('debrief.claim.noRationale'),
    )
  })
})

// ---------------------------------------------------------------------------------------------
// 2. "One thing this run did" (10 §13.1)
// ---------------------------------------------------------------------------------------------

describe('done well selection', () => {
  /** A run that supports no rung: nothing matched, nothing checked, no Turn, no escalation. */
  const bare = (over: Partial<AssemblyInput> = {}): AssemblyInput =>
    input({
      claims: [claim({ stanceTaken: 'accept', warrantedStance: 'verify', check: null })],
      turnResponse: null,
      turnStandard: null,
      escalations: [],
      bands: BANDS('developing'),
      ...over,
    })

  it('takes a matched stance on a load-bearing claim first', () => {
    const answer = selectDoneWell(
      bare({
        claims: [
          claim({
            key: 'C2',
            importance: 'load_bearing',
            stanceTaken: 'accept',
            warrantedStance: 'accept',
          }),
        ],
        turnStandard: { warrantsChange: true, proportionateResponse: 'revise' },
        turnResponse: { response: 'revise' },
      }),
    )
    expect(answer).toBe(
      t('debrief.doneWell.matchedStance', { key: 'C2', stance: t('stance.accept') }),
    )
  })

  it('falls to a check read correctly on a defective claim', () => {
    const answer = selectDoneWell(
      bare({
        claims: [
          claim({
            key: 'C1',
            evidenceStatus: 'defective',
            warrantedStance: 'verify',
            stanceTaken: 'challenge',
            stanceSetAt: '2026-09-01T10:00:00.000Z',
            actions: [{ type: 'source_trace', completedAt: '2026-09-01T09:00:00.000Z' }],
          }),
        ],
      }),
    )
    expect(answer).toBe(
      t('debrief.doneWell.sourceTrace', {
        action: t('debrief.action.source_trace'),
        key: 'C1',
        stance: t('stance.challenge'),
      }),
    )
  })

  it('does not credit a check that was run after the stance was taken', () => {
    const answer = selectDoneWell(
      bare({
        claims: [
          claim({
            evidenceStatus: 'defective',
            warrantedStance: 'verify',
            stanceTaken: 'challenge',
            stanceSetAt: '2026-09-01T08:00:00.000Z',
            actions: [{ type: 'source_trace', completedAt: '2026-09-01T09:00:00.000Z' }],
          }),
        ],
      }),
    )
    expect(answer).toBe(t('debrief.doneWell.fallback'))
  })

  it('falls to a Turn response that matched what the Turn warranted', () => {
    const answer = selectDoneWell(
      bare({
        turnStandard: { warrantsChange: true, proportionateResponse: 'revise' },
        turnResponse: { response: 'revise' },
      }),
    )
    expect(answer).toBe(
      t('debrief.doneWell.turnResponse', {
        warranted: t('graph.frameBesideDecision.responseRevise'),
      }),
    )
  })

  it('does not credit a Turn response that did not match', () => {
    const answer = selectDoneWell(
      bare({
        turnStandard: { warrantsChange: true, proportionateResponse: 'revise' },
        turnResponse: { response: 'hold' },
      }),
    )
    expect(answer).toBe(t('debrief.doneWell.fallback'))
  })

  it('falls to an escalation', () => {
    const answer = selectDoneWell(bare({ escalations: [{ claimId: 'x', claimKey: 'C4' }] }))
    expect(answer).toBe(t('debrief.doneWell.escalation', { key: 'C4' }))
  })

  it('falls to a whole frame when Framing stands at Professional, quoting the student', () => {
    const answer = selectDoneWell(
      bare({
        bands: BANDS('professional'),
        frame: {
          decision: 'Hold the spend',
          assumptions: ['Premium retention holds', 'b', 'c'],
          position: 'lean hold',
        },
      }),
    )
    expect(answer).toBe(t('debrief.doneWell.frame', { assumption: 'Premium retention holds' }))
  })

  it('does not credit a frame whose Framing band is below Professional', () => {
    expect(selectDoneWell(bare({ bands: BANDS('proficient') }))).toBe(
      t('debrief.doneWell.fallback'),
    )
  })

  it('always names something: the fallback is true of every run that reaches this page', () => {
    expect(selectDoneWell(bare())).toBe(t('debrief.doneWell.fallback'))
    expect(selectDoneWell(bare({ frame: null, graphs: null, bands: [] }))).toBe(
      t('debrief.doneWell.fallback'),
    )
  })
})

// ---------------------------------------------------------------------------------------------
// 3. The voice (PRD §7 standing rules, FR-153, FR-131)
// ---------------------------------------------------------------------------------------------

/**
 * One forbidden term, as a regex source matched on word boundaries.
 *
 * Boundaries rather than substrings, because the substrings collide with ordinary English this
 * catalogue is entitled to use: "means" and "meaning" are not the noun "mean", "default" is not
 * "fault", "appeared" is not "peer", and "frank" is not "rank". The variants each term admits are
 * written out, so "cheating" is caught by the entry for "cheat".
 */
type Vocabulary = { name: string; terms: readonly string[] }

/**
 * "Nothing Tassl observes is treated as misconduct" (PRD §7 standing rules) and "the debrief never
 * uses the word cheating" (FR-153). There is no sentence on this surface that accuses.
 */
const MISCONDUCT: Vocabulary = {
  name: 'misconduct',
  terms: [
    'cheat(?:s|ed|ing|er|ers)?',
    'dishonest(?:y|ly)?',
    'misconduct',
    'plagiaris(?:m|e|ed|ing)',
    'plagiariz(?:m|e|ed|ing)',
    'fraud(?:ulent)?',
    'deceit(?:ful)?',
    'deceiv(?:e|ed|ing)',
    'decept(?:ion|ive)',
    'suspicio(?:n|us)',
    'violat(?:e|ed|ion|ions)',
    'guilt(?:y)?',
    'blam(?:e|ed|ing)',
    'fault(?:y)?',
    'caught',
    'breach(?:ed|es)?',
    'excuse(?:s|d)?',
    'accus(?:e|ed|ation|ations)',
  ],
}

/**
 * "Never characterizes motives" and "attributes failures to specific actions and omissions"
 * (FR-153), and PRD §7.13's rule that Tassl describes what happened, never who the person is. The
 * verb "fail" is in the list on purpose: "you failed to check" is exactly the register the rule
 * exists to keep out, and "accepted without running a Source Trace" is what replaces it.
 */
const CHARACTER: Vocabulary = {
  name: 'character and motive',
  terms: [
    'lazy',
    'laziness',
    'careless(?:ly|ness)?',
    'sloppy',
    'negligen(?:t|ce)',
    'incompeten(?:t|ce)',
    'stupid',
    'fool(?:s|ish)?',
    'naive',
    'gullible',
    'credulous',
    'arrogan(?:t|ce)',
    'complacen(?:t|cy)',
    'reckless(?:ly|ness)?',
    'overconfiden(?:t|ce)',
    'unmotivated',
    'disengaged',
    'rush(?:ed|ing)',
    'attitude',
    'motive(?:s)?',
    'intent(?:ion|ional|ionally)?',
    'deliberate(?:ly)?',
    'wilful(?:ly)?',
    'willful(?:ly)?',
    'character',
    'trait(?:s)?',
    'personality',
    'capable',
    'incapable',
    'fail(?:s|ed|ing|ure|ures)?',
    'weak(?:ly|er|ness)?',
    'poor(?:ly)?',
    'bad(?:ly)?',
    'good',
    'strong(?:ly|er)?',
    'excellent',
    'impressive',
    'disappointing',
  ],
}

/**
 * FR-131: "no composite judgment score, rank, percentile, or validated trait claim". Nothing on this
 * surface compares one run with another or with a cohort, and the word "score" does not appear —
 * what the run holds is seven bands, and what the course does with them is arithmetic.
 */
const RANKING: Vocabulary = {
  name: 'ranking and comparison',
  terms: [
    'score(?:s|d|r|rs)?',
    'scoring',
    'rank(?:s|ed|ing|ings)?',
    'percentile(?:s)?',
    'average(?:s|d)?',
    'mean',
    'median',
    'cohort(?:s)?',
    'peer(?:s)?',
    'classmate(?:s)?',
    'composite',
    'better than',
    'worse than',
    'compared (?:to|with)',
    'comparison(?:s)?',
    'top of',
    'bottom of',
  ],
}

const VOCABULARIES: readonly Vocabulary[] = [MISCONDUCT, CHARACTER, RANKING]

const matcherFor = (vocabulary: Vocabulary): RegExp =>
  new RegExp(`\\b(?:${vocabulary.terms.join('|')})\\b`, 'gi')

/** Every `debrief.` key and value in the catalogue, as `path → text` pairs to scan. */
function debriefStrings(catalogue: Record<string, string>): { path: string; text: string }[] {
  return Object.entries(catalogue).flatMap(([key, value]) => [
    { path: `${key} (key)`, text: key.replace(/[.]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2') },
    { path: key, text: value },
  ])
}

function scan(catalogue: Record<string, string>): { path: string; word: string; rule: string }[] {
  const findings: { path: string; word: string; rule: string }[] = []
  for (const { path, text } of debriefStrings(catalogue)) {
    for (const vocabulary of VOCABULARIES) {
      for (const hit of text.match(matcherFor(vocabulary)) ?? []) {
        findings.push({ path, word: hit, rule: vocabulary.name })
      }
    }
  }
  return findings
}

describe('the debrief catalogue keeps the product voice', () => {
  it('holds every key the assembly interpolates', () => {
    // The scan is only as good as its coverage: if the namespace were empty it would pass.
    expect(Object.keys(debrief).length).toBeGreaterThan(60)
    for (const key of Object.keys(debrief)) expect(key.startsWith('debrief.')).toBe(true)
  })

  it('uses no word of the three forbidden vocabularies', () => {
    expect(scan(debrief as unknown as Record<string, string>)).toEqual([])
  })

  it('names at least one thing done well for a run that did nothing else', () => {
    expect(debrief['debrief.doneWell.fallback']).toBeTruthy()
  })
})

describe('the scan can still fail', () => {
  it.each([
    ['misconduct', 'This looks like cheating, so the run is under suspicion.'],
    ['character and motive', 'You were careless here and failed to check the figure.'],
    ['ranking and comparison', 'Your score is below the cohort average.'],
  ])('finds a planted %s sentence', (rule, planted) => {
    const findings = scan({
      ...(debrief as unknown as Record<string, string>),
      'debrief.planted': planted,
    })
    expect(findings.map((finding) => finding.rule)).toContain(rule)
    expect(findings.every((finding) => finding.path === 'debrief.planted')).toBe(true)
  })

  it('finds a forbidden word planted in a key name, not only in a value', () => {
    const findings = scan({
      ...(debrief as unknown as Record<string, string>),
      'debrief.cohortRank': 'A sentence with nothing wrong in it.',
    })
    expect(findings.map((finding) => finding.word.toLowerCase())).toEqual(
      expect.arrayContaining(['cohort', 'rank']),
    )
  })
})
