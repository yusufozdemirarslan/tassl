// Public interface of the `admin` module (docs/tech/10-backend-spec-modules.md §16).
// Server Components, other modules, and the job handlers import from here; never from ./service or
// ./repository. `audit` is the helper every module writes its audit row through (SYS-011); the four
// platform functions are UI-050's screens.
export {
  audit,
  getFlags,
  listAuditLog,
  listInstitutions,
  listUsers,
  setPlatformRole,
} from './service'
export type { AuditAction, AuditInput, AuditLog, AuditLogMetadata } from './service'

export {
  adminFlagsSchema,
  adminUserPageSchema,
  adminUserSchema,
  auditEntryPageSchema,
  auditEntrySchema,
  institutionRefSchema,
  INSTITUTION_FILTER_LIMIT,
  listAuditLogSchema,
  listUsersSchema,
  platformRoleSchema,
  setPlatformRoleSchema,
  type AdminFlags,
  type AdminUser,
  type AdminUserPage,
  type AuditEntry,
  type AuditEntryPage,
  type InstitutionRef,
  type ListAuditLogInput,
  type ListUsersInput,
  type PlatformRole,
  type SetPlatformRoleInput,
} from './schema'
