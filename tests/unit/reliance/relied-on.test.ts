// Step 8.1 — the two pure rules behind FR-084's lock gate, tested where they can be read: D-076's
// named-field matching (`src/server/modules/reliance/matching.ts`) and D-274's ordering of the
// claims the gate refuses over (`src/server/modules/reliance/ordering.ts`).
//
// Why these two are worth a suite of their own. A run is refused a Decision Lock over a claim the
// student relied on and took no position on, and both halves of that sentence are decided here: the
// matching says *which* claims a brief's figures leaned on, and the ordering says which one the
// refusal names. Both fail silently — a tolerance that is too tight refuses nothing and a student
// locks over a claim they used; one that is too loose refuses over a claim they never touched; a
// non-total order names a different claim on two identical locks. None of that shows up in a screen.
//
// The database half — that the run's rows really do come back in this order, and that a named figure
// really does write `claim_used { via: 'named_field' }` — is `tests/integration/reliance/*`.
import { describe, expect, it } from 'vitest'
import { ESCALATION_LIMIT } from '@/server/modules/reliance/schema'
import {
  MATCH_TOLERANCE,
  convertUnit,
  matchesField,
  namedValueMatchesClaim,
  valueMatches,
  type CarriedValue,
} from '@/server/modules/reliance/matching'
import { bySurfacing, type SurfacingOrder } from '@/server/modules/reliance/ordering'
import { ESCALATIONS_PER_RUN } from '@/server/modules/runs/limits'

const carried = (value: number, unit: CarriedValue['unit'], fieldKey?: string): CarriedValue =>
  fieldKey === undefined ? { value, unit } : { field_key: fieldKey, value, unit }

// ---------------------------------------------------------------------------------------------
// D-076, half one: unit normalization
// ---------------------------------------------------------------------------------------------

describe('unit normalization (D-076, FR-101)', () => {
  it('reads percent and ratio as the same quantity, both ways', () => {
    expect(convertUnit(40, 'percent', 'ratio')).toBe(0.4)
    expect(convertUnit(0.4, 'ratio', 'percent')).toBeCloseTo(40, 10)
    expect(convertUnit(31, 'percent', 'percent')).toBe(31)
  })

  it('converts nothing else, so months are never dollars', () => {
    expect(convertUnit(11, 'months', 'usd')).toBeNull()
    expect(convertUnit(11, 'months', 'percent')).toBeNull()
    expect(convertUnit(8.8, 'usd', 'count')).toBeNull()
    expect(convertUnit(3, 'count', 'other')).toBeNull()
  })

  it('answers null for a value that is not a number, rather than propagating it', () => {
    expect(convertUnit(Number.NaN, 'months', 'months')).toBeNull()
    expect(convertUnit(Number.POSITIVE_INFINITY, 'percent', 'ratio')).toBeNull()
  })

  it('matches a ratio entered against a claim that carries a percentage', () => {
    // The claim says "40 percent"; the student writes 0.4 in a ratio field. Same figure.
    expect(valueMatches(0.4, 'ratio', carried(40, 'percent'))).toBe(true)
    // And the other way: the claim carries a ratio, the field is a percentage.
    expect(valueMatches(40, 'percent', carried(0.4, 'ratio'))).toBe(true)
  })

  it('never matches across units that are not the same quantity', () => {
    expect(valueMatches(11, 'usd', carried(11, 'months'))).toBe(false)
    expect(valueMatches(8.8, 'count', carried(8.8, 'usd'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------
// D-076, half two: the tolerance
// ---------------------------------------------------------------------------------------------

describe('the matching tolerance (D-076)', () => {
  it('is half a percent of the claim’s value', () => {
    expect(MATCH_TOLERANCE).toBe(0.005)
  })

  it('accepts the rounding a person does between reading a figure and writing it down', () => {
    // The decomposition says 4.19 months and the claim carries 4.2: a student who types either is
    // relying on the same claim.
    expect(valueMatches(4.19, 'months', carried(4.2, 'months'))).toBe(true)
    expect(valueMatches(11.0, 'months', carried(11, 'months'))).toBe(true)
    expect(valueMatches(310, 'usd', carried(310.5, 'usd'))).toBe(true)
  })

  it('refuses a figure outside the band', () => {
    // 4.2 months: the band is 0.005 x 4.2 = 0.021, so a fifth of a month out is out.
    expect(valueMatches(4.4, 'months', carried(4.2, 'months'))).toBe(false)
    expect(valueMatches(15.98, 'months', carried(11, 'months'))).toBe(false)
    expect(valueMatches(9, 'percent', carried(78, 'percent'))).toBe(false)
  })

  it('is strictly less than, exactly at the boundary', () => {
    // A claim carrying 1000 has a band of 0.005 × 1000 = 5.
    expect(valueMatches(1004.999, 'usd', carried(1000, 'usd'))).toBe(true)
    expect(valueMatches(1005, 'usd', carried(1000, 'usd'))).toBe(false)
    expect(valueMatches(995.001, 'usd', carried(1000, 'usd'))).toBe(true)
    expect(valueMatches(995, 'usd', carried(1000, 'usd'))).toBe(false)
  })

  it('floors the multiplier at one, so a claim below 1 keeps the same 0.005 band', () => {
    expect(valueMatches(0.004, 'count', carried(0, 'count'))).toBe(true)
    expect(valueMatches(0.005, 'count', carried(0, 'count'))).toBe(false)
    expect(valueMatches(0.402, 'ratio', carried(0.4, 'ratio'))).toBe(true)
    expect(valueMatches(0.41, 'ratio', carried(0.4, 'ratio'))).toBe(false)
  })

  it('scales with the claim, so a large figure has a proportionate band', () => {
    // 0.5 percent of 200,000 is 1,000.
    expect(valueMatches(200_999, 'usd', carried(200_000, 'usd'))).toBe(true)
    expect(valueMatches(201_001, 'usd', carried(200_000, 'usd'))).toBe(false)
  })

  it('says nothing about a carried value that is not a number', () => {
    expect(valueMatches(4.2, 'months', { value: Number.NaN, unit: 'months' })).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------
// Which field a carried value belongs to
// ---------------------------------------------------------------------------------------------

describe('field keys on carried values', () => {
  it('binds a carried value that declares a field key to that field alone', () => {
    const payback = carried(11, 'months', 'premium_payback_months')
    expect(matchesField(payback, 'premium_payback_months')).toBe(true)
    expect(matchesField(payback, 'value_payback_months')).toBe(false)
    expect(namedValueMatchesClaim('premium_payback_months', 11, 'months', [payback])).toBe(true)
    // The same number in a different months field is not reliance on this claim.
    expect(namedValueMatchesClaim('value_payback_months', 11, 'months', [payback])).toBe(false)
  })

  it('lets a carried value with no field key be named by any field of the same unit', () => {
    const blended = carried(4.2, 'months')
    expect(namedValueMatchesClaim('premium_payback_months', 4.2, 'months', [blended])).toBe(true)
    expect(namedValueMatchesClaim('value_payback_months', 4.19, 'months', [blended])).toBe(true)
    expect(namedValueMatchesClaim('budget_share_to_premium', 4.2, 'percent', [blended])).toBe(false)
  })

  it('marks a claim relied on when any one of its figures is named', () => {
    const values = [carried(4.2, 'months'), carried(22.9, 'usd')]
    expect(namedValueMatchesClaim('contribution_usd', 22.9, 'usd', values)).toBe(true)
    expect(namedValueMatchesClaim('payback_months', 4.2, 'months', values)).toBe(true)
    expect(namedValueMatchesClaim('payback_months', 9, 'months', values)).toBe(false)
  })

  it('matches nothing for a claim that carries no figure', () => {
    expect(namedValueMatchesClaim('premium_payback_months', 11, 'months', [])).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------
// The order the lock gate names claims in (FR-084, D-274)
// ---------------------------------------------------------------------------------------------

describe('ordering of unstanced relied-on claims', () => {
  const at = (iso: string, position: number, key: string): SurfacingOrder => ({
    surfacedAt: new Date(iso),
    position,
    key,
  })

  it('puts the claim the student met first at the head of the list', () => {
    const rows = [
      at('2026-09-05T10:05:00.000Z', 2, 'C3'),
      at('2026-09-05T10:01:00.000Z', 7, 'C8'),
      at('2026-09-05T10:03:00.000Z', 0, 'C1'),
    ]
    expect([...rows].sort(bySurfacing).map((row) => row.key)).toEqual(['C8', 'C1', 'C3'])
  })

  it('breaks a shared instant on the author’s order, not on whatever the query returned', () => {
    // One delegation matching three triggers surfaces three claims in one instant.
    const instant = '2026-09-05T10:00:00.000Z'
    const rows = [at(instant, 4, 'C5'), at(instant, 1, 'C2'), at(instant, 2, 'C3')]
    expect([...rows].sort(bySurfacing).map((row) => row.key)).toEqual(['C2', 'C3', 'C5'])
    // Reversed input, same answer: the order is a property of the rows, not of their arrival.
    expect(
      [...rows]
        .reverse()
        .sort(bySurfacing)
        .map((row) => row.key),
    ).toEqual(['C2', 'C3', 'C5'])
  })

  it('is total, so two claims at one instant and one position still have an order', () => {
    const instant = '2026-09-05T10:00:00.000Z'
    const rows = [at(instant, 3, 'C9'), at(instant, 3, 'C4')]
    expect([...rows].sort(bySurfacing).map((row) => row.key)).toEqual(['C4', 'C9'])
    expect(bySurfacing(rows[0]!, rows[0]!)).toBe(0)
  })
})

// ---------------------------------------------------------------------------------------------
// The one number this module writes twice
// ---------------------------------------------------------------------------------------------

describe('the escalation limit', () => {
  /**
   * `ESCALATION_LIMIT` is the wire bound on `remainingEscalations` (07 §10) and lives in the module
   * schema, which may import `src/lib` and nothing else — so it cannot read the pilot parameter that
   * decides it (`runs/limits.ts`, 10 §10: "nothing else in the codebase writes any of them as a
   * literal"). This is the assertion that keeps the two from drifting apart in silence.
   */
  it('agrees with the pilot parameter it publishes', () => {
    expect(ESCALATION_LIMIT).toBe(ESCALATIONS_PER_RUN)
  })
})
