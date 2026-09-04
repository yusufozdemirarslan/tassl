-- Step 3.3 (D-093, D-112, D-167): the purge job's re-pointing, as SECURITY DEFINER functions.
--
-- Migration 0009 revokes UPDATE on run_events, audit_logs, and llm_calls from tassl_app, so the
-- application role cannot rewrite the actor columns those append-only tables carry. The purge is the
-- one operation that has to: a purged account leaves its runs and its trace behind for the course
-- record, attached to the organization's `deleted-user@<slug>.tassl.local` placeholder (D-093).
-- These two functions are owned by the migration role, run with its privileges, are executable only
-- by tassl_app, and touch nothing but the four columns named below — the append-only grants stay as
-- they are for every other statement the application makes.
--
-- Both are tenant-aware because the placeholder is per organization: the purge calls
-- repoint_user_references once per organization that references the user, then
-- anonymize_user_references for the rows that belong to no organization at all.
CREATE OR REPLACE FUNCTION repoint_user_references(
  from_id text,
  to_id text,
  tenant_id text DEFAULT NULL
)
RETURNS TABLE (runs_updated integer, run_events_updated integer, audit_logs_updated integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  updated_runs integer;
  updated_events integer;
  updated_audit integer;
BEGIN
  UPDATE run_events
     SET actor_id = to_id
   WHERE actor_id = from_id
     AND (
       tenant_id IS NULL
       OR run_id IN (SELECT id FROM runs WHERE organization_id = tenant_id)
     );
  GET DIAGNOSTICS updated_events = ROW_COUNT;

  UPDATE runs
     SET student_id = to_id
   WHERE student_id = from_id
     AND (tenant_id IS NULL OR organization_id = tenant_id);
  GET DIAGNOSTICS updated_runs = ROW_COUNT;

  UPDATE audit_logs
     SET actor_id = to_id
   WHERE actor_id = from_id
     AND (tenant_id IS NULL OR organization_id = tenant_id);
  GET DIAGNOSTICS updated_audit = ROW_COUNT;

  RETURN QUERY SELECT updated_runs, updated_events, updated_audit;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION repoint_user_references(text, text, text) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tassl_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION repoint_user_references(text, text, text) TO tassl_app';
  END IF;
END
$$;
--> statement-breakpoint
-- The append-only rows a purge cannot re-point: audit rows that belong to no organization (there is
-- no placeholder to move them to) and every llm_calls row (the table has no organization column).
-- They lose the actor instead of being deleted, because they are evidence (D-112).
CREATE OR REPLACE FUNCTION anonymize_user_references(from_id text)
RETURNS TABLE (audit_logs_anonymized integer, llm_calls_anonymized integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  updated_audit integer;
  updated_calls integer;
BEGIN
  UPDATE audit_logs SET actor_id = NULL WHERE actor_id = from_id;
  GET DIAGNOSTICS updated_audit = ROW_COUNT;

  UPDATE llm_calls SET user_id = NULL WHERE user_id = from_id;
  GET DIAGNOSTICS updated_calls = ROW_COUNT;

  RETURN QUERY SELECT updated_audit, updated_calls;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION anonymize_user_references(text) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tassl_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION anonymize_user_references(text) TO tassl_app';
  END IF;
END
$$;
