// `Idempotency-Key` (docs/tech/07-api-spec.md §1; 10-backend-spec.md §11).
//
// 07 §1: "`Idempotency-Key` header accepted on the routes marked *idempotent*; a repeat within 24 h
// returns the original result". A client whose Start times out has no way to know whether the run
// was created; without this it retries and is told it already has one, which is true and useless.
// (D-231, which replaces the earlier reading that D-041's refusal already was the rule: it prevents
// the duplicate, and leaves the retry with no way to reach what the first attempt made.)
//
// What is remembered, and what is not
// -----------------------------------
// The key is a *receipt*, not a cache of the response. A route declares `idempotency.replay`, which
// answers what this actor's request already produced, and this file remembers only that the key was
// used. Two reasons: what the client wants back is the resource as it now stands — a run whose
// state a poll is about to follow — not the bytes the first attempt sent; and a stored body would
// be a second copy of a run, free to disagree with the row.
//
// The receipt is written *after* the handler succeeded, which is what keeps a replay honest. A
// first attempt that was refused — a genuine second Start, D-041 — leaves no receipt, so the retry
// meets the same refusal rather than being handed a run it never created. The cost is the narrow
// window between the commit and the receipt: a crash there loses the receipt and the retry is
// refused, exactly as it is today. Two Starts with one key arriving together likewise both run,
// and the unique index on `(assignment_id, student_id, attempt_no)` refuses one of them.
//
// Where it is stored
// ------------------
// 10 §11 puts the key in `rate_limit_buckets` under `idem:<userId>:<key>` for 24 h. That table has
// three columns — `key`, `window_start`, `count` — and no room for a value, which is the other
// reason the receipt holds none. Two refinements of the spec line, both for safety:
//
//   * the operation is part of the stored key (`idem:<userId>:<operationId>:<key>`), so one key
//     reused across two endpoints cannot replay the other one's resource;
//   * `window_start` holds the instant the receipt *expires*, not the instant it was written. A
//     receipt is live while `window_start > now()`, which is the 24 h rule, and the sliding-window
//     limiter's own sweep (`delete … where window_start < now − 3 min`, `rate-limit/sliding-window.ts`)
//     then collects it three minutes after it expires. Nothing else in that table is ever read by
//     prefix, and no `read:`/`write:` bucket key can collide with an `idem:` one.
import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { AppError } from '@/lib/errors'
import { db } from '@/server/db/client'

/** The header, lower-cased the way `Headers.get` compares it. */
export const IDEMPOTENCY_HEADER = 'idempotency-key'

/** 07 §1: "a repeat within 24 h returns the original result". */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000

/** `openapi.yaml` documents the header as `maxLength: 128`; this is that bound. */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128

/** Printable ASCII without spaces: a UUID, a ULID, or any opaque token a client generates. */
const KEY_PATTERN = /^[\x21-\x7e]+$/

/**
 * The key the request carries, or null when it carries none.
 *
 * A malformed key is a 400 rather than a silent fallback to "not idempotent": a client that meant
 * to be safe under retry should be told its key was ignored, not discover it by creating a second
 * run.
 */
export function readIdempotencyKey(request: Request): string | null {
  const raw = request.headers.get(IDEMPOTENCY_HEADER)
  if (raw === null) return null
  const key = raw.trim()
  if (key === '' || key.length > IDEMPOTENCY_KEY_MAX_LENGTH || !KEY_PATTERN.test(key)) {
    throw new AppError('VALIDATION_ERROR', 'Invalid Idempotency-Key header.', {
      details: {
        header: 'Idempotency-Key',
        rule: `1 to ${IDEMPOTENCY_KEY_MAX_LENGTH} printable characters without spaces`,
      },
    })
  }
  return key
}

/**
 * The row key of 10 §11, with the operation folded in.
 *
 * The client's key travels as a hash: it is opaque text this service never has to read back, the
 * column is shared with the rate limiter, and a hash keeps whatever a client chose to put in it
 * (an order id, an email) out of the table and out of any log line that quotes the key.
 */
export function idempotencyStorageKey(userId: string, operationId: string, key: string): string {
  const digest = createHash('sha256').update(key).digest('base64url')
  return `idem:${userId}:${operationId}:${digest}`
}

/** Whether this actor already completed this operation under this key, within the 24 h window. */
export async function hasIdempotencyReceipt(storageKey: string): Promise<boolean> {
  const rows = await db.execute<{ one: number }>(sql`
    select 1 as one from rate_limit_buckets
     where key = ${storageKey} and window_start > now()
     limit 1`)
  return (Array.isArray(rows) ? rows.length : 0) > 0
}

/**
 * Records that the operation completed under this key. Called after the handler succeeded, never
 * before, so a refusal leaves nothing behind to replay.
 */
export async function writeIdempotencyReceipt(
  storageKey: string,
  now: Date = new Date(),
): Promise<void> {
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString()
  await db.execute(sql`
    insert into rate_limit_buckets (key, window_start, count)
    values (${storageKey}, ${expiresAt}::timestamptz, 1)
    on conflict (key, window_start) do nothing`)
}
