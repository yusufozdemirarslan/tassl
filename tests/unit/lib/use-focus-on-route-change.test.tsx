import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

let pathname = '/home'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))

import { useFocusOnRouteChange } from '@/lib/hooks/use-focus-on-route-change'

function Page({ title }: { title: string }) {
  useFocusOnRouteChange()
  return (
    <main id="main" tabIndex={-1}>
      <h1 id="page-title" tabIndex={-1}>
        {title}
      </h1>
    </main>
  )
}

describe('useFocusOnRouteChange', () => {
  afterEach(() => {
    pathname = '/home'
  })

  it('leaves focus alone on the first render', () => {
    render(<Page title="Home" />)
    expect(document.activeElement).toBe(document.body)
  })

  it('moves focus to the page title after the pathname changes', () => {
    const { rerender } = render(<Page title="Home" />)
    pathname = '/runs'
    rerender(<Page title="Runs" />)
    expect(document.activeElement).toBe(document.getElementById('page-title'))
  })

  it('falls back to main when there is no page title', () => {
    function Bare() {
      useFocusOnRouteChange()
      return <main id="main" tabIndex={-1} />
    }
    const { rerender } = render(<Bare />)
    pathname = '/settings'
    rerender(<Bare />)
    expect(document.activeElement).toBe(document.getElementById('main'))
  })
})
