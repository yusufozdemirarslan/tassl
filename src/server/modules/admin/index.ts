// Public interface of the `admin` module (docs/tech/10-backend-spec-modules.md §16).
// Phase 3 exports the audit helper only; the platform screens and their service functions arrive
// in Phase 13. Other modules import `audit` from here, never from ./service or ./repository.
export { audit } from './service'
export type { AuditAction, AuditInput, AuditLog, AuditLogMetadata } from './service'
