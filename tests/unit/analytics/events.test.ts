// @vitest-environment node
// The catalogue is the contract: docs/tech/17-analytics-events.md §9.2.
//
// These tests are the enforcement behind rule 3 of 17 §1 — "properties are ids, enums, counts,
// durations, shares and booleans; never names, emails, free text, claim texts, document bodies,
// defense answers, justifications, statements, purposes, notes, or IP addresses". A schema that
// declares a free-form string, or a property named `email`, fails here rather than in production.
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  EVENTS,
  EVENT_NAMES,
  FORBIDDEN_PROPERTY_PATTERN,
  MAX_PROPERTY_STRING_LENGTH,
} from '@/lib/analytics/events'
import { eventExamples } from '@tests/factories/analytics'

type Def = {
  type: string
  innerType?: z.ZodType
  element?: z.ZodType
  format?: string
  checks?: unknown[]
  shape?: Record<string, z.ZodType>
}
const def = (schema: z.ZodType): Def => (schema as unknown as { def: Def }).def

function unwrap(schema: z.ZodType): z.ZodType {
  const d = def(schema)
  return d.type === 'optional' || d.type === 'nullable' ? unwrap(d.innerType as z.ZodType) : schema
}

function assertAllowedLeaf(path: string, schema: z.ZodType): void {
  const d = def(unwrap(schema))
  if (d.type === 'array') {
    assertAllowedLeaf(`${path}[]`, d.element as z.ZodType)
    return
  }
  if (d.type === 'boolean' || d.type === 'number' || d.type === 'int' || d.type === 'enum') return
  if (d.type === 'string') {
    // A uuid or a regex; a bare string is how free text gets in.
    const constrained = d.format === 'uuid' || (d.checks?.length ?? 0) > 0
    expect(constrained, `${path} is a free-form string`).toBe(true)
    return
  }
  throw new Error(`${path}: leaf kind ${d.type} is not allowed`)
}

const shapeOf = (name: (typeof EVENT_NAMES)[number]): Record<string, z.ZodType> =>
  def(EVENTS[name]).shape as Record<string, z.ZodType>

describe('analytics events', () => {
  it('has an example for every event and every example validates', () => {
    for (const name of EVENT_NAMES) {
      const result = EVENTS[name].safeParse(eventExamples[name])
      expect(result.success, `${name}: ${result.success ? '' : result.error.message}`).toBe(true)
    }
  })

  it('rejects unknown properties (allowlist by construction)', () => {
    for (const name of EVENT_NAMES) {
      const result = EVENTS[name].safeParse({ ...eventExamples[name], email: 'x@y.z' })
      expect(result.success, name).toBe(false)
    }
  })

  it('never declares a forbidden property name and only allowed leaf kinds', () => {
    for (const name of EVENT_NAMES) {
      for (const [key, schema] of Object.entries(shapeOf(name))) {
        expect(FORBIDDEN_PROPERTY_PATTERN.test(key), `${name}.${key}`).toBe(false)
        assertAllowedLeaf(`${name}.${key}`, schema)
      }
    }
  })

  it('uses snake_case object_verb names', () => {
    for (const name of EVENT_NAMES) expect(name).toMatch(/^[a-z]+(_[a-z]+)+$/)
  })

  // A run-scoped event is one whose `run_id` is required. `llm_call` is the deliberate exception:
  // it carries a *nullable* run id because a generation call belongs to a package version and not
  // to any run, so it is an operations event with a pointer, not a run event (17 §3.6).
  const isRunScoped = (name: (typeof EVENT_NAMES)[number]): boolean => {
    const runId = shapeOf(name).run_id
    return runId !== undefined && def(runId).type !== 'nullable'
  }

  it('carries is_walkthrough on every run-scoped event', () => {
    for (const name of EVENT_NAMES) {
      if (isRunScoped(name)) expect(shapeOf(name).is_walkthrough, name).toBeDefined()
    }
  })

  it('carries the whole R group wherever it is run-scoped', () => {
    for (const name of EVENT_NAMES) {
      if (!isRunScoped(name)) continue
      const shape = shapeOf(name)
      for (const key of ['assignment_id', 'package_version_id', 'variant', 'mode', 'attempt_no']) {
        expect(shape[key], `${name}.${key}`).toBeDefined()
      }
    }
  })

  it('treats llm_call as the one event with a nullable run id', () => {
    expect(isRunScoped('llm_call')).toBe(false)
    expect(EVENT_NAMES.filter((name) => !isRunScoped(name) && 'run_id' in shapeOf(name))).toEqual([
      'llm_call',
    ])
  })
})

describe('the property allowlist', () => {
  it('forbids the property names that would carry a person or authored text', () => {
    for (const key of [
      'name',
      'email',
      'text',
      'user_name',
      'student_email',
      'answer_text',
      'body',
      'ip',
      'justification',
      'statement',
      'purpose',
      'note',
      'url',
      'token',
    ]) {
      expect(FORBIDDEN_PROPERTY_PATTERN.test(key), key).toBe(true)
    }
  })

  it('allows the property names the catalogue actually uses', () => {
    for (const key of [
      'run_id',
      'documents_opened_count',
      'duration_ms',
      'prompt',
      'model',
      'bands_status',
      'nothing_answered',
      'has_note',
      'has_why',
      'note_count',
    ]) {
      expect(FORBIDDEN_PROPERTY_PATTERN.test(key), key).toBe(false)
    }
  })

  it('caps a property string well below the length of a sentence someone wrote', () => {
    expect(MAX_PROPERTY_STRING_LENGTH).toBe(200)
  })
})
