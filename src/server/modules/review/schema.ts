// Wire contract of the `review` module (docs/tech/10-backend-spec-modules.md §12; 07-api-spec.md
// §7). One Zod schema per input, shared by the route, the Server Action and the form that submits
// it; one schema per view, which the route validates against before serializing.
//
// Step 8.2 opens the namespace with the one row of 07 §7 the faculty seat needs before the replay
// exists: FR-118's forced-failure control, which the walkthrough uses to demonstrate the standing
// rule of FR-001 to a class. The replay bundle, the band decisions, the neutralization and the
// manual banding arrive with Phase 11.
//
// Like every module schema this file carries no server import, so a Server Component may read its
// types and a Client Component never imports it (D-186).
import { z } from 'zod'

/** Every route of this module is addressed by a run id (07 §7's `/review/runs/{runId}/…`). */
export const RunIdParamsSchema = z.object({ runId: z.uuid() })

/**
 * What arming the test control answers (07 §7).
 *
 * A literal `true` rather than a boolean: the endpoint has one outcome, and a refusal is an error
 * envelope (`TEST_CONTROLS_DISABLED`, FORBIDDEN, NOT_FOUND) rather than `{ armed: false }`. A shape
 * that could say "no" would invite a caller to read the answer instead of the status.
 */
export const ForcedFailureSchema = z.object({ armed: z.literal(true) })
export type ForcedFailure = z.infer<typeof ForcedFailureSchema>
