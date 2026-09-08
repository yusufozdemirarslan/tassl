// Session revocation for incident containment (docs/tech/12-security.md §9.3, "compromised
// account"). Deleting the session rows is what Better Auth treats as revocation: the cookie still
// exists in the browser but resolves to nothing, so the next request is unauthenticated.
//
//   pnpm exec tsx scripts/revoke-sessions.ts --email student1@tassl.local
//   pnpm exec tsx scripts/revoke-sessions.ts --email student1@tassl.local --dry-run
//   pnpm exec tsx scripts/revoke-sessions.ts --all
//
// `--all` revokes every session in the deployment; it is the containment step for a leaked
// BETTER_AUTH_SECRET or a suspected token theft, and everyone signs in again afterwards.
// `--dry-run` counts what would go without touching anything, because the argument is typed under
// incident pressure (D-586).
//
// Run it with production values in the shell (the env pull in 13-observability-ops.md §8), then
// record the run in the incident record: the file under docs/incidents/ is the log for operator
// actions, exactly as §9.4 asks for rotations. It writes no audit row — audit_logs is the record of
// what the *application* did, and adding a platform action to that enum here would put a second,
// unauthenticated writer on an append-only table (D-587).
import 'dotenv/config'
import { count, eq } from 'drizzle-orm'
import { client, db } from '@/server/db/client'
import { session, user } from '@/server/db/schema'

type Mode = { kind: 'email'; email: string } | { kind: 'all' }

const USAGE =
  'usage: pnpm exec tsx scripts/revoke-sessions.ts --email <address> | --all [--dry-run]'

function parseArgs(argv: string[]): { mode: Mode; dryRun: boolean } | null {
  const dryRun = argv.includes('--dry-run')
  const rest = argv.filter((arg) => arg !== '--dry-run')
  if (rest.length === 1 && rest[0] === '--all') return { mode: { kind: 'all' }, dryRun }
  if (rest.length === 2 && rest[0] === '--email' && rest[1]) {
    return { mode: { kind: 'email', email: rest[1] }, dryRun }
  }
  return null
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2))
  if (!parsed) {
    console.error(USAGE)
    process.exitCode = 2
    return
  }
  const { mode, dryRun } = parsed

  if (mode.kind === 'all') {
    const [row] = await db.select({ value: count() }).from(session)
    const total = row?.value ?? 0
    if (dryRun) {
      console.log(
        `revoke-sessions: --dry-run; ${total} session(s) would be revoked deployment-wide`,
      )
      return
    }
    const revoked = await db.delete(session).returning({ id: session.id })
    console.log(`revoke-sessions: ${revoked.length} session(s) revoked deployment-wide`)
    return
  }

  const [owner] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, mode.email))
    .limit(1)
  if (!owner) {
    // A typo must not read as "the account had no sessions".
    console.error(`revoke-sessions: no account with email ${mode.email}`)
    process.exitCode = 1
    return
  }

  if (dryRun) {
    const [row] = await db
      .select({ value: count() })
      .from(session)
      .where(eq(session.userId, owner.id))
    console.log(
      `revoke-sessions: --dry-run; ${row?.value ?? 0} session(s) would be revoked for ${mode.email}`,
    )
    return
  }

  const revoked = await db
    .delete(session)
    .where(eq(session.userId, owner.id))
    .returning({ id: session.id })
  console.log(`revoke-sessions: ${revoked.length} session(s) revoked for ${mode.email}`)
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => client.end({ timeout: 5 }))
