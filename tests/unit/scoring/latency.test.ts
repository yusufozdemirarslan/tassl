// NFR-001's two latency numbers, and the one that has to be reachable (D-047, D-425; 13 §5).
//
// `scoreRun` raises `scoring_slow` when one attempt takes longer than `SCORING_SLOW_MS`. That is a
// threshold on a *single job attempt*, so it is bounded by how long an attempt is allowed to live:
// `score_run` has `expireInSeconds` (10 §7), and in production the drain that runs it has a budget
// inside a route the platform caps at 300 seconds. At 480,000 ms the alert sat three minutes past
// the point where the queue expires the job and re-dispatches it beside the attempt still running —
// so the alert could never fire, and the only thing the excess produced was a second concurrent
// attempt at the same run.
//
// D-047's eight minutes is not lost: 13 §5 gives it to `scoring_overdue`, measured by the drain from
// `defense_completed_at`, which is what NFR-001 actually states — the debrief exists within ten
// minutes of the defense completing, queue wait and retries included. Both alerts feed one Sentry
// rule, so the posture is unchanged and the per-attempt half now works.
import { describe, expect, it } from 'vitest'
import { SCORING_SLOW_MS } from '@/server/modules/scoring'
import { QUEUE_OPTIONS } from '@/server/jobs/queues'

/** 10 §7's drain budget, from `src/app/api/internal/jobs/drain/route.ts`. */
const DRAIN_BUDGET_MS = 270_000
/** NFR-001's p95 target with the real provider. */
const REAL_PROVIDER_TARGET_MS = 180_000

describe('the slow-scoring alert can actually fire', () => {
  const expiryMs = QUEUE_OPTIONS.score_run.expireInSeconds * 1000

  it('sits below the queue expiry, so an attempt reaches it before it is re-dispatched', () => {
    expect(SCORING_SLOW_MS).toBeLessThan(expiryMs)
  })

  it('sits below the drain’s own budget, so it is reachable on the production path', () => {
    expect(SCORING_SLOW_MS).toBeLessThan(DRAIN_BUDGET_MS)
  })

  it('sits above NFR-001’s p95 target, so a healthy run is silent', () => {
    expect(SCORING_SLOW_MS).toBeGreaterThan(REAL_PROVIDER_TARGET_MS)
  })

  it('is the number D-425 settled on', () => {
    expect(SCORING_SLOW_MS).toBe(240_000)
    expect(QUEUE_OPTIONS.score_run.expireInSeconds).toBe(280)
  })
})
