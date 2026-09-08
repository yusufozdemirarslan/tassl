// The eval runner: `pnpm evals` (docs/tech/11-llm-integration.md §5, D-064).
//
//   pnpm evals              # every suite against the configured provider
//   pnpm evals assistant    # one suite
//
// It runs the suites against `getProvider()` — the same registry the application calls, with the
// same call logging — so what it measures is the provider a student would actually meet. With
// `FEATURE_AI=false` that is the mock, every case has one right answer, and the threshold is 100
// percent; with a key and `FEATURE_AI=true` it is the real provider and the threshold is 90.
// Below the threshold the process exits 1 and the report names every failing check.
//
// All three suites of 11 §5 are registered below: the assistant's twelve delegations, the
// authoring pipeline's three licensed cases, and scoring's fixed placements.
import type { EvalCaseResult, EvalSuite } from './config'

/** Two spaces per level; the report is read in a terminal, not parsed. */
const indent = (depth: number): string => '  '.repeat(depth)

const percent = (ratio: number): string => `${(ratio * 100).toFixed(1)}%`

/**
 * One case's line, plus — when it failed — the checks that failed and the digest of the raw output.
 *
 * The digest and not the answer (§5). Everything printed here is a check name, an id, a count or a
 * rule code; the model's words are represented by `output <sha256>` and nothing else, so this report
 * can be pasted anywhere. `evals/README.md` says what to do with the digest.
 */
function reportCase(result: EvalCaseResult, ok: boolean): string[] {
  const lines = [`${indent(1)}${ok ? 'pass' : 'FAIL'}  ${result.id} — ${result.title}`]
  if (ok) return lines
  for (const check of result.checks.filter((entry) => !entry.ok)) {
    lines.push(`${indent(3)}✗ ${check.name}${check.detail ? `: ${check.detail}` : ''}`)
  }
  lines.push(`${indent(3)}output ${result.outputHash ?? 'none (no answer was returned)'}`)
  return lines
}

async function main(): Promise<void> {
  // Before anything imports `@/server/config`, and deliberately before dotenv runs inside it: the
  // report is this command's output, and `.env`'s LOG_LEVEL=debug — right for the dev server — would
  // bury it under a call log line per case. Setting LOG_LEVEL in the shell still wins.
  process.env.LOG_LEVEL ??= 'warn'

  const { caseOk, thresholdFor } = await import('./config')
  const { env } = await import('@/server/config')
  const { getProvider } = await import('@/server/llm/registry')
  const { assistantSuite } = await import('./assistant/check')
  const { authoringSuite } = await import('./authoring/check')
  const { scoringSuite } = await import('./scoring/check')

  const all: EvalSuite[] = [assistantSuite, authoringSuite, scoringSuite]
  const wanted = process.argv.slice(2)
  const suites = wanted.length === 0 ? all : all.filter((suite) => wanted.includes(suite.name))
  if (suites.length === 0) {
    console.error(
      `No eval suite matched ${wanted.join(', ')}. Known: ${all.map((s) => s.name).join(', ')}`,
    )
    process.exit(1)
  }

  const provider = getProvider()
  const threshold = thresholdFor(provider.name)
  const lines: string[] = [
    '',
    `tassl evals — provider ${provider.name} (FEATURE_AI=${String(env.FEATURE_AI)}, LLM_PROVIDER=${env.LLM_PROVIDER}, TRIGGER_MATCHING=${env.TRIGGER_MATCHING})`,
    `threshold ${percent(threshold)} of cases`,
    '',
  ]

  let passed = 0
  let total = 0
  let checksPassed = 0
  let checksTotal = 0

  for (const suite of suites) {
    const results = await suite.run(provider)
    const suitePassed = results.filter(caseOk).length
    lines.push(`${suite.name}`)
    for (const result of results) {
      lines.push(...reportCase(result, caseOk(result)))
      checksPassed += result.checks.filter((check) => check.ok).length
      checksTotal += result.checks.length
    }
    lines.push(`${indent(1)}${suitePassed}/${results.length} cases`, '')
    passed += suitePassed
    total += results.length
  }

  const rate = total === 0 ? 0 : passed / total
  const ok = total > 0 && rate >= threshold
  lines.push(
    `${passed}/${total} cases (${percent(rate)}), ${checksPassed}/${checksTotal} checks — ${ok ? 'PASS' : 'FAIL'}`,
    '',
  )
  console.log(lines.join('\n'))

  // Explicit, because the provider chain holds a database pool open for the `llm_calls` writes.
  process.exit(ok ? 0 : 1)
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
