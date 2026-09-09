// Feature flags (docs/tech/05-environment-config.md §3). The server derives them from the parsed
// environment; the client receives only these four booleans through <FlagsProvider>.
//
// `demoMode` (D-692) is a flag in the same sense as the other three — a deployment fact, read from
// the environment, that changes what a screen does — and it reaches the client for the one screen
// that branches on it: the sign-up form, which lands a new account on `/home` rather than on
// "check your email" when the deployment auto-confirms sign-ups.
export type Flags = { ai: boolean; sampleData: boolean; testControls: boolean; demoMode: boolean }

// Structural input type so src/lib never imports src/server (boundaries rule).
export type FlagEnv = {
  FEATURE_AI: boolean
  FEATURE_SAMPLE_DATA: boolean
  FEATURE_TEST_CONTROLS: boolean
  DEMO_MODE: boolean
}

export function flagsFromEnv(env: FlagEnv): Flags {
  return {
    ai: env.FEATURE_AI,
    sampleData: env.FEATURE_SAMPLE_DATA,
    testControls: env.FEATURE_TEST_CONTROLS,
    demoMode: env.DEMO_MODE,
  }
}
