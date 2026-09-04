import type { ReactNode } from 'react'
import { FocusOnRouteChange } from '@/components/layout/focus-on-route-change'
import { t } from '@/lib/i18n/t'

// Public routes (sign-in, sign-up, verification, legal): one centered card on the paper ground.
// The brand is a `header` beside `main` rather than inside it, so it is the page's banner landmark
// and `main` starts at the screen's own heading (DESIGN.md §Navigation → Header).
// Phase 3 adds the Toaster here when its forms need it (D-156).
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bg-paper text-ink flex min-h-dvh flex-col">
      <header className="flex justify-center px-4 pt-12 md:px-6">
        <p className="text-h4 font-serif font-semibold">{t('shell.brand')}</p>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="flex flex-1 flex-col items-center justify-center px-4 py-12 outline-none md:px-6"
      >
        <FocusOnRouteChange />
        {/* The card is capped at the 420 px of 09 §UI-001 and stays a single column at every width. */}
        <div className="border-line bg-paper-raised w-full max-w-[420px] rounded-md border p-6">
          {children}
        </div>
      </main>
    </div>
  )
}
