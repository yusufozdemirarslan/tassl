// Public interface of the `reliance` module (docs/tech/10-backend-spec-modules.md §8).
// Other modules, Server Components, and job handlers import from here; never from ./service or
// ./repository.
//
// Step 6.4 opened the module with what a run needs before there is an assistant: claims are
// surfaced by opening the document they come from (FR-031), and the run's surfaced claims can be
// read back. Step 7.3 added `markClaimUsed`, the one writer of `relied_on_via` and of the
// `claim_used` event (FR-060, FR-084, FR-101, D-077). Step 8.1 adds 10 §8's remaining rows: the
// three acts a student performs on a surfaced claim, the named-field route into reliance, and the
// query the Decision Lock's gate asks. `stanceMatrixInput` is scoring's and arrives with Phase 10.
//
// The exports fall into two shapes, and the difference is who has already taken the run's row lock.
//
//   * `setStance`, `runAction`, `escalate` and `listRunClaims` name an actor first, like every
//     other endpoint in the codebase: they are reached from a route or a Server Action, and they
//     take the lock themselves.
//   * `surfaceClaims`, `surfaceDocumentClaims`, `markClaimUsed`, `markReliedOnFromNamedFields` and
//     `findUnstancedReliedOn` take a transaction and a locked run row, like `trace.append` and for
//     the same reason: they are called from inside another module's mutation, which has already
//     named its actor, run its permission helper and taken the run's row lock. None of the five is
//     reachable from a route.
export {
  escalate,
  findReliedOn,
  findUnstancedReliedOn,
  listRunClaims,
  markClaimUsed,
  markReliedOnFromNamedFields,
  runAction,
  setStance,
  surfaceClaims,
  surfaceDocumentClaims,
} from './service'

export type { NamedFieldMark, SurfacedClaim, SurfacingRun, UnstancedReliedOnClaim } from './service'

export {
  ACTION_TYPES,
  ActionResultSchema,
  ActionTypeSchema,
  ClaimViewSchema,
  ESCALATION_LIMIT,
  EscalationResultSchema,
  StanceSchema,
  SurfacedBySchema,
} from './schema'

export type {
  ActionResult,
  ActionTypeValue,
  ClaimView,
  EscalationResult,
  ReliedOnViaValue,
  StanceValue,
  SurfacedByValue,
} from './schema'
