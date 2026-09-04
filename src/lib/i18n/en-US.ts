// Every user-facing string lives here (docs/tech/04-repo-structure.md, NFR-017, SYS-021).
// Keys are dot-separated by screen or module; values may carry {param} placeholders.
export const enUS = {
  'landing.title': 'Tassl',
  'landing.tagline': 'Make the call.',

  // Shared UI primitives
  'ui.close': 'Close',
  'ui.loading': 'Loading',
  'ui.more': 'More',
  'toast.region': 'Messages',

  // App shell (UI-008)
  'shell.brand': 'Tassl',
  'shell.titleTemplate': '%s · Tassl',
  'shell.skipToMain': 'Skip to main content',
  'shell.primaryNav': 'Primary',
  'shell.institution': 'Institution',
  'shell.switchInstitution': 'Switch institution',
  'shell.noInstitution': 'No institution yet',
  'shell.notifications': 'Notifications',
  'shell.notificationsUnread': '{count} unread',
  'shell.notificationsNone': 'No unread notifications',
  'shell.notificationsLabel': '{title}: {status}',
  'shell.notificationsOverflow': '{max}+',
  'shell.account': 'Account',
  'shell.settings': 'Settings',
  'shell.signOut': 'Sign out',
  'shell.notSignedIn': 'Not signed in',
  'nav.home': 'Home',
  'nav.runs': 'Runs',
  'nav.courses': 'Courses',
  'nav.review': 'Review',
  'nav.packages': 'Packages',
  'nav.admin': 'Admin',

  // Home (UI-009)
  'home.title': 'Home',
  'home.description': 'What needs your attention, and what is coming up.',
  'home.runsTitle': 'Your runs',
  'home.emptyTitle': 'Nothing to do yet',
  'home.emptyBody':
    'When a course assigns you a run, or a run is waiting for your review, it appears here.',
  'home.noMembershipsTitle': 'Waiting for an invitation',
  'home.noMemberships':
    'An institution adds you by an invitation email; once you accept it, your courses and runs appear here.',

  // Error pages (UI-007)
  'notFound.title': 'Not found',
  'notFound.body': 'There is nothing at this address. It may have moved, or the link may be wrong.',
  'notFound.home': 'Go home',
  'error.title': 'Something went wrong',
  'error.body': 'The problem has been recorded. If it continues, quote the reference below.',
  'error.bodyNoReference': 'The problem has been recorded. Try again, or come back in a moment.',
  'error.reference': 'Reference',
  'error.retry': 'Try again',

  // Email templates (SYS-001, SYS-005, INT-003; src/server/email/templates)
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

  // Label chips and sample data (FR-254)
  'label.draft': 'Draft',
  'label.confirmed': 'Confirmed',
  'label.uncalibrated': 'Uncalibrated',
  'label.walkthrough': 'Walkthrough',
  'label.provisional': 'Provisional',
  'label.unreviewed': 'Unreviewed',
  'sample.label': 'Illustrative sample data',

  // Account and identity (SYS-003, SYS-004, UI-010; src/server/modules/identity)
  'identity.exportFileName': 'tassl-my-data.json',
  'identity.accountNotFound': 'This account no longer exists.',
  'identity.confirmEmailMismatch': 'Type the email address of this account to confirm.',

  // Institutions, invitations, and data agreements (SYS-005, FR-234; src/server/modules/tenancy)
  'tenancy.invitationNotFound': 'This invitation has expired or has already been used.',
  'tenancy.invitationEmailUnverified':
    'Confirm your email address before accepting this invitation.',
  'tenancy.slugTaken': 'That institution address is already taken.',
  'tenancy.alreadyMember': 'That person is already a member of this institution.',
  'tenancy.alreadyInvited': 'That person already has an invitation to this institution.',
  'tenancy.programLeadNotFound':
    'No Tassl account uses {email}. The program lead needs an account before the institution is created.',
} as const

export type MessageKey = keyof typeof enUS
