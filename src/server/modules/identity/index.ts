// Public surface of the `identity` module (docs/tech/10-backend-spec-modules.md §1). Other modules,
// job handlers, and server components import from here and from `./schema`; nothing else in the
// module is reachable from outside it (04-repo-structure.md §2).
export {
  exportUserData,
  getCurrentUser,
  listMyAssignments,
  purgeDeletedAccounts,
  requestAccountDeletion,
  updateProfile,
} from './service'

export {
  capabilitiesSchema,
  confirmAccountDeletionSchema,
  meViewSchema,
  membershipSchema,
  myAssignmentsPageSchema,
  pageQuerySchema,
  updateProfileSchema,
  userExportSchema,
  type Capabilities,
  type ConfirmAccountDeletionInput,
  type MeView,
  type Membership,
  type OrganizationRole,
  type PageQuery,
  type PlatformRole,
  type RunRef,
  type RunSummary,
  type SectionRole,
  type StudentAssignment,
  type UpdateProfileInput,
  type UserExport,
} from './schema'
