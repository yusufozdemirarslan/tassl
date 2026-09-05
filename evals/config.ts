// Eval thresholds and the shapes a suite reports in (docs/tech/11-llm-integration.md §5, D-064).
//
// The two thresholds are not two opinions about quality; they are two different questions.
//
//   *On the mock, 100 percent.* The mock is a pure function of its input (§1.4), so every case has
//   exactly one right answer and it never moves. Anything below 100 is a regression in a prompt, a
//   guardrail, or the matcher — never noise — which is why CI runs this suite with
//   `FEATURE_AI=false` and treats a single failing case as a broken build.
//
//   *On a real provider, 90 percent.* A model is allowed to phrase things differently, and the
//   checks are properties rather than string equality, but a tenth of the suite failing means the
//   prompt has drifted from what the product promises.
//
// The suites are the regression net for every later prompt change: `evals/authoring` (Phase 12) and
// `evals/scoring` (Phase 10) join `evals/assistant` here as they are built.
import type { LlmProvider } from '@/server/llm/provider'

/** One property asserted about one case's answer. A case passes only when every check passes. */
export type EvalCheck = { name: string; ok: boolean; detail?: string }

export type EvalCaseResult = {
  id: string
  title: string
  checks: EvalCheck[]
}

export type EvalSuite = {
  name: string
  run(provider: LlmProvider): Promise<EvalCaseResult[]>
}

export const caseOk = (result: EvalCaseResult): boolean => result.checks.every((check) => check.ok)

/** D-064: the mock is deterministic, so it has to be perfect; a real provider has to be close. */
export const MOCK_PASS_RATE = 1
export const REAL_PASS_RATE = 0.9

export const thresholdFor = (providerName: string): number =>
  providerName === 'mock' ? MOCK_PASS_RATE : REAL_PASS_RATE

/** Every call the suites make is logged under this feature, so eval traffic is not student traffic. */
export const EVAL_FEATURE = 'eval' as const
