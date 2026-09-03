// Feature flags (docs/tech/05-environment-config.md §3). The server derives them from the parsed
// environment; the client receives only these three booleans through <FlagsProvider>.
export type Flags = { ai: boolean; sampleData: boolean; testControls: boolean }

// Structural input type so src/lib never imports src/server (boundaries rule).
export type FlagEnv = {
  FEATURE_AI: boolean
  FEATURE_SAMPLE_DATA: boolean
  FEATURE_TEST_CONTROLS: boolean
}

export function flagsFromEnv(env: FlagEnv): Flags {
  return {
    ai: env.FEATURE_AI,
    sampleData: env.FEATURE_SAMPLE_DATA,
    testControls: env.FEATURE_TEST_CONTROLS,
  }
}
