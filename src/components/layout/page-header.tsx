import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

type PageHeaderProps = {
  title: string
  description?: string | undefined
  eyebrow?: ReactNode
  actions?: ReactNode
  className?: string | undefined
}

// Serif page title (the page's single h1; focus lands here on route change), optional
// description, and the page-level actions on the right.
export function PageHeader({ title, description, eyebrow, actions, className }: PageHeaderProps) {
  return (
    <header className={cn('mb-6 flex flex-wrap items-end justify-between gap-4', className)}>
      <div className="min-w-0">
        {eyebrow && <div className="text-ink-muted text-meta mb-1">{eyebrow}</div>}
        <h1 id="page-title" tabIndex={-1} className="text-h1 outline-none">
          {title}
        </h1>
        {description && <p className="text-ink-muted text-body mt-2 max-w-[72ch]">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}
