-- D-748: one role per account. `user.platform_role` becomes Student, Scenario Editor, Instructor
-- or Platform Admin; the institution role (`member.role`) and the section role
-- (`section_memberships.role`) stop being roles.
--
-- 1. Every account is mapped to one of the four, from the seats it holds today, before the section
--    role is dropped. Highest wins, in this order:
--      admin                                   -> admin
--      tassl_scenario_editor (set by an admin) -> tassl_scenario_editor
--      an instructor, program-lead or teaching-assistant institution seat, or an instructor or
--      TA section seat                         -> instructor (they run or review courses)
--      a scenario-author institution seat      -> tassl_scenario_editor
--      anything else (students, no seat)       -> student
UPDATE "user" AS u
SET "platform_role" = CASE
  WHEN u."platform_role" = 'admin' THEN 'admin'
  WHEN u."platform_role" = 'tassl_scenario_editor' THEN 'tassl_scenario_editor'
  WHEN EXISTS (
    SELECT 1 FROM "member" m
    WHERE m."user_id" = u."id" AND m."role" IN ('instructor', 'program_lead', 'teaching_assistant')
  ) OR EXISTS (
    SELECT 1 FROM "section_memberships" sm
    WHERE sm."user_id" = u."id" AND sm."role" IN ('instructor', 'ta')
  ) THEN 'instructor'
  WHEN EXISTS (
    SELECT 1 FROM "member" m WHERE m."user_id" = u."id" AND m."role" = 'scenario_author'
  ) THEN 'tassl_scenario_editor'
  ELSE 'student'
END;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_platform_role_check"
  CHECK ("platform_role" IN ('student', 'tassl_scenario_editor', 'instructor', 'admin'));--> statement-breakpoint
-- 2. A membership is membership. Better Auth's organization plugin requires a `role` string on its
--    `member` and `invitation` rows and writes its own default, `member`; every row is set to that
--    value and a check constraint keeps it there, so no institution role can be stored again.
UPDATE "member" SET "role" = 'member';--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_role_is_membership" CHECK ("role" = 'member');--> statement-breakpoint
UPDATE "invitation" SET "role" = 'member' WHERE "role" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_role_is_membership"
  CHECK ("role" IS NULL OR "role" = 'member');--> statement-breakpoint
-- 3. A section roster row is a roster row: the section role goes, with its index and its type.
DROP INDEX "section_memberships_section_id_role_idx";--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "platform_role" SET DEFAULT 'student';--> statement-breakpoint
ALTER TABLE "section_memberships" DROP COLUMN "role";--> statement-breakpoint
DROP TYPE "public"."section_role";
