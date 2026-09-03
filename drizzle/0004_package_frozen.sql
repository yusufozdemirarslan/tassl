-- Hand-written migration body for `package_frozen` (06 §3.3, §4; NFR-004; D-137, D-163).
-- Register it with `pnpm exec drizzle-kit generate --custom --name package_frozen` after the
-- Step 2.3 table migration, then paste this file into the numbered file the journal assigns.
-- Every statement is idempotent so the migration can be re-run against a partially applied database.

-- (1) A confirmed version is frozen. After confirmed_at is set, an UPDATE may change only status,
-- review_requested_at, review_reason and updated_at (the set_updated_at trigger writes the last one).
CREATE OR REPLACE FUNCTION package_version_frozen() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF OLD.confirmed_at IS NOT NULL
     AND (to_jsonb(OLD) - 'status' - 'review_requested_at' - 'review_reason' - 'updated_at')
      <> (to_jsonb(NEW) - 'status' - 'review_requested_at' - 'review_reason' - 'updated_at') THEN
    RAISE EXCEPTION USING MESSAGE = 'VERSION_FROZEN', ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$fn$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS package_version_frozen ON public.scenario_package_versions;
--> statement-breakpoint
CREATE TRIGGER package_version_frozen
  BEFORE UPDATE ON public.scenario_package_versions
  FOR EACH ROW EXECUTE FUNCTION package_version_frozen();
--> statement-breakpoint
-- (2) Elements of a confirmed version cannot be inserted, updated, or deleted. NEW is null on
-- DELETE and OLD on INSERT (their fields read as null), so both parents are checked; an UPDATE that
-- moves an element between versions is refused when either side is confirmed.
CREATE OR REPLACE FUNCTION package_element_frozen() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM scenario_package_versions pv
    WHERE pv.id IN (NEW.package_version_id, OLD.package_version_id)
      AND pv.confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'VERSION_FROZEN', ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$fn$;
--> statement-breakpoint
-- variant_claim_states carries no package_version_id; it reaches the version through its variant.
CREATE OR REPLACE FUNCTION variant_claim_state_frozen() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM scenario_variants v
    JOIN scenario_package_versions pv ON pv.id = v.package_version_id
    WHERE v.id IN (NEW.variant_id, OLD.variant_id)
      AND pv.confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'VERSION_FROZEN', ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$fn$;
--> statement-breakpoint
-- Attach to every element table that carries package_version_id. element_confirmations and
-- generation_runs are authoring records written after confirmation and stay writable.
DO $do$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'seed_records',
    'scenario_documents',
    'stakeholders',
    'answer_space_positions',
    'named_fields',
    'scenario_claims',
    'scenario_variants',
    'sycophancy_probes',
    'scenario_turns',
    'defense_questions',
    'readiness_items'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS package_element_frozen ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER package_element_frozen BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION package_element_frozen()',
      t
    );
  END LOOP;
END
$do$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS variant_claim_state_frozen ON public.variant_claim_states;
--> statement-breakpoint
CREATE TRIGGER variant_claim_state_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON public.variant_claim_states
  FOR EACH ROW EXECUTE FUNCTION variant_claim_state_frozen();
--> statement-breakpoint
-- (3) Deferred from Step 2.2 (D-163): an assignment's variant must belong to its package version.
CREATE OR REPLACE FUNCTION assignments_variant_matches_version() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM scenario_variants v
    WHERE v.id = NEW.variant_id
      AND v.package_version_id = NEW.package_version_id
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'VARIANT_VERSION_MISMATCH', ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$fn$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS assignments_variant_matches_version ON public.assignments;
--> statement-breakpoint
CREATE TRIGGER assignments_variant_matches_version
  BEFORE INSERT OR UPDATE ON public.assignments
  FOR EACH ROW EXECUTE FUNCTION assignments_variant_matches_version();
--> statement-breakpoint
-- (4) updated_at maintenance for the tables this step created (the same block as
-- extensions_and_triggers; it only sees tables that exist when it runs and is safe to repeat).
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
