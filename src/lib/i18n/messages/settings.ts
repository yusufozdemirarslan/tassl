// Account settings (UI-010, SYS-003, SYS-004)
import { scopedT } from '../scoped'

export const settings = {
  'settings.title': 'Account settings',
  'settings.description': 'Your profile, your password and devices, and your data.',
  'settings.tabsLabel': 'Account settings sections',
  'settings.tabProfile': 'Profile',
  'settings.tabSecurity': 'Security',
  'settings.tabData': 'Data',
  'settings.profileTitle': 'Profile',
  'settings.profileDescription': 'The name your instructors and classmates see beside your work.',
  'settings.profileSave': 'Save changes',
  'settings.profileSaved': 'Your name is saved.',
  'settings.emailFixed':
    'Your institution knows you by this address, so it is not editable here. Ask your program lead if it needs to change.',
  'settings.security.passwordTitle': 'Password',
  'settings.security.passwordDescription':
    'Choosing a new password signs out every other device straight away.',
  'settings.security.currentPassword': 'Current password',
  'settings.security.submit': 'Change password',
  'settings.security.changed': 'Your password is changed. Other devices are signed out.',
  'settings.security.wrongPassword': 'That is not your current password.',
  'settings.security.sessionsTitle': 'Signed-in devices',
  'settings.security.sessionsDescription':
    'Every device holding a live session. Sign out any you do not recognise.',
  'settings.security.sessionsEmpty': 'No other device is signed in.',
  'settings.security.sessionsFailed': 'The device list could not be loaded.',
  'settings.security.thisDevice': 'This device',
  'settings.security.unknownDevice': 'Unknown device',
  'settings.security.signedIn': 'Signed in {value}',
  'settings.security.revoke': 'Sign out',
  'settings.security.revokeLabel': 'Sign out {device}',
  'settings.security.revoked': 'That device is signed out.',
  'settings.security.revokeOthers': 'Sign out every other device',
  'settings.security.revokedOthers': 'Every other device is signed out.',
  'settings.data.exportTitle': 'Download my data',
  'settings.data.exportDescription':
    'A JSON file holding your profile, your memberships, your runs, your notifications, and the actions you took. Twice an hour.',
  'settings.data.exportSubmit': 'Download my data',
  'settings.data.exportStarted': 'Your file is downloading.',
  'settings.data.exportFailed': 'The download did not start. Try again in a moment.',
  'settings.data.deleteTitle': 'Delete account',
  'settings.data.deleteDescription':
    'Your account closes immediately and is deleted 30 days later. Course records keep a pseudonymous copy of your runs so your institution can keep its grades; that copy carries no name and no email address.',
  'settings.data.deleteSubmit': 'Delete my account',
  'settings.data.deleteDialogTitle': 'Delete your account?',
  'settings.data.deleteDialogBody':
    'You are signed out straight away and cannot sign in again. After 30 days everything Tassl holds about you is deleted; the pseudonymous course record of your runs stays with your institution.',
  'settings.data.deleteConfirmLabel': 'Type {email} to confirm',
  'settings.data.deleteConfirm': 'Delete my account',
  'settings.data.deleteCancel': 'Keep my account',
  'settings.data.deleteFailed': 'The account was not deleted. Try again.',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(settings)
