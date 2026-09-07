// `buildGraphs` — the graph step of the scoring pipeline (10 §11; FR-136, FR-212).
//
// Two properties belong here rather than in any one builder's file: that all four payloads are
// produced for every fixture, and that a run missing the events a graph is drawn from produces an
// *unavailable* graph rather than an exception. The second is what makes a dimension unassessed
// instead of wrong, and it is the difference between a run the instructor can still debrief and a
// scoring job that fell over.
import { describe, expect, it } from 'vitest'
import { buildGraphs, GRAPH_KEYS, unavailableGraphKeys } from '@/server/modules/scoring/graphs'
import { FIXTURE_NAMES, loadFixture, without } from './fixtures'

describe('buildGraphs', () => {
  it.each(FIXTURE_NAMES)('plots all four graphs of %s from the trace alone', (name) => {
    const graphs = buildGraphs(loadFixture(name))
    expect(Object.keys(graphs).sort()).toStrictEqual([...GRAPH_KEYS].sort())
    for (const key of GRAPH_KEYS) {
      const payload = graphs[key]
      expect(payload.available, `${name} ${key}`).toBe(true)
      expect(payload.missing_event_types).toStrictEqual([])
      expect(payload.description.length, `${name} ${key} description`).toBeGreaterThan(30)
      expect(payload.data_table.columns.length).toBeGreaterThan(0)
      expect(payload.data_table.caption.length).toBeGreaterThan(0)
    }
    expect(unavailableGraphKeys(graphs)).toStrictEqual([])
  })

  it('is pure: the same input twice gives the same payloads', () => {
    const fixture = loadFixture('marco-8-of-11')
    expect(buildGraphs(fixture)).toStrictEqual(buildGraphs(fixture))
  })

  it('does not mutate its input', () => {
    const fixture = loadFixture('marco-8-of-11')
    const before = JSON.stringify(fixture)
    buildGraphs(fixture)
    expect(JSON.stringify(fixture)).toBe(before)
  })

  it('reports the three graphs drawn from the frame as unavailable when it is missing', () => {
    const graphs = buildGraphs(without(loadFixture('marco-8-of-11'), 'frame_locked'))
    expect(unavailableGraphKeys(graphs).sort()).toStrictEqual([
      'clock_timeline',
      'confidence_line',
      'frame_beside_decision',
    ])
    // The stance matrix is not drawn from the frame, so it survives and still carries its rate.
    expect(graphs.stance_matrix.available).toBe(true)
    for (const key of ['confidence_line', 'clock_timeline', 'frame_beside_decision'] as const) {
      expect(graphs[key].missing_event_types).toContain('frame_locked')
      expect(graphs[key].description).toContain('frame_locked')
    }
  })

  it('makes every graph unavailable on a run with no events at all, and throws nothing', () => {
    const empty = { ...loadFixture('marco-8-of-11'), events: [] }
    const graphs = buildGraphs(empty)
    expect(unavailableGraphKeys(graphs).sort()).toStrictEqual([...GRAPH_KEYS].sort())
    // The stance matrix keeps a row per consequential claim: unsurfaced is a finding, not a gap.
    expect(graphs.stance_matrix.rows).toHaveLength(11)
    expect(graphs.stance_matrix.rows.every((row) => !row.surfaced)).toBe(true)
  })
})
