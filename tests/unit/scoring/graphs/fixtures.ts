// The thirteen scoring fixtures (docs/tech/14-testing-strategy.md §5), loaded as `GraphInput`.
//
// Each file under `tests/fixtures/scoring/` is a complete input to the graph builders: the authored
// package version, the variant's claim states, and the run's whole event list. They are read from
// disk rather than imported so the JSON stays exactly what the export and the evals will read, and
// the cast is checked for real in `fixtures.test.ts`, which parses every payload through
// `EVENT_PAYLOAD_SCHEMAS` and every claim state against the enums.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GraphInput } from '@/server/modules/scoring/graphs'

export type ScoringFixture = GraphInput & { name: string; purpose: string }

/** The thirteen names of 14 §5, in that file's order. */
export const FIXTURE_NAMES = [
  'accept-everything-defective',
  'accept-everything-sound',
  'both-defects-escalated',
  'outside-answer-space',
  'marco-8-of-11',
  'nadia-run-one',
  'implicit-hold-no-change',
  'implicit-hold-change-warranted',
  'full-reversal-marginal',
  'hold-with-reason',
  'nothing-answered',
  'stance-records-lost-third',
  'stance-records-lost-half',
] as const

export type FixtureName = (typeof FIXTURE_NAMES)[number]

const DIR = join(process.cwd(), 'tests', 'fixtures', 'scoring')

export function loadFixture(name: FixtureName): ScoringFixture {
  return JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8')) as ScoringFixture
}

/** The same fixture with events of one type removed — how an unavailable graph is provoked. */
export function without(fixture: ScoringFixture, type: string): ScoringFixture {
  return { ...fixture, events: fixture.events.filter((event) => event.type !== type) }
}
