// Email templates (SYS-001, SYS-005, INT-003; src/server/email/templates)
import { scopedT } from '../scoped'

export const email = {
  'email.greeting': 'Hello {name},',
  'email.linkFallback': 'If the button does not work, paste this link into your browser:',
  'email.footer': 'Tassl sends this message because your institution runs its decision runs here.',
  'email.verify.subject': 'Confirm your email address for Tassl',
  'email.verify.preview': 'Confirm your email address to finish setting up your Tassl account.',
  'email.verify.heading': 'Confirm your email address',
  'email.verify.body':
    'Confirm this address to finish setting up your Tassl account. The link works for 24 hours.',
  'email.verify.cta': 'Confirm email address',
  'email.verify.ignore':
    'If you did not create a Tassl account, ignore this message and nothing happens.',
  'email.reset.subject': 'Reset your Tassl password',
  'email.reset.preview': 'Choose a new password for your Tassl account.',
  'email.reset.heading': 'Reset your password',
  'email.reset.body':
    'Choose a new password for your Tassl account. The link works for one hour, and setting a new password signs out every other session.',
  'email.reset.cta': 'Choose a new password',
  'email.reset.ignore':
    'If you did not ask to reset your password, ignore this message; your password stays as it is.',
  'email.invitation.subject': '{inviterName} invited you to {organizationName} on Tassl',
  'email.invitation.preview': 'Accept your invitation to {organizationName} on Tassl.',
  'email.invitation.heading': 'You are invited to {organizationName}',
  'email.invitation.body':
    '{inviterName} invited you to join {organizationName} on Tassl. Accept the invitation with this email address; it expires in seven days.',
  'email.invitation.role': 'Your role: {role}',
  'email.invitation.cta': 'Accept the invitation',
  'email.notification.subject': '{title} · Tassl',
  'email.notification.preview': 'An update from Tassl: {title}',
  'email.notification.cta': 'Open in Tassl',
  'email.notification.footer':
    'This is an email copy of a Tassl notification. Email copies can be turned off in your account settings.',
  'email.incident.subject': 'Tassl notice · {title}',
  'email.incident.preview': 'An incident notice from Tassl: {title}',
  'email.incident.cta': 'Read the status page',
  'email.incident.footer':
    'This notice goes to everyone affected. It names no one else and makes no judgement about anyone.',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(email)
