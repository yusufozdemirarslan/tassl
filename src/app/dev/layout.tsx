import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { ToasterClient } from '@/components/layout/toaster-client'
import { TooltipProvider } from '@/components/ui/tooltip'
import { devRoutesEnabled } from '@/lib/dev-route'
import { env } from '@/server/config'

export const dynamic = 'force-dynamic'

// Guard for every /dev route: renders only when APP_ENV is local or test. The gallery carries its
// own toast and tooltip providers like the (app) layout does (D-156) and its own main landmark.
export default function DevLayout({ children }: { children: ReactNode }) {
  if (!devRoutesEnabled(env.APP_ENV)) notFound()
  return (
    <TooltipProvider>
      <main id="main" tabIndex={-1} className="bg-paper text-ink min-h-dvh px-6 py-8 outline-none">
        {children}
      </main>
      <ToasterClient />
    </TooltipProvider>
  )
}
