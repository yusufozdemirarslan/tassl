'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, ChevronDown, Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { t } from '@/lib/i18n/t'
import { setActiveInstitutionAction } from '@/server/modules/tenancy/actions'

export type Institution = { id: string; name: string }

type InstitutionSwitcherProps = {
  institutions: Institution[]
  activeId?: string | undefined
}

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
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [switching, setSwitching] = useState<string | null>(null)

  const active = institutions.find((i) => i.id === activeId) ?? institutions[0]

  function switchTo(id: string): void {
    if (id === active?.id) return
    setSwitching(id)
    startTransition(async () => {
      const result = await setActiveInstitutionAction({ orgId: id })
      setSwitching(null)
      if (!result.ok) {
        toast.error(result.error.message)
        return
      }
      toast.success(t('shell.institutionSwitched', { name: result.data.name }))
      router.refresh()
    })
  }

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
        render={
          <Button variant="ghost" className="min-w-0 shrink px-2 md:px-3" aria-busy={pending} />
        }
      >
        {pending ? (
          <Loader2Icon aria-hidden="true" className="size-4 shrink-0 animate-spin" />
        ) : (
          <Building2 aria-hidden="true" className="size-4 shrink-0" />
        )}
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
        <DropdownMenuRadioGroup
          value={active.id}
          onValueChange={(id) => {
            switchTo(String(id))
          }}
        >
          {institutions.map((institution) => (
            <DropdownMenuRadioItem
              key={institution.id}
              value={institution.id}
              disabled={pending}
              className="min-h-10 [overflow-wrap:anywhere]"
            >
              {institution.name}
              {switching === institution.id && (
                <Loader2Icon aria-hidden="true" className="size-4 shrink-0 animate-spin" />
              )}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
