// `useRefresh` (D-709, D-713): one `router.refresh()` in flight at a time, one more afterwards for
// everything asked for while it flew, and a remembered refresh that is never lost.
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const refresh = vi.fn()
// One router object, as Next hands out: the hook memoises on its identity.
const router = { refresh, push: vi.fn(), replace: vi.fn() }
vi.mock('next/navigation', () => ({
  useRouter: () => router,
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

  it('runs a refresh remembered behind a starter that unmounted mid-flight, through another instance', async () => {
    const starter = renderHook(() => useRefresh())
    const other = renderHook(() => useRefresh())
    // The starter's flight begins outside `act`, so its transition has not settled when the other
    // instance asks and the starter leaves — the shape of a confirmed row replaced by its refresh.
    starter.result.current()
    other.result.current()
    expect(refresh).toHaveBeenCalledTimes(1)
    await act(async () => {
      starter.unmount()
    })
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('runs a remembered refresh when the stale bound passes with the flight still marked', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-09T12:00:00Z'))
    const starter = renderHook(() => useRefresh())
    const other = renderHook(() => useRefresh())
    starter.result.current()
    other.result.current()
    expect(refresh).toHaveBeenCalledTimes(1)
    // Nothing settles the starter here; the timer armed when the refresh was remembered ends the
    // flight at the stale bound and runs it.
    await act(async () => {
      vi.setSystemTime(new Date('2026-09-09T12:00:05.001Z'))
      vi.advanceTimersByTime(5_001)
    })
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('treats a flight older than the stale bound as over, so an unmounted starter cannot block the page', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-09T12:00:00Z'))
    const first = renderHook(() => useRefresh())
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
