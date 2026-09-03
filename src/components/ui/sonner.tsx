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

import { t } from '@/lib/i18n/t'

// One theme only (D-025): the toaster is always light and takes the product tokens. globals.css
// gives [data-sonner-toast] the Plex face and the float shadow.
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group font-sans"
      containerAriaLabel={t('toast.region')}
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
