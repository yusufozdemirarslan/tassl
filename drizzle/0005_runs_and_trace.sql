CREATE TABLE "run_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"type" "action_type" NOT NULL,
	"clock_cost_ms" integer NOT NULL,
	"result" jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"in_turn_window" boolean DEFAULT false NOT NULL,
	"clock_remaining_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_addenda" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_briefs" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"recommendation" text DEFAULT '' NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"assumptions" text[] DEFAULT '{"","",""}'::text[] NOT NULL,
	"change_my_mind" text DEFAULT '' NOT NULL,
	"confidence" integer,
	"named_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"draft_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"auto_locked" boolean DEFAULT false NOT NULL,
	"speed_outlier" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_briefs_confidence_check" CHECK (confidence between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "run_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"surfaced_at" timestamp with time zone NOT NULL,
	"surfaced_by" "surfaced_by" NOT NULL,
	"surfaced_by_id" uuid,
	"in_turn_window" boolean DEFAULT false NOT NULL,
	"stance" "stance",
	"previous_stance" "stance",
	"stance_set_at" timestamp with time zone,
	"used_marked" boolean DEFAULT false NOT NULL,
	"relied_on_via" text[] DEFAULT '{}'::text[] NOT NULL,
	"relied_on" boolean GENERATED ALWAYS AS (cardinality(relied_on_via) > 0) STORED NOT NULL,
	"inconsistency_credited" boolean DEFAULT false NOT NULL,
	"stance_record_lost" boolean DEFAULT false NOT NULL,
	"neutralization_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_defense_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"run_defense_question_id" uuid NOT NULL,
	"text" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"answered_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_defense_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"rendered_text" text NOT NULL,
	"follow_up_of" uuid,
	"selecting_event_seq" integer,
	"asked_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_delegations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"request_text" text NOT NULL,
	"response_text" text DEFAULT '' NOT NULL,
	"failed" boolean DEFAULT false NOT NULL,
	"why" text,
	"claim_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"unverified_numbers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"in_turn_window" boolean DEFAULT false NOT NULL,
	"clock_remaining_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_document_opens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"duration_ms" integer,
	"before_first_delegation" boolean NOT NULL,
	"in_turn_window" boolean DEFAULT false NOT NULL,
	"skim" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_escalations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"statement" text NOT NULL,
	"response_id" text NOT NULL,
	"response_text" text NOT NULL,
	"clock_cost_ms" integer DEFAULT 300000 NOT NULL,
	"counts_against_limit" boolean NOT NULL,
	"in_turn_window" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_escalations_response_id_check" CHECK (response_id in ('claim', 'general'))
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "run_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" "run_event_type" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"clock_remaining_ms" integer,
	"actor_id" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_frames" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"decision" text NOT NULL,
	"assumptions" text[] NOT NULL,
	"position" text NOT NULL,
	"confidence" integer NOT NULL,
	"locked_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_frames_assumptions_check" CHECK (array_length(assumptions, 1) = 3),
	CONSTRAINT "run_frames_confidence_check" CHECK (confidence between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "run_pauses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"cause" "pause_cause" NOT NULL,
	"paused_at" timestamp with time zone NOT NULL,
	"resumed_at" timestamp with time zone,
	"credited_ms" integer DEFAULT 0 NOT NULL,
	"related_delegation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_readiness_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"answer_key" text,
	"correct" boolean,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_readiness_results" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"submitted_at" timestamp with time zone,
	"skipped" boolean DEFAULT false NOT NULL,
	"concepts" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_turn_responses" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"response" "turn_response" NOT NULL,
	"justification" text,
	"confidence" integer,
	"implicit" boolean DEFAULT false NOT NULL,
	"locked_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_turn_responses_confidence_check" CHECK (confidence between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"assignment_id" uuid NOT NULL,
	"student_id" text NOT NULL,
	"package_version_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"attempt_no" integer DEFAULT 1 NOT NULL,
	"state" "run_state" DEFAULT 'assigned' NOT NULL,
	"mode" "run_mode" DEFAULT 'standard' NOT NULL,
	"is_walkthrough" boolean DEFAULT false NOT NULL,
	"working_clock_seconds" integer NOT NULL,
	"turn_delay_seconds" integer NOT NULL,
	"policy_displayed_at" timestamp with time zone,
	"readiness_started_at" timestamp with time zone,
	"readiness_expires_at" timestamp with time zone,
	"working_started_at" timestamp with time zone,
	"first_delegation_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"total_paused_ms" bigint DEFAULT 0 NOT NULL,
	"credited_ms" bigint DEFAULT 0 NOT NULL,
	"charged_ms" bigint DEFAULT 0 NOT NULL,
	"decision_locked_at" timestamp with time zone,
	"turn_due_at" timestamp with time zone,
	"turn_delivered_at" timestamp with time zone,
	"turn_window_ends_at" timestamp with time zone,
	"turn_locked_at" timestamp with time zone,
	"defense_opened_at" timestamp with time zone,
	"defense_completed_at" timestamp with time zone,
	"scored_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"recorded_at" timestamp with time zone,
	"adjusted_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"void_reason" "void_reason",
	"re_offered_from_run_id" uuid,
	"re_offered_to_run_id" uuid,
	"scoring_status" "scoring_status" DEFAULT 'idle' NOT NULL,
	"confidence_at_frame" integer,
	"confidence_at_lock" integer,
	"confidence_after_turn" integer,
	"flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"accommodation_applied" boolean DEFAULT false NOT NULL,
	"next_event_seq" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runs_confidence_at_frame_check" CHECK (confidence_at_frame between 0 and 100),
	CONSTRAINT "runs_confidence_at_lock_check" CHECK (confidence_at_lock between 0 and 100),
	CONSTRAINT "runs_confidence_after_turn_check" CHECK (confidence_after_turn between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "run_actions" ADD CONSTRAINT "run_actions_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_actions" ADD CONSTRAINT "run_actions_claim_id_scenario_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."scenario_claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_addenda" ADD CONSTRAINT "run_addenda_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_briefs" ADD CONSTRAINT "run_briefs_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_claims" ADD CONSTRAINT "run_claims_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_claims" ADD CONSTRAINT "run_claims_claim_id_scenario_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."scenario_claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_defense_answers" ADD CONSTRAINT "run_defense_answers_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_defense_answers" ADD CONSTRAINT "run_defense_answers_run_defense_question_id_run_defense_questions_id_fk" FOREIGN KEY ("run_defense_question_id") REFERENCES "public"."run_defense_questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_defense_questions" ADD CONSTRAINT "run_defense_questions_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_defense_questions" ADD CONSTRAINT "run_defense_questions_question_id_defense_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."defense_questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_defense_questions" ADD CONSTRAINT "run_defense_questions_follow_up_of_run_defense_questions_id_fk" FOREIGN KEY ("follow_up_of") REFERENCES "public"."run_defense_questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_delegations" ADD CONSTRAINT "run_delegations_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_document_opens" ADD CONSTRAINT "run_document_opens_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_document_opens" ADD CONSTRAINT "run_document_opens_document_id_scenario_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."scenario_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_escalations" ADD CONSTRAINT "run_escalations_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_escalations" ADD CONSTRAINT "run_escalations_claim_id_scenario_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."scenario_claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_frames" ADD CONSTRAINT "run_frames_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_pauses" ADD CONSTRAINT "run_pauses_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_readiness_answers" ADD CONSTRAINT "run_readiness_answers_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_readiness_answers" ADD CONSTRAINT "run_readiness_answers_item_id_readiness_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."readiness_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_readiness_results" ADD CONSTRAINT "run_readiness_results_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_turn_responses" ADD CONSTRAINT "run_turn_responses_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_student_id_user_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_package_version_id_scenario_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "public"."scenario_package_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_variant_id_scenario_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."scenario_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_re_offered_from_run_id_runs_id_fk" FOREIGN KEY ("re_offered_from_run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_re_offered_to_run_id_runs_id_fk" FOREIGN KEY ("re_offered_to_run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "run_actions_run_id_claim_id_idx" ON "run_actions" USING btree ("run_id","claim_id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_claims_run_id_claim_id_uidx" ON "run_claims" USING btree ("run_id","claim_id");--> statement-breakpoint
CREATE INDEX "run_claims_run_id_stance_null_idx" ON "run_claims" USING btree ("run_id") WHERE stance is null;--> statement-breakpoint
CREATE UNIQUE INDEX "run_defense_answers_run_defense_question_id_uidx" ON "run_defense_answers" USING btree ("run_defense_question_id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_defense_questions_run_id_seq_uidx" ON "run_defense_questions" USING btree ("run_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "run_delegations_run_id_seq_uidx" ON "run_delegations" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "run_document_opens_run_id_opened_at_idx" ON "run_document_opens" USING btree ("run_id","opened_at");--> statement-breakpoint
CREATE INDEX "run_escalations_run_id_counts_idx" ON "run_escalations" USING btree ("run_id") WHERE counts_against_limit;--> statement-breakpoint
CREATE UNIQUE INDEX "run_events_run_id_seq_uidx" ON "run_events" USING btree ("run_id","seq");--> statement-breakpoint
CREATE INDEX "run_events_run_id_type_idx" ON "run_events" USING btree ("run_id","type");--> statement-breakpoint
CREATE INDEX "run_pauses_run_id_idx" ON "run_pauses" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_readiness_answers_run_id_item_id_uidx" ON "run_readiness_answers" USING btree ("run_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_assignment_id_student_id_attempt_no_uidx" ON "runs" USING btree ("assignment_id","student_id","attempt_no");--> statement-breakpoint
CREATE INDEX "runs_student_id_state_idx" ON "runs" USING btree ("student_id","state");--> statement-breakpoint
CREATE INDEX "runs_assignment_id_idx" ON "runs" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "runs_state_scoring_status_idx" ON "runs" USING btree ("state","scoring_status") WHERE scoring_status = 'held';--> statement-breakpoint
CREATE INDEX "runs_turn_due_at_idx" ON "runs" USING btree ("turn_due_at") WHERE state = 'decision_locked';