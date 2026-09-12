import { describe, expect, it } from 'vitest'
import { resetTargetProblem } from '../../../scripts/reset-target'

// D-744: a demo reset aimed at a deployment's database must carry that deployment's app URL, or the
// notification emails it writes are dead-lettered by the deployment's worker.

const NEON =
  'postgres://owner:secret@ep-example-123456.us-east-1.aws.neon.tech/neondb?sslmode=require'

describe('resetTargetProblem', () => {
  it('lets a local reset through whatever the app URL is', () => {
    expect(
      resetTargetProblem({
        databaseUrl: 'postgres://tassl:tassl@localhost:5432/tassl',
        appUrl: 'http://localhost:3000',
      }),
    ).toBeNull()
    expect(
      resetTargetProblem({
        databaseUrl: 'postgres://tassl:tassl@127.0.0.1:5432/tassl_test',
        appUrl: undefined,
      }),
    ).toBeNull()
  })

  it('lets a deployment reset through when the app URL is that deployment', () => {
    expect(resetTargetProblem({ databaseUrl: NEON, appUrl: 'https://tassl.vercel.app' })).toBeNull()
  })

  it('refuses a deployment database with the local app URL the .env supplies', () => {
    const problem = resetTargetProblem({ databaseUrl: NEON, appUrl: 'http://localhost:3000' })
    expect(problem).toContain('NEXT_PUBLIC_APP_URL is http://localhost:3000')
    expect(problem).toContain('https://tassl.vercel.app')
  })

  it('refuses a deployment database with no app URL, and with a plain-http one', () => {
    expect(resetTargetProblem({ databaseUrl: NEON, appUrl: undefined })).toContain(
      'NEXT_PUBLIC_APP_URL is not set',
    )
    expect(
      resetTargetProblem({ databaseUrl: NEON, appUrl: 'http://tassl.vercel.app' }),
    ).not.toBeNull()
  })

  it('names nothing secret: the database string never appears in the message', () => {
    const problem = resetTargetProblem({ databaseUrl: NEON, appUrl: 'http://localhost:3000' }) ?? ''
    expect(problem).not.toContain('secret')
    expect(problem).not.toContain('neon.tech')
  })
})
