// User factory (docs/tech/06-data-model.md §5, D-040). Users are the one fixture written directly to
// the schema: sign-up belongs to Better Auth, and tests need seats without passwords. Ids and times
// are deterministic (uuidFrom, FROZEN_TIME).
import { eq } from 'drizzle-orm'
import { db } from '@/server/db/client'
import { user } from '@/server/db/schema'
import { emailFrom, uuidFrom } from './ids'
import { FROZEN_TIME } from './time'

export type UserRow = typeof user.$inferSelect

export type UserOverrides = {
  name?: string
  email?: string
  platformRole?: 'none' | 'tassl_scenario_editor' | 'admin'
  emailVerified?: boolean
}

/** Creates (or returns) the user labelled `label`, e.g. createUser('student-1'). */
export async function createUser(label: string, overrides: UserOverrides = {}): Promise<UserRow> {
  const id = uuidFrom(`user:${label}`)
  const [existing] = await db.select().from(user).where(eq(user.id, id))
  if (existing) return existing
  const [row] = await db
    .insert(user)
    .values({
      id,
      name: overrides.name ?? label,
      email: overrides.email ?? emailFrom(label),
      emailVerified: overrides.emailVerified ?? true,
      platform_role: overrides.platformRole ?? 'none',
      createdAt: FROZEN_TIME,
      updatedAt: FROZEN_TIME,
    })
    .returning()
  return row!
}
