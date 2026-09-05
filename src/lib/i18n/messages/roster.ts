// UI-031 section roster (/courses/[courseId]/sections/[sectionId]/roster, SYS-005)
import { scopedT } from '../scoped'

export const roster = {
  'roster.title': 'Section roster',
  'roster.description':
    'Who is in this section. Everyone on it already belongs to the institution; invite anyone who does not.',
  'roster.context': '{course} · {section}',
  'roster.backToCourse': 'Back to the course',
  'roster.membersTitle': 'Members',
  'roster.membersCaption': 'People in {section}',
  'roster.columnName': 'Name',
  'roster.columnEmail': 'Email',
  'roster.columnRole': 'Role',
  'roster.columnActions': 'Actions',
  'roster.remove': 'Remove',
  'roster.removeLabel': 'Remove {name} from this section',
  'roster.removed': '{name} is out of this section.',
  'roster.membersEmptyTitle': 'Nobody is in this section yet',
  'roster.membersEmptyBody':
    'Add the people who will take this section’s assignments. A student needs a row here before a run can start.',
  'roster.truncated': 'The first {count} members are shown.',
  'roster.roleStudent': 'Student',
  'roster.roleInstructor': 'Instructor',
  'roster.roleTa': 'Teaching assistant',
  'roster.addTitle': 'Add member',
  'roster.addDescription':
    'Add someone by the address they sign in with. They must already belong to the institution.',
  'roster.addEmail': 'Email address',
  'roster.addRole': 'Role in this section',
  'roster.addSubmit': 'Add to section',
  'roster.added': '{email} is now in this section.',
  'roster.inviteAction': 'Invite to institution',
  'roster.invited': 'An invitation is on its way to {email}.',
  'roster.invitationsTitle': 'Invitations',
  'roster.invitationsDescription': 'An invitation lasts seven days and can be accepted once.',
  'roster.invitationsCaption': 'Outstanding invitations to this institution',
  'roster.invitationsExpires': 'Expires',
  'roster.invitationsEmptyTitle': 'No invitations yet',
  'roster.invitationsEmptyBody':
    'Invite an address that does not belong to the institution and the invitation appears here with the day it expires.',
  'roster.cancel': 'Cancel',
  'roster.columnStatus': 'Status',
  'roster.invitationPending': 'Pending',
  'roster.invitationExpired': 'Expired',
  'roster.removeConfirmTitle': 'Take this person off the roster?',
  'roster.removeConfirmBody':
    '{name} ({email}) comes off the roster of {section} and can no longer start its assignments. Nothing they have written is deleted, and you can add them back by address.',
  'roster.removeConfirmAction': 'Remove from section',
  'roster.removeConfirmPending': 'Removing…',
  'roster.inviteTitle': 'Invite to the institution',
  'roster.inviteDescription':
    'They get an email with a link that lasts seven days. Accepting it makes them a member of the institution; add them to this section afterwards.',
  'roster.inviteEmail': 'Email address',
  'roster.inviteRole': 'Role in the institution',
  'roster.inviteSubmit': 'Send invitation',
  'roster.invitePending': 'Sending…',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(roster)
