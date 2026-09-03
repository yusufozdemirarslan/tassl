// Database client (phase-00 step 0.6). The only module that opens connections; repositories and
// src/server/http/readiness.ts import `db` from here (docs/tech/04-repo-structure.md §2).
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '@/server/config'
import * as schema from '@/server/db/schema'

// prepare: false is required for Neon's pooled connection string; max 5 per serverless instance.
// In preview and production DATABASE_URL is built for the tassl_app role (D-085, D-110; Phase 15
// sets its password), so the immutability grants of migration 0009 apply to every app query.
export const client = postgres(env.DATABASE_URL, { max: 5, prepare: false })

// The schema object gives the query builder every table and relation (06-data-model.md §1).
export const db = drizzle({ client, schema })

export { sql }

/** Resolves when the database answers `select 1` within timeoutMs; rejects with Error('timeout') otherwise. */
export async function pingDb(timeoutMs = 2000): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), timeoutMs)
    timer.unref()
  })
  try {
    await Promise.race([db.execute(sql`select 1`), timeout])
  } finally {
    clearTimeout(timer)
  }
}
