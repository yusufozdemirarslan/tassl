// Notifications (UI-011)
import { scopedT } from '../scoped'

export const notifications = {
  'notifications.title': 'Notifications',
  'notifications.description': 'What Tassl has told you, newest first.',
  'notifications.listLabel': 'Notifications',
  'notifications.markAllRead': 'Mark all read',
  'notifications.markRead': 'Mark read',
  'notifications.markReadLabel': 'Mark "{title}" read',
  'notifications.markedAllRead': 'Everything is marked read.',
  'notifications.loadMore': 'Load more',
  'notifications.unread': 'Unread',
  'notifications.open': 'Open',
  'notifications.emptyTitle': 'Nothing yet',
  'notifications.emptyBody':
    'Tassl writes here when a run is scored, a package finishes generating, or an instructor confirms your bands.',
  'notifications.notFound': 'That notification no longer exists.',
  'notifications.type.generation_complete': 'Package generated',
  'notifications.type.generation_failed': 'Generation failed',
  'notifications.type.run_scored': 'Run scored',
  'notifications.type.run_held': 'Run held for review',
  'notifications.type.bands_confirmed': 'Bands confirmed',
  'notifications.type.invitation': 'Invitation',
  'notifications.type.export_ready': 'Export ready',
  'notifications.type.package_confirmed': 'Package confirmed',
  'notifications.packageConfirmedTitle': 'A scenario package is ready to assign',
  'notifications.packageConfirmedBody':
    '{title} version {version} is confirmed and frozen, so it can be set on an assignment.',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(notifications)
