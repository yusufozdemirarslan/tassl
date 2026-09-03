import { act, render, screen } from '@testing-library/react'
import { toast } from 'sonner'
import { describe, expect, it } from 'vitest'
import { Toaster } from '@/components/ui/sonner'

describe('Toaster', () => {
  it('labels the toast region through t() and stays on the light theme', async () => {
    render(<Toaster />)
    expect(screen.getByRole('region', { name: /^Messages/ })).toBeInTheDocument()

    // The list mounts with its first toast.
    act(() => {
      toast('Draft saved', { description: 'Autosaved at 14:02:11' })
    })
    await screen.findByText('Draft saved')

    const list = document.querySelector('[data-sonner-toaster]')
    expect(list).toHaveAttribute('data-sonner-theme', 'light')
    expect(list?.className).toContain('font-sans')
    expect(list?.className).not.toMatch(/dark|cn-toast/)

    const item = document.querySelector('[data-sonner-toast]')
    expect(item?.className).toContain('bg-paper-raised')
    expect(item?.className).toContain('text-ink')
    expect(item?.className).not.toMatch(/cn-toast|zinc|black|gray-/)
    expect(screen.getByText('Autosaved at 14:02:11').className).toContain('text-ink-muted')
  })
})
