-- Step 6.4 follow-up (D-255; D-104, D-193, NFR-005): every foreign key that points at `runs.id`
-- gets the delete behaviour D-104 needs, so that `courses.deleteWalkthroughRun` — the Delete
-- control on UI-032 — works on a run that has actually been taken.
--
-- Migration 0005 declared all of them `ON DELETE no action`, so `DELETE FROM runs` raised 23503 the
-- moment a run had a single trace event, which is to say always. Deleting the children first is not
-- open to the application either: migration 0009 revokes DELETE on `run_events`, `run_frames`,
-- `run_turn_responses` and `run_addenda` from `tassl_app`, because the trace and the frame are the
-- record (NFR-005, FR-043). A referential action runs with the privileges of the table that owns
-- the constraint rather than of the role issuing the delete, which is exactly the distinction this
-- migration relies on: nobody may rewrite a record, and an instructor may discard a whole
-- walkthrough run. **This migration weakens no grant.** The UPDATE and DELETE revocations of 0009
-- stand untouched; the only new power is the cascade, and it can only ever be reached by deleting
-- the run the rows belong to.
--
-- Every child of a run cascades, `course_exports` and `run_records` included — the reasoning for
-- those two is in `src/server/db/schema/records.ts`. The two exceptions are the re-offer links on
-- `runs` itself: they join two runs rather than a run and its child, so they are `SET NULL` and the
-- surviving attempt keeps its row.
ALTER TABLE "run_actions" DROP CONSTRAINT "run_actions_run_id_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "run_addenda" DROP CONSTRAINT "run_addenda_run_id_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "run_briefs" DROP CONSTRAINT "run_briefs_run_id_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "run_claims" DROP CONSTRAINT "run_claims_run_id_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "run_defense_answers" DROP CONSTRAINT "run_defense_answers_run_id_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "run_defense_answers" DROP CONSTRAINT "run_defense_answers_run_defense_question_id_run_defense_questions_id_fk";
--> statement-breakpoint
ALTER TABLE "run_defense_questions" DROP CONSTRAINT "run_defense_questions_run_id_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "run_defense_questions" DROP CONSTRAINT "run_defense_questions_follow_up_of_run_defense_questions_id_fk";
--> statement-breakpoint
ALTER TABLE "run_delegations" DROP CONSTRAINT "run_delegations_run_id_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "run_document_opens" DROP CONSTRAINT "run_document_opens_run_id_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "run_escalations" DROP CONSTRAINT "run_escalations_run_id_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "run_events" DROP CONSTRAINT "run_events_run_id_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "run_frames" DROP CONSTRAINT "run_frames_run_id_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "run_pauses" DROP CONSTRAINT "run_pauses_run_id_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "run_readiness_answers" DROP CONSTRAINT "run_readiness_answers_run_id_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "run_readiness_results" DROP CONSTRAINT "run_readiness_results_run_id_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "run_turn_responses" DROP CONSTRAINT "run_turn_responses_run_id_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "runs" DROP CONSTRAINT "runs_re_offered_from_run_id_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "runs" DROP CONSTRAINT "runs_re_offered_to_run_id_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "claim_neutralizations" DROP CONSTRAINT "claim_neutralizations_run_id_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "run_bands" DROP CONSTRAINT "run_bands_run_id_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "run_debrief_answers" DROP CONSTRAINT "run_debrief_answers_run_id_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "run_scores" DROP CONSTRAINT "run_scores_run_id_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "course_exports" DROP CONSTRAINT "course_exports_run_id_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "run_records" DROP CONSTRAINT "run_records_run_id_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "run_actions" ADD CONSTRAINT "run_actions_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_addenda" ADD CONSTRAINT "run_addenda_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_briefs" ADD CONSTRAINT "run_briefs_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_claims" ADD CONSTRAINT "run_claims_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_defense_answers" ADD CONSTRAINT "run_defense_answers_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_defense_answers" ADD CONSTRAINT "run_defense_answers_run_defense_question_id_run_defense_questions_id_fk" FOREIGN KEY ("run_defense_question_id") REFERENCES "public"."run_defense_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_defense_questions" ADD CONSTRAINT "run_defense_questions_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_defense_questions" ADD CONSTRAINT "run_defense_questions_follow_up_of_run_defense_questions_id_fk" FOREIGN KEY ("follow_up_of") REFERENCES "public"."run_defense_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_delegations" ADD CONSTRAINT "run_delegations_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_document_opens" ADD CONSTRAINT "run_document_opens_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_escalations" ADD CONSTRAINT "run_escalations_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_frames" ADD CONSTRAINT "run_frames_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_pauses" ADD CONSTRAINT "run_pauses_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_readiness_answers" ADD CONSTRAINT "run_readiness_answers_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_readiness_results" ADD CONSTRAINT "run_readiness_results_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_turn_responses" ADD CONSTRAINT "run_turn_responses_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_re_offered_from_run_id_runs_id_fk" FOREIGN KEY ("re_offered_from_run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_re_offered_to_run_id_runs_id_fk" FOREIGN KEY ("re_offered_to_run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_neutralizations" ADD CONSTRAINT "claim_neutralizations_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_bands" ADD CONSTRAINT "run_bands_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_debrief_answers" ADD CONSTRAINT "run_debrief_answers_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_scores" ADD CONSTRAINT "run_scores_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_exports" ADD CONSTRAINT "course_exports_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_records" ADD CONSTRAINT "run_records_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- `run_claims.neutralization_id` was deferred out of the Drizzle schema by D-163 and added by hand
-- in migration 0008, so drizzle-kit does not see it and cannot rewrite it above. It is `SET NULL`
-- rather than `CASCADE`: outside a run delete, removing a neutralization must leave the claim it
-- marked standing, with the mark gone. Inside one, both tables are emptied by the run's own cascade
-- and the order they are emptied in stops mattering.
ALTER TABLE "run_claims" DROP CONSTRAINT IF EXISTS "run_claims_neutralization_id_claim_neutralizations_id_fk";--> statement-breakpoint
ALTER TABLE "run_claims" ADD CONSTRAINT "run_claims_neutralization_id_claim_neutralizations_id_fk" FOREIGN KEY ("neutralization_id") REFERENCES "public"."claim_neutralizations"("id") ON DELETE set null ON UPDATE no action;
