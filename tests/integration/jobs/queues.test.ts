// Step 2.7 (SYS-020, INT-010, D-012): the five queues exist with the 10 §7 options, enqueue → drain
// runs a registered handler once, and the drain route enforces the cron bearer.
// Job rows live in the pgboss schema (not touched by truncateAll); the suite clears them itself.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/internal/jobs/drain/route'
import { getBoss, stopBoss } from '@/server/jobs/boss'
import { drainQueues } from '@/server/jobs/drain'
import { enqueue } from '@/server/jobs/enqueue'
import { clearHandlers, registerHandler, type JobHandler } from '@/server/jobs/handlers'
import { deadLetterQueue, QUEUE_NAMES, utcDateKey } from '@/server/jobs/queues'

const noParams = { params: Promise.resolve({}) }

describe('pg-boss queues', () => {
  beforeAll(async () => {
    const boss = await getBoss()
    await boss.deleteAllJobs()
  })

  afterAll(async () => {
    clearHandlers()
    await stopBoss()
  })

  it('creates the five queues with retryLimit 3 and a dead-letter queue each', async () => {
    const boss = await getBoss()
    for (const name of QUEUE_NAMES) {
      const queue = await boss.getQueue(name)
      expect(queue, name).not.toBeNull()
      expect(queue).toMatchObject({
        retryLimit: 3,
        retryDelay: 30,
        retryBackoff: true,
        expireInSeconds: 280,
        deadLetter: deadLetterQueue(name),
      })
      expect(await boss.getQueue(deadLetterQueue(name)), deadLetterQueue(name)).not.toBeNull()
    }
  })

  it('runs a registered handler once when the queue is drained', async () => {
    const handler = vi.fn<JobHandler<'send_email'>>(async () => {})
    registerHandler('send_email', handler)
    const jobId = await enqueue(
      'send_email',
      { to: 'a@example.test', template: 'verify-email', props: {} },
      { drain: false },
    )
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/)

    const result = await drainQueues({ maxMs: 10000 })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0]?.[0]).toEqual({
      to: 'a@example.test',
      template: 'verify-email',
      props: {},
    })
    expect(handler.mock.calls[0]?.[1]).toMatchObject({ jobId })
    expect(result.processed).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.skippedQueues).toEqual([
      'score_run',
      'generate_package_step',
      'recompute_exports',
    ])
  })

  it('fails a job whose handler throws and reports it', async () => {
    registerHandler('send_email', async () => {
      throw new Error('smtp down')
    })
    await enqueue(
      'send_email',
      { to: 'b@example.test', template: 'verify-email', props: {} },
      { drain: false },
    )
    const result = await drainQueues({ maxMs: 10000 })
    expect(result.failed).toBe(1)
    expect(result.processed).toBe(0)
    const boss = await getBoss()
    await boss.deleteAllJobs('send_email')
  })

  it('rejects the drain route without the cron bearer', async () => {
    const res = await GET(new Request('http://t/api/internal/jobs/drain'), noParams)
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } })
  })

  it('drains and schedules maintenance with the cron bearer', async () => {
    const res = await GET(
      new Request('http://t/api/internal/jobs/drain', {
        headers: { authorization: 'Bearer local-cron-secret' },
      }),
      noParams,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      processed: number
      failed: number
      skippedQueues: string[]
      durationMs: number
    }
    // Step 3.3 registered purge_deleted_accounts, so the cron drain schedules the daily purge and
    // then runs it in the same pass; only the queues without a handler are skipped.
    expect(body).toMatchObject({ failed: 0 })
    expect(body.processed).toBeGreaterThanOrEqual(1)
    expect(body.skippedQueues).not.toContain('purge_deleted_accounts')
    expect(body.durationMs).toBeGreaterThanOrEqual(0)

    // Queue counters on pgboss.queue are refreshed by the supervisor, which is off (D-012): read the job.
    const boss = await getBoss()
    const purge = await boss.findJobs('purge_deleted_accounts', { key: `purge:${utcDateKey()}` })
    expect(purge.length).toBeGreaterThanOrEqual(1)
  })
})
