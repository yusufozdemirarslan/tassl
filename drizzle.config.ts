import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

// docs/tech/04-repo-structure.md §9. Migrations run against the unpooled URL when one is set.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL! },
  strict: true,
  verbose: true,
})
