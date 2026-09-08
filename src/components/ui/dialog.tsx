'use client'

import * as React from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'

import { cn } from '@/lib/cn'
import { t } from '@/lib/i18n/messages/ui'
import { Button } from '@/components/ui/button'
import { XIcon } from 'lucide-react'

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  // Scrims are ink at 10 % (DESIGN.md §Components "Control heights").
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        'data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 bg-ink/10 fixed inset-0 isolate z-50 duration-200 ease-out supports-backdrop-filter:backdrop-blur-xs',
        className,
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          // Dialog recipe (DESIGN.md §Shapes, §Elevation): 10 px radius, hairline, float shadow, 24 px padding.
          //
          // `max-h-[calc(100dvh-2rem)] overflow-y-auto` is the vertical twin of the
          // `max-w-[calc(100%-2rem)]` beside it, and it belongs to the primitive rather than to
          // the dialogs that remembered it (D-622). A `fixed` box centred with `-translate-y-1/2`
          // and no height bound does not overflow its parent — it overflows the *viewport*, off
          // both ends at once, and nothing scrolls: the read-back before the Decision Lock lists a
          // recommendation, a rationale, three assumptions, a change-my-mind line, a confidence and
          // the named figures, and on a 360 × 780 phone its "Lock it" button was below the bottom
          // edge with no way to reach it. Five of the twenty-four dialogs in the app had written
          // the guard by hand; the other nineteen had not.
          'bg-paper-raised text-ink border-line shadow-float data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 text-body fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border p-6 duration-200 ease-out outline-none sm:max-w-sm',
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          // 32 px is the visual size the corner wants; 40 px is the target DESIGN.md §Layout sets
          // as the minimum. `after:-inset-1` grows the hit area by 4 px on each edge without
          // moving a pixel of the button, the same way the concept chips' remove control does.
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-4 right-4 after:absolute after:-inset-1"
                size="icon-sm"
              />
            }
          >
            <XIcon />
            <span className="sr-only">{t('ui.close')}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="dialog-header" className={cn('flex flex-col gap-2', className)} {...props} />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      // Whitespace and one full-bleed hairline, never a filled well: a tinted, rounded, bordered
      // strip inside the raised-paper dialog is a card inside a card, which DESIGN.md's One-Layer
      // Rule bans outright (D-316). The rule still separates the actions from the form above it;
      // the negative inline margins are what carry it to the dialog's own edges.
      className={cn(
        'border-line -mx-6 flex flex-col-reverse gap-2 border-t px-6 pt-4 sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="secondary" />}>
          {t('ui.close')}
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      // `pr-8` keeps the title clear of the close button above it: at 360 px the dialog is 328 px
      // wide with 24 px of padding, and a title that wrapped ran under the X with 24 px of overlap.
      className={cn('text-h4 text-ink pr-8 font-serif font-medium', className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-body text-ink-muted *:[a]:underline *:[a]:underline-offset-2', className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
