import type { ReactNode } from 'react'
import Link from 'next/link'
import { FocusOnRouteChange } from '@/components/layout/focus-on-route-change'
import { t } from '@/lib/i18n/t'

// Public routes: the ground, the brand banner, `main`, and the legal footer. The brand is a
// `header` beside `main` rather than inside it, so it is the banner landmark of the page and `main`
// starts at the heading of the screen itself (DESIGN.md §Navigation → Header).
//
// Two shapes live under this group, and which one to draw is not a question this layout can answer:
// an auth screen is one 420 px card centred in the viewport (UI-001), a legal page is a document
// that runs from the top of `main` to the bottom of the reading (UI-006). A layout cannot see which
// route it is wrapping, so the card moved down into `(auth)/layout.tsx` and this one keeps what
// both need — which is also why `main` no longer centres its child: the group that wants centring
// does it itself (D-573).
//
// The footer is here rather than in either child because both need it, and a visitor who lands on
// /privacy must be able to reach /terms. It is `contentinfo` on every public screen and the only
// route out of the legal pages for someone with no account.
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bg-paper text-ink flex min-h-dvh flex-col">
      <header className="flex justify-center px-4 pt-12 md:px-6">
        {/* A link, not a heading: /privacy and /terms are read by people with no account and by
            people signed in, and `/` sends each of them where they belong (09 §1). Without it the
            two legal pages link only to each other, which is a room with no door. */}
        <Link
          href="/"
          className="text-h4 focus-visible:outline-focus rounded-sm font-serif font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {t('shell.brand')}
        </Link>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="flex flex-1 flex-col px-4 py-12 outline-none md:px-6"
      >
        <FocusOnRouteChange />
        {children}
      </main>
      <footer className="text-ink-muted text-meta flex flex-wrap items-center justify-center gap-x-4 gap-y-2 px-4 pb-8 md:px-6">
        <Link
          href="/privacy"
          className="focus-visible:outline-focus rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {t('legal.privacyTitle')}
        </Link>
        <Link
          href="/terms"
          className="focus-visible:outline-focus rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {t('legal.termsTitle')}
        </Link>
      </footer>
    </div>
  )
}
