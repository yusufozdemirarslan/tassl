import { describe, expect, it } from 'vitest'
import { GET } from '@/app/api/ready/route'

describe('GET /api/ready', () => {
  it('reports the database and the pgboss schema as ok against the local Postgres', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toMatchObject({ status: 'ready', checks: { db: 'ok', jobs: 'ok' } })
  })

  it('reports the assistant mode, which is scripted while FEATURE_AI is off (D-691)', async () => {
    // The suite runs with the flag off, so the environment decides and no row is consulted;
    // `tests/integration/admin/ai-mode.test.ts` reads the same field with the flag on.
    const body = (await (await GET()).json()) as { assistantMode: string }
    expect(body.assistantMode).toBe('scripted')
  })
})
