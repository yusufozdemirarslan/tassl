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

  // ---------------------------------------------------------------------------------------------
  // The three role panels (UI-009)
  //
  // Each lands with the data it reports and is drawn only for a seat that has the data: a panel
  // whose read the service refuses is not rendered at all, rather than rendered empty. An empty
  // panel is a promise about a thing this person cannot do.
  // ---------------------------------------------------------------------------------------------
  'home.reviewTitle': 'Review',
  'home.reviewMore': 'Open the review queue',
  'home.reviewEmptyTitle': 'Nothing waiting',
  'home.reviewEmptyBody':
    'A run appears here once its bands have been drafted, or when nothing could place them and it needs a hand.',
  'home.reviewHeld': 'Needs a hand',
  'home.reviewDecisions': '{made} of 7 decided',
  'home.reviewOpen': 'Open the replay for {student}',

  'home.packagesTitle': 'Packages',
  'home.packagesMore': 'Open the shelf',
  'home.packagesEmptyTitle': 'Nothing to confirm',
  'home.packagesEmptyBody':
    'A package version appears here while its elements are still being confirmed. Build one from a seed case to start.',
  'home.packagesDraftVersion': 'Version {version}, in confirmation',
  'home.packagesOpen': 'Open {title}',

  'home.coursesTitle': 'Courses',
  'home.coursesMore': 'Open all courses',
  'home.coursesEmptyTitle': 'No course yet',
  'home.coursesEmptyBody': 'Create a course to hold sections, assignments and the band mapping.',
  'home.coursesCounts': '{sections} sections · {assignments} assignments',
  'home.coursesOpen': 'Open {name}',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(home)
