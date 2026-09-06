// FR-131: Tassl produces no composite judgment score, rank, percentile, or trait claim.
//
// The requirement's own enforcement note is what this file implements: "No field named
// score/rank/percentile exists on run tables, events, or exports except `points` (FR-190) and
// `false_challenge_rate`; a grep-based test enforces the field-name rule." Step 10.3 is the step
// that would break it — it is the one that turns seven bands into a number — so the guard lands
// with it.
//
// **This is a grep and not a token check.** It walks four real artifacts and asks each of them for
// its own field names:
//
//   1. every column of every table in `src/server/db/schema`, read off the Drizzle definitions;
//   2. every key of every event payload schema, read off `EVENT_PAYLOAD_SCHEMAS` recursively;
//   3. every key of both trace export forms, read off the Zod schemas the endpoints serve;
//   4. every key of what this module actually produces at run time — the four graph payloads, the
//      categorical facts, the seven draft bands and a recompute result — because a field that only
//      exists in a payload never reaches a table or a schema and would otherwise be invisible here.
//
// So a column, a payload key or an export key added tomorrow is checked without anyone editing this
// file. The last describe block proves the walkers can fail: each is run again over the same
// artifact with a forbidden name planted in it, and each must find it. A guard that cannot fail is
// not a guard.
//
// **What the rule is, precisely.** A *field* named score, rank or percentile. The word is matched
// on name segments, so `composite_score`, `judgmentScore`, `class_rank`, `percentileRank` and
// `rankings` are all caught, while `scored_at` and `scoring_status` are not: those name the act of
// scoring rather than a number about a person. `points` is the course's own arithmetic under the
// instructor's mapping (FR-190, FR-202) and `false_challenge_rate` is a rate with its numerator and
// denominator beside it (FR-134); both are named in the requirement as the two exceptions and
// neither is a composite of the seven bands.
//
// Table names are not walked and are not meant to be: `run_scores` is where the run's scoring
// output lives, and a table called that holding no field called that is exactly the shape FR-131
// describes. The four walkers below take columns, keys and payload properties only.
import { getTableColumns, is } from 'drizzle-orm'
import { PgTable } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import * as dbSchema from '@/server/db/schema'
import {
  CourseTraceExportSchema,
  RecordTraceExportSchema,
} from '@/server/modules/trace/export-schema'
import { EVENT_PAYLOAD_SCHEMAS } from '@/server/modules/trace/schema'
import {
  DEFAULT_MAPPING,
  buildGraphs,
  categoricalFacts,
  draftBands,
  recomputeAfterNeutralization,
} from '@/server/modules/scoring'
import { loadFixture } from './graphs/fixtures'

// ---------------------------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------------------------

/** The three words FR-131 forbids as a field name, with the plurals and the -ing form. */
const FORBIDDEN = new Set([
  'score',
  'scores',
  'rank',
  'ranks',
  'ranking',
  'rankings',
  'ranked',
  'percentile',
  'percentiles',
])

/** `falseChallengeRate` and `false_challenge_rate` alike become ['false','challenge','rate']. */
const segments = (name: string): string[] =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((part) => part !== '')

/** Every name in the list that names a score, a rank or a percentile. */
function forbiddenNames(names: Iterable<string>): string[] {
  return [...new Set(names)]
    .filter((name) => segments(name).some((part) => FORBIDDEN.has(part)))
    .sort()
}

// ---------------------------------------------------------------------------------------------
// The four walkers
// ---------------------------------------------------------------------------------------------

/** Every column name of every table Drizzle defines, in both the TS and the SQL spelling. */
function everyColumnName(): string[] {
  const names: string[] = []
  for (const value of Object.values(dbSchema)) {
    if (!is(value, PgTable)) continue
    for (const [property, column] of Object.entries(getTableColumns(value))) {
      names.push(property, column.name)
    }
  }
  return names
}

/** Every property name inside a Zod schema, at any depth, through objects, arrays and unions. */
function everyZodKey(schema: z.ZodType): string[] {
  const json = z.toJSONSchema(schema, { io: 'output', unrepresentable: 'any' })
  const names: string[] = []
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    const record = node as Record<string, unknown>
    const properties = record['properties']
    if (properties !== null && typeof properties === 'object') {
      names.push(...Object.keys(properties as Record<string, unknown>))
    }
    for (const value of Object.values(record)) walk(value)
  }
  walk(json)
  return names
}

/** Every key of a value the module produces at run time, at any depth. */
function everyPayloadKey(value: unknown, seen = new Set<unknown>()): string[] {
  if (value === null || typeof value !== 'object' || seen.has(value)) return []
  seen.add(value)
  if (Array.isArray(value)) return value.flatMap((item) => everyPayloadKey(item, seen))
  const names: string[] = []
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    names.push(key)
    names.push(...everyPayloadKey(nested, seen))
  }
  return names
}

// ---------------------------------------------------------------------------------------------
// The artifacts
// ---------------------------------------------------------------------------------------------

const input = loadFixture('marco-8-of-11')
const graphs = buildGraphs(input)
const facts = categoricalFacts(input, graphs)
const bands = draftBands({
  facts,
  graphs,
  reads: {
    framing: { band: 'proficient', quotes: [], rationale: 'r' },
    delegation: { band: 'proficient', quotes: [], rationale: 'r' },
    decision_quality: {
      band: 'proficient',
      quotes: [],
      rationale: 'r',
      matchedPosition: 'defensible',
      minimumCommitmentExists: false,
    },
    adaptation: { band: 'proficient', quotes: [], rationale: 'r' },
    ownership: { band: 'proficient', quotes: [], rationale: 'r' },
  },
})
const recompute = recomputeAfterNeutralization({
  input,
  neutralization: {
    neutralizationId: '00000000-0000-4000-8000-0000000000ff',
    claimId: input.packageVersion.claims[0]?.id ?? '',
    reason: 'unintended_defect',
    creditChallenge: true,
  },
  occurredAt: '2026-09-06T12:00:00.000Z',
  effectiveBands: { verification: 'professional', calibration: 'novice' },
  mapping: DEFAULT_MAPPING,
})

// ---------------------------------------------------------------------------------------------
// The rule holds
// ---------------------------------------------------------------------------------------------

describe('FR-131 — no field is named score, rank or percentile', () => {
  it('not on any column of any table', () => {
    const columns = everyColumnName()
    // Guard the guard: if the walker ever stops finding tables this assertion is what says so.
    expect(columns.length).toBeGreaterThan(200)
    expect(forbiddenNames(columns)).toStrictEqual([])
  })

  it('not in any event payload the trace can hold', () => {
    const keys = Object.values(EVENT_PAYLOAD_SCHEMAS).flatMap((schema) =>
      everyZodKey(schema as z.ZodType),
    )
    expect(keys.length).toBeGreaterThan(100)
    expect(forbiddenNames(keys)).toStrictEqual([])
  })

  it('not in either form of the trace export', () => {
    const course = everyZodKey(CourseTraceExportSchema)
    const record = everyZodKey(RecordTraceExportSchema)
    expect(course.length).toBeGreaterThan(100)
    expect(forbiddenNames(course)).toStrictEqual([])
    expect(forbiddenNames(record)).toStrictEqual([])
    // The course form carries `points` and both carry `false_challenge_rate`: FR-131's two named
    // exceptions, and the reason this test matches segments rather than substrings.
    expect(course).toContain('points')
    expect(course).toContain('false_challenge_rate')
  })

  it('not in anything the scoring module produces at run time', () => {
    const keys = [
      ...everyPayloadKey(graphs),
      ...everyPayloadKey(facts),
      ...everyPayloadKey(bands),
      ...everyPayloadKey(recompute),
    ]
    expect(keys.length).toBeGreaterThan(100)
    expect(forbiddenNames(keys)).toStrictEqual([])
  })

  it('leaves the names that describe the act of scoring alone', () => {
    expect(
      forbiddenNames([
        'scored_at',
        'scoringStatus',
        'points',
        'pointsDraft',
        'points_before_correction',
        'falseChallengeRate',
        'matched_stance_share',
        'rubric_version',
      ]),
    ).toStrictEqual([])
  })
})

// ---------------------------------------------------------------------------------------------
// The guard can fail
// ---------------------------------------------------------------------------------------------

describe('FR-131 — the guard finds a forbidden field when there is one', () => {
  it('catches every spelling a composite would arrive under', () => {
    expect(
      forbiddenNames([
        'score',
        'compositeScore',
        'composite_score',
        'judgment_score',
        'rank',
        'classRank',
        'cohort_ranking',
        'percentile',
        'percentileRank',
        'band_percentiles',
      ]),
    ).toStrictEqual([
      'band_percentiles',
      'classRank',
      'cohort_ranking',
      'compositeScore',
      'composite_score',
      'judgment_score',
      'percentile',
      'percentileRank',
      'rank',
      'score',
    ])
  })

  it('would fail the column walk if a table grew a composite column', () => {
    expect(forbiddenNames([...everyColumnName(), 'composite_score'])).toStrictEqual([
      'composite_score',
    ])
  })

  it('would fail the payload walk if a schema grew a rank key', () => {
    const planted = z.strictObject({
      dimension: z.string(),
      cohort_rank: z.int(),
      nested: z.strictObject({ percentile: z.number() }),
    })
    expect(forbiddenNames(everyZodKey(planted))).toStrictEqual(['cohort_rank', 'percentile'])
  })

  it('would fail the run-time walk if a band payload grew one', () => {
    const planted = { ...bands, extra: { compositeScore: 2.857 } }
    expect(forbiddenNames(everyPayloadKey(planted))).toStrictEqual(['compositeScore'])
  })

  it('reaches into arrays and nested objects, which is where a leak would actually be', () => {
    const planted = { rows: [{ claim_id: 'x', deep: [{ percentileRank: 3 }] }] }
    expect(forbiddenNames(everyPayloadKey(planted))).toStrictEqual(['percentileRank'])
  })
})
