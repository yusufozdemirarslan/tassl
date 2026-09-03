import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

type PanelProps = {
  title?: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
  /** Padding for writing surfaces is wider (DESIGN.md §Layout). */
  padding?: 'default' | 'reading'
  id?: string
}

// The one container (DESIGN.md §Components → Panels): raised paper, hairline border, no shadow,
// never nested inside another Panel. Sections inside are separated by whitespace and h4s.
export function Panel({
  title,
  description,
  actions,
  children,
  className,
  padding = 'default',
  id,
}: PanelProps) {
  return (
    <section
      id={id}
      className={cn(
        'border-line bg-paper-raised text-ink rounded-md border',
        padding === 'reading' ? 'p-6' : 'p-4',
        className,
      )}
      aria-labelledby={title && id ? `${id}-title` : undefined}
    >
      {(title || actions) && (
        <div className="mb-3 flex items-start justify-between gap-4">
          <div className="min-w-0">
            {title && (
              <h3 id={id ? `${id}-title` : undefined} className="text-h3">
                {title}
              </h3>
            )}
            {description && <p className="text-ink-muted text-body mt-1">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}
