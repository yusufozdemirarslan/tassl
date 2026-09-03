import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

const FORBIDDEN =
  /bg-black|ring-1|ring-foreground|shadow-md|shadow-lg|duration-100|ease-in-out|dark:|zinc|gray-|rounded-xl/

describe('Dialog', () => {
  it('uses the dialog recipe: 10 px radius, hairline, float shadow, ink scrim', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lock decision</DialogTitle>
            <DialogDescription>This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <span>actions</span>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Lock decision' })
    expect(dialog.className).toContain('rounded-lg')
    expect(dialog.className).toContain('border-line')
    expect(dialog.className).toContain('bg-paper-raised')
    expect(dialog.className).toContain('shadow-float')
    expect(dialog.className).toContain('p-6')
    expect(dialog.className).toContain('duration-200')
    expect(dialog.className).toContain('ease-out')
    expect(dialog.className).not.toMatch(FORBIDDEN)

    const overlay = document.querySelector('[data-slot="dialog-overlay"]')
    expect(overlay?.className).toContain('bg-ink/10')
    expect(overlay?.className).not.toMatch(FORBIDDEN)

    const title = screen.getByText('Lock decision')
    expect(title.tagName).toBe('H2')
    expect(title.className).toContain('text-h4')
    expect(title.className).toContain('font-serif')
    expect(screen.getByText('This cannot be undone.').className).toContain('text-ink-muted')

    const footer = document.querySelector('[data-slot="dialog-footer"]')
    expect(footer?.className).toContain('rounded-b-lg')
    expect(footer?.className).toContain('-mx-6')
  })
})

describe('AlertDialog', () => {
  it('uses the same recipe with an alertdialog role', () => {
    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard draft?</AlertDialogTitle>
            <AlertDialogDescription>The brief will be lost.</AlertDialogDescription>
          </AlertDialogHeader>
        </AlertDialogContent>
      </AlertDialog>,
    )
    const dialog = screen.getByRole('alertdialog', { name: 'Discard draft?' })
    expect(dialog.className).toContain('rounded-lg')
    expect(dialog.className).toContain('shadow-float')
    expect(dialog.className).toContain('bg-paper-raised')
    expect(dialog.className).not.toMatch(FORBIDDEN)
    expect(document.querySelector('[data-slot="alert-dialog-overlay"]')?.className).toContain(
      'bg-ink/10',
    )
    expect(screen.getByText('Discard draft?').className).toContain('text-h4')
    expect(screen.getByText('The brief will be lost.').className).toContain('text-ink-muted')
  })
})

describe('Sheet', () => {
  it('slides in on raised paper with the float shadow and ease-out', () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Evidence</SheetTitle>
            <SheetDescription>Documents for this claim.</SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>,
    )
    const sheet = screen.getByRole('dialog', { name: 'Evidence' })
    expect(sheet.className).toContain('bg-paper-raised')
    expect(sheet.className).toContain('border-line')
    expect(sheet.className).toContain('shadow-float')
    expect(sheet.className).toContain('ease-out')
    expect(sheet.className).not.toMatch(FORBIDDEN)
    expect(document.querySelector('[data-slot="sheet-overlay"]')?.className).toContain('bg-ink/10')
    expect(screen.getByText('Evidence').className).toContain('text-h4')
    expect(screen.getByText('Documents for this claim.').className).toContain('text-ink-muted')
  })
})
