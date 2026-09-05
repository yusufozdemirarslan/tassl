// Public interface of the `reliance` module (docs/tech/10-backend-spec-modules.md §8).
// Other modules, Server Components, and job handlers import from here; never from ./service or
// ./repository.
//
// Step 6.4 opens the module with what a run needs before there is an assistant: claims are surfaced
// by opening the document they come from (FR-031), and the run's surfaced claims can be read back.
// `setStance`, `runAction`, `escalate`, `markReliedOnFromNamedFields`, `findUnstancedReliedOn` and
// `stanceMatrixInput` are 10 §8's other rows and arrive with Phase 8, each with its rules.
//
// `surfaceClaims` and `surfaceDocumentClaims` take a transaction and a locked run row rather than an
// actor, like `trace.append` and for the same reason: they are called from inside another module's
// mutation, which has already named its actor, run its permission helper and taken the run's row
// lock. Neither is reachable from a route.
export { listRunClaims, surfaceClaims, surfaceDocumentClaims } from './service'

export type { SurfacedClaim, SurfacingRun } from './service'

export { ClaimViewSchema, StanceSchema, SurfacedBySchema } from './schema'

export type { ClaimView, ReliedOnViaValue, StanceValue, SurfacedByValue } from './schema'
