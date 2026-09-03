CREATE TABLE "claim_neutralizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"reason" "neutralization_reason" NOT NULL,
	"credit_challenge" boolean DEFAULT false NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_bands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"dimension" "dimension" NOT NULL,
	"draft_band" "band",
	"draft_status" "draft_status" NOT NULL,
	"draft_reason" text DEFAULT '' NOT NULL,
	"basis" "band_basis" NOT NULL,
	"provisional" boolean DEFAULT true NOT NULL,
	"graph_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"evidence_event_seqs" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"quotes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"decision" "band_decision",
	"decided_band" "band",
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"note" text,
	"band_before_correction" "band",
	"band_after_correction" "band",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_debrief_answers" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"stance_to_change" text NOT NULL,
	"do_differently" text NOT NULL,
	"answered_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_scores" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"rubric_version" text NOT NULL,
	"graphs" jsonb NOT NULL,
	"false_challenge_rate" numeric(5, 4),
	"matched_stance_share" numeric(5, 4),
	"points_draft" numeric(6, 3),
	"points_confirmed" numeric(6, 3),
	"points_before_correction" numeric(6, 3),
	"points_after_correction" numeric(6, 3),
	"points_effective" numeric(6, 3),
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"scored_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"file" jsonb NOT NULL,
	"reason" "export_reason" NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_records" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"snapshot" jsonb NOT NULL,
	"hidden_from_export" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text,
	"actor_id" text,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feature" "llm_feature" NOT NULL,
	"prompt_name" text NOT NULL,
	"prompt_version" integer NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer NOT NULL,
	"cost_estimate_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"outcome" "llm_outcome" NOT NULL,
	"user_id" text,
	"run_id" uuid,
	"package_version_id" uuid,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"type" "notification_type" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"email_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limit_buckets_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
ALTER TABLE "claim_neutralizations" ADD CONSTRAINT "claim_neutralizations_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_neutralizations" ADD CONSTRAINT "claim_neutralizations_claim_id_scenario_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."scenario_claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_neutralizations" ADD CONSTRAINT "claim_neutralizations_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_bands" ADD CONSTRAINT "run_bands_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_bands" ADD CONSTRAINT "run_bands_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_debrief_answers" ADD CONSTRAINT "run_debrief_answers_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_scores" ADD CONSTRAINT "run_scores_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_exports" ADD CONSTRAINT "course_exports_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_exports" ADD CONSTRAINT "course_exports_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_exports" ADD CONSTRAINT "course_exports_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_exports" ADD CONSTRAINT "course_exports_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_records" ADD CONSTRAINT "run_records_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claim_neutralizations_run_id_idx" ON "claim_neutralizations" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_bands_run_id_dimension_uidx" ON "run_bands" USING btree ("run_id","dimension");--> statement-breakpoint
CREATE UNIQUE INDEX "course_exports_run_id_version_uidx" ON "course_exports" USING btree ("run_id","version");--> statement-breakpoint
CREATE INDEX "audit_logs_organization_id_created_at_idx" ON "audit_logs" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs" USING btree ("actor_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "llm_calls_user_id_created_at_idx" ON "llm_calls" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "llm_calls_created_at_idx" ON "llm_calls" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications" USING btree ("user_id","read_at");