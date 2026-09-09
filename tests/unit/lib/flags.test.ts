// The client-safe flags (docs/tech/05-environment-config.md §3): four booleans derived from the
// parsed environment and nothing else, so `<FlagsProvider>` can never carry a secret by accident.
import { describe, expect, it } from 'vitest'
import { flagsFromEnv } from '@/lib/flags'

describe('flagsFromEnv', () => {
  it('maps the four flags and carries nothing else', () => {
    expect(
      flagsFromEnv({
        FEATURE_AI: true,
        FEATURE_SAMPLE_DATA: false,
        FEATURE_TEST_CONTROLS: true,
        DEMO_MODE: true,
      }),
    ).toEqual({ ai: true, sampleData: false, testControls: true, demoMode: true })
  })

  it('reads DEMO_MODE as its own flag (D-692)', () => {
    const env = { FEATURE_AI: false, FEATURE_SAMPLE_DATA: true, FEATURE_TEST_CONTROLS: true }
    expect(flagsFromEnv({ ...env, DEMO_MODE: false }).demoMode).toBe(false)
    expect(flagsFromEnv({ ...env, DEMO_MODE: true }).demoMode).toBe(true)
  })
})
