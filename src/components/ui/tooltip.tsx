'use client'

import * as React from 'react'
import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'

import { cn } from '@/lib/cn'

// Base UI 1.7 gives the popup no role and the trigger no aria-describedby. The root shares a
// generated id and its open state so the trigger can point at the popup while it is showing
// (WCAG 1.3.1; docs/tech/16-performance-a11y-budgets.md).
type TooltipState = { contentId: string; open: boolean }

const TooltipStateContext = React.createContext<TooltipState | null>(null)

function TooltipProvider({ delay = 0, ...props }: TooltipPrimitive.Provider.Props) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delay={delay} {...props} />
}

function Tooltip({ onOpenChange, ...props }: TooltipPrimitive.Root.Props) {
  const contentId = React.useId()
  const [internalOpen, setInternalOpen] = React.useState(props.defaultOpen ?? false)
  const open = props.open ?? internalOpen

  const handleOpenChange = React.useCallback<
    NonNullable<TooltipPrimitive.Root.Props['onOpenChange']>
  >(
    (nextOpen, eventDetails) => {
      setInternalOpen(nextOpen)
      onOpenChange?.(nextOpen, eventDetails)
    },
    [onOpenChange],
  )

  const state = React.useMemo<TooltipState>(() => ({ contentId, open }), [contentId, open])

  return (
    <TooltipStateContext.Provider value={state}>
      <TooltipPrimitive.Root data-slot="tooltip" onOpenChange={handleOpenChange} {...props} />
    </TooltipStateContext.Provider>
  )
}

function TooltipTrigger({
  'aria-describedby': ariaDescribedBy,
  ...props
}: TooltipPrimitive.Trigger.Props) {
  const state = React.useContext(TooltipStateContext)
  const describedBy = state?.open
    ? [ariaDescribedBy, state.contentId].filter(Boolean).join(' ')
    : ariaDescribedBy
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      aria-describedby={describedBy}
      {...props}
    />
  )
}

function TooltipContent({
  className,
  side = 'top',
  sideOffset = 4,
  align = 'center',
  alignOffset = 0,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<TooltipPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset'>) {
  const state = React.useContext(TooltipStateContext)
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          role="tooltip"
          id={state?.contentId}
          className={cn(
            // Ink on paper, 2 px radius, float shadow; a 150 ms fade with no scale (DESIGN.md §Motion).
            'bg-ink text-paper shadow-float data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 text-meta z-50 inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-2 rounded-sm px-2 py-1 duration-150 ease-out',
            className,
          )}
          {...props}
        >
          {children}
          <TooltipPrimitive.Arrow className="bg-ink fill-ink z-50 size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-sm data-[side=bottom]:top-1 data-[side=inline-end]:top-1/2! data-[side=inline-end]:-left-1 data-[side=inline-end]:-translate-y-1/2 data-[side=inline-start]:top-1/2! data-[side=inline-start]:-right-1 data-[side=inline-start]:-translate-y-1/2 data-[side=left]:top-1/2! data-[side=left]:-right-1 data-[side=left]:-translate-y-1/2 data-[side=right]:top-1/2! data-[side=right]:-left-1 data-[side=right]:-translate-y-1/2 data-[side=top]:-bottom-2.5" />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
