import type { AccountUser } from '@/components/layout/account-menu'
import type { Institution } from '@/components/layout/institution-switcher'
import type { RailItem } from '@/components/layout/rail'
import { t } from '@/lib/i18n/t'

// Phase 1 shell inputs, shared by the (app) layout and the pages that branch on them (UI-008,
// UI-009): the zero-membership state with Home only. Phase 3 replaces this module with
// session-derived data: requireSession(), memberships, the unread count, and the permitted rail
// items.
export const RAIL: RailItem[] = [{ href: '/home', label: t('nav.home'), icon: 'home' }]
export const INSTITUTIONS: Institution[] = []
export const UNREAD_COUNT = 0
export const USER: AccountUser | null = null
