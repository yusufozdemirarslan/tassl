import type { ReactNode } from 'react'
import { FocusOnRouteChange } from '@/components/layout/focus-on-route-change'
import { t } from '@/lib/i18n/t'

// Public routes (sign-in, sign-up, verification, legal): one centered card on the paper ground.
// Phase 3 adds the Toaster here when its forms need it (D-156).
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <main
      id="main"
      tabIndex={-1}
      className="bg-paper text-ink flex min-h-dvh flex-col items-center justify-center px-4 py-12 outline-none"
    >
      <FocusOnRouteChange />
      <p className="text-h3 mb-6 font-serif font-semibold">{t('shell.brand')}</p>
      <div className="border-line bg-paper-raised w-full max-w-md rounded-md border p-6">
        {children}
      </div>
    </main>
  )
}
