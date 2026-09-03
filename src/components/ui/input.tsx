import * as React from 'react'
import { Input as InputPrimitive } from '@base-ui/react/input'

import { cn } from '@/lib/cn'

// Themed per DESIGN.md §Inputs / Fields: 40 px, 6 px radius, paper-raised fill, line-control border,
// body type; focus turns the border primary and shows the outline (no glow); red border when invalid.
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        'border-line-control bg-paper-raised text-body text-ink placeholder:text-ink/70 file:text-meta file:text-ink focus-visible:border-primary focus-visible:outline-focus disabled:bg-paper-sunken aria-invalid:border-red h-10 w-full min-w-0 rounded-md border px-3 py-2 transition-colors duration-150 ease-out file:inline-flex file:h-6 file:border-0 file:bg-transparent file:font-medium focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
