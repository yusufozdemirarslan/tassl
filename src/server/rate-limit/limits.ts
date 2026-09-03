// Buckets and limits per minute (D-026, docs/tech/10-backend-spec.md §4).
export type RateLimitBucket = 'read' | 'write' | 'auth' | 'llm' | 'run-events'

export const RATE_LIMIT_WINDOW_MS = 60_000

export const RATE_LIMITS: Record<RateLimitBucket, number> = {
  read: 600, // per user
  write: 60, // per user
  auth: 10, // per IP and per account
  llm: 10, // per user
  'run-events': 300, // per user: document open/close, stance set, brief autosave
}
