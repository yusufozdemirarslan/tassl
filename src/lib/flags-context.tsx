'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { Flags } from './flags'

const FlagsContext = createContext<Flags | null>(null)

export function FlagsProvider({ flags, children }: { flags: Flags; children: ReactNode }) {
  return <FlagsContext.Provider value={flags}>{children}</FlagsContext.Provider>
}

export function useFlags(): Flags {
  const flags = useContext(FlagsContext)
  if (flags === null) throw new Error('useFlags must be rendered inside <FlagsProvider>')
  return flags
}
