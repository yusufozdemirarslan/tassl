'use client'

import { useEffect } from 'react'
import { ErrorState } from '@/components/layout/error-state'
import { Panel } from '@/components/layout/panel'
import { Button } from '@/components/ui/button'
import { t } from '@/lib/i18n/t'

// Error boundary for pages inside the app shell (09 §1: "shell skeleton; boundary"). The shell,
// its skip link, and focus management stay mounted; the page area shows the error state. The
// body only asks the reader to quote a reference when one exists.
export default function AppRouteError({
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
    <Panel className="mx-auto max-w-lg">
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
    </Panel>
  )
}
