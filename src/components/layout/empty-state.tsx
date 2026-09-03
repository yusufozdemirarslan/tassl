import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

type EmptyStateProps = {
  title: string
  body: string
  action?: ReactNode
  className?: string
}

// One serif heading, one sentence, one action, inside the panel where content will appear.
// No illustration (DESIGN.md §Components → Empty and error states).
export function EmptyState({ title, body, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-start gap-3 py-6', className)}>
      <h3 className="text-h3">{title}</h3>
      <p className="text-ink-muted text-body max-w-[60ch]">{body}</p>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
