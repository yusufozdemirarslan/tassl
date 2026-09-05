'use client'

import { useEffect } from 'react'
import { ErrorState } from '@/components/layout/error-state'
import { Button } from '@/components/ui/button'
import { t } from '@/lib/i18n/messages/error'

// UI-007: the root error boundary replaces the segment layouts, so it carries its own main
// landmark and h1 like not-found.tsx. `error.digest` is the reference the server logged with the
// request id; the body only asks the reader to quote it when it exists. Phase 13 forwards the
// error to Sentry.
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main
      id="main"
      tabIndex={-1}
      className="bg-paper text-ink flex min-h-dvh flex-col items-center justify-center px-4 py-12 outline-none"
    >
      {/* ErrorState carries the 24 px vertical padding, so the card matches not-found's p-6. */}
      <div className="border-line bg-paper-raised w-full max-w-md rounded-md border px-6">
        <ErrorState
          headingLevel={1}
          title={t('error.title')}
          message={error.digest ? t('error.body') : t('error.bodyNoReference')}
          requestId={error.digest}
          action={
            <Button variant="primary" onClick={() => reset()}>
              {t('error.retry')}
            </Button>
          }
        />
      </div>
    </main>
  )
}
