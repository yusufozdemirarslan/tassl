// The seven draft bands (10-backend-spec-modules.md §11.3; PRD Appendix A; FR-004, FR-064, FR-087,
// FR-109, FR-125, FR-136, FR-137, FR-138, FR-139).
//
// **Every placement PRD FR-139 fixes has a test here**, named after the sentence that fixes it, and
// the fixture it runs on is the one 14 §5 created for that sentence. FR-139 is the requirement that
// says the rubric's own worked examples must come out the way the PRD says they do; a change to a
// rule below that moves one of them is a change to the product, not a refactor.
//
// The five free-text dimensions take a stub read, because Step 10.3 owns the rules and Step 10.4
// owns the reading. The stub is deliberately flat — the same band for every dimension — so that a
// test which asserts a band different from the stub is asserting a *rule*, and one that asserts the
// stub's own band is asserting that the rule left the read alone.
import { describe, expect, it } from 'vitest'
import {
  DIMENSION_GRAPHS,
  buildGraphs,
  categoricalFacts,
  draftBands,
  type Band,
  type BandContext,
  type BandReads,
  type Dimension,
  type DraftBand,
  type GraphInput,
  type MatchedPosition,
} from '@/server/modules/scoring'
import { loadFixture, without, type FixtureName } from './graphs/fixtures'

// ---------------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------------

const reads = (
  band: Band,
  matchedPosition: MatchedPosition = 'defensible',
  minimumCommitmentExists = false,
): BandReads => ({
  framing: { band, quotes: [{ event_seq: 1, text: 'frame' }], rationale: 'the frame reads so.' },
  delegation: { band, quotes: [], rationale: 'the log reads so.' },
  decision_quality: {
    band,
    quotes: [],
    rationale: 'the brief reads so.',
    matchedPosition,
    minimumCommitmentExists,
  },
  adaptation: { band, quotes: [], rationale: 'the justification reads so.' },
  ownership: { band, quotes: [], rationale: 'the answers read so.' },
})

function bandsOf(
  input: GraphInput,
  extra: Partial<Omit<BandContext, 'facts' | 'graphs'>> = {},
): Record<Dimension, DraftBand> {
  const graphs = buildGraphs(input)
  return draftBands({ facts: categoricalFacts(input, graphs), graphs, ...extra })
}

const fixtureBands = (
  name: FixtureName,
  extra: Partial<Omit<BandContext, 'facts' | 'graphs'>> = {},
) => bandsOf(loadFixture(name), extra)

// ---------------------------------------------------------------------------------------------
// FR-139: the placements the PRD fixes
// ---------------------------------------------------------------------------------------------

describe('FR-139 — Calibration', () => {
  it('accept-everything is the bottom of Calibration on a variant that plants a defect (§7.8)', () => {
    expect(fixtureBands('accept-everything-defective').calibration.band).toBe('novice')
  })

  it('accept-everything is the top of Calibration on a defect-free variant (§7.8)', () => {
    expect(fixtureBands('accept-everything-sound').calibration.band).toBe('professional')
  })

  it('nothing to catch and nothing caught is high Calibration (§7.13)', () => {
    // The same fixture read the other way round: the variant plants nothing, the run caught
    // nothing, and that is the top rather than the bottom.
    const facts = categoricalFacts(loadFixture('accept-everything-sound'))
    expect(facts.defectFree).toBe(true)
    expect(facts.falseChallengeCount).toBe(0)
    expect(fixtureBands('accept-everything-sound').calibration.band).toBe('professional')
  })

  it('both consequential defects escalated is the top of Calibration (§7.9)', () => {
    const bands = fixtureBands('both-defects-escalated')
    expect(bands.calibration.band).toBe('professional')
    // Even though one escalation fell on a concept the Readiness Check showed held: an escalation
    // that lands on a defect is a catch, and §7.9's fixed placement outranks A.4's boundary clause.
    expect(
      categoricalFacts(loadFixture('both-defects-escalated')).escalationsInsideCompetence,
    ).toBe(1)
  })

  it('Marco’s 73 percent False Challenge Rate is the bottom of Calibration (§6)', () => {
    const bands = fixtureBands('marco-8-of-11')
    expect(categoricalFacts(loadFixture('marco-8-of-11')).fcr).toBe(0.727)
    expect(bands.calibration.band).toBe('novice')
  })

  it('and Marco’s Verification is Professional at the same time (§6)', () => {
    expect(fixtureBands('marco-8-of-11').verification.band).toBe('professional')
  })

  it('Nadia’s run one is Novice on Verification, with the line rising on unchecked claims (§6)', () => {
    const bands = fixtureBands('nadia-run-one')
    expect(bands.verification.band).toBe('novice')
    expect(categoricalFacts(loadFixture('nadia-run-one')).confidenceShape).toBe('rising_unchecked')
  })
})

describe('FR-139 — Adaptation', () => {
  it('over-adaptation scores as poorly as failing to adapt (§7.11)', () => {
    expect(fixtureBands('full-reversal-marginal').adaptation.band).toBe('novice')
    expect(fixtureBands('nadia-run-one').adaptation.band).toBe('novice')
    expect(fixtureBands('full-reversal-marginal').adaptation.band).toBe(
      fixtureBands('nadia-run-one').adaptation.band,
    )
  })

  it('holding with a reason scores exactly as highly as a warranted revision (§7.11)', () => {
    // Same read on both, so the only difference between the runs is what they filed: a hold that
    // matched the warrant, and a revision that matched it.
    const held = fixtureBands('hold-with-reason', { reads: reads('proficient') })
    const revised = fixtureBands('both-defects-escalated', { reads: reads('proficient') })
    expect(held.adaptation.band).toBe('proficient')
    expect(held.adaptation.band).toBe(revised.adaptation.band)
  })

  it('and the two stay equal when the read reaches Professional', () => {
    const held = fixtureBands('hold-with-reason', { reads: reads('professional') })
    const revised = fixtureBands('both-defects-escalated', { reads: reads('professional') })
    expect(held.adaptation.band).toBe('professional')
    expect(held.adaptation.band).toBe(revised.adaptation.band)
  })

  it('the read never lowers a matching response below Proficient', () => {
    const held = fixtureBands('hold-with-reason', { reads: reads('novice') })
    expect(held.adaptation.band).toBe('proficient')
  })

  it('an implicit hold where no change was warranted is Developing (D-108, §7.11)', () => {
    expect(fixtureBands('implicit-hold-no-change').adaptation.band).toBe('developing')
  })

  it('an implicit hold where a change was warranted is the bottom (§7.11)', () => {
    expect(fixtureBands('implicit-hold-change-warranted').adaptation.band).toBe('novice')
  })

  it('a filed response carrying no justification is the bottom, whatever direction it took', () => {
    const fixture = loadFixture('hold-with-reason')
    const events = fixture.events.map((event) =>
      event.type === 'turn_response_locked'
        ? { ...event, payload: { ...event.payload, justification: '' } }
        : event,
    )
    expect(bandsOf({ ...fixture, events }, { reads: reads('professional') }).adaptation.band).toBe(
      'novice',
    )
  })
})

describe('FR-139 — Decision Quality and Ownership', () => {
  it('a recommendation outside the answer space is the bottom of Decision Quality (§7.10)', () => {
    const bands = fixtureBands('outside-answer-space', {
      reads: reads('professional', 'evidence_inconsistent'),
    })
    expect(bands.decision_quality.band).toBe('novice')
  })

  it('and so is a recommendation matching no authored position at all', () => {
    const bands = fixtureBands('outside-answer-space', { reads: reads('professional', 'none') })
    expect(bands.decision_quality.band).toBe('novice')
  })

  it('and so is declining to recommend where a minimum commitment exists (§7.10)', () => {
    expect(
      fixtureBands('marco-8-of-11', { reads: reads('proficient', 'declined', true) })
        .decision_quality.band,
    ).toBe('novice')
    // Where the answer space allows declining, the same response is the read's own band.
    expect(
      fixtureBands('marco-8-of-11', { reads: reads('proficient', 'declined', false) })
        .decision_quality.band,
    ).toBe('proficient')
  })

  it('an empty recommendation is the bottom whatever the rest of the brief says (FR-105)', () => {
    const fixture = loadFixture('marco-8-of-11')
    const events = fixture.events.map((event) =>
      event.type === 'decision_locked'
        ? { ...event, payload: { ...event.payload, recommendation: '' } }
        : event,
    )
    const bands = bandsOf({ ...fixture, events }, { reads: reads('professional') })
    expect(bands.decision_quality.band).toBe('novice')
  })

  it('nothing answered is the bottom of Ownership (FR-124, §7.12)', () => {
    const bands = fixtureBands('nothing-answered', { reads: reads('professional') })
    expect(bands.ownership.band).toBe('novice')
    expect(bands.ownership.provisional).toBe(false)
  })

  it('Defense Missed caps Ownership and leaves every other dimension intact (§7.12)', () => {
    const bands = fixtureBands('marco-8-of-11', {
      reads: reads('professional'),
      defenseMissed: true,
    })
    expect(bands.ownership.band).toBe('novice')
    expect(bands.framing.band).toBe('professional')
    expect(bands.delegation.band).toBe('professional')
    expect(bands.verification.band).toBe('professional')
    expect(bands.calibration.band).toBe('novice')
  })
})

// ---------------------------------------------------------------------------------------------
// Unassessed (FR-004, FR-087, FR-136)
// ---------------------------------------------------------------------------------------------

describe('a graph that could not be plotted makes its dimensions unassessed (FR-136)', () => {
  it('drops every dimension that reads from a graph the trace cannot produce', () => {
    // Losing `frame_locked` costs three of the four graphs (D-383), and every dimension reads from
    // at least one of them, so the whole set is unassessed and none of it is estimated.
    const bands = bandsOf(without(loadFixture('marco-8-of-11'), 'frame_locked'), {
      reads: reads('professional'),
    })
    for (const dimension of Object.keys(bands) as Dimension[]) {
      expect(bands[dimension].status, dimension).toBe('unassessed')
      expect(bands[dimension].band, dimension).toBeNull()
      expect(bands[dimension].reason, dimension).toBe('graph_unavailable')
      expect(bands[dimension].basis, dimension).toBe('none')
    }
  })

  it('keeps the stance matrix, and says so by citing every graph the dimension reads from', () => {
    const input = without(loadFixture('marco-8-of-11'), 'frame_locked')
    expect(buildGraphs(input).stance_matrix.available).toBe(true)
    const bands = bandsOf(input, { reads: reads('professional') })
    expect(bands.verification.graphKeys).toStrictEqual(['clock_timeline', 'stance_matrix'])
    expect(bands.calibration.graphKeys).toStrictEqual(['stance_matrix', 'confidence_line'])
  })

  it('names the graphs of every dimension the way 10 §11.3 does', () => {
    expect(DIMENSION_GRAPHS.delegation).toStrictEqual(['clock_timeline'])
    expect(DIMENSION_GRAPHS.decision_quality).toStrictEqual(['frame_beside_decision'])
    expect(DIMENSION_GRAPHS.ownership).toHaveLength(4)
  })
})

describe('stance records lost (FR-087)', () => {
  it('a third or fewer leaves the run standing with Verification and Calibration unassessed', () => {
    const bands = fixtureBands('stance-records-lost-third', { reads: reads('proficient') })
    for (const dimension of ['verification', 'calibration'] as const) {
      expect(bands[dimension].status, dimension).toBe('unassessed')
      expect(bands[dimension].reason, dimension).toBe('stance_records_lost')
      expect(bands[dimension].band, dimension).toBeNull()
    }
    // Everything else is intact: the loss is about the stance record, not about the run.
    expect(bands.framing.band).toBe('proficient')
    expect(bands.adaptation.band).toBe('proficient')
    expect(bands.ownership.band).toBe('proficient')
  })

  it('more than a third makes the run unscoreable, which the facts say before any band is drafted', () => {
    const facts = categoricalFacts(loadFixture('stance-records-lost-half'))
    expect(facts.stanceRecordLoss).toBe('unscoreable')
    // The job holds such a run and the faculty seat voids it (10 §11.3). Drafting anyway still
    // reports the two dimensions unassessed rather than inventing a band for them.
    const bands = fixtureBands('stance-records-lost-half', { reads: reads('proficient') })
    expect(bands.verification.status).toBe('unassessed')
    expect(bands.calibration.status).toBe('unassessed')
  })
})

describe('no evidence at all (FR-004)', () => {
  it('reports Adaptation unassessed on a run that never received a Turn', () => {
    const bands = bandsOf(without(loadFixture('hold-with-reason'), 'turn_delivered'), {
      reads: reads('proficient'),
    })
    expect(bands.adaptation.status).toBe('unassessed')
    expect(bands.adaptation.reason).toBe('no_evidence')
  })

  it('reports Ownership unassessed on a run whose defense asked nothing', () => {
    const bands = bandsOf(without(loadFixture('hold-with-reason'), 'defense_question'), {
      reads: reads('proficient'),
    })
    expect(bands.ownership.status).toBe('unassessed')
    expect(bands.ownership.reason).toBe('no_evidence')
  })
})

describe('a read that did not come back (11 §3)', () => {
  it('reports the read dimensions unassessed rather than guessing at them', () => {
    const bands = fixtureBands('hold-with-reason')
    for (const dimension of ['framing', 'delegation', 'decision_quality', 'ownership'] as const) {
      expect(bands[dimension].status, dimension).toBe('unassessed')
      expect(bands[dimension].reason, dimension).toBe('read_failed')
    }
    // Verification and Calibration are computed throughout, so they are unaffected.
    expect(bands.verification.band).toBe('professional')
    expect(bands.calibration.band).toBe('professional')
  })

  it('keeps the placements the recorded events alone support, on basis categorical_only', () => {
    // A match with a justification is Proficient without anyone reading the justification.
    expect(fixtureBands('hold-with-reason').adaptation.band).toBe('proficient')
    expect(fixtureBands('hold-with-reason').adaptation.basis).toBe('categorical_only')
    // Nothing answered needs no read either.
    expect(fixtureBands('nothing-answered').ownership.band).toBe('novice')
  })
})

// ---------------------------------------------------------------------------------------------
// The rules the free-text dimensions add on top of their read
// ---------------------------------------------------------------------------------------------

describe('Framing (A.1)', () => {
  it('floors a frame with a single-token field at Novice, whatever the read said', () => {
    const fixture = loadFixture('marco-8-of-11')
    const events = fixture.events.map((event) =>
      event.type === 'frame_locked'
        ? { ...event, payload: { ...event.payload, decision: 'Launch' } }
        : event,
    )
    expect(bandsOf({ ...fixture, events }, { reads: reads('professional') }).framing.band).toBe(
      'novice',
    )
  })

  it('blocks Professional where nothing was read before the assistant was first used', () => {
    // Nadia opened no document before her first delegation, so A.1's Professional condition on the
    // evidence read before AI entered cannot be met however the frame itself reads.
    expect(fixtureBands('nadia-run-one', { reads: reads('professional') }).framing.band).toBe(
      'proficient',
    )
    expect(fixtureBands('marco-8-of-11', { reads: reads('professional') }).framing.band).toBe(
      'professional',
    )
  })
})

describe('Delegation (A.2, FR-064, FR-138)', () => {
  it('reads a complete log from the trace', () => {
    expect(fixtureBands('marco-8-of-11', { reads: reads('proficient') }).delegation.basis).toBe(
      'trace',
    )
  })

  it('drafts from the defense answers when a delegation carries no response text', () => {
    const fixture = loadFixture('marco-8-of-11')
    const events = fixture.events.map((event) =>
      event.type === 'delegation'
        ? { ...event, payload: { ...event.payload, response_text: '' } }
        : event,
    )
    const band = bandsOf({ ...fixture, events }, { reads: reads('proficient') }).delegation
    expect(band.basis).toBe('defense_only')
    expect(band.provisional).toBe(true)
  })

  it('drafts from the defense answers when there was no delegation to read', () => {
    const band = bandsOf(without(loadFixture('marco-8-of-11'), 'delegation'), {
      reads: reads('proficient'),
    }).delegation
    expect(band.basis).toBe('defense_only')
  })
})

// ---------------------------------------------------------------------------------------------
// What every band carries, and what it must never carry
// ---------------------------------------------------------------------------------------------

describe('every band carries its evidence (FR-137)', () => {
  const bands = fixtureBands('marco-8-of-11', { reads: reads('proficient') })

  it.each(Object.keys(bands) as Dimension[])('%s cites graphs and trace events', (dimension) => {
    const band = bands[dimension]
    expect(band.dimension).toBe(dimension)
    expect(band.graphKeys.length).toBeGreaterThan(0)
    expect(band.evidenceEventSeqs.length).toBeGreaterThan(0)
    expect(band.rationale.length).toBeGreaterThan(0)
  })

  it('marks the two computed dimensions non-provisional and the read ones provisional', () => {
    expect(bands.verification.provisional).toBe(false)
    expect(bands.calibration.provisional).toBe(false)
    for (const dimension of ['framing', 'delegation', 'decision_quality', 'ownership'] as const) {
      expect(bands[dimension].provisional, dimension).toBe(true)
    }
  })

  it('puts the categorical sentence before the model’s, and carries the model’s quotes', () => {
    expect(bands.framing.rationale).toContain('Evidence Room documents opened')
    expect(bands.framing.rationale.endsWith('the frame reads so.')).toBe(true)
    expect(bands.framing.quotes).toStrictEqual([{ event_seq: 1, text: 'frame' }])
    // A computed dimension never carries a quote, because nothing read anything.
    expect(bands.calibration.quotes).toStrictEqual([])
  })

  it('never names a warranted stance, an evidence status or the Turn’s warrant in a rationale', () => {
    // The rationale is shown to the student in the debrief, and the Turn's authored warrant is
    // forbidden in a student payload in every state (12 §8.1, D-384).
    for (const band of Object.values(bands)) {
      expect(band.rationale.toLowerCase()).not.toContain('warrants_change')
      expect(band.rationale.toLowerCase()).not.toContain('proportionate_response')
      expect(band.rationale.toLowerCase()).not.toContain('planted')
    }
  })
})

describe('the product invariants (CLAUDE.md, FR-061)', () => {
  it('declaring outside-tool use changes no band', () => {
    const fixture = loadFixture('marco-8-of-11')
    const declared = bandsOf(fixture, { reads: reads('proficient') })
    const undeclared = bandsOf(without(fixture, 'outside_tool_declared'), {
      reads: reads('proficient'),
    })
    expect(categoricalFacts(fixture).outsideToolDeclarations).toBe(1)
    for (const dimension of Object.keys(declared) as Dimension[]) {
      expect(undeclared[dimension].band, dimension).toBe(declared[dimension].band)
    }
  })

  it('a Readiness result never lowers a band for a knowledge gap (A.0, §7.1)', () => {
    // Marking every readiness item wrong widens what counts as outside demonstrated competence,
    // which can only excuse false challenges — never add one.
    const fixture = loadFixture('marco-8-of-11')
    const events = fixture.events.map((event) =>
      event.type === 'readiness_item'
        ? { ...event, payload: { ...event.payload, correct: false } }
        : event,
    )
    const worse = categoricalFacts({ ...fixture, events })
    const asIs = categoricalFacts(fixture)
    expect(worse.indefensibleFalseChallengeClaimIds.length).toBeLessThanOrEqual(
      asIs.indefensibleFalseChallengeClaimIds.length,
    )
  })
})
