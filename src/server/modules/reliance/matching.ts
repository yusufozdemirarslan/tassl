// Named-field matching (docs/tech/DECISIONS.md D-076; FR-101; 10-backend-spec-modules.md §8).
//
// A student's brief carries named numeric fields. A value they type into one of them, when it is
// the value a claim carries, is a statement that they leaned on that claim — so the claim becomes
// relied on and the Decision Lock's gate asks them for a stance on it (FR-084). This file is the
// whole of the arithmetic behind that sentence, and nothing else: no database, no run, no event.
//
// It is a separate file because the rule has to be readable on its own. D-076 is two rules braided
// together — a unit normalization and a tolerance — and each is a place a run's reliance can be
// wrong in a way nobody notices until a Decision Lock is refused over a claim the student never
// used, or waved through over one they did. `tests/unit/reliance/relied-on.test.ts` reads it here.
//
// The two rules, in the order they are applied:
//
//   1. **Normalize into the claim's own unit** (FR-101: "normalizing to the claim's declared
//      unit"). `percent` and `ratio` are the same quantity written two ways, so 40 percent and 0.4
//      are the same number and either spelling matches the other. Every other unit — `months`,
//      `usd`, `count`, `other` — converts only to itself: eleven months is not eleven dollars, and
//      a field that means one is never evidence of reliance on a claim that carries the other.
//   2. **Compare inside D-076's tolerance**: `|entered − carried| < 0.005 × max(1, |carried|)`.
//      Half a percent of the claim's own value, with the *multiplier* floored at one so a claim
//      carrying a figure below 1 keeps a 0.005 band rather than a vanishing one. It exists because
//      a student reads "4.19 months" in a decomposition and types 4.2, and because the author wrote
//      11 where the brief asks for 11.0 — the rounding a person does between reading a figure and
//      writing it down. It is deliberately tight: it forgives a rounded transcription and nothing
//      more, so a figure a student computed for themselves is their own assumption to defend
//      (FR-025) rather than reliance on a claim that happens to be nearby.
//
// The order matters and is why the conversion targets the claim rather than some canonical unit:
// the tolerance is a fraction *of the claim's value as authored*, so converting 40 percent to 0.4
// before applying it would shrink the band from 0.2 percentage points to 0.005 of a ratio, which
// is 0.5 points — two and a half times wider, on the same pair of numbers.

/** `value_unit` (06 §3.1), as `scenario_claims.carried_values[]` and `named_fields` both spell it. */
export type ValueUnitValue = 'percent' | 'ratio' | 'months' | 'usd' | 'count' | 'other'

/**
 * One entry of `scenario_claims.carried_values` (06 §3.1's `CarriedValue`).
 *
 * `field_key` is the author saying which named field this figure belongs in. It is optional, and
 * the two cases are read differently — see `matchesField`.
 */
export type CarriedValue = { field_key?: string; value: number; unit: ValueUnitValue }

/** D-076: half a percent of the claim's own value, with the multiplier floored at one. */
export const MATCH_TOLERANCE = 0.005

/**
 * `value` expressed in `to`, or null when the two units are not the same quantity.
 *
 * `percent` and `ratio` are one quantity in two spellings and convert both ways. Nothing else
 * converts: the enum's remaining members name different things, and inventing a rate between them
 * would make a payback in months match a price in dollars.
 */
export function convertUnit(
  value: number,
  from: ValueUnitValue,
  to: ValueUnitValue,
): number | null {
  if (!Number.isFinite(value)) return null
  if (from === to) return value
  if (from === 'percent' && to === 'ratio') return value / 100
  if (from === 'ratio' && to === 'percent') return value * 100
  return null
}

/**
 * D-076's comparison: the entered value, read in the claim's unit, sits inside the claim's band.
 *
 * Strictly less than, as D-076 writes it. A carried value that is not a finite number is authored
 * data this rule cannot speak about, and answers false rather than throwing — a malformed package
 * element must not be able to stop a Decision Lock.
 */
export function valueMatches(
  entered: number,
  enteredUnit: ValueUnitValue,
  carried: CarriedValue,
): boolean {
  if (!Number.isFinite(carried.value)) return false
  const converted = convertUnit(entered, enteredUnit, carried.unit)
  if (converted === null) return false
  return (
    Math.abs(converted - carried.value) < MATCH_TOLERANCE * Math.max(1, Math.abs(carried.value))
  )
}

/**
 * Whether this carried value is a figure the field named `fieldKey` could be carrying.
 *
 * A carried value that declares a `field_key` belongs to that field and to no other: the author has
 * said which of the brief's boxes the figure goes in, and a payback figure typed into a budget-share
 * box is not reliance on the payback claim however close the two numbers happen to land. A carried
 * value with no `field_key` is a figure the claim states without saying where it belongs, so any
 * field of a compatible unit can carry it — which is the common case, and the one FR-101 describes
 * ("a value entered in a named numeric field that matches a value carried by a claim object").
 */
export function matchesField(carried: CarriedValue, fieldKey: string): boolean {
  return carried.field_key === undefined || carried.field_key === fieldKey
}

/**
 * Whether a value entered in one named field marks a claim as relied on (FR-101).
 *
 * True when *any* of the claim's carried values both belongs to this field and lands inside D-076's
 * band. A claim carrying several figures is relied on if the student named any one of them.
 */
export function namedValueMatchesClaim(
  fieldKey: string,
  entered: number,
  enteredUnit: ValueUnitValue,
  carriedValues: readonly CarriedValue[],
): boolean {
  return carriedValues.some(
    (carried) => matchesField(carried, fieldKey) && valueMatches(entered, enteredUnit, carried),
  )
}
