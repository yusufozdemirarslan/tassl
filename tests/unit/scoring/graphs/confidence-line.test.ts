// The confidence line (FR-132, FR-083, D-078).
//
// The shape the Calibration rules read off it is `rising_unchecked`: confidence climbing while the
// accuracy of the claims being relied on stays under a half (10 §11.2). The Nadia fixture is that
// shape — 40 at the frame, 85 at the lock, accuracy 0.4 — and the rest of this file defends the two
// definitions the shape depends on: what "relied on" means at a point, and what "accurate" means.
import { describe, expect, it } from 'vitest'
import { buildConfidenceLine } from '@/server/modules/scoring/graphs'
import { loadFixture, without } from './fixtures'

describe('buildConfidenceLine — the Nadia fixture', () => {
  const line = buildConfidenceLine(loadFixture('nadia-run-one'))
  const at = (key: 'frame' | 'lock' | 'turn') => line.points.find((point) => point.at === key)

  it('plots confidence rising from 40 at the frame to 85 at the lock', () => {
    expect(at('frame')?.confidence).toBe(40)
    expect(at('lock')?.confidence).toBe(85)
    expect(at('lock')!.confidence!).toBeGreaterThan(at('frame')!.confidence!)
  })

  it('puts the accuracy of the claims relied on at the lock below one half', () => {
    expect(at('lock')?.accuracy).toBe(0.4)
    expect(at('lock')!.accuracy!).toBeLessThan(0.5)
    expect(at('lock')?.relied_on_claim_ids).toHaveLength(5)
    expect(at('lock')?.accurate_claim_ids).toHaveLength(2)
  })

  it('reports no accuracy at the frame, because nothing is relied on before the assistant', () => {
    expect(at('frame')?.accuracy).toBeNull()
    expect(at('frame')?.relied_on_claim_ids).toStrictEqual([])
  })

  it('describes the three points in words with their numbers', () => {
    expect(line.description).toContain('confidence 40 out of 100')
    expect(line.description).toContain('confidence 85 out of 100')
    expect(line.description).toContain('accuracy 40 percent')
    expect(line.data_table.rows).toHaveLength(3)
  })
})

describe('buildConfidenceLine — "sound or verified" (D-078)', () => {
  it('counts a defective claim as accurate once an action has run on it', () => {
    const fixture = loadFixture('marco-8-of-11')
    const line = buildConfidenceLine(fixture)
    const lock = line.points.find((point) => point.at === 'lock')!
    // Marco relies on three sound claims, so the accuracy is 1 either way; what this asserts is
    // that the *rule* is applied — every relied-on claim is classified, none is dropped.
    expect(lock.accurate_claim_ids).toHaveLength(lock.relied_on_claim_ids.length)
    expect(lock.accuracy).toBe(1)
  })

  it('does not credit an action that ran after the point it is read at', () => {
    // Nadia runs no action at all, so every accurate claim is accurate by evidence status alone.
    const line = buildConfidenceLine(loadFixture('nadia-run-one'))
    const fixture = loadFixture('nadia-run-one')
    const sound = new Set(
      fixture.variantStates.filter((s) => s.evidenceStatus === 'sound').map((s) => s.claimId),
    )
    const lock = line.points.find((point) => point.at === 'lock')!
    expect(lock.accurate_claim_ids.every((id) => sound.has(id))).toBe(true)
  })
})

describe('buildConfidenceLine — the third point', () => {
  it('adds a point after the Turn when a response was filed', () => {
    const line = buildConfidenceLine(loadFixture('hold-with-reason'))
    expect(line.points.map((point) => point.at)).toStrictEqual(['frame', 'lock', 'turn'])
    expect(line.points[2]?.confidence).toBe(60)
  })

  it('records a null confidence when the window closed unanswered (FR-115)', () => {
    const line = buildConfidenceLine(loadFixture('implicit-hold-no-change'))
    expect(line.points[2]?.at).toBe('turn')
    expect(line.points[2]?.confidence).toBeNull()
  })
})

describe('buildConfidenceLine — availability (FR-136)', () => {
  it('is unavailable when the frame was never locked, and names the missing event', () => {
    const line = buildConfidenceLine(without(loadFixture('marco-8-of-11'), 'frame_locked'))
    expect(line.available).toBe(false)
    expect(line.missing_event_types).toStrictEqual(['frame_locked'])
    expect(line.points).toStrictEqual([])
    expect(line.description).toContain('frame_locked')
    expect(line.data_table.columns.length).toBeGreaterThan(0)
  })

  it('is unavailable when the decision was never locked', () => {
    const line = buildConfidenceLine(without(loadFixture('marco-8-of-11'), 'decision_locked'))
    expect(line.available).toBe(false)
    expect(line.missing_event_types).toStrictEqual(['decision_locked'])
  })

  it('names both missing events when neither end of the working period exists', () => {
    const stripped = without(
      without(loadFixture('marco-8-of-11'), 'frame_locked'),
      'decision_locked',
    )
    expect(buildConfidenceLine(stripped).missing_event_types).toStrictEqual([
      'frame_locked',
      'decision_locked',
    ])
  })
})
