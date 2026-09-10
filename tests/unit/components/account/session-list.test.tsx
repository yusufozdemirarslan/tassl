import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionList } from '@/components/features/account/session-list'
import { enUS } from '@/lib/i18n/en-US'

// UI-010 Security → "Signed-in devices". Better Auth stores the User-Agent header on the session;
// the row names the device the way a person would ("Chrome on Windows") and keeps the raw header
// on the row's title for whoever knows what to make of it. A header that names nothing this
// recognises is "Unknown device", never a hundred characters of tokens.

const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1'

const auth = vi.hoisted(() => ({
  listSessions: vi.fn(),
  getSession: vi.fn(),
  revokeSession: vi.fn(),
  revokeOtherSessions: vi.fn(),
}))

vi.mock('@/lib/auth-client', () => ({ authClient: auth }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

describe('SessionList (UI-010)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.listSessions.mockResolvedValue({
      data: [
        {
          token: 'this-one',
          userAgent: CHROME_WINDOWS,
          ipAddress: '10.0.0.4',
          createdAt: '2026-09-01T10:00:00.000Z',
        },
        {
          token: 'phone',
          userAgent: SAFARI_IPHONE,
          ipAddress: null,
          createdAt: '2026-09-02T10:00:00.000Z',
        },
        { token: 'bare', userAgent: null, ipAddress: null, createdAt: '2026-09-03T10:00:00.000Z' },
      ],
      error: null,
    })
    auth.getSession.mockResolvedValue({ data: { session: { token: 'this-one' } }, error: null })
  })

  it('names each device by browser and platform, with the raw header on the title', async () => {
    render(<SessionList />)

    const chrome = await screen.findByText('Chrome on Windows')
    expect(chrome).toHaveAttribute('title', CHROME_WINDOWS)
    const safari = screen.getByText('Safari on iOS')
    expect(safari).toHaveAttribute('title', SAFARI_IPHONE)
    // The header itself is never the visible text of the row.
    expect(screen.queryByText(CHROME_WINDOWS)).not.toBeInTheDocument()
    expect(screen.queryByText(SAFARI_IPHONE)).not.toBeInTheDocument()
  })

  it('says "Unknown device" for a session with no header, and gives it no title', async () => {
    render(<SessionList />)

    const unknown = await screen.findByText(enUS['settings.security.unknownDevice'])
    expect(unknown).not.toHaveAttribute('title')
  })

  it('names the device in the revoke control as it is named on the row', async () => {
    render(<SessionList />)

    await screen.findByText('Safari on iOS')
    expect(screen.getByRole('button', { name: 'Sign out Safari on iOS' })).toBeInTheDocument()
    // This device carries the badge and no revoke control.
    expect(screen.getByText(enUS['settings.security.thisDevice'])).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Sign out Chrome on Windows' }),
    ).not.toBeInTheDocument()
  })
})
