'use client'

import { useFocusOnRouteChange } from '@/lib/hooks/use-focus-on-route-change'

// Mounts the focus-management hook once inside the app shell (a server component).
export function FocusOnRouteChange() {
  useFocusOnRouteChange()
  return null
}
