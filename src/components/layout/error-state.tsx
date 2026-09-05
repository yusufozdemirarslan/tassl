import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { t } from '@/lib/i18n/messages/error'

type ErrorStateProps = {
  title?: string
  message: string
  /** The request id or error digest shown in mono as the support reference. */
  requestId?: string | undefined
  /** 1 when the error view is the page (root boundaries); 2 or 3 inside a panel under a page h1. */
  headingLevel?: 1 | 2 | 3
  action?: ReactNode
  className?: string
}

// Plain message, the reference in mono, one retry action (DESIGN.md §Components). The caller
// picks the message: `error.body` when a reference is shown, `error.bodyNoReference` otherwise.
// The page-level h1 is the Headline style (30/38, weight 500) and takes the same focus ring as
// PageHeader's h1, since route-change focus lands on it.
export function ErrorState({
  title,
  message,
  requestId,
  action,
  className,
  headingLevel = 3,
}: ErrorStateProps) {
  const heading = title ?? t('error.title')
  const Heading = `h${headingLevel}` as const
  return (
    <div role="alert" className={cn('flex flex-col items-start gap-3 py-6', className)}>
      {headingLevel === 1 ? (
        <h1
          id="page-title"
          tabIndex={-1}
          className="text-h2 focus-visible:outline-focus rounded-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {heading}
        </h1>
      ) : (
        <Heading className="text-h3">{heading}</Heading>
      )}
      <p className="text-ink text-body max-w-[60ch]">{message}</p>
      {requestId && (
        <p className="text-ink-muted text-meta max-w-full">
          {t('error.reference')}
          {': '}
          <code className="text-mono text-ink font-mono break-all">{requestId}</code>
        </p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
