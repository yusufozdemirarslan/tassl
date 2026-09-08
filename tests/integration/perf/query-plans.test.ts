// B13 (docs/tech/16-performance-a11y-budgets.md §5.5, §10): no run-scoped read plans a sequential
// scan of `run_events` or `run_claims`.
//
// The two tables are the ones every run screen reads whole (§5.4), and they are the two that grow
// without bound as a term goes on: a section of sixty students is 60 x a few hundred events, a
// course is a dozen sections, and an institution is a dozen courses. A missing index on either
// costs nothing at all on a fixture and everything in week ten, which is exactly the failure a
// budget file exists to catch early.
//
// So the fixture is 10,000 rows in each (`@tests/factories/perf`), `ANALYZE` runs so the planner
// has statistics, and each query is asked for its real plan with `EXPLAIN (ANALYZE, FORMAT JSON)`.
// The assertion is on the plan tree, not on a duration: a timing on CI hardware is noise, and a Seq
// Scan on ten thousand rows is fast enough to pass any threshold anybody would dare to write.
//
// The five queries are the run-scoped reads of §5.4 and §5.3 — the trace in sequence order, the
// trace filtered by type for the graph builders, the claims panel, the lock gate's unstanced
// claims, and the sequence allocator every mutation runs before it appends.
// @db:truncate
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { truncateAll } from '@tests/setup/integration'

type DbModule = typeof import('@/server/db/client')
type PerfFactory = typeof import('@tests/factories/perf')

let db: DbModule['db']
let sql: DbModule['sql']
let runId: string

/** A node of the JSON plan tree Postgres returns for `EXPLAIN (FORMAT JSON)`. */
type PlanNode = { 'Node Type': string; 'Relation Name'?: string; Plans?: PlanNode[] }

const WATCHED = ['run_events', 'run_claims']

/** Every relation in `relations` this plan reads with a sequential scan, at any depth. */
const seqScans = (node: PlanNode, relations: string[]): string[] => [
  ...(node['Node Type'] === 'Seq Scan' && relations.includes(node['Relation Name'] ?? '')
    ? [node['Relation Name']!]
    : []),
  ...(node.Plans ?? []).flatMap((child) => seqScans(child, relations)),
]

beforeAll(async () => {
  await truncateAll()
  const client: DbModule = await import('@/server/db/client')
  db = client.db
  sql = client.sql
  const perf: PerfFactory = await import('@tests/factories/perf')
  runId = await perf.seedRunsForPlans({
    eventRuns: 100,
    eventsPerRun: 100,
    claimRuns: 1250,
    claimsPerRun: 8,
  })
  await db.execute(sql`ANALYZE run_events`)
  await db.execute(sql`ANALYZE run_claims`)
}, 180_000)

afterAll(async () => {
  await truncateAll()
})

describe('run-scoped query plans (NFR-008, NFR-014, B13)', () => {
  it('the fixture is large enough for the planner to have a choice', async () => {
    const [events] = await db.execute<{ n: number }>(sql`select count(*)::int as n from run_events`)
    const [claims] = await db.execute<{ n: number }>(sql`select count(*)::int as n from run_claims`)
    expect(events?.n).toBe(10_000)
    expect(claims?.n).toBe(10_000)
  })

  const cases: Array<[string, () => ReturnType<typeof sql>]> = [
    [
      'events by run ordered by seq (§5.4 statement 2)',
      () => sql`SELECT * FROM run_events WHERE run_id = ${runId} ORDER BY seq`,
    ],
    [
      'events by run and type (graph builders)',
      () =>
        sql`SELECT * FROM run_events WHERE run_id = ${runId} AND type IN ('stance_set', 'claim_used')`,
    ],
    [
      'claims by run (§5.4 statement 3)',
      () => sql`SELECT * FROM run_claims WHERE run_id = ${runId}`,
    ],
    [
      'unstanced claims (lock gate)',
      () => sql`SELECT * FROM run_claims WHERE run_id = ${runId} AND stance IS NULL`,
    ],
    ['next seq allocation', () => sql`SELECT max(seq) FROM run_events WHERE run_id = ${runId}`],
  ]

  for (const [name, query] of cases) {
    it(`${name}: no Seq Scan on run_events or run_claims`, async () => {
      const rows = await db.execute<{ 'QUERY PLAN': Array<{ Plan: PlanNode }> }>(
        sql`EXPLAIN (ANALYZE, FORMAT JSON) ${query()}`,
      )
      const plan = rows[0]!['QUERY PLAN'][0]!.Plan
      // The plan itself is the failure message: §10.3 asks for the EXPLAIN JSON on a red run.
      expect(seqScans(plan, WATCHED), JSON.stringify(plan, null, 2)).toEqual([])
    })
  }

  // The control. Every assertion above is that a list is empty, and a detector that never finds
  // anything makes every one of them pass — including on a database with the indexes dropped. So
  // one query with no index behind it is asked for its plan too, and the same reader has to find
  // the scan in it. `used_marked` is a column of `run_claims` that §5.3 lists no index for.
  it('the detector finds a Seq Scan when there is one (this gate is not vacuous)', async () => {
    const rows = await db.execute<{ 'QUERY PLAN': Array<{ Plan: PlanNode }> }>(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) SELECT count(*) FROM run_claims WHERE used_marked IS TRUE`,
    )
    const plan = rows[0]!['QUERY PLAN'][0]!.Plan
    expect(seqScans(plan, WATCHED), JSON.stringify(plan, null, 2)).toContain('run_claims')
  })
})
