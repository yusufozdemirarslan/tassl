'use client'

import { Building2, ChevronDown, CircleUserRound, Loader2Icon } from 'lucide-react'
import { t } from '@/lib/i18n/t'

// The visible half of the header's two menu triggers (UI-008). Each is rendered twice: once as the
// plain button the shell paints before the menu's code has arrived (./deferred-menu) and once as
// the Base UI trigger that replaces it, and the two have to be the same control — so what they
// show is written once, here.

/** The switcher may shrink and truncate so that a long name never pushes the header sideways. */
export const institutionTriggerClassName = 'min-w-0 shrink px-2 md:px-3'

/**
 * The active institution, the label that tells a screen reader what pressing does (WCAG 2.5.3),
 * and the caret. `busy` is a switch in flight, which only the Base UI trigger can be in.
 */
export function InstitutionTriggerContent({ name, busy }: { name: string; busy: boolean }) {
  return (
    <>
      {busy ? (
        <Loader2Icon aria-hidden="true" className="size-4 shrink-0 animate-spin" />
      ) : (
        <Building2 aria-hidden="true" className="size-4 shrink-0" />
      )}
      <span className="min-w-0 truncate md:max-w-[16ch] lg:max-w-[32ch]" title={name}>
        {name}
      </span>
      <span className="sr-only">{t('shell.switchInstitution')}</span>
      <ChevronDown aria-hidden="true" className="size-4 shrink-0" />
    </>
  )
}

/** The account trigger is an icon, so the person's name is what names it. */
export function accountTriggerLabel(name: string): string {
  return `${t('shell.account')}: ${name}`
}

export function AccountTriggerContent() {
  return <CircleUserRound aria-hidden="true" className="size-5" />
}
