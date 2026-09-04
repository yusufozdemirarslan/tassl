'use client'

import { Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { t } from '@/lib/i18n/t'
import { useDeferredMenu } from './deferred-menu'
import { InstitutionTriggerContent, institutionTriggerClassName } from './header-menu-triggers'

export type Institution = { id: string; name: string }

type InstitutionSwitcherProps = {
  institutions: Institution[]
  activeId?: string | undefined
}

// The menu, the switch and its toast live in ./institution-menu and arrive on the press that opens
// them (B4, see ./deferred-menu): the header paints a name and a caret, and until someone presses
// it the Base UI menu is code nobody runs.
const loadMenu = () => import('./institution-menu')

// One institution: the name, no menu. Several: a radio menu whose trigger's accessible name
// contains the visible institution name (WCAG 2.5.3). None: an explanatory placeholder.
// Every branch truncates a long name (the full text stays in `title`) so the header never overflows.
//
// Switching writes the session's active organization (`setActiveInstitutionAction`) and then
// refreshes the tree: every server component in the group reads the session, so the whole page —
// rail, panels, lists — re-renders for the institution that is now active. The refusal is shown as
// a toast carrying the message from the action's error envelope, and the selection stays where it
// was, because nothing moved.
export function InstitutionSwitcher({ institutions, activeId }: InstitutionSwitcherProps) {
  const { loaded, open, setOpen, triggerProps } = useDeferredMenu(loadMenu)

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

  const InstitutionMenu = loaded?.InstitutionMenu
  if (InstitutionMenu) {
    return (
      <InstitutionMenu
        institutions={institutions}
        active={active}
        open={open}
        onOpenChange={setOpen}
      />
    )
  }

  return (
    <Button variant="ghost" className={institutionTriggerClassName} {...triggerProps}>
      <InstitutionTriggerContent name={active.name} busy={false} />
    </Button>
  )
}
