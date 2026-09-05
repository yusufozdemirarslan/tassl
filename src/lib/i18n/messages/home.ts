// Home (UI-009)
import { scopedT } from '../scoped'

export const home = {
  'home.title': 'Home',
  'home.description': 'What needs your attention, and what is coming up.',
  'home.runsTitle': 'Your runs',
  'home.emptyTitle': 'Nothing to do yet',
  'home.emptyBody':
    'When a course assigns you a run, or a run is waiting for your review, it appears here.',
  'home.noMembershipsTitle': 'Waiting for an invitation',
  'home.noMemberships':
    'An institution adds you by an invitation email; once you accept it, your courses and runs appear here.',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(home)
