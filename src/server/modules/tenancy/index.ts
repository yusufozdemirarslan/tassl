// Public interface of the `tenancy` module (docs/tech/10-backend-spec-modules.md §2).
// Other modules, Server Components, and the app shell import from here; never from ./service,
// ./repository, or ./errors.
export {
  acceptInvitation,
  canReadIdentifiedRecords,
  createInstitution,
  getInstitutionSettings,
  getInvitation,
  inviteMember,
  listDataAgreements,
  listInvitations,
  listMyInstitutions,
  requireMembership,
  setActiveInstitution,
  updateDataAgreement,
  updateInstitutionSettings,
  upsertDataAgreement,
} from './service'

export type {
  CreateInstitutionInput,
  DataAgreementInput,
  DataAgreementView,
  Institution,
  InstitutionView,
  InvitationDetail,
  InvitationView,
  InviteMemberInput,
  Mapping,
  Membership,
  MyInstitution,
  OrganizationRoleValue,
  UpdateDataAgreementInput,
  UpdateInstitutionSettingsInput,
} from './schema'
