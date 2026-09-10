// `useRefresh` (D-709): one `router.refresh()` in flight at a time, and one more afterwards for
// everything asked for while it flew.
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}))

import { resetRefreshState, useRefresh } from '@/lib/hooks/use-refresh'

beforeEach(() => {
  refresh.mockReset()
  resetRefreshState()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useRefresh', () => {
  it('starts one refresh for the first call and coalesces the calls made while it flies', async () => {
    const { result } = renderHook(() => useRefresh())
    await act(async () => {
      result.current()
      result.current()
      result.current()
    })
    // The first call flew; the two behind it became one more refresh once the flight settled.
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('refreshes once per call when the calls do not overlap', async () => {
    const { result } = renderHook(() => useRefresh())
    await act(async () => {
      result.current()
    })
    await act(async () => {
      result.current()
    })
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('treats a flight older than the stale bound as over, so an unmounted starter cannot block the page', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-09T12:00:00Z'))
    const first = renderHook(() => useRefresh())
    // Start a flight and unmount before its transition can settle the module state.
    act(() => {
      first.result.current()
    })
    first.unmount()
    vi.setSystemTime(new Date('2026-09-09T12:00:06Z'))
    const second = renderHook(() => useRefresh())
    await act(async () => {
      second.result.current()
    })
    expect(refresh).toHaveBeenCalledTimes(2)
  })
})
