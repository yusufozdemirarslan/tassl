// Institutions, invitations, and data agreements (SYS-005, FR-234; src/server/modules/tenancy)
import { scopedT } from '../scoped'

export const tenancy = {
  'tenancy.invitationNotFound': 'This invitation has expired or has already been used.',
  'tenancy.invitationEmailUnverified':
    'Confirm your email address before accepting this invitation.',
  'tenancy.slugTaken': 'That institution address is already taken.',
  'tenancy.alreadyMember': 'That person is already a member of this institution.',
  'tenancy.alreadyInvited': 'That person already has an invitation to this institution.',
  'tenancy.programLeadNotFound':
    'No Tassl account uses {email}. The program lead needs an account before the institution is created.',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(tenancy)
