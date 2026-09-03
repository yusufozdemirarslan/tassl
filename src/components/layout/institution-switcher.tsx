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
export function InstitutionSwitcher({
  institutions,
  activeId,
  onSwitch,
}: InstitutionSwitcherProps) {
  const active = institutions.find((i) => i.id === activeId) ?? institutions[0]

  if (institutions.length === 0) {
    return (
      <span className="text-ink-muted text-meta inline-flex items-center gap-2">
        <Building2 aria-hidden="true" className="size-4" />
        {t('shell.noInstitution')}
      </span>
    )
  }

  if (institutions.length === 1 || !active) {
    return (
      <span className="text-ink text-meta inline-flex items-center gap-2 font-medium">
        <Building2 aria-hidden="true" className="size-4" />
        <span className="sr-only">{t('shell.institution')}</span>
        {active?.name}
      </span>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" />}>
        <Building2 aria-hidden="true" className="size-4" />
        <span className="max-w-[16ch] truncate">{active.name}</span>
        <span className="sr-only">{t('shell.switchInstitution')}</span>
        <ChevronDown aria-hidden="true" className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={active.id} onValueChange={(id) => onSwitch?.(String(id))}>
          {institutions.map((institution) => (
            <DropdownMenuRadioItem key={institution.id} value={institution.id}>
              {institution.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
