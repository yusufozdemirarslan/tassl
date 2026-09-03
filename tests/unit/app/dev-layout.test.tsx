// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

// The layout must call notFound() outside local and test. The config module is mocked so the
// test controls APP_ENV without loading .env.
async function loadLayout(appEnv: string) {
  vi.resetModules()
  vi.doMock('@/server/config', () => ({ env: { APP_ENV: appEnv } }))
  vi.doMock('next/navigation', () => ({
    notFound: () => {
      throw new Error('NEXT_NOT_FOUND')
    },
  }))
  const mod = await import('@/app/dev/layout')
  return mod.default
}

describe('dev layout guard', () => {
  afterEach(() => {
    vi.doUnmock('@/server/config')
    vi.doUnmock('next/navigation')
  })

  it('renders in local and test', async () => {
    for (const appEnv of ['local', 'test']) {
      const DevLayout = await loadLayout(appEnv)
      expect(() => DevLayout({ children: null })).not.toThrow()
    }
  })

  it('is a 404 in preview and production', async () => {
    for (const appEnv of ['preview', 'production']) {
      const DevLayout = await loadLayout(appEnv)
      expect(() => DevLayout({ children: null })).toThrow('NEXT_NOT_FOUND')
    }
  })
})
