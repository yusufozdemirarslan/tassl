import type { RailItem } from '@/components/layout/rail'
import { t } from '@/lib/i18n/t'
import type { OrganizationRole, PlatformRole } from '@/server/modules/identity/schema'

// Which primary-navigation items a person may see (UI-008). Hiding an item is a courtesy: every
// route behind it re-checks the same roles server-side (08 §5), so this decides what is offered,
// never what is allowed.

export type RailKey = 'home' | 'runs' | 'courses' | 'review' | 'packages' | 'admin'

export type RailAudience = {
  /** The organization roles the person holds, across every institution they belong to. */
  roles: readonly OrganizationRole[]
  platformRole: PlatformRole
}

/**
 * The full UI-008 rule, including the destinations later phases add. Home is unconditional, so a
 * person with no membership still has one place to stand (the zero-membership state of UI-009).
 */
export function permittedRailKeys({ roles, platformRole }: RailAudience): RailKey[] {
  const has = (role: OrganizationRole): boolean => roles.includes(role)
  const keys: RailKey[] = ['home']
  // Runs: the institution seat today; Phase 4 narrows it to a section membership as student, which
  // is the roster row UI-008 names and no table holds yet.
  if (has('student')) keys.push('runs')
  if (has('instructor') || has('program_lead')) keys.push('courses')
  if (has('instructor') || has('teaching_assistant')) keys.push('review')
  // Packages: an instructor authors and confirms them exactly as a scenario author does — 08 §4
  // gives both the author column, `requireAuthorOnPackage` admits both, and the seeded instructor
  // is the authority who confirmed the fixture. Offering the destination only to the dedicated
  // seat hid the shelf from the person who owns it.
  // A platform editor is not admitted by the platform role alone: 08 §4 gives them the author
  // column "in any org where the editor has a scenario_author membership", and `listPackages`
  // refuses anyone without that seat. Offering a destination the service turns away is worse than
  // not offering it, so the membership decides here too.
  if (has('instructor') || has('scenario_author')) keys.push('packages')
  if (platformRole === 'admin') keys.push('admin')
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
