import { describe, expect, it } from 'vitest'
import { AppError, DEFAULT_MESSAGES, DEFAULT_STATUS, ERROR_STATUS, isAppError } from '@/lib/errors'

describe('AppError', () => {
  it.each([
    ['VALIDATION_ERROR', 400],
    ['UNAUTHENTICATED', 401],
    ['FORBIDDEN', 403],
    ['NOT_FOUND', 404],
    ['CONFLICT', 409],
    ['RATE_LIMITED', 429],
    ['LLM_BUDGET_EXCEEDED', 402],
    ['LLM_PROVIDER_ERROR', 502],
    ['LLM_CIRCUIT_OPEN', 503],
    ['LLM_OUTPUT_INVALID', 502],
    ['INTERNAL_ERROR', 500],
  ] as const)('%s maps to %i', (code, status) => {
    expect(new AppError(code).status).toBe(status)
    expect(DEFAULT_STATUS[code]).toBe(status)
  })

  it('every registered code has a default message', () => {
    for (const code of Object.keys(ERROR_STATUS) as Array<keyof typeof ERROR_STATUS>) {
      expect(DEFAULT_MESSAGES[code]).toBeTruthy()
      expect(new AppError(code).message).toBe(DEFAULT_MESSAGES[code])
    }
  })

  it('keeps an explicit message, status, and details', () => {
    const err = new AppError('CONFLICT', 'Lock refused.', { status: 412, details: { rule: 'x' } })
    expect(err.message).toBe('Lock refused.')
    expect(err.status).toBe(412)
    expect(err.opts.details).toEqual({ rule: 'x' })
    expect(err.name).toBe('AppError')
    expect(err).toBeInstanceOf(Error)
  })

  it('isAppError narrows', () => {
    expect(isAppError(new AppError('NOT_FOUND'))).toBe(true)
    expect(isAppError(new Error('x'))).toBe(false)
    expect(isAppError(null)).toBe(false)
  })
})
