-- Step 2.5 (docs/tech/build-plan/phase-02-data-layer.md): hand-written companion to the generated
-- table migration for run_bands, run_scores, claim_neutralizations, run_debrief_answers, run_records,
-- course_exports, notifications, audit_logs, llm_calls, rate_limit_buckets. Register it with
-- `pnpm exec drizzle-kit generate --custom --name scoring_and_platform` AFTER the table migration.
--
-- 1. Re-run of the set_updated_at() attachment loop from `extensions_and_triggers` (step 2.2): it
--    only sees tables that exist when it runs, so this step repeats the exact block to cover
--    run_bands, run_scores, and run_records. The append-only tables of this step (claim_neutralizations,
--    course_exports, notifications, audit_logs, llm_calls, rate_limit_buckets) and the 1:1 tables with
--    a domain timestamp (run_debrief_answers) carry no updated_at and are skipped. Safe to repeat.
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
-- 2. D-163: the foreign key deferred from Step 2.4. run_claims.neutralization_id was created as a
--    plain uuid because claim_neutralizations did not exist yet. The constraint carries drizzle-kit's
--    default name, so this block is a no-op if runs.ts later gains
--    `.references(() => claimNeutralizations.id)` and the generated migration adds it first; if you
--    take that route instead, delete this statement.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'run_claims_neutralization_id_claim_neutralizations_id_fk'
  ) THEN
    ALTER TABLE "run_claims"
      ADD CONSTRAINT "run_claims_neutralization_id_claim_neutralizations_id_fk"
      FOREIGN KEY ("neutralization_id") REFERENCES "public"."claim_neutralizations"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END
$$;
