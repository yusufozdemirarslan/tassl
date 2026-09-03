import * as React from 'react'

import { cn } from '@/lib/cn'

/** Flattens a React node to its plain text (strings, numbers, and nested element children). */
function textOf(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return textOf(node.props.children)
  }
  return ''
}

/** The caption's text, when the table has one, so the scroll region can announce what it holds. */
function captionText(children: React.ReactNode): string | undefined {
  const caption = React.Children.toArray(children).find(
    (child) =>
      React.isValidElement(child) && (child.type === TableCaption || child.type === 'caption'),
  )
  const text = caption ? textOf(caption).trim() : ''
  return text.length > 0 ? text : undefined
}

// The scroll container is keyboard reachable (tabIndex 0, role region) so a wide table can be
// scrolled without a pointer, and it shows the focus recipe like every other focusable element.
function Table({ className, children, ...props }: React.ComponentProps<'table'>) {
  const label = captionText(children)
  return (
    <div
      data-slot="table-container"
      role="region"
      tabIndex={0}
      aria-label={label}
      className="focus-visible:outline-focus relative w-full overflow-x-auto rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <table
        data-slot="table"
        className={cn('text-body w-full caption-bottom', className)}
        {...props}
      >
        {children}
      </table>
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead data-slot="table-header" className={cn('[&_tr]:border-b', className)} {...props} />
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn('bg-paper-sunken border-t font-medium [&>tr]:last:border-b-0', className)}
      {...props}
    />
  )
}

// Rows only respond to hover when marked `data-interactive`; selected rows take the primary wash.
function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'data-interactive:hover:bg-paper-sunken has-aria-expanded:bg-paper-sunken data-[state=selected]:bg-primary-soft border-b transition-colors duration-150 ease-out',
        className,
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'text-meta text-ink h-10 px-2 text-left align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0',
        className,
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        'text-body p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0',
        className,
      )}
      {...props}
    />
  )
}

function TableCaption({ className, ...props }: React.ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('text-ink-muted text-meta mt-4', className)}
      {...props}
    />
  )
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption }
