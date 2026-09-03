import { describe, expect, it } from 'vitest'
import { devRoutesEnabled } from '@/lib/dev-route'

// The /dev routes (component gallery, UI-060) exist in local and test only (09 §1, 16 §3.5).
describe('devRoutesEnabled', () => {
  it.each([
    ['local', true],
    ['test', true],
    ['preview', false],
    ['production', false],
    ['', false],
  ])('%s → %s', (appEnv, expected) => {
    expect(devRoutesEnabled(appEnv)).toBe(expected)
  })
})
