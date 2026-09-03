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

  // Label chips and sample data (FR-254)
  'label.draft': 'Draft',
  'label.confirmed': 'Confirmed',
  'label.uncalibrated': 'Uncalibrated',
  'label.walkthrough': 'Walkthrough',
  'label.provisional': 'Provisional',
  'label.unreviewed': 'Unreviewed',
  'sample.label': 'Illustrative sample data',
} as const

export type MessageKey = keyof typeof enUS
