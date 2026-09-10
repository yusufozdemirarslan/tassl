import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AccountMenuPopup } from '@/components/layout/account-menu-popup'
import { enUS } from '@/lib/i18n/en-US'

// The account menu (UI-008). Settings and sign-out were always here; the two legal pages join them
// so a signed-in person can reach Privacy and Terms without signing out to find the public footer.
// A menu item is reached from the keyboard like every other row, so nothing extra is needed.

const user = { name: 'Yusuf', email: 'y@example.edu' }

describe('AccountMenuPopup', () => {
  it('offers Privacy and Terms as menu items linking to the two legal pages', () => {
    render(
      <AccountMenuPopup
        user={user}
        open
        onOpenChange={vi.fn()}
        signOutPending={false}
        onSignOut={vi.fn(async () => {})}
      />,
    )
    const menu = screen.getByRole('menu')
    const privacy = screen.getByRole('menuitem', { name: enUS['shell.privacy'] })
    const terms = screen.getByRole('menuitem', { name: enUS['shell.terms'] })
    expect(menu).toContainElement(privacy)
    expect(menu).toContainElement(terms)
    expect(privacy).toHaveAttribute('href', '/privacy')
    expect(terms).toHaveAttribute('href', '/terms')
    // The rows a person already expects are still there, in order: settings, legal, sign out.
    const names = screen.getAllByRole('menuitem').map((item) => item.textContent)
    expect(names).toEqual([
      enUS['shell.settings'],
      enUS['shell.privacy'],
      enUS['shell.terms'],
      enUS['shell.signOut'],
    ])
  })
})
