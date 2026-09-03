import * as React from 'react'

import { cn } from '@/lib/cn'

// Label type (13/20 weight 500) from DESIGN.md §Typography; disabled controls dim their label to 45 %.
function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    <label
      data-slot="label"
      className={cn(
        'text-meta flex items-center gap-2 font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-45 peer-disabled:cursor-not-allowed peer-disabled:opacity-45',
        className,
      )}
      {...props}
    />
  )
}

export { Label }
