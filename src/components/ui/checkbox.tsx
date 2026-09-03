'use client'

import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox'

import { cn } from '@/lib/cn'
import { CheckIcon } from 'lucide-react'

// 16 px box, 2 px radius, line-control border; the ::after pseudo widens the hit area to 40 px.
function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer border-line-control bg-paper-raised text-primary-ink data-checked:border-primary data-checked:bg-primary data-indeterminate:border-primary data-indeterminate:bg-primary focus-visible:outline-focus aria-invalid:border-red aria-invalid:aria-checked:border-primary relative flex size-4 shrink-0 items-center justify-center rounded-sm border transition-colors duration-150 ease-out group-has-disabled/field:opacity-45 after:absolute after:-inset-x-3 after:-inset-y-3 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-45',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-3.5"
      >
        <CheckIcon />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
