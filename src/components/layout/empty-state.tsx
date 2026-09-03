import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

type EmptyStateProps = {
  /** Omitted only when the page h1 already names the state (the in-shell not-found page). */
  title?: string
  body: string
  action?: ReactNode
  className?: string
  /** Element for the heading; the style stays the h3 "Title" size. 3 inside a titled panel. */
  headingLevel?: 2 | 3 | 4
}

// One serif heading, one sentence, one action, inside the panel where content will appear.
// No illustration (DESIGN.md §Components → Empty and error states).
export function EmptyState({ title, body, action, className, headingLevel = 3 }: EmptyStateProps) {
  const Heading = `h${headingLevel}` as const
  return (
    <div className={cn('flex flex-col items-start gap-3 py-6', className)}>
      {title && <Heading className={headingLevel === 2 ? 'text-h3' : 'text-h4'}>{title}</Heading>}
      <p className="text-ink-muted text-body max-w-[60ch]">{body}</p>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
