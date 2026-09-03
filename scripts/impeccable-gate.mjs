#!/usr/bin/env node
// Fails when `impeccable detect --json` reports findings that are not waived.
// Usage: node scripts/impeccable-gate.mjs <report.json> <.impeccable/config.json>
import { readFileSync } from 'node:fs'

const [reportPath = 'impeccable-report.json', configPath = '.impeccable/config.json'] =
  process.argv.slice(2)
const report = JSON.parse(readFileSync(reportPath, 'utf8'))
// Waivers are Impeccable's own detector ignores (D-130); the detector has already applied them,
// so every finding that reaches this script is open. The config is read only to print the
// active ignore counts beside the result.
let ignores = { ignoreRules: [], ignoreFiles: [], ignoreValues: [] }
try {
  const detector = JSON.parse(readFileSync(configPath, 'utf8')).detector ?? {}
  ignores = {
    ignoreRules: detector.ignoreRules ?? [],
    ignoreFiles: detector.ignoreFiles ?? [],
    ignoreValues: detector.ignoreValues ?? [],
  }
} catch {
  // no config: nothing ignored
}
const findings = Array.isArray(report)
  ? report
  : (report.findings ?? report.issues ?? report.results ?? report.violations ?? [])
const ruleOf = (f) => String(f.rule ?? f.id ?? f.pattern ?? f.name ?? 'unknown')
const fileOf = (f) => String(f.file ?? f.path ?? f.filePath ?? '')
for (const f of findings)
  console.log(`${ruleOf(f)}  ${fileOf(f)}  ${f.message ?? f.description ?? ''}`)
console.log(
  `${findings.length} open findings (ignores active: ${ignores.ignoreRules.length} rules, ${ignores.ignoreFiles.length} files, ${ignores.ignoreValues.length} values)`,
)
process.exit(findings.length === 0 ? 0 : 1)
