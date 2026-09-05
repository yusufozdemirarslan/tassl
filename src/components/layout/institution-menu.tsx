'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { t } from '@/lib/i18n/messages/shell'
import { setActiveInstitutionAction } from '@/server/modules/tenancy/actions'
import { InstitutionTriggerContent, institutionTriggerClassName } from './header-menu-triggers'
import type { Institution } from './institution-switcher'

type InstitutionMenuProps = {
  institutions: Institution[]
  /** The institution the header shows; the radio group's value. */
  active: Institution
  open: boolean
  onOpenChange: (open: boolean) => void
}

// The switcher's menu, and everything only a switch needs: the Base UI menu, the server action and
// the toast. It is imported on the press that opens it (B4, see ./deferred-menu) and it takes over
// the trigger from that point on, so the trigger is written once in ./header-menu-triggers and
// rendered here with the busy state a switch in flight puts it in.
//
// `open` is the press that asked for this module, so the menu mounts open; Base UI moves focus into
// the popup and hands it back to the trigger on Escape.
export function InstitutionMenu({
  institutions,
  active,
  open,
  onOpenChange,
}: InstitutionMenuProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [switching, setSwitching] = useState<string | null>(null)

  function switchTo(id: string): void {
    if (id === active.id) return
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

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" className={institutionTriggerClassName} aria-busy={pending} />
        }
      >
        <InstitutionTriggerContent name={active.name} busy={pending} />
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
