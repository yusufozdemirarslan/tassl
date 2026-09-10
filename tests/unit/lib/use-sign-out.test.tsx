import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSignOut } from '@/lib/hooks/use-sign-out'
import { enUS } from '@/lib/i18n/en-US'

// The one sign-out every control shares (UI-008). Better Auth answers `{ error }` rather than
// throwing, so a hook that ignored the answer and pushed /sign-in sent a still-signed-in person to a
// screen whose first act is to bounce them back to /home. A refused sign-out stays on the page and
// says so through the toast, which is the only surface the calling control leaves behind.

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
const auth = vi.hoisted(() => ({ signOut: vi.fn() }))
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: router.push, refresh: router.refresh, replace: vi.fn() }),
}))
vi.mock('@/lib/auth-client', () => ({ authClient: { signOut: auth.signOut } }))
vi.mock('@/lib/analytics/client', () => ({ resetClient: vi.fn(async () => {}) }))
vi.mock('sonner', () => ({ toast: { success: toasts.success, error: toasts.error } }))

describe('useSignOut', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lands on /sign-in once Better Auth has revoked the session', async () => {
    auth.signOut.mockResolvedValue({ data: { success: true }, error: null })
    const { result } = renderHook(() => useSignOut())

    await act(() => result.current.signOut())

    expect(router.push).toHaveBeenCalledWith('/sign-in')
    expect(router.refresh).toHaveBeenCalled()
    expect(toasts.error).not.toHaveBeenCalled()
    expect(result.current.pending).toBe(false)
  })

  it('stays on the page and says so when Better Auth refuses', async () => {
    auth.signOut.mockResolvedValue({
      data: null,
      error: { status: 500, message: 'upstream', statusText: 'Internal Server Error' },
    })
    const { result } = renderHook(() => useSignOut())

    await act(() => result.current.signOut())

    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith(enUS['shell.signOutFailed']))
    expect(router.push).not.toHaveBeenCalled()
    expect(router.refresh).not.toHaveBeenCalled()
    expect(result.current.pending).toBe(false)
  })

  it('treats a request that never reached Better Auth the same way', async () => {
    auth.signOut.mockRejectedValue(new Error('network'))
    const { result } = renderHook(() => useSignOut())

    await act(() => result.current.signOut())

    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith(enUS['shell.signOutFailed']))
    expect(router.push).not.toHaveBeenCalled()
  })
})
