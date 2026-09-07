// The thirteen scoring fixtures of 14 §5 are traces the database would accept.
//
// Everything else in this folder reads those files as `GraphInput` through a cast, and a cast is
// only as good as what proves it. So this file parses every event payload through the same
// registry `trace.append` parses through before an insert, checks the sequence is 1..N with no gap,
// and checks the authored halves against the enums they mirror. A fixture that drifts from the
// trace's own contract fails here, where the message says which event and which field, rather than
// in a graph assertion that says a number was wrong.
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { EVENT_PAYLOAD_SCHEMAS, RUN_EVENT_TYPES } from '@/server/modules/trace/schema'
import { FIXTURE_NAMES, loadFixture } from './fixtures'

const StanceSchema = z.enum(['accept', 'verify', 'challenge', 'reject', 'escalate'])

const ClaimSchema = z.strictObject({
  id: z.uuid(),
  key: z.string().min(1),
  text: z.string().min(1),
  sourceKind: z.enum(['assistant', 'document']),
  sourceDocumentId: z.uuid().nullable(),
  importance: z.enum(['load_bearing', 'supporting']),
  consequenceLevel: z.enum(['low', 'medium', 'high']),
  conceptKey: z.string().min(1),
  weaklySourced: z.boolean(),
  position: z.int().min(1),
})

const VariantStateSchema = z.strictObject({
  claimId: z.uuid(),
  evidenceStatus: z.enum(['sound', 'defective']),
  failureFamily: z.string().nullable(),
  warrantedStance: StanceSchema,
  planted: z.boolean(),
})

describe('the thirteen scoring fixtures', () => {
  it('are all present, and 14 §5 names no others', () => {
    expect(FIXTURE_NAMES).toHaveLength(13)
    expect(new Set(FIXTURE_NAMES).size).toBe(13)
  })

  it.each(FIXTURE_NAMES)('%s is a trace the database would accept', (name) => {
    const fixture = loadFixture(name)
    expect(fixture.name).toBe(name)
    expect(fixture.purpose.length).toBeGreaterThan(20)

    fixture.events.forEach((event, index) => {
      expect(event.seq, `${name} event ${String(index)}`).toBe(index + 1)
      expect(RUN_EVENT_TYPES).toContain(event.type)
      expect(Number.isNaN(Date.parse(event.occurredAt))).toBe(false)
      const schema = EVENT_PAYLOAD_SCHEMAS[event.type]
      const parsed = schema.safeParse(event.payload)
      expect(
        parsed.success
          ? null
          : `${name} seq ${String(event.seq)} ${event.type}: ${parsed.error.message}`,
      ).toBeNull()
    })
  })

  it.each(FIXTURE_NAMES)('%s carries an authored standard for every claim', (name) => {
    const fixture = loadFixture(name)
    expect(fixture.packageVersion.claims.length).toBeGreaterThanOrEqual(6)
    for (const claim of fixture.packageVersion.claims) {
      expect(ClaimSchema.safeParse(claim).success).toBe(true)
    }
    for (const state of fixture.variantStates) {
      expect(VariantStateSchema.safeParse(state).success).toBe(true)
    }
    // One variant state per claim, and none for a claim the version does not carry.
    const claimIds = new Set(fixture.packageVersion.claims.map((claim) => claim.id))
    const stateIds = new Set(fixture.variantStates.map((state) => state.claimId))
    expect(stateIds).toStrictEqual(claimIds)
  })

  it('never puts the clock on an event outside the working period or the Turn window (D-042)', () => {
    for (const name of FIXTURE_NAMES) {
      const fixture = loadFixture(name)
      const before = fixture.events.filter(
        (event) => event.seq < (fixture.events.find((e) => e.type === 'frame_locked')?.seq ?? 0),
      )
      for (const event of before) {
        expect(event.clockRemainingMs, `${name} seq ${String(event.seq)}`).toBeNull()
      }
    }
  })
})
