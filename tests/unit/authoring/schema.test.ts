// The two numbers `authoring/schema.ts` states that belong to something else (D-550).
//
// A module schema may import `src/lib` and nothing else (04 §2), so the staleness window cannot be
// computed from the queue option it is derived from. That leaves a literal, and a literal that
// nobody pins is a number that drifts the first time the queue's timeouts move — which would either
// call a live worker dead (two workers on one step) or leave a wedged version wedged for longer than
// anybody looking at the screen will wait.
import { describe, expect, it } from 'vitest'
import {
  GENERATION_RUN_ABANDONED,
  GENERATION_RUN_STALE_AFTER_MS,
  GENERATION_RUN_STATUSES,
  MAX_GENERATION_PASSES,
} from '@/server/modules/authoring/schema'
import { QUEUE_OPTIONS } from '@/server/jobs/queues'

/** `vercel.json` / the route segment config: the longest a Node invocation may live (13 §2). */
const MAX_DURATION_SECONDS = 300

describe('the abandoned-run window', () => {
  it('is longer than any single attempt at a step can possibly live', () => {
    const expire = QUEUE_OPTIONS.generate_package_step.expireInSeconds
    // The queue gives up on an attempt at `expireInSeconds`, and the platform kills the invocation
    // at `maxDuration`; the later of the two is the longest a claim can still have a worker behind
    // it. Every redelivery re-claims through `claimStep` and stamps a fresh `started_at`, so this
    // bounds one attempt and never the whole retry chain.
    const longestAttemptMs = Math.max(expire, MAX_DURATION_SECONDS) * 1000
    expect(GENERATION_RUN_STALE_AFTER_MS).toBeGreaterThanOrEqual(longestAttemptMs * 2)
    expect(GENERATION_RUN_STALE_AFTER_MS).toBe(3 * MAX_DURATION_SECONDS * 1000)
  })

  it('is short enough that an author is not left watching a dead pipeline all day', () => {
    expect(GENERATION_RUN_STALE_AFTER_MS).toBeLessThanOrEqual(30 * 60 * 1000)
  })

  it('closes a swept row out with a reason that is not a rule code', () => {
    // DATA-027 keeps `failed_rules` for the validator's codes; a run nobody finished broke no rule,
    // so it travels in `error` and the screen prints it as the sentence it is.
    expect(GENERATION_RUN_ABANDONED).toBe('GENERATION_ABANDONED')
  })
})

describe('the run statuses the claim decides on', () => {
  it('are the four of the job_status enum, so the claim decision is total', () => {
    expect([...GENERATION_RUN_STATUSES]).toEqual(['queued', 'running', 'succeeded', 'failed'])
  })

  it('gives a step one retry and no more', () => {
    expect(MAX_GENERATION_PASSES).toBe(2)
  })
})
