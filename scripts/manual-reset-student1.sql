-- Frees the seeded student seat so scripts/manual-capture-run.ts can take a whole run again
-- (docs/manual tooling). Deleting the run cascades everything hanging off it, which is what makes
-- the capture repeatable without the two and a half minutes `pnpm demo:reset` costs.
--
--   PGPASSWORD=tassl psql -h localhost -U tassl -d tassl -f scripts/manual-reset-student1.sql
--
-- The two re-offer columns point at other runs and do not cascade, so they are cleared first.
UPDATE runs
   SET re_offered_from_run_id = NULL, re_offered_to_run_id = NULL
 WHERE student_id = (SELECT id FROM "user" WHERE email = 'student1@tassl.local');

DELETE FROM runs
 WHERE student_id = (SELECT id FROM "user" WHERE email = 'student1@tassl.local');

DELETE FROM notifications
 WHERE user_id = (SELECT id FROM "user" WHERE email = 'student1@tassl.local');
