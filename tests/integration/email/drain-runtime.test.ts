// A runtime with no HTML renderer must not claim send_email (D-431).
//
// `render()` reaches `react-dom/server`, and React resolves that specifier to a module whose only
// statement is a throw for anyone using the `react-server` export condition. `--conditions` is
// process-wide in Node, so `pnpm db:seed` (`tsx --conditions=react-server`, D-214) is exactly that
// runtime: it enqueues five seat verification mails, drains them inline because
// JOBS_DRAIN_ON_ENQUEUE is on, and used to fail every one of them without failing the script — the
// state this suite exists to keep from coming back. The mock is the failure the seed really sees;
// what is asserted is that the queue is left alone rather than burnt through its retries.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { getBoss, stopBoss } from '@/server/jobs/boss'
import { drainQueues } from '@/server/jobs/drain'
import { enqueue } from '@/server/jobs/enqueue'
import { clearHandlers, getHandler } from '@/server/jobs/handlers'
import { registerAllHandlers } from '@/server/jobs/handlers/register'

vi.mock('@react-email/render', () => ({
  render: () =>
    Promise.reject(new Error('react-dom/server is not supported in React Server Components.')),
}))

const TO = 'grace@example.test'

describe('send_email in a process that cannot render', () => {
  // Nothing is cleared first: the other three handlers register when `register.ts` is imported, and
  // this suite is about which of them `registerAllHandlers()` is willing to add on top.
  beforeAll(async () => {
    const boss = await getBoss()
    await boss.deleteAllJobs()
  })

  afterAll(async () => {
    clearHandlers()
    const boss = await getBoss()
    await boss.deleteAllJobs()
    await stopBoss()
  })

  it('leaves the queue unclaimed and the job queued instead of failing it', async () => {
    await registerAllHandlers()
    expect(getHandler('send_email')).toBeUndefined()
    // The other handlers are unaffected: only email needs a renderer.
    expect(getHandler('score_run')).toBeDefined()
    expect(getHandler('purge_deleted_accounts')).toBeDefined()

    const jobId = await enqueue(
      'send_email',
      { to: TO, template: 'verify-email', props: { url: 'http://localhost:3000/verify-email' } },
      { drain: false },
    )
    expect(jobId).not.toBeNull()

    const result = await drainQueues({ maxMs: 5_000 })

    expect(result.skippedQueues).toContain('send_email')
    expect(result.failed).toBe(0)

    const boss = await getBoss()
    const queued = await boss.findJobs('send_email', { queued: true })
    expect(queued).toHaveLength(1)
    expect(queued[0]?.id).toBe(jobId)
    // Never touched, so a runtime that can render still delivers it.
    expect(queued[0]?.retryCount).toBe(0)
  })
})
