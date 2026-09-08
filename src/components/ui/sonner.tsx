'use client'

import type { CSSProperties } from 'react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from 'lucide-react'

import { t } from '@/lib/i18n/messages/ui'

// One theme only (D-025): the toaster is always light and takes the product tokens. globals.css
// gives [data-sonner-toast] the Plex face and the float shadow.
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group font-sans"
      containerAriaLabel={t('toast.region')}
      // Clear of the app rail (D-625). sonner is `bottom-right` by default, and under 600 px it
      // goes full width at 16 px from the bottom edge with a z-index of 999999 — which is exactly
      // where the rail is on a phone: a fixed bottom bar 57 px tall at `z-20`. Every toast in the
      // product therefore covered the whole of primary navigation for its lifetime, and because a
      // toast is itself pointer-interactive, a tap aimed at "Runs" dismissed a message instead.
      // 5 rem is the number the shell already commits to for the same bar — `main`'s `pb-20` and
      // the `scroll-padding-bottom` in globals.css — so the toast clears it by the same measure
      // everything else does. Above 600 px sonner uses `offset`, where the bar does not exist.
      mobileOffset={{ bottom: '5rem', left: '1rem', right: '1rem' }}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--paper-raised)',
          '--normal-text': 'var(--ink)',
          '--normal-border': 'var(--line)',
          '--border-radius': 'var(--radius)',
        } as CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: 'font-sans text-body border-line bg-paper-raised text-ink',
          title: 'text-ink font-medium',
          description: 'text-ink-muted',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
