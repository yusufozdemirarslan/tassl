import * as React from 'react'

import { cn } from '@/lib/cn'

// Same recipe as Input (DESIGN.md §Inputs / Fields) with a 96 px minimum height; writing surfaces
// pass `text-reading` through className.
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'border-line-control bg-paper-raised text-body text-ink placeholder:text-ink/70 focus-visible:border-primary focus-visible:outline-focus disabled:bg-paper-sunken aria-invalid:border-red flex field-sizing-content min-h-24 w-full rounded-md border px-3 py-2 transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-45',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
