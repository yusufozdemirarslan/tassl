// @vitest-environment node
// The pure half of `Idempotency-Key` (docs/tech/07-api-spec.md §1, 10-backend-spec.md §11): what
// counts as a key, and what row it is remembered under. The replay itself needs a database and is
// exercised end to end in tests/integration/api/runs.test.ts.
import { describe, expect, it } from 'vitest'
import { isAppError } from '@/lib/errors'
import {
  IDEMPOTENCY_KEY_MAX_LENGTH,
  idempotencyStorageKey,
  readIdempotencyKey,
} from '@/server/http/idempotency'

const withKey = (key: string): Request =>
  new Request('http://t/api/v1/assignments/a/runs', {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
  })

const codeOf = (fn: () => unknown): string => {
  try {
    fn()
    return 'no error'
  } catch (error) {
    return isAppError(error) ? error.code : String(error)
  }
}

describe('readIdempotencyKey', () => {
  it('answers null when the request carries no key', () => {
    expect(readIdempotencyKey(new Request('http://t/api/v1/x', { method: 'POST' }))).toBeNull()
  })

  it('accepts an opaque token and trims the surrounding whitespace', () => {
    expect(readIdempotencyKey(withKey('01J8Z4S8Q5B3F1V6E9K2N7M0TA'))).toBe(
      '01J8Z4S8Q5B3F1V6E9K2N7M0TA',
    )
    expect(readIdempotencyKey(withKey('  6f9b1a2c-0000-4000-8000-000000000000  '))).toBe(
      '6f9b1a2c-0000-4000-8000-000000000000',
    )
  })

  it('refuses an empty, oversized, or whitespace-bearing key rather than ignoring it', () => {
    // A client that meant to be safe under retry must learn its key was unusable here, not find out
    // by creating a second run.
    expect(codeOf(() => readIdempotencyKey(withKey('   ')))).toBe('VALIDATION_ERROR')
    expect(codeOf(() => readIdempotencyKey(withKey('has a space')))).toBe('VALIDATION_ERROR')
    expect(
      codeOf(() => readIdempotencyKey(withKey('a'.repeat(IDEMPOTENCY_KEY_MAX_LENGTH + 1)))),
    ).toBe('VALIDATION_ERROR')
    expect(readIdempotencyKey(withKey('a'.repeat(IDEMPOTENCY_KEY_MAX_LENGTH)))).toHaveLength(
      IDEMPOTENCY_KEY_MAX_LENGTH,
    )
  })
})

describe('idempotencyStorageKey (10 §11)', () => {
  const KEY = '01J8Z4S8Q5B3F1V6E9K2N7M0TA'

  it('is namespaced by actor and by operation, and carries the key only as a hash', () => {
    const mine = idempotencyStorageKey('user-1', 'startRun', KEY)
    expect(mine.startsWith('idem:user-1:startRun:')).toBe(true)
    // The client's key is opaque text this service never reads back, and the column is shared with
    // the rate limiter: whatever a client put in it stays out of the table.
    expect(mine).not.toContain(KEY)

    // Two people retrying with the same key are two receipts, and one key reused across endpoints
    // cannot replay the other endpoint's resource.
    expect(idempotencyStorageKey('user-2', 'startRun', KEY)).not.toBe(mine)
    expect(idempotencyStorageKey('user-1', 'startGeneration', KEY)).not.toBe(mine)
  })

  it('is stable, so a retry finds the receipt the first call wrote', () => {
    expect(idempotencyStorageKey('user-1', 'startRun', KEY)).toBe(
      idempotencyStorageKey('user-1', 'startRun', KEY),
    )
    expect(idempotencyStorageKey('user-1', 'startRun', `${KEY}x`)).not.toBe(
      idempotencyStorageKey('user-1', 'startRun', KEY),
    )
  })
})
