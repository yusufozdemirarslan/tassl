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
  /**
   * Element for the title; the style stays the h3 "Title" size (DESIGN.md §Typography). A panel
   * directly under the page h1 is an h2 so the outline never skips a level.
   */
  headingLevel?: 2 | 3 | 4
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
  headingLevel = 2,
}: PanelProps) {
  const Heading = `h${headingLevel}` as const
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
        <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1 basis-48">
            {title && (
              <Heading id={id ? `${id}-title` : undefined} className="text-h3 break-words">
                {title}
              </Heading>
            )}
            {description && <p className="text-ink-muted text-body mt-1">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}
