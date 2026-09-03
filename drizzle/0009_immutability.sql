-- Step 2.6 (NFR-004, NFR-005, D-085, D-110): the application role and the immutability grants.
-- tassl_app is created NOLOGIN; scripts/db-app-role.ts sets LOGIN and the password from
-- TASSL_APP_DB_PASSWORD (a password cannot be parameterized in plain SQL). Locally the tests set
-- a throwaway password in tests/setup/integration.ts.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tassl_app') THEN
    CREATE ROLE tassl_app NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO tassl_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tassl_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tassl_app;
--> statement-breakpoint
-- Append-only tables and locked artifacts: the app may read and insert, never rewrite or erase.
-- run_briefs stays updatable until locked_at (the run_briefs_locked trigger enforces the lock).
REVOKE UPDATE, DELETE ON run_events, run_frames, run_turn_responses, run_addenda, audit_logs, llm_calls, course_exports FROM tassl_app;
--> statement-breakpoint
-- Tables created by later migrations inherit the default grants; a later migration that adds an
-- append-only table must revoke UPDATE and DELETE on it explicitly.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tassl_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO tassl_app;
--> statement-breakpoint
-- pg-boss keeps its own schema (created by scripts/pgboss-migrate.ts after the drizzle migrations);
-- grant it when it already exists, and scripts/db-app-role.ts repeats this grant at release time.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'pgboss') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA pgboss TO tassl_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO tassl_app';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO tassl_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tassl_app';
  END IF;
END
$$;
