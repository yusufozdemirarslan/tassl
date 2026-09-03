-- Hand-written migration body for `extensions_and_triggers` (06 §4, D-137, D-162, D-163).
-- Register it with `pnpm exec drizzle-kit generate --custom --name extensions_and_triggers` after the
-- Step 2.2 table migration, then paste this file into the numbered file the journal assigns.
-- Every statement is idempotent so the migration can be re-run against a partially applied database.

-- (1) updated_at maintenance. Application code never sets updated_at; this trigger does (06 §1).
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$fn$;
--> statement-breakpoint
-- (2) Attach set_updated_at to every base table in `public` that carries an updated_at column,
-- including the generated Better Auth tables (D-162). The loop only sees tables that exist when it
-- runs, so every later hand-written migration that follows a table migration (package_frozen,
-- run_briefs_locked, immutability) pastes this exact DO block again; it is safe to repeat.
DO $do$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns AS c
    JOIN information_schema.tables AS tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'updated_at'
      AND tb.table_type = 'BASE TABLE'
    ORDER BY c.table_name
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON public.%I', t.table_name);
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t.table_name
    );
  END LOOP;
END
$do$;
--> statement-breakpoint
-- (3) Better Auth indexes the generator does not emit (06 §3.1, D-162).
CREATE UNIQUE INDEX IF NOT EXISTS member_organization_user_uidx ON member (organization_id, user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS user_deleted_at_idx ON "user" (deleted_at) WHERE deleted_at IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS invitation_organization_status_idx ON invitation (organization_id, status);
