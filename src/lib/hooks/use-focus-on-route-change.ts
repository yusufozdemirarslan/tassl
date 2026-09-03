'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'

// After a client-side navigation, move focus to the page title (or main) so screen-reader and
// keyboard users land on the new content (09-frontend-spec.md §6). The first render is skipped so
// the initial focus stays where the browser put it.
export function useFocusOnRouteChange(): void {
  const pathname = usePathname()
  const previous = useRef<string | null>(null)

  useEffect(() => {
    if (previous.current !== null && previous.current !== pathname) {
      const target =
        document.getElementById('page-title') ??
        document.querySelector<HTMLElement>('main h1') ??
        document.getElementById('main')
      target?.focus({ preventScroll: false })
    }
    previous.current = pathname
  }, [pathname])
}
