import type { RailItem } from '@/components/layout/rail'
import { t } from '@/lib/i18n/t'
import type { PlatformRole } from '@/server/modules/identity/schema'

// Which primary-navigation items a person may see (UI-008). Hiding an item is a courtesy: every
// route behind it re-checks the same role server-side (08 §5), so this decides what is offered,
// never what is allowed.

export type RailKey = 'home' | 'runs' | 'courses' | 'review' | 'packages' | 'admin'

export type RailAudience = {
  /** The one role the account holds (D-748); memberships say where, never what. */
  platformRole: PlatformRole
}

/**
 * The full UI-008 rule, derived from the platform role alone (D-748). Home is unconditional, so a
 * person with no membership still has one place to stand (the zero-membership state of UI-009).
 *
 *   Student          — Home, Runs
 *   Scenario Editor  — Home, Runs, Packages (a Student's access, plus authoring)
 *   Instructor       — Home, Courses, Review, Packages (read, to assign and review)
 *   Platform Admin   — every destination
 */
export function permittedRailKeys({ platformRole }: RailAudience): RailKey[] {
  const admin = platformRole === 'admin'
  const keys: RailKey[] = ['home']
  if (admin || platformRole === 'student' || platformRole === 'tassl_scenario_editor') {
    keys.push('runs')
  }
  if (admin || platformRole === 'instructor') keys.push('courses', 'review')
  if (admin || platformRole === 'tassl_scenario_editor' || platformRole === 'instructor') {
    keys.push('packages')
  }
  if (admin) keys.push('admin')
  return keys
}

/**
 * The rail items whose routes exist. A permitted key with no route here is simply not rendered:
 * a rail link that 404s is worse than an absent one, so each destination joins the map in the step
 * that creates its page.
 *
 * `/courses` landed with Phase 4, step 4.2 (UI-030), `/packages` with Phase 5, step 5.4 (UI-040),
 * `/runs` with Phase 6, step 6.5 (UI-020), `/review` with Phase 11, step 11.4 (UI-034) and
 * `/admin/users` with Phase 13, step 13.5 (UI-050); `permittedRailKeys` above is what decides who
 * sees each. Admin points at its first section rather than at `/admin`, which is a prefix and not a
 * screen; `section` names that prefix, so the item stays lit on `/admin/flags` and `/admin/audit`
 * the way every other item does across the screens beneath it.
 *
 * Notifications and Settings are not rail items: they live in the bell and the account menu.
 */
const READY: Partial<Record<RailKey, RailItem>> = {
  home: { href: '/home', label: t('nav.home'), icon: 'home' },
  runs: { href: '/runs', label: t('nav.runs'), icon: 'runs' },
  courses: { href: '/courses', label: t('nav.courses'), icon: 'courses' },
  review: { href: '/review', label: t('nav.review'), icon: 'review' },
  packages: { href: '/packages', label: t('nav.packages'), icon: 'packages' },
  admin: { href: '/admin/users', label: t('nav.admin'), icon: 'admin', section: '/admin' },
}

export function railFor(audience: RailAudience): RailItem[] {
  return permittedRailKeys(audience).flatMap((key) => READY[key] ?? [])
}
