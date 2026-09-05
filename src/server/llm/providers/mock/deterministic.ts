// The mock provider's determinism (docs/tech/11-llm-integration.md §1.4, D-063).
//
// "Deterministic" here is a product requirement, not a testing convenience. `FEATURE_AI=false` is
// the default in every environment until Phase 14, so the mock is what the walkthrough runs on, what
// the E2E suite asserts against, and what the evals must score 100 percent on (D-064). Two identical
// requests that produced two different replies would make every one of those flaky, and would make a
// student's second delegation on the same question look like new information.
//
// Everything the mock decides — which template, which numbers a generated package carries — comes
// from a hash of its input and nothing else. No `Date.now()`, no `Math.random()`, no counter.
import { createHash } from 'node:crypto'

/**
 * JSON with object keys sorted at every depth, so two structurally equal inputs hash the same
 * however they were built. Arrays keep their order, because order is meaning; `undefined` values
 * are dropped, so an absent optional and an explicit `undefined` are one input.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
  return `{${entries.join(',')}}`
}

/** A 32-bit unsigned seed from the first four bytes of sha256; stable across processes and runs. */
export function hash32(text: string): number {
  return createHash('sha256').update(text).digest().readUInt32BE(0)
}

export const seedOf = (value: unknown): number => hash32(stableStringify(value))

/**
 * mulberry32: 32 bits of state, uniform enough for choosing a template and a plausible figure, and
 * short enough to read. The point is reproducibility, not statistical quality.
 */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** An integer in `[min, max]`, inclusive. */
export const intBetween = (rng: () => number, min: number, max: number): number =>
  min + Math.floor(rng() * (max - min + 1))

/** `items[(offset + index) % items.length]`, for rotating through a fixed set without repeating. */
export function rotate<T>(items: readonly T[], offset: number, index = 0): T {
  const item = items[(((offset + index) % items.length) + items.length) % items.length]
  if (item === undefined) throw new Error('MOCK_TEMPLATE_SET_EMPTY')
  return item
}
