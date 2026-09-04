'use client'

import { type KeyboardEvent, useCallback, useEffect, useState } from 'react'
import { useDeferredModule } from '@/lib/hooks/use-deferred-module'
import { t } from '@/lib/i18n/t'

// B4 / NFR-013 (16 §3.2). The header's two menus (UI-008) open on a press, so the Base UI menu,
// its positioner and everything the popup holds are fetched on that press instead of on every
// route in the group: they were 89 KB of gzip that the shell downloaded before anyone had clicked
// anything, on a header whose first paint is a wordmark, a name, a bell and an avatar.
//
// What stays in the entry bundle is the trigger itself — a real button with the same label, the
// same accessible name, `aria-haspopup="menu"` and `aria-expanded="false"` — so the header is
// complete and keyboard operable from the first paint. The press sets `open` and starts the
// import; when the module arrives it renders the Base UI menu already open, and Base UI moves
// focus into the popup and returns it to the trigger on Escape, as it does for a menu opened the
// ordinary way. The one difference is the very first ArrowDown or ArrowUp: focus lands on the
// popup rather than on the first or last item, and every press afterwards is Base UI's own.
//
// A failed import (an offline moment, a deployment that moved the file) must not leave a control
// that does nothing: the failure is said out loud through the toaster the shell already mounts
// (D-156) and the next press retries the import. `import('sonner')` resolves from the module cache
// the ToasterClient filled after hydration, so it asks the network for nothing and costs the entry
// bundle nothing.
function announceMenuLoadFailure(): void {
  void import('sonner').then(
    ({ toast }) => {
      toast.error(t('ui.menuLoadFailed'))
    },
    () => {
      // The toaster itself never arrived either; the trigger still retries on the next press.
    },
  )
}

/** What the shell paints on the trigger until the menu's own code has arrived. */
export type DeferredMenuTriggerProps = {
  'aria-haspopup': 'menu'
  'aria-expanded': false
  'aria-busy': boolean
  onClick: () => void
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
}

export type DeferredMenu<T extends object> = {
  /** The menu's module once it has arrived; null until then, and after a failed import. */
  loaded: T | null
  /** Whether the menu should be open — set by the press that started the import. */
  open: boolean
  setOpen: (open: boolean) => void
  triggerProps: DeferredMenuTriggerProps
}

/**
 * Loads a header menu on the first press. `load` must be a module-scope arrow holding a literal
 * `import()` — the bundler matches the call site to the chunk, so a variable path would not split.
 */
export function useDeferredMenu<T extends object>(load: () => Promise<T>): DeferredMenu<T> {
  const { loaded, status, request } = useDeferredModule(load)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (status === 'failed') announceMenuLoadFailure()
  }, [status])

  const openMenu = useCallback(() => {
    setOpen(true)
    request()
  }, [request])

  return {
    loaded,
    open,
    setOpen,
    triggerProps: {
      'aria-haspopup': 'menu',
      'aria-expanded': false,
      'aria-busy': status === 'loading',
      onClick: openMenu,
      onKeyDown: (event) => {
        // Base UI opens a menu on ArrowDown and ArrowUp as well as on Enter and Space; the native
        // button gives us the last two as clicks, so only the arrows need saying.
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          openMenu()
        }
      },
    },
  }
}
