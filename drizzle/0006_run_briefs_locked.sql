-- Phase 2 step 2.4 (docs/tech/06-data-model.md §3.4, run_briefs; NFR-005). Hand-written body for
-- the custom migration registered with `drizzle-kit generate --custom --name run_briefs_locked`
-- after the step's table migration (D-137). Idempotent: safe to re-run.

-- A decision brief is immutable once locked: any UPDATE of a row whose locked_at is already set is
-- refused. The lock itself (OLD.locked_at IS NULL → NEW.locked_at set) passes.
CREATE OR REPLACE FUNCTION run_briefs_locked() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'BRIEF_LOCKED'
      USING HINT = 'run_briefs rows cannot change after locked_at is set',
            DETAIL = format('run_id=%s locked_at=%s', OLD.run_id, OLD.locked_at);
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS run_briefs_locked ON run_briefs;
--> statement-breakpoint
CREATE TRIGGER run_briefs_locked
  BEFORE UPDATE ON run_briefs
  FOR EACH ROW EXECUTE FUNCTION run_briefs_locked();
--> statement-breakpoint
-- Re-run of the set_updated_at() attachment loop from `extensions_and_triggers` (step 2.2): it only
-- sees tables that exist when it runs, so this step repeats the exact block to cover runs,
-- run_readiness_results, run_readiness_answers, run_document_opens, run_delegations, run_claims,
-- run_briefs, run_defense_questions, and run_defense_answers. The append-only and locked-artifact
-- tables carry no updated_at and are skipped by the information_schema filter. Safe to repeat.
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
