// Schema drift gate (docs/prompts/02-qa-and-guides.md C6): `drizzle-kit generate` against the
// current schema must produce no new migration.
//
//   pnpm db:drift
//
// The committed `drizzle/` folder is copied to a scratch directory and drizzle-kit is asked to
// generate into the copy, so a diff never touches the real folder. A new `.sql` file in the copy
// means the TypeScript schema and the migrations disagree — somebody changed `src/server/db/schema`
// without running `pnpm db:generate` — and that is the failure this gate exists to catch. The
// check needs no database: drizzle-kit diffs the schema against the snapshot in `drizzle/meta`.
import { execSync } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REPO = process.cwd()
const MIGRATIONS = join(REPO, 'drizzle')

const sqlFiles = (dir: string): string[] =>
  readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()

function main(): void {
  const scratch = mkdtempSync(join(tmpdir(), 'tassl-drift-'))
  const out = join(scratch, 'drizzle')
  cpSync(MIGRATIONS, out, { recursive: true })
  const before = sqlFiles(out)
  try {
    execSync(
      `pnpm exec drizzle-kit generate --dialect postgresql --schema ./src/server/db/schema/index.ts --out "${out}" --name drift-check`,
      { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', cwd: REPO },
    )
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    // drizzle-kit exits non-zero on "No schema changes, nothing to migrate" in some versions; a
    // generate that wrote nothing is the pass condition, so the file count decides, not the code.
    if (
      !/No schema changes|nothing to migrate/i.test(detail) &&
      sqlFiles(out).length !== before.length
    ) {
      rmSync(scratch, { recursive: true, force: true })
      console.error(`db drift: drizzle-kit failed: ${detail}`)
      process.exit(1)
    }
  }
  const after = sqlFiles(out)
  rmSync(scratch, { recursive: true, force: true })
  const added = after.filter((name) => !before.includes(name))
  if (added.length > 0) {
    console.error(
      `db drift: the schema and the migrations disagree; drizzle-kit would generate ${added.join(', ')}. Run pnpm db:generate and commit the migration.`,
    )
    process.exit(1)
  }
  console.log(`db drift: none (${before.length} migrations match the schema)`)
}

main()
