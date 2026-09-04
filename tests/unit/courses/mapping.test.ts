// Step 4.1 — the band mapping rule (docs/tech/10-backend-spec-modules.md §17, 06 §3.2, PRD §7.19).
//
// `MappingSchema` is where "four positive numbers" is written down. The service parses every
// mapping through it and answers `MAPPING_INVALID` when the parse fails (07 §5), so what this file
// asserts about the schema is exactly what the API refuses; `MappingInputSchema` is the wire shape
// that lets the request reach the service in the first place.
import { describe, expect, it } from 'vitest'
import { MappingInputSchema, MappingSchema } from '@/server/modules/courses/schema'

const BANDS = ['novice', 'developing', 'proficient', 'professional'] as const

const mapping = (overrides: Partial<Record<(typeof BANDS)[number], unknown>> = {}) => ({
  novice: 1,
  developing: 2,
  proficient: 3,
  professional: 4,
  ...overrides,
})

describe('MappingSchema (10 §17)', () => {
  it('accepts four positive numbers', () => {
    const parsed = MappingSchema.safeParse(mapping())
    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual({ novice: 1, developing: 2, proficient: 3, professional: 4 })
  })

  it('accepts fractional points, which the PRD example uses', () => {
    expect(MappingSchema.safeParse(mapping({ proficient: 2.5 })).success).toBe(true)
  })

  for (const band of BANDS) {
    it(`rejects zero for ${band}`, () => {
      expect(MappingSchema.safeParse(mapping({ [band]: 0 })).success).toBe(false)
    })

    it(`rejects a negative number for ${band}`, () => {
      expect(MappingSchema.safeParse(mapping({ [band]: -1 })).success).toBe(false)
    })

    it(`rejects a non-finite number for ${band}`, () => {
      expect(MappingSchema.safeParse(mapping({ [band]: Number.POSITIVE_INFINITY })).success).toBe(
        false,
      )
      expect(MappingSchema.safeParse(mapping({ [band]: Number.NaN })).success).toBe(false)
    })

    it(`rejects a missing ${band}`, () => {
      const values = mapping()
      delete (values as Record<string, unknown>)[band]
      expect(MappingSchema.safeParse(values).success).toBe(false)
    })
  }

  it('rejects a string that looks like a number', () => {
    expect(MappingSchema.safeParse(mapping({ novice: '1' })).success).toBe(false)
  })
})

describe('MappingInputSchema (the wire shape)', () => {
  it('accepts the four keys without judging their values, so the service can name the code', () => {
    const parsed = MappingInputSchema.safeParse(mapping({ novice: 0 }))
    expect(parsed.success).toBe(true)
    // …and the rule then refuses it.
    expect(MappingSchema.safeParse(parsed.data).success).toBe(false)
  })

  it('still refuses a shape that is not four numbers', () => {
    expect(MappingInputSchema.safeParse({ novice: 1 }).success).toBe(false)
    expect(MappingInputSchema.safeParse(mapping({ professional: 'four' })).success).toBe(false)
  })
})
