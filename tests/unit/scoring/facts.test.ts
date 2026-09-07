// The categorical facts against the thirteen fixtures (10-backend-spec-modules.md §11.2; FR-075,
// FR-083, FR-086, FR-087, FR-134, D-107).
//
// A fact is what a band rule is allowed to know without asking a model, so the assertions here are
// deliberately about *numbers a person can check by reading the fixture*, not about bands. Where a
// number appears in the PRD it is the number asserted: Marco's eight false alarms over eleven
// claims, Nadia's 40 to 85 over an accuracy of 0.4, three of nine stance records lost leaving the
// run standing and four of eight taking it away.
import { describe, expect, it } from 'vitest'
import { SPEED_OUTLIER_MS as RUN_SPEED_OUTLIER_MS } from '@/server/modules/runs/limits'
import { SPEED_OUTLIER_MS, categoricalFacts, stanceRecordLoss } from '@/server/modules/scoring'
import { FIXTURE_NAMES, loadFixture, without, type FixtureName } from './graphs/fixtures'

const factsOf = (name: FixtureName) => categoricalFacts(loadFixture(name))

/** The first of `marco-8-of-11`'s two exchanges: its `run_delegations.id` and its event seq. */
const FIRST_DELEGATION_ID = '00000000-0000-4000-8000-000000000201'
const FIRST_DELEGATION_SEQ = 14

// ---------------------------------------------------------------------------------------------
// Every fixture, every fact
// ---------------------------------------------------------------------------------------------

describe('categoricalFacts is total over the thirteen fixtures', () => {
  it.each(FIXTURE_NAMES)('%s computes without throwing and cites its evidence', (name) => {
    const facts = factsOf(name)
    expect(facts.consequentialClaimCount).toBeGreaterThan(0)
    // Every dimension names the trace events its facts were read from (FR-137): the list may be
    // empty for a dimension this run holds nothing for, but the key is always there.
    expect(Object.keys(facts.evidenceEventSeqs).sort()).toStrictEqual([
      'adaptation',
      'calibration',
      'decision_quality',
      'delegation',
      'framing',
      'ownership',
      'verification',
    ])
    for (const seqs of Object.values(facts.evidenceEventSeqs)) {
      expect(seqs).toStrictEqual([...seqs].sort((a, b) => a - b))
    }
  })

  it('answers a run stripped of every event rather than throwing (FR-004)', () => {
    const bare = { ...loadFixture('marco-8-of-11'), events: [] }
    const facts = categoricalFacts(bare)
    expect(facts.responseVsWarrant).toBe('no_turn')
    expect(facts.actionCount).toBe(0)
    expect(facts.acceptEverything).toBe(false)
    expect(facts.nothingAnswered).toBe(false)
    expect(facts.confidence).toStrictEqual({ frame: null, lock: null, turn: null })
  })
})

// ---------------------------------------------------------------------------------------------
// Defects, checks and escalation
// ---------------------------------------------------------------------------------------------

describe('the defects the variant carries, and what became of them', () => {
  it('counts Marco’s one planted defect as kept from the decision and checked', () => {
    const facts = factsOf('marco-8-of-11')
    expect(facts.defectsInVariant).toBe(1)
    expect(facts.defectsKeptFromDecision).toBe(1)
    expect(facts.defectsSurfacedByCheck).toBe(1)
    expect(facts.allDefectsKeptFromDecision).toBe(true)
    expect(facts.defectFree).toBe(false)
  })

  it('counts both of the escalated defects as kept, with no check on either (PRD §7.9)', () => {
    const facts = factsOf('both-defects-escalated')
    expect(facts.defectsInVariant).toBe(2)
    expect(facts.defectsKeptFromDecision).toBe(2)
    expect(facts.defectsSurfacedByCheck).toBe(0)
    expect(facts.defectsReachedDecision).toBe(0)
  })

  it('counts Nadia’s three defects as reaching the decision unexamined', () => {
    const facts = factsOf('nadia-run-one')
    expect(facts.defectsInVariant).toBe(3)
    expect(facts.defectsKeptFromDecision).toBe(0)
    expect(facts.defectsReachedDecision).toBe(3)
    expect(facts.allDefectsKeptFromDecision).toBe(false)
  })

  it('reports the defect-free variant as having nothing to catch', () => {
    const facts = factsOf('accept-everything-sound')
    expect(facts.defectFree).toBe(true)
    expect(facts.defectsInVariant).toBe(0)
    // Vacuously true, and A.4 leans on it: with nothing to catch, nothing got through.
    expect(facts.allDefectsKeptFromDecision).toBe(true)
  })

  it('separates the check that ran from the check that landed on a load-bearing claim', () => {
    const facts = factsOf('marco-8-of-11')
    expect(facts.actionCount).toBe(3)
    expect(facts.actionsOnLoadBearing).toBe(2)
    // One trace fell on a claim whose warranted stance was accept: a check nothing asked for.
    expect(facts.actionsOnNonWarranting).toBe(1)
    expect(facts.assertedVerification).toBe(0)
  })

  it('finds no misread trace where the trace ended in a challenge (FR-075)', () => {
    expect(factsOf('marco-8-of-11').misreadTrace).toBe(0)
    expect(factsOf('full-reversal-marginal').misreadTrace).toBe(0)
  })

  it('finds a misread trace when the same trace ends in accept (FR-075)', () => {
    // The fixture traces the planted defect and challenges it. Change only the stance it ended in:
    // the action is the same, the conclusion is not, and that is exactly the pair FR-075 separates.
    const fixture = loadFixture('full-reversal-marginal')
    const claimId = fixture.variantStates.find((s) => s.evidenceStatus === 'defective')?.claimId
    const events = fixture.events.map((event) =>
      event.type === 'stance_set' && event.payload.claim_id === claimId
        ? { ...event, payload: { ...event.payload, stance: 'accept' } }
        : event,
    )
    const facts = categoricalFacts({ ...fixture, events })
    expect(facts.misreadTrace).toBe(1)
    expect(facts.defectsSurfacedByCheck).toBe(1)
    expect(facts.defectsKeptFromDecision).toBe(0)
  })

  it('counts an escalation inside demonstrated competence, and does not count a catch as one', () => {
    const facts = factsOf('both-defects-escalated')
    expect(facts.escalationCount).toBe(2)
    // One of the two lands on a claim whose concept the Readiness Check showed held...
    expect(facts.escalationsInsideCompetence).toBe(1)
    // ...but that claim is defective, so it is a catch and not the under-confidence §7.8 describes.
    expect(facts.escalationsInsideCompetenceOnSoundClaims).toBe(0)
  })
})

// ---------------------------------------------------------------------------------------------
// The False Challenge Rate and its defensibility (FR-134, D-107, A.4)
// ---------------------------------------------------------------------------------------------

describe('reliance across the run', () => {
  it('takes the False Challenge Rate from the stance matrix, arithmetic and all (D-107)', () => {
    const facts = factsOf('marco-8-of-11')
    expect(facts.fcr).toBe(0.727)
    expect(facts.falseChallengeCount).toBe(8)
    expect(facts.consequentialClaimCount).toBe(11)
    expect(facts.matchedShare).toBe(0.273)
  })

  it('excuses a false challenge on a weakly sourced, load-bearing, high-stakes or unheld claim', () => {
    const fixture = loadFixture('marco-8-of-11')
    const facts = categoricalFacts(fixture)
    const keyOf = (id: string) => fixture.packageVersion.claims.find((c) => c.id === id)?.key
    expect(facts.falseChallengeClaimIds.map(keyOf)).toStrictEqual([
      'claim_02',
      'claim_03',
      'claim_04',
      'claim_05',
      'claim_06',
      'claim_07',
      'claim_08',
      'claim_09',
    ])
    // claim_02 and claim_11 are load-bearing; claim_05 and claim_08 are weakly sourced; claim_03 and
    // claim_07 turn on the one concept the Readiness Check showed the student does not hold. What is
    // left is the three A.4's Developing-to-Proficient boundary does not excuse.
    expect(facts.indefensibleFalseChallengeClaimIds.map(keyOf)).toStrictEqual([
      'claim_04',
      'claim_06',
      'claim_09',
    ])
  })

  it('records accepting everything, and does not record it where one stance differed', () => {
    expect(factsOf('accept-everything-defective').acceptEverything).toBe(true)
    expect(factsOf('accept-everything-sound').acceptEverything).toBe(true)
    expect(factsOf('nadia-run-one').acceptEverything).toBe(false)
    expect(factsOf('both-defects-escalated').acceptEverything).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------
// Confidence (FR-083, FR-086)
// ---------------------------------------------------------------------------------------------

describe('the confidence line, read separately (PRD §7.8)', () => {
  it('reads Nadia’s 40 to 85 over an accuracy of 0.4 as rising on unchecked claims', () => {
    const facts = factsOf('nadia-run-one')
    expect(facts.confidence).toStrictEqual({ frame: 40, lock: 85, turn: 85 })
    expect(facts.accuracyAtLock).toBe(0.4)
    expect(facts.confidenceShape).toBe('rising_unchecked')
  })

  it('reads a flat 50 as flat, even where the third point was never filed', () => {
    const facts = factsOf('nothing-answered')
    expect(facts.confidence).toStrictEqual({ frame: 50, lock: 50, turn: null })
    expect(facts.confidenceShape).toBe('flat_50')
  })

  it('does not call a rise unchecked when half the claims relied on were sound', () => {
    // 0.5 is not below 0.5: the boundary is the one 10 §11.2 states and nothing rounds onto it.
    const facts = factsOf('outside-answer-space')
    expect(facts.accuracyAtLock).toBe(0.5)
    expect(facts.confidenceShape).toBe('other')
  })

  it('names no shape for a line that is neither flat nor rising on unchecked claims', () => {
    expect(factsOf('hold-with-reason').confidenceShape).toBe('other')
  })
})

// ---------------------------------------------------------------------------------------------
// The Turn (FR-115)
// ---------------------------------------------------------------------------------------------

describe('the response against the Turn’s authored warrant', () => {
  it.each([
    ['hold-with-reason', 'match', true],
    ['both-defects-escalated', 'match', true],
    ['full-reversal-marginal', 'over_adaptation', true],
    ['nadia-run-one', 'under_adaptation', true],
    ['implicit-hold-no-change', 'implicit_hold_ok', false],
    ['implicit-hold-change-warranted', 'implicit_hold_failed', false],
  ] as const)('%s is %s', (name, expected, justified) => {
    const facts = factsOf(name)
    expect(facts.responseVsWarrant).toBe(expected)
    expect(facts.turnJustificationPresent).toBe(justified)
  })

  it('reports no Turn rather than a placement when none was delivered', () => {
    const facts = categoricalFacts(without(loadFixture('hold-with-reason'), 'turn_delivered'))
    expect(facts.responseVsWarrant).toBe('no_turn')
  })
})

// ---------------------------------------------------------------------------------------------
// The brief, the frame, the log and the defense
// ---------------------------------------------------------------------------------------------

describe('the rest of the run', () => {
  it('reads the frame’s five fields and finds no single-token field in the fixtures', () => {
    expect(factsOf('marco-8-of-11').frameFieldSingleToken).toBe(false)
  })

  it('finds a single-token field where one was filled to pass the gate (PRD §7.4)', () => {
    const fixture = loadFixture('marco-8-of-11')
    const events = fixture.events.map((event) =>
      event.type === 'frame_locked'
        ? { ...event, payload: { ...event.payload, position: 'Launch' } }
        : event,
    )
    expect(categoricalFacts({ ...fixture, events }).frameFieldSingleToken).toBe(true)
  })

  it('counts the documents opened before the assistant was first used (A.2, A.1)', () => {
    expect(factsOf('marco-8-of-11').readOrderBeforeAssistant).toBe(2)
    expect(factsOf('nadia-run-one').readOrderBeforeAssistant).toBe(0)
  })

  it('counts delegations and the why lines on them, and finds no incomplete log', () => {
    const facts = factsOf('marco-8-of-11')
    expect(facts.delegationCount).toBe(2)
    expect(facts.whyLineCount).toBe(2)
    expect(facts.flaggedDelegationCount).toBe(0)
    expect(facts.incompleteLog).toBe(false)
    expect(factsOf('nadia-run-one').whyLineCount).toBe(0)
  })

  // FR-055, D-481. The set comes from `run_delegations`, because that is where a mark added after
  // the exchange can live — the `delegation` event was written when the exchange happened, carries
  // the *guard's* flags, and is append-only.
  it('leaves a delegation a reviewer marked out of the log the rubric reads (FR-055)', () => {
    const fixture = loadFixture('marco-8-of-11')
    const facts = categoricalFacts({
      ...fixture,
      flaggedDelegationIds: [FIRST_DELEGATION_ID],
    })
    expect(facts.delegationCount).toBe(1)
    expect(facts.flaggedDelegationCount).toBe(1)
    expect(facts.whyLineCount).toBe(1)
    // FR-137: a band may not cite what it was not allowed to read.
    expect(facts.evidenceEventSeqs.delegation).not.toContain(FIRST_DELEGATION_SEQ)
  })

  it('does not read the guard’s own flags as a reviewer’s mark (FR-055)', () => {
    const fixture = loadFixture('marco-8-of-11')
    const events = fixture.events.map((event) =>
      event.type === 'delegation'
        ? { ...event, payload: { ...event.payload, flags: ['rebuilt'] } }
        : event,
    )
    const facts = categoricalFacts({ ...fixture, events })
    expect(facts.delegationCount).toBe(2)
    expect(facts.flaggedDelegationCount).toBe(0)
  })

  it('calls a log with a delegation carrying no response text incomplete (FR-064)', () => {
    const fixture = loadFixture('marco-8-of-11')
    const events = fixture.events.map((event) =>
      event.type === 'delegation'
        ? { ...event, payload: { ...event.payload, response_text: '' } }
        : event,
    )
    expect(categoricalFacts({ ...fixture, events }).incompleteLog).toBe(true)
  })

  it('records an outside-tool declaration and reads nothing into it (FR-061)', () => {
    expect(factsOf('marco-8-of-11').outsideToolDeclarations).toBe(1)
  })

  it('counts the defense answers, and reports nothing answered when all are empty (FR-124)', () => {
    expect(factsOf('nothing-answered').questionCount).toBe(2)
    expect(factsOf('nothing-answered').answeredCount).toBe(0)
    expect(factsOf('nothing-answered').nothingAnswered).toBe(true)
    expect(factsOf('marco-8-of-11').nothingAnswered).toBe(false)
    expect(factsOf('marco-8-of-11').answeredCount).toBe(2)
  })

  it('reads an empty recommendation as empty rather than as a decision (FR-105)', () => {
    expect(factsOf('marco-8-of-11').recommendationEmpty).toBe(false)
    const fixture = loadFixture('marco-8-of-11')
    const events = fixture.events.map((event) =>
      event.type === 'decision_locked'
        ? { ...event, payload: { ...event.payload, recommendation: '   ' } }
        : event,
    )
    expect(categoricalFacts({ ...fixture, events }).recommendationEmpty).toBe(true)
  })
})

// ---------------------------------------------------------------------------------------------
// FR-087 and the constants
// ---------------------------------------------------------------------------------------------

describe('stance records lost (FR-087)', () => {
  it('leaves the run standing at exactly a third', () => {
    const facts = factsOf('stance-records-lost-third')
    expect(facts.stanceRecordsLost).toBe(3)
    expect(facts.consequentialClaimCount).toBe(9)
    expect(facts.stanceRecordsLostShare).toBe(0.333)
    expect(facts.stanceRecordLoss).toBe('dimensions_unassessed')
  })

  it('takes the run away above a third', () => {
    const facts = factsOf('stance-records-lost-half')
    expect(facts.stanceRecordsLost).toBe(4)
    expect(facts.consequentialClaimCount).toBe(8)
    expect(facts.stanceRecordLoss).toBe('unscoreable')
  })

  it('compares in integers, so exactly a third is never rounded across the line', () => {
    expect(stanceRecordLoss(0, 9)).toBe('none')
    expect(stanceRecordLoss(1, 3)).toBe('dimensions_unassessed')
    expect(stanceRecordLoss(2, 6)).toBe('dimensions_unassessed')
    expect(stanceRecordLoss(333, 999)).toBe('dimensions_unassessed')
    expect(stanceRecordLoss(334, 999)).toBe('unscoreable')
    expect(stanceRecordLoss(0, 0)).toBe('none')
  })
})

describe('the constants this module restates', () => {
  it('keeps the speed outlier threshold equal to the run clock’s pilot parameter (FR-106)', () => {
    // `constants.ts` restates the number rather than importing it, because a module-internal file
    // may not reach another module. This is what stops the restatement drifting.
    expect(SPEED_OUTLIER_MS).toBe(RUN_SPEED_OUTLIER_MS)
  })

  it('flags a lock under four minutes and nothing above it', () => {
    expect(factsOf('marco-8-of-11').speedOutlier).toBe(false)
    const fixture = loadFixture('marco-8-of-11')
    const events = fixture.events.map((event) =>
      event.type === 'decision_locked'
        ? { ...event, payload: { ...event.payload, elapsed_ms: SPEED_OUTLIER_MS - 1 } }
        : event,
    )
    expect(categoricalFacts({ ...fixture, events }).speedOutlier).toBe(true)
  })
})
