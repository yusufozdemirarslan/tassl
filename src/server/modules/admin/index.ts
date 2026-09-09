// Public interface of the `admin` module (docs/tech/10-backend-spec-modules.md §16).
// Server Components, other modules, and the job handlers import from here; never from ./service or
// ./repository. `audit` is the helper every module writes its audit row through (SYS-011); the
// platform functions are UI-050's screens; `effectiveAssistantMode` is the runtime switch's effect
// (D-691), which the workspace pages and `/api/ready` read through this door.
export {
  audit,
  effectiveAssistantMode,
  getFlags,
  listAuditLog,
  listInstitutions,
  listUsers,
  setAiMode,
  setPlatformRole,
} from './service'
export type { AuditAction, AuditInput, AuditLog, AuditLogMetadata } from './service'

export {
  adminFlagsSchema,
  adminUserPageSchema,
  adminUserSchema,
  aiModeSchema,
  assistantModeSchema,
  auditEntryPageSchema,
  auditEntrySchema,
  institutionRefSchema,
  INSTITUTION_FILTER_LIMIT,
  listAuditLogSchema,
  listUsersSchema,
  llmUsageSchema,
  llmUsageWindowSchema,
  platformRoleSchema,
  setAiModeSchema,
  setPlatformRoleSchema,
  type AdminFlags,
  type AdminUser,
  type AdminUserPage,
  type AiMode,
  type AssistantMode,
  type AuditEntry,
  type AuditEntryPage,
  type InstitutionRef,
  type ListAuditLogInput,
  type ListUsersInput,
  type LlmUsage,
  type LlmUsageWindow,
  type PlatformRole,
  type SetAiModeInput,
  type SetPlatformRoleInput,
} from './schema'
