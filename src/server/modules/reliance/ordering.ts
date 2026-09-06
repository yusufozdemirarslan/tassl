// The order the Decision Lock's gate reads claims in (FR-084; D-274).
//
// One comparator, in one pure file, because the order is a rule and not a convenience. FR-084 says
// the refusal "names the first such claim", so *which* claim a student is sent back to is decided
// here — and a student who fixes the claim they were named, re-locks, and is named a different one
// has been given a list one item at a time, which is fine; being named a *different first* claim on
// two identical locks is not.
//
// Three keys, in this order:
//
//   1. `surfacedAt` — when the student met the claim. The one they met first is the one they have
//      had longest to take a position on, and it is the one the refusal names.
//   2. `position` — the author's order in the package. Several claims are routinely surfaced in one
//      instant (one delegation matching two triggers, one document carrying three claims), so
//      `surfacedAt` alone leaves ties, and the rows come back from Postgres in whatever order the
//      plan produced.
//   3. `key` — the author's own label, which is unique per version, so the comparator is total.
//
// It is the same order `repository.listRunClaims` asks Postgres for, and applying it again in the
// service is deliberate: the SQL clause serves the index, and this makes the contract a property of
// the code that returns the list rather than of a clause a future query could quietly drop.

/** The three fields the order is decided by; a joined `run_claims`/`scenario_claims` row has all three. */
export type SurfacingOrder = {
  surfacedAt: Date
  /** `scenario_claims.position`: the author's order within the package version. */
  position: number
  /** `scenario_claims.key`, unique per version — the tiebreak that makes the order total. */
  key: string
}

/** Oldest surfacing first, then the author's order, then the claim key (D-274). */
export function bySurfacing(a: SurfacingOrder, b: SurfacingOrder): number {
  const surfaced = a.surfacedAt.getTime() - b.surfacedAt.getTime()
  if (surfaced !== 0) return surfaced
  if (a.position !== b.position) return a.position - b.position
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}
