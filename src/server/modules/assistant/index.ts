// Public interface of the `assistant` module (docs/tech/10-backend-spec-modules.md §7).
// Other modules, Server Components, and job handlers import from here; never from ./service,
// ./repository, ./triggers, or ./errors.
//
// `delegate` is the only function in the codebase that answers an `AsyncIterable`. It is a promise
// of one rather than a generator on purpose: everything that can refuse a delegation — the state
// gate of FR-050, the length limit of 11 §3, a provider that never answered — is settled before the
// promise resolves, so the route can answer a JSON error envelope with a status the client can act
// on, and a resolved promise means the whole reply exists, has passed both guards, and has been
// stored (D-271). A generator would defer all of that to the first `next()`, by which time the
// response headers are written and a refusal has nowhere to go.
//
// `flagDelegation` (FR-055) has no route yet: 07 §8 puts it on the faculty replay, which arrives
// with Phase 11. It is exported because the rule is here, not there.
export {
  assembleReply,
  declareOutsideTool,
  delegate,
  flagDelegation,
  listDelegations,
  updateDelegation,
  DELEGATION_NO_COMMENTARY_FLAG,
  DELEGATION_REBUILT_FLAG,
} from './service'

export type { DelegationChunk, DelegationSegment } from './service'

export {
  DELEGATION_REQUEST_MAX_CHARS,
  DELEGATION_WHY_MAX_CHARS,
  DelegateInputSchema,
  DelegationClaimSchema,
  DelegationViewSchema,
  DeclareOutsideToolSchema,
  OUTSIDE_TOOL_PURPOSE_MAX_CHARS,
  UpdateDelegationSchema,
} from './schema'

export type {
  DeclareOutsideToolInput,
  DelegateInput,
  DelegationClaim,
  DelegationFlagValue,
  DelegationView,
  UpdateDelegationInput,
} from './schema'
