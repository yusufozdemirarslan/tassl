// App shell (UI-008)
import { scopedT } from '../scoped'

export const shell = {
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

  // Shell wiring (UI-008, Step 3.5)
  'shell.institutionSwitched': 'Now working in {name}.',
  'shell.signOutFailed': 'Signing out did not work. Try again.',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(shell)
