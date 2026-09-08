// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

// Each case resets the module registry and imports the route afresh, which pulls the page, the
// component tree under it and the catalogue with them. On a cold cache under a full run that first
// import is comfortably past the unit project's 5 s default, and a timeout there says nothing about
// the gate; the integration suite raises its own for the same reason.
vi.setConfig({ testTimeout: 30_000 })

// UI-042's gate, which is the page's own and not only the service's (08 §4, 07 §6).
//
// `GET /package-versions/{id}/generation` is "Auth, Editor" and nobody else, because the report it
// carries names the rules a draft breaks — which is to say where its defects are. The integration
// matrix proves the route refuses every other seat; what this file proves is the thing a matrix
// cannot see: that the *page* renders nothing at all before that read has succeeded. A page that
// laid out a heading, or read the version first, would leak the package's title and its status to
// a seat that may not have them, and would then draw an empty screen instead of a 404.
//
// So the order is the assertion. The first thing `GenerationPage` does after validating its two
// ids is ask for the generation status; a refusal of any kind — FORBIDDEN for a teaching assistant
// or a program lead, NOT_FOUND for another institution's id — is the not-found page, and the
// version read never happens.

const PACKAGE_ID = '11111111-1111-4111-8111-111111111111'
const VERSION_ID = '22222222-2222-4222-8222-222222222222'

type Loaded = {
  page: (props: { params: Promise<{ packageId: string; versionId: string }> }) => Promise<unknown>
  /** The refusal class *of the reset module graph*: `isAppError` is an `instanceof` check. */
  refuse: (code: string) => never
  getGenerationStatus: ReturnType<typeof vi.fn>
  getPackageVersion: ReturnType<typeof vi.fn>
  listVersionElements: ReturnType<typeof vi.fn>
}

async function loadPage(statusAnswer: (refuse: Loaded['refuse']) => unknown): Promise<Loaded> {
  vi.resetModules()
  // Imported after the reset, so the class the page's `isAppError` tests against is this one.
  const { AppError } = await import('@/lib/errors')
  const refuse = (code: string): never => {
    throw new AppError(code as 'FORBIDDEN', 'refused')
  }
  const getGenerationStatus = vi.fn(async () => statusAnswer(refuse))
  const getPackageVersion = vi.fn(async () => {
    throw new Error('THE_VERSION_WAS_READ_BEFORE_THE_GATE')
  })
  const listVersionElements = vi.fn(async () => [])

  vi.doMock('next/navigation', () => ({
    notFound: () => {
      throw new Error('NEXT_NOT_FOUND')
    },
  }))
  vi.doMock('@/app/(app)/viewer', () => ({
    getViewer: async () => ({ actor: { id: 'user_1' } }),
  }))
  vi.doMock('@/server/modules/authoring', () => ({ getGenerationStatus }))
  vi.doMock('@/server/modules/scenarios', () => ({ getPackageVersion, listVersionElements }))

  const mod = await import('@/app/(app)/packages/[packageId]/versions/[versionId]/generation/page')
  return {
    page: mod.default as Loaded['page'],
    refuse,
    getGenerationStatus,
    getPackageVersion,
    listVersionElements,
  }
}

const params = (over: Partial<{ packageId: string; versionId: string }> = {}) =>
  Promise.resolve({ packageId: PACKAGE_ID, versionId: VERSION_ID, ...over })

afterEach(() => {
  vi.doUnmock('next/navigation')
  vi.doUnmock('@/app/(app)/viewer')
  vi.doUnmock('@/server/modules/authoring')
  vi.doUnmock('@/server/modules/scenarios')
})

describe('the generation screen refuses before it renders (UI-042, 08 §4)', () => {
  it.each([
    ['FORBIDDEN', 'a seat with no author membership'],
    ['NOT_FOUND', "another institution's version id"],
  ])('answers the not-found page on %s — %s', async (code) => {
    const loaded = await loadPage((refuse) => refuse(code))

    await expect(loaded.page({ params: params() })).rejects.toThrow('NEXT_NOT_FOUND')
    // And nothing about the package was read on the way to that answer.
    expect(loaded.getPackageVersion).not.toHaveBeenCalled()
    expect(loaded.listVersionElements).not.toHaveBeenCalled()
  })

  it('never asks for the status at all when the address is not two uuids', async () => {
    const loaded = await loadPage(() => ({}))

    await expect(loaded.page({ params: params({ versionId: 'not-a-uuid' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    )
    expect(loaded.getGenerationStatus).not.toHaveBeenCalled()
  })

  it('answers the not-found page when the version belongs to another package', async () => {
    const loaded = await loadPage(() => ({
      packageVersionId: VERSION_ID,
      packageId: '33333333-3333-4333-8333-333333333333',
      version: 1,
      state: 'complete',
      steps: [],
      runs: [],
      validation: { ok: true, failures: [] },
    }))

    await expect(loaded.page({ params: params() })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(loaded.getPackageVersion).not.toHaveBeenCalled()
  })
})
