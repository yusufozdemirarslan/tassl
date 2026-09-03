import { describe, expect, it } from 'vitest'
import { GET } from '@/app/api/ready/route'

describe('GET /api/ready', () => {
  it('reports the database and the pgboss schema as ok against the local Postgres', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toMatchObject({ status: 'ready', checks: { db: 'ok', jobs: 'ok' } })
  })
})
