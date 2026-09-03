import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { t } from '@/lib/i18n/t'

type ErrorStateProps = {
  title?: string
  message: string
  /** The request id or error digest shown in mono as the support reference. */
  requestId?: string | undefined
  /** 1 when the error view is the page (root boundaries), 3 inside a panel. */
  headingLevel?: 1 | 3
  action?: ReactNode
  className?: string
}

// Plain message, the reference in mono, one retry action (DESIGN.md §Components).
export function ErrorState({
  title,
  message,
  requestId,
  action,
  className,
  headingLevel = 3,
}: ErrorStateProps) {
  const heading = title ?? t('error.title')
  return (
    <div role="alert" className={cn('flex flex-col items-start gap-3 py-6', className)}>
      {headingLevel === 1 ? (
        <h1 id="page-title" tabIndex={-1} className="text-h2 outline-none">
          {heading}
        </h1>
      ) : (
        <h3 className="text-h3">{heading}</h3>
      )}
      <p className="text-ink text-body max-w-[60ch]">{message}</p>
      {requestId && (
        <p className="text-ink-muted text-meta">
          {t('error.reference')}
          {': '}
          <code className="text-mono text-ink font-mono">{requestId}</code>
        </p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
