// enforceRateLimit(): docs/tech/10-backend-spec.md §4, 12-security.md §3 (A09), 13 §2.6 and §3.8.
import { AppError } from '@/lib/errors'
import { track } from '@/server/analytics/track'
import { getLogger } from '@/server/http/request-context'
import { hashId } from '@/server/logging/logger'
import { alertOps, countOps } from '@/server/logging/ops-events'
import { getRateLimiter } from '@/server/rate-limit/index'
import { RATE_LIMITS, type RateLimitBucket } from '@/server/rate-limit/limits'

export type RateLimitScope = 'user' | 'ip'

export type RateLimitSubject = {
  /** Raw key: the user id, or the client IP for anonymous requests. Only its hash is logged. */
  key: string
  scope: RateLimitScope
  userId?: string | null
  organizationId?: string | null
}

const ANALYTICS_BUCKET = {
  read: 'user_reads',
  write: 'user_writes',
  auth: 'auth',
  llm: 'llm',
  'run-events': 'run_events',
} as const

/** Throws RATE_LIMITED (429, Retry-After) when the subject exceeded the bucket's limit. */
export async function enforceRateLimit(
  bucket: RateLimitBucket,
  subject: RateLimitSubject,
): Promise<void> {
  const limit = RATE_LIMITS[bucket]
  const decision = await getRateLimiter().hit(`${bucket}:${subject.key}`, limit)
  if (decision.allowed) return

  getLogger().warn(
    { event: 'rate_limit', bucket, key: hashId(subject.key), limit },
    'rate limit exceeded',
  )
  countOps(
    'ops_rate_limit_hit',
    { bucket, limit },
    subject.userId ? hashId(subject.userId) : 'system',
  )
  if (bucket === 'auth') alertOps('auth_rate_limited', { bucket, limit })
  track(
    'rate_limited',
    { bucket: ANALYTICS_BUCKET[bucket], scope: subject.scope },
    { userId: subject.userId ?? null, organizationId: subject.organizationId ?? null },
  )

  throw new AppError('RATE_LIMITED', undefined, {
    details: { bucket, retryAfterSeconds: decision.retryAfterSeconds },
  })
}
