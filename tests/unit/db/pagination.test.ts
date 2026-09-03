import { describe, expect, it } from 'vitest'
import { AppError } from '@/lib/errors'
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  clampLimit,
  decodeCursor,
  encodeCursor,
  toPage,
} from '@/server/db/pagination'

describe('cursor pagination (10 §11, D-020)', () => {
  it('round-trips a cursor', () => {
    const row = { createdAt: new Date('2026-09-01T09:00:00.123Z'), id: crypto.randomUUID() }
    const cursor = encodeCursor(row)
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeCursor(cursor)).toEqual(row)
  })

  it('treats a missing cursor as the first page and rejects a malformed one', () => {
    expect(decodeCursor(undefined)).toBeNull()
    expect(decodeCursor('')).toBeNull()
    expect(() => decodeCursor('not-a-cursor')).toThrow(AppError)
    expect(() => decodeCursor(Buffer.from('garbage|').toString('base64url'))).toThrow(AppError)
  })

  it('clamps the limit to 1..100 with a default of 20', () => {
    expect(clampLimit(undefined)).toBe(DEFAULT_LIMIT)
    expect(clampLimit(Number.NaN)).toBe(DEFAULT_LIMIT)
    expect(clampLimit(0)).toBe(1)
    expect(clampLimit(1000)).toBe(MAX_LIMIT)
    expect(clampLimit(33.7)).toBe(33)
  })

  it('derives the next cursor only when more rows exist', () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({
      id: `id-${i}`,
      createdAt: new Date(Date.UTC(2026, 8, 1, 9, 0, 10 - i)),
    }))
    const full = toPage(rows, 3)
    expect(full.items).toHaveLength(3)
    expect(full.nextCursor).toBe(encodeCursor(rows[2]!))
    const last = toPage(rows.slice(0, 2), 3)
    expect(last.items).toHaveLength(2)
    expect(last.nextCursor).toBeNull()
  })
})
