// The stance matrix and the False Challenge Rate (FR-134, FR-082, FR-063, D-107).
//
// The arithmetic PRD §6 fixes is the anchor: Marco's nine challenge-or-reject acts on eleven
// consequential claims are one catch and eight false alarms, and eight over eleven is 0.727. Every
// other assertion here defends one of the three ways that number can be got wrong — a denominator
// that counts only the claims the student met, a numerator that counts a challenge on a defective
// claim, and a neutralized row that stays in either.
import { describe, expect, it } from 'vitest'
import { buildStanceMatrix, falseChallengeRate, STANCES } from '@/server/modules/scoring/graphs'
import { loadFixture, without } from './fixtures'

const index = (stance: (typeof STANCES)[number]): number => STANCES.indexOf(stance)

describe('buildStanceMatrix — the Marco fixture (PRD §6)', () => {
  const matrix = buildStanceMatrix(loadFixture('marco-8-of-11'))

  it('reproduces the False Challenge Rate of 0.727 and shows the arithmetic', () => {
    expect(matrix.false_challenge_rate).toBe(0.727)
    expect(matrix.false_challenge_count).toBe(8)
    expect(matrix.consequential_claim_count).toBe(11)
  })

  it('counts the five-by-five summary of stances taken against stances warranted', () => {
    // Seven challenges and two rejections; one challenge lands on the planted defect, so eight of
    // the nine acts fall on sound claims that warranted accept or verify.
    expect(matrix.summary).toStrictEqual([
      [1, 0, 0, 0, 0], // accept taken
      [0, 1, 0, 0, 0], // verify taken
      [5, 1, 1, 0, 0], // challenge taken
      [2, 0, 0, 0, 0], // reject taken
      [0, 0, 0, 0, 0], // escalate taken
    ])
    const total = matrix.summary.flat().reduce((sum, count) => sum + count, 0)
    expect(total).toBe(11)
  })

  it('reports the matched share over the same eleven rows', () => {
    expect(matrix.matched_share).toBe(0.273)
    expect(matrix.rows.filter((row) => row.match).map((row) => row.key)).toStrictEqual([
      'claim_01',
      'claim_10',
      'claim_11',
    ])
  })

  it('never counts a challenge on a defective claim as a false challenge', () => {
    const defect = matrix.rows.find((row) => row.evidence_status === 'defective')
    expect(defect?.key).toBe('claim_01')
    expect(defect?.stance_taken).toBe('challenge')
    expect(
      falseChallengeRate(loadFixture('marco-8-of-11')).false_challenge_claim_ids,
    ).not.toContain(defect?.claim_id)
  })

  it('keeps both stances on a claim re-stanced inside the Turn window (FR-081)', () => {
    const row = matrix.rows.find((r) => r.key === 'claim_03')
    expect(row?.stance_taken).toBe('challenge')
    expect(row?.previous_stance).toBe('accept')
  })

  it('carries the interrogation action that preceded a stance, and how each claim was surfaced', () => {
    const traced = matrix.rows.find((row) => row.key === 'claim_01')
    expect(traced?.preceding_action?.type).toBe('source_trace')
    expect(traced?.surfaced_by).toBe('delegation')
    expect(traced?.surfaced_by_id).not.toBeNull()
  })

  it('carries the readiness result on each claim’s concept as context (FR-012)', () => {
    for (const row of matrix.rows) {
      expect(row.readiness_context?.concept_key).toBe(
        loadFixture('marco-8-of-11').packageVersion.claims.find((c) => c.id === row.claim_id)
          ?.conceptKey,
      )
    }
  })

  it('describes itself in words, with every non-zero cell of the summary', () => {
    expect(matrix.description).toContain('False Challenge Rate 73 percent')
    expect(matrix.description).toContain('Challenge taken where Accept was warranted: 5')
    expect(matrix.description).toContain('Reject taken where Accept was warranted: 2')
    expect(matrix.data_table.rows).toHaveLength(11)
  })
})

describe('buildStanceMatrix — the denominator includes claims the student never met (D-107)', () => {
  const fixture = loadFixture('nadia-run-one')
  const matrix = buildStanceMatrix(fixture)

  it('counts every consequential claim in the variant, surfaced or not', () => {
    expect(fixture.packageVersion.claims).toHaveLength(8)
    const unsurfaced = matrix.rows.filter((row) => !row.surfaced)
    expect(unsurfaced.map((row) => row.key)).toStrictEqual(['claim_07', 'claim_08'])
    expect(matrix.consequential_claim_count).toBe(8)
    expect(matrix.false_challenge_count).toBe(1)
    expect(matrix.false_challenge_rate).toBe(0.125)
  })

  it('does not compute the rate over the claims that were surfaced', () => {
    // 1 of 6 surfaced claims would be 0.167, which is the number this decision exists to refuse.
    expect(matrix.false_challenge_rate).not.toBe(0.167)
  })

  it('gives an unsurfaced claim no stance, no match and no false challenge', () => {
    const row = matrix.rows.find((r) => r.key === 'claim_07')
    expect(row?.stance_taken).toBeNull()
    expect(row?.stance_taken_at).toBeNull()
    expect(row?.match).toBe(false)
    expect(row?.surfaced_by).toBeNull()
  })

  it('leaves an unstanced row out of the five-by-five summary', () => {
    const total = matrix.summary.flat().reduce((sum, count) => sum + count, 0)
    expect(total).toBe(6)
  })
})

describe('buildStanceMatrix — neutralization (FR-003, FR-087)', () => {
  it('drops a neutralized row from the summary and from the rate, and keeps the row', () => {
    const matrix = buildStanceMatrix(loadFixture('stance-records-lost-third'))
    expect(matrix.rows).toHaveLength(9)
    const neutralized = matrix.rows.filter((row) => row.neutralized)
    expect(neutralized).toHaveLength(3)
    expect(neutralized.every((row) => row.stance_record_lost)).toBe(true)
    expect(matrix.consequential_claim_count).toBe(6)
    const total = matrix.summary.flat().reduce((sum, count) => sum + count, 0)
    expect(total).toBe(6)
  })

  it('reports the share of stance records lost, on both sides of the one-third rule', () => {
    const third = buildStanceMatrix(loadFixture('stance-records-lost-third'))
    const half = buildStanceMatrix(loadFixture('stance-records-lost-half'))
    const share = (rows: { stance_record_lost: boolean }[]): number =>
      rows.filter((row) => row.stance_record_lost).length / rows.length
    expect(share(third.rows)).toBeCloseTo(1 / 3, 6)
    expect(share(third.rows)).toBeLessThanOrEqual(1 / 3)
    expect(share(half.rows)).toBe(0.5)
    expect(share(half.rows)).toBeGreaterThan(1 / 3)
  })
})

describe('buildStanceMatrix — accepting everything', () => {
  it('produces no false challenges in either variant', () => {
    for (const name of ['accept-everything-defective', 'accept-everything-sound'] as const) {
      const matrix = buildStanceMatrix(loadFixture(name))
      expect(matrix.false_challenge_rate).toBe(0)
      expect(matrix.summary[index('accept')]?.[index('accept')]).toBeGreaterThan(0)
      expect(matrix.summary[index('challenge')]?.reduce((a, b) => a + b, 0)).toBe(0)
    }
  })

  it('leaves the defect unmatched in the defective variant and matched nowhere in the sound one', () => {
    const defective = buildStanceMatrix(loadFixture('accept-everything-defective'))
    const planted = defective.rows.find((row) => row.evidence_status === 'defective')
    expect(planted?.stance_taken).toBe('accept')
    expect(planted?.match).toBe(false)
  })
})

describe('buildStanceMatrix — availability', () => {
  it('is unavailable without a Decision Lock, and still carries its rows and its table', () => {
    const matrix = buildStanceMatrix(without(loadFixture('marco-8-of-11'), 'decision_locked'))
    expect(matrix.available).toBe(false)
    expect(matrix.missing_event_types).toStrictEqual(['decision_locked'])
    expect(matrix.rows).toHaveLength(11)
    expect(matrix.data_table.rows).toHaveLength(11)
    expect(matrix.description).toContain('decision_locked')
  })

  it('is still available when the frame is missing — the matrix is not drawn from it', () => {
    const matrix = buildStanceMatrix(without(loadFixture('marco-8-of-11'), 'frame_locked'))
    expect(matrix.available).toBe(true)
    expect(matrix.false_challenge_rate).toBe(0.727)
  })
})
