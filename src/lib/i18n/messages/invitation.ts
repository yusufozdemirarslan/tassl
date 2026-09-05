// Accept invitation (UI-005, SYS-005)
import { scopedT } from '../scoped'

export const invitation = {
  'invitation.title': 'Invitation',
  'invitation.heading': 'Join {name}',
  'invitation.body':
    '{name} invited you to Tassl. Accept and your courses, assignments, and runs there appear on your home page.',
  'invitation.roleLabel': 'Your role',
  'invitation.accept': 'Accept the invitation',
  'invitation.accepted': 'You are now a member of {name}.',
  'invitation.acceptFailed': 'The invitation was not accepted. Try again.',
  'invitation.expiredTitle': 'This invitation no longer works',
  'invitation.expiredBody':
    'Invitations last seven days and work once. Ask whoever invited you to send a new one.',
  'invitation.mismatchTitle': 'This invitation is for another address',
  'invitation.mismatchBody':
    'You are signed in as {email}. Sign in with the address the invitation was sent to, then open the link again.',
  'invitation.switchAccount': 'Sign out and use another account',
  'invitation.home': 'Go home',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(invitation)
