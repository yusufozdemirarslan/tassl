// Every event in the catalogue is actually fired somewhere (Step 13.2).
//
// The catalogue is a promise: a dashboard in 17 §8 that reads an event nobody emits is a panel that
// is silently empty forever, and a pilot metric that cannot be computed. This test is the only
// thing that notices — it scans the source for a `track('<event>'` or `trackClient('<event>'` call
// site and fails on the first event that has none.
//
// It is a grep, deliberately: proving each event fires would mean driving the whole product loop,
// which the walkthrough e2e already does. What this catches is the failure the loop cannot — an
// event added to `EVENTS` and never wired, or a call site deleted with its feature.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EVENT_NAMES } from '@/lib/analytics/events'

const ROOTS = ['src/server', 'src/components', 'src/app']

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    else if (/\.tsx?$/.test(entry)) out.push(path)
  }
  return out
}

const source = ROOTS.flatMap((root) => sourceFiles(join(process.cwd(), root)))
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n')

describe('analytics coverage', () => {
  it('fires every catalogue event from at least one call site', () => {
    // Prettier puts a long call's first argument on its own line, so the name is not always
    // adjacent to the parenthesis.
    const missing = EVENT_NAMES.filter(
      (name) => !new RegExp(String.raw`\btrack(?:Client)?\(\s*'${name}'`).test(source),
    )
    expect(missing, `events in EVENTS with no call site: ${missing.join(', ')}`).toEqual([])
  })

  it('has a catalogue at all, so an empty scan cannot pass', () => {
    expect(EVENT_NAMES.length).toBeGreaterThan(40)
    expect(source.length).toBeGreaterThan(100_000)
  })
})
