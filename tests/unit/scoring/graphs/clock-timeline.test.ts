// The clock timeline (FR-133, FR-063, D-334).
//
// The property that makes the graph readable is that its segments are a *partition*: the working
// period is covered from zero to its end, no two segments overlap, and unattributed time is a
// segment rather than a gap. Every fixture is checked against that, because a timeline that leaks
// time is a timeline whose "unattributed" number is a guess.
import { describe, expect, it } from 'vitest'
import { buildClockTimeline, type TimelineTrack } from '@/server/modules/scoring/graphs'
import { FIXTURE_NAMES, loadFixture, without } from './fixtures'

/** Zero to `total_ms`, contiguous, in order, with no overlap and no gap. */
function assertCovers(track: TimelineTrack, label: string): void {
  expect(track.total_ms, label).toBeGreaterThan(0)
  expect(track.segments.length, label).toBeGreaterThan(0)
  expect(track.segments[0]?.start_ms, `${label} starts at zero`).toBe(0)
  expect(track.segments[track.segments.length - 1]?.end_ms, `${label} ends at total_ms`).toBe(
    track.total_ms,
  )
  track.segments.forEach((segment, i) => {
    expect(segment.end_ms, `${label} segment ${String(i)} has width`).toBeGreaterThan(
      segment.start_ms,
    )
    if (i > 0) {
      expect(segment.start_ms, `${label} segment ${String(i)} abuts its predecessor`).toBe(
        track.segments[i - 1]?.end_ms,
      )
    }
  })
  const covered = track.segments.reduce((sum, s) => sum + (s.end_ms - s.start_ms), 0)
  expect(covered, `${label} covers the clock exactly`).toBe(track.total_ms)
}

describe('buildClockTimeline — the segments cover the clock without overlap', () => {
  it.each(FIXTURE_NAMES)('%s', (name) => {
    const timeline = buildClockTimeline(loadFixture(name))
    expect(timeline.available).toBe(true)
    assertCovers(timeline, `${name} working clock`)
    if (timeline.window) assertCovers(timeline.window, `${name} Turn window`)
  })

  it('never places a mark outside the clock it belongs to', () => {
    for (const name of FIXTURE_NAMES) {
      const timeline = buildClockTimeline(loadFixture(name))
      for (const mark of timeline.marks) {
        expect(mark.at_ms, `${name} mark ${mark.kind}`).toBeGreaterThanOrEqual(0)
        expect(mark.at_ms).toBeLessThanOrEqual(timeline.total_ms)
      }
      for (const mark of timeline.window?.marks ?? []) {
        expect(mark.at_ms).toBeGreaterThanOrEqual(0)
        expect(mark.at_ms).toBeLessThanOrEqual(timeline.window!.total_ms)
      }
    }
  })
})

describe('buildClockTimeline — what the segments are attributed to', () => {
  const timeline = buildClockTimeline(loadFixture('marco-8-of-11'))

  it('gives each delegation a segment of its own (FR-063)', () => {
    const delegations = timeline.segments.filter((segment) => segment.type === 'delegation')
    expect(delegations.length).toBe(2)
    expect(new Set(delegations.map((segment) => segment.ref_id)).size).toBe(2)
    expect(delegations.every((segment) => segment.claim_ids.length > 0)).toBe(true)
  })

  it('names the document a reading segment was spent in', () => {
    const reading = timeline.segments.find((segment) => segment.type === 'reading')
    expect(reading?.document_id).toBeDefined()
    expect(reading?.ref_id).not.toBeNull()
  })

  it('gives the brief and the interrogation action their own segments', () => {
    const types = new Set(timeline.segments.map((segment) => segment.type))
    expect(types.has('brief')).toBe(true)
    expect(types.has('action')).toBe(true)
    expect(types.has('unattributed')).toBe(true)
  })

  it('marks the Decision Lock and every claim-touching event (FR-133)', () => {
    expect(timeline.marks.some((mark) => mark.kind === 'lock')).toBe(true)
    expect(timeline.marks.filter((mark) => mark.kind === 'claim_touch').length).toBeGreaterThan(10)
  })

  it('puts every segment and every mark in the data table', () => {
    const expected =
      timeline.segments.length +
      timeline.marks.length +
      (timeline.window?.segments.length ?? 0) +
      (timeline.window?.marks.length ?? 0)
    expect(timeline.data_table.rows).toHaveLength(expected)
  })
})

describe('buildClockTimeline — the Turn window', () => {
  it('opens when the student read the Turn, not when it fired (D-334)', () => {
    const fixture = loadFixture('marco-8-of-11')
    const timeline = buildClockTimeline(fixture)
    const delivered = fixture.events.find((event) => event.type === 'turn_delivered')!
    const opened = fixture.events.find(
      (event) => event.type === 'lifecycle' && event.payload.to === 'turn_open',
    )!
    const response = fixture.events.find((event) => event.type === 'turn_response_locked')!

    // The fixture's Turn fires ninety seconds after the lock and is read twenty minutes later, so
    // the two candidate origins differ by twenty minutes and only one of them is the window.
    const firedToResponse = Date.parse(response.occurredAt) - Date.parse(delivered.occurredAt)
    const openedToResponse = Date.parse(response.occurredAt) - Date.parse(opened.occurredAt)
    expect(firedToResponse - openedToResponse).toBe(20 * 60 * 1000)
    expect(timeline.window?.total_ms).toBe(openedToResponse)
  })

  it('marks the delivery of the Turn at the head of the window', () => {
    const timeline = buildClockTimeline(loadFixture('marco-8-of-11'))
    expect(timeline.window?.marks[0]).toMatchObject({ at_ms: 0, kind: 'turn_delivered' })
  })

  it('is null on a run that never received a Turn', () => {
    const timeline = buildClockTimeline(without(loadFixture('marco-8-of-11'), 'turn_delivered'))
    expect(timeline.window).toBeNull()
    expect(timeline.description).toContain('No Turn window opened')
  })
})

describe('buildClockTimeline — availability (FR-136)', () => {
  it('is unavailable when the frame was never locked', () => {
    const timeline = buildClockTimeline(without(loadFixture('marco-8-of-11'), 'frame_locked'))
    expect(timeline.available).toBe(false)
    expect(timeline.missing_event_types).toStrictEqual(['frame_locked'])
    expect(timeline.segments).toStrictEqual([])
    expect(timeline.total_ms).toBe(0)
    expect(timeline.window).toBeNull()
  })

  it('is unavailable when the decision was never locked', () => {
    const timeline = buildClockTimeline(without(loadFixture('marco-8-of-11'), 'decision_locked'))
    expect(timeline.available).toBe(false)
    expect(timeline.missing_event_types).toStrictEqual(['decision_locked'])
  })
})
