'use client'

import { Building2, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { t } from '@/lib/i18n/t'

export type Institution = { id: string; name: string }

type InstitutionSwitcherProps = {
  institutions: Institution[]
  activeId?: string | undefined
  /** Wired to setActiveInstitutionAction in Phase 3; until then the switcher is display-only. */
  onSwitch?: ((id: string) => void) | undefined
}

// One institution: the name, no menu. Several: a radio menu whose trigger's accessible name
// contains the visible institution name (WCAG 2.5.3). None: an explanatory placeholder.
// Every branch truncates a long name (the full text stays in `title`) so the header never overflows.
export function InstitutionSwitcher({
  institutions,
  activeId,
  onSwitch,
}: InstitutionSwitcherProps) {
  const active = institutions.find((i) => i.id === activeId) ?? institutions[0]

  if (institutions.length === 0) {
    return (
      <span className="text-ink-muted text-meta inline-flex min-w-0 items-center gap-2 whitespace-nowrap">
        <Building2 aria-hidden="true" className="size-4 shrink-0" />
        <span className="min-w-0 truncate md:max-w-[40ch]" title={t('shell.noInstitution')}>
          {t('shell.noInstitution')}
        </span>
      </span>
    )
  }

  if (institutions.length === 1 || !active) {
    const name = active?.name ?? ''
    return (
      <span className="text-ink text-meta inline-flex min-w-0 items-center gap-2 font-medium whitespace-nowrap">
        <Building2 aria-hidden="true" className="size-4 shrink-0" />
        <span className="sr-only">{t('shell.institution')}</span>
        <span className="min-w-0 truncate md:max-w-[40ch]" title={name}>
          {name}
        </span>
      </span>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" className="min-w-0 shrink px-2 md:px-3" />}
      >
        <Building2 aria-hidden="true" className="size-4 shrink-0" />
        <span className="min-w-0 truncate md:max-w-[16ch] lg:max-w-[32ch]" title={active.name}>
          {active.name}
        </span>
        <span className="sr-only">{t('shell.switchInstitution')}</span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-max max-w-[min(24rem,calc(100vw-2rem))] min-w-(--anchor-width)"
      >
        <DropdownMenuRadioGroup value={active.id} onValueChange={(id) => onSwitch?.(String(id))}>
          {institutions.map((institution) => (
            <DropdownMenuRadioItem
              key={institution.id}
              value={institution.id}
              className="min-h-10 [overflow-wrap:anywhere]"
            >
              {institution.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
