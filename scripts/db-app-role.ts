// Sets the login password of the tassl_app database role (D-110; docs/tech/06-data-model.md §4).
// Run as the owner role with TASSL_APP_DB_PASSWORD in the environment:
//   pnpm exec tsx scripts/db-app-role.ts
// The migration `immutability` creates the role NOLOGIN; this script makes it usable and repeats the
// pgboss grants, which the migration can only apply when the pgboss schema already exists.
import 'dotenv/config'
import postgres from 'postgres'

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
  const password = process.env.TASSL_APP_DB_PASSWORD
  if (!url) throw new Error('DATABASE_URL is not set')
  if (!password || password.length < 16) {
    throw new Error('TASSL_APP_DB_PASSWORD must be set (at least 16 characters)')
  }

  const sql = postgres(url, { max: 1, prepare: false })
  try {
    const [role] = await sql<
      { rolname: string }[]
    >`select rolname from pg_roles where rolname = 'tassl_app'`
    if (!role) throw new Error('role tassl_app does not exist; run pnpm db:migrate first')
    // The password never reaches a log: postgres-js sends the statement without echoing it.
    await sql.unsafe(`alter role tassl_app login password '${password.replaceAll("'", "''")}'`)
    await sql.unsafe('grant usage on schema pgboss to tassl_app')
    await sql.unsafe(
      'grant select, insert, update, delete on all tables in schema pgboss to tassl_app',
    )
    await sql.unsafe('grant usage, select on all sequences in schema pgboss to tassl_app')
    await sql.unsafe(
      'alter default privileges in schema pgboss grant select, insert, update, delete on tables to tassl_app',
    )
    console.log('db-app-role: tassl_app can log in; pgboss grants applied')
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
