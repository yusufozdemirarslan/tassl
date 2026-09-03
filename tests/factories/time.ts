// Frozen time for fixtures (docs/tech/06-data-model.md §5): every factory row is created at
// FROZEN_TIME unless a test advances it, so ordering and cursors are deterministic.
export const FROZEN_TIME = new Date('2026-09-01T09:00:00.000Z')

/** FROZEN_TIME plus `seconds` (negative values go back in time). */
export const at = (seconds: number): Date => new Date(FROZEN_TIME.getTime() + seconds * 1000)
