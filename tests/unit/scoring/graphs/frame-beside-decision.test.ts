// Frame beside decision (FR-135, D-079).
//
// The graph's one computed thing is the marking: which of the three framed assumptions the Turn
// disrupted, and which authored disruptions the frame never named. D-079 settles it as a stemmed
// token overlap of at least a half against the author's `disrupted_assumption_keys`, so the tests
// here are about that matcher and about the three records the graph carries beside it.
import { describe, expect, it } from 'vitest'
import {
  buildFrameBesideDecision,
  contentTokens,
  matchDisruptions,
} from '@/server/modules/scoring/graphs'
import { loadFixture, without } from './fixtures'

describe('buildFrameBesideDecision — the Marco fixture', () => {
  const graph = buildFrameBesideDecision(loadFixture('marco-8-of-11'))

  it('marks the framed assumption the Turn disrupted', () => {
    // The Turn moves supplier lead times; the frame's second assumption is "Supplier lead times
    // hold at four weeks", which is index 1.
    expect(graph.disrupted_assumption_indexes).toStrictEqual([1])
    expect(graph.frame?.assumptions[1]).toContain('lead times')
  })

  it('lists an authored disruption the frame never named (D-079)', () => {
    expect(graph.unmatched_disrupted_keys).toStrictEqual(['regulatory_review_window'])
    expect(graph.description).toContain('regulatory_review_window')
  })

  it('carries the frame, the brief, the addendum and the Turn response', () => {
    expect(graph.frame?.confidence).toBe(55)
    expect(graph.brief?.confidence).toBe(60)
    expect(graph.brief?.named_values).toStrictEqual({ unit_margin: 34, payback_months: 6 })
    expect(graph.addendum).toContain('load-bearing')
    expect(graph.turn?.response).toBe('revise')
    expect(graph.turn?.implicit).toBe(false)
  })

  it('never carries the answer key the Turn is measured against (12 §8.1)', () => {
    const keys = JSON.stringify(graph)
    expect(keys).not.toContain('warrants_change')
    expect(keys).not.toContain('warrantsChange')
    expect(keys).not.toContain('proportionate_response')
    expect(keys).not.toContain('disrupted_assumption_keys')
  })

  it('puts both records side by side in the data table', () => {
    expect(graph.data_table.columns).toHaveLength(3)
    const labels = graph.data_table.rows.map((row) => String(row[0]))
    expect(labels.some((label) => label.includes('Assumption 2'))).toBe(true)
    expect(labels.some((label) => label.includes('Disrupted by the Turn'))).toBe(true)
  })
})

describe('matchDisruptions — D-079’s stemmed token overlap', () => {
  it('matches an authored key against the student’s own wording', () => {
    const { indexes, unmatched } = matchDisruptions(
      ['supplier_lead_times'],
      [
        'Demand for the premium line grows at six percent a year.',
        'Supplier lead times hold at four weeks.',
        'The board will accept a two-quarter payback.',
      ],
    )
    expect(indexes).toStrictEqual([1])
    expect(unmatched).toStrictEqual([])
  })

  it('needs at least half of the key’s content words, not one of them', () => {
    // "supplier" alone is one of three: below the half, so no match.
    expect(
      matchDisruptions(['supplier_lead_times'], ['The supplier is based in Rotterdam.']).indexes,
    ).toStrictEqual([])
    // Two of three clears it.
    expect(
      matchDisruptions(['supplier_lead_times'], ['Lead times from the supplier are stable.'])
        .indexes,
    ).toStrictEqual([0])
  })

  it('stems plurals and the common inflections so one wording matches the other', () => {
    expect([...contentTokens('supplier_lead_times')]).toStrictEqual(['supplier', 'lead', 'time'])
    expect([...contentTokens('Supplier lead time holds.')]).toStrictEqual([
      'supplier',
      'lead',
      'time',
      'hold',
    ])
  })

  it('marks every assumption a key matches, and reports a key that matches none', () => {
    const { indexes, unmatched } = matchDisruptions(
      ['payback_period', 'freight_cost_volatility'],
      ['A two-quarter payback period is acceptable.', 'Payback period lands inside two quarters.'],
    )
    expect(indexes).toStrictEqual([0, 1])
    expect(unmatched).toStrictEqual(['freight_cost_volatility'])
  })
})

describe('buildFrameBesideDecision — the Turn that was never answered', () => {
  it('records an implicit hold as one (FR-115)', () => {
    const graph = buildFrameBesideDecision(loadFixture('implicit-hold-change-warranted'))
    expect(graph.turn?.implicit).toBe(true)
    expect(graph.turn?.justification).toBeNull()
    expect(graph.turn?.confidence).toBeNull()
    expect(graph.description).toContain('closed without a response')
  })

  it('says so when no Turn was delivered at all', () => {
    const graph = buildFrameBesideDecision(without(loadFixture('marco-8-of-11'), 'turn_delivered'))
    expect(graph.turn).toBeNull()
    expect(graph.description).toContain('No Turn was delivered')
  })
})

describe('buildFrameBesideDecision — availability (FR-136)', () => {
  it('is unavailable when the frame was never locked', () => {
    const graph = buildFrameBesideDecision(without(loadFixture('marco-8-of-11'), 'frame_locked'))
    expect(graph.available).toBe(false)
    expect(graph.missing_event_types).toStrictEqual(['frame_locked'])
    expect(graph.frame).toBeNull()
    expect(graph.brief).toBeNull()
    expect(graph.disrupted_assumption_indexes).toStrictEqual([])
    expect(graph.data_table.rows).toStrictEqual([])
  })
})
