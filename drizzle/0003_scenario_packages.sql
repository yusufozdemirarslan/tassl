CREATE TABLE "answer_space_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_version_id" uuid NOT NULL,
	"key" text NOT NULL,
	"kind" "position_kind" NOT NULL,
	"summary" text NOT NULL,
	"supporting_document_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"ignored_evidence" text,
	"is_minimum_commitment" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "defense_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_version_id" uuid NOT NULL,
	"key" text NOT NULL,
	"kind" "question_kind" NOT NULL,
	"claim_id" uuid,
	"assumption_index" integer,
	"template" text NOT NULL,
	"condition" jsonb NOT NULL,
	"follow_up" text NOT NULL,
	"expected_answer_notes" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "defense_questions_assumption_index_check" CHECK ("defense_questions"."assumption_index" is null or "defense_questions"."assumption_index" between 0 and 2)
);
--> statement-breakpoint
CREATE TABLE "named_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_version_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"unit" "value_unit" NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "readiness_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_version_id" uuid NOT NULL,
	"key" text NOT NULL,
	"category" "readiness_category" NOT NULL,
	"concept_key" text NOT NULL,
	"stem" text NOT NULL,
	"options" jsonb NOT NULL,
	"answer_key" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenario_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_version_id" uuid NOT NULL,
	"key" text NOT NULL,
	"text" text NOT NULL,
	"source_kind" "claim_source" NOT NULL,
	"source_document_id" uuid,
	"source_passage" text DEFAULT '' NOT NULL,
	"importance" "claim_importance" NOT NULL,
	"consequence_level" "consequence_level" NOT NULL,
	"verification_cost" "verification_cost" NOT NULL,
	"weakly_sourced" boolean DEFAULT false NOT NULL,
	"volatile" boolean DEFAULT false NOT NULL,
	"concept_key" text NOT NULL,
	"carried_values" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"trigger_phrases" text[] DEFAULT '{}'::text[] NOT NULL,
	"trigger_description" text DEFAULT '' NOT NULL,
	"escalatable" boolean DEFAULT false NOT NULL,
	"escalation_reply" text,
	"rationale" text DEFAULT '' NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenario_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_version_id" uuid NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"author" text NOT NULL,
	"dated_on" date NOT NULL,
	"body" text NOT NULL,
	"word_count" integer NOT NULL,
	"role" "document_role" NOT NULL,
	"superseded_by_document_id" uuid,
	"stakeholder_id" uuid,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scenario_documents_superseded_by_check" CHECK ("scenario_documents"."role" <> 'superseded' or "scenario_documents"."superseded_by_document_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "scenario_package_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"package_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "package_status" DEFAULT 'draft' NOT NULL,
	"calibration_status" "calibration_status" DEFAULT 'uncalibrated' NOT NULL,
	"concept_set" text[] NOT NULL,
	"brief" text DEFAULT '' NOT NULL,
	"working_clock_seconds" integer DEFAULT 1500 NOT NULL,
	"turn_delay_seconds" integer DEFAULT 90 NOT NULL,
	"difficulty_profile" jsonb DEFAULT '{"estimate":"unknown","note":"","uncalibrated":true}'::jsonb NOT NULL,
	"general_escalation_reply" text DEFAULT '' NOT NULL,
	"debrief_counterfactual" text DEFAULT '' NOT NULL,
	"generation_model" text,
	"generated_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" text,
	"teaching_note_checked" boolean DEFAULT false NOT NULL,
	"review_requested_at" timestamp with time zone,
	"review_reason" text,
	"snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scenario_package_versions_version_check" CHECK ("scenario_package_versions"."version" > 0),
	CONSTRAINT "scenario_package_versions_concept_set_check" CHECK (array_length("scenario_package_versions"."concept_set", 1) >= 4),
	CONSTRAINT "scenario_package_versions_turn_delay_seconds_check" CHECK ("scenario_package_versions"."turn_delay_seconds" between 60 and 120)
);
--> statement-breakpoint
CREATE TABLE "scenario_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"title" text NOT NULL,
	"discipline" text DEFAULT 'marketing_strategy' NOT NULL,
	"family_key" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "scenario_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_version_id" uuid NOT NULL,
	"text" text NOT NULL,
	"voice" "turn_voice" NOT NULL,
	"stakeholder_id" uuid,
	"warrants_change" boolean NOT NULL,
	"proportionate_response" "turn_response" NOT NULL,
	"evidence" text NOT NULL,
	"disrupted_assumption_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"window_claim_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenario_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_version_id" uuid NOT NULL,
	"key" "variant_key" NOT NULL,
	"label" text NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seed_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_version_id" uuid NOT NULL,
	"case_title" text NOT NULL,
	"publisher" text NOT NULL,
	"license_terms" text NOT NULL,
	"license_permits_adaptation" boolean NOT NULL,
	"seed_text" text NOT NULL,
	"reskin_log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seed_records_seed_text_length_check" CHECK (length("seed_records"."seed_text") <= 200000)
);
--> statement-breakpoint
CREATE TABLE "stakeholders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_version_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"role_title" text NOT NULL,
	"position_statement" text NOT NULL,
	"incentives" text NOT NULL,
	"blind_spots" text NOT NULL,
	"contradicts_stakeholder_id" uuid,
	"contradiction_point" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sycophancy_probes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_version_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"original_position" text NOT NULL,
	"scripted_reversal" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "variant_claim_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"evidence_status" "evidence_status" NOT NULL,
	"failure_family" "failure_family",
	"warranted_stance" "stance" NOT NULL,
	"verification_paths" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"planted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "variant_claim_states_failure_family_check" CHECK ("variant_claim_states"."evidence_status" <> 'defective' or "variant_claim_states"."failure_family" is not null)
);
--> statement-breakpoint
CREATE TABLE "element_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_version_id" uuid NOT NULL,
	"element_type" "element_type" NOT NULL,
	"element_id" uuid,
	"element_key" uuid GENERATED ALWAYS AS (coalesce("element_id", '00000000-0000-0000-0000-000000000000'::uuid)) STORED NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"decision" "confirmation_decision" NOT NULL,
	"edits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"decided_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_version_id" uuid NOT NULL,
	"step" "generation_step" NOT NULL,
	"pass_number" integer DEFAULT 1 NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"provider" text,
	"model" text,
	"prompt_version" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_estimate_usd" numeric(10, 6),
	"failed_rules" text[] DEFAULT '{}'::text[] NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "answer_space_positions" ADD CONSTRAINT "answer_space_positions_package_version_id_scenario_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "public"."scenario_package_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defense_questions" ADD CONSTRAINT "defense_questions_package_version_id_scenario_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "public"."scenario_package_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defense_questions" ADD CONSTRAINT "defense_questions_claim_id_scenario_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."scenario_claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "named_fields" ADD CONSTRAINT "named_fields_package_version_id_scenario_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "public"."scenario_package_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_items" ADD CONSTRAINT "readiness_items_package_version_id_scenario_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "public"."scenario_package_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_claims" ADD CONSTRAINT "scenario_claims_package_version_id_scenario_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "public"."scenario_package_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_claims" ADD CONSTRAINT "scenario_claims_source_document_id_scenario_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."scenario_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_documents" ADD CONSTRAINT "scenario_documents_package_version_id_scenario_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "public"."scenario_package_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_documents" ADD CONSTRAINT "scenario_documents_superseded_by_document_id_scenario_documents_id_fk" FOREIGN KEY ("superseded_by_document_id") REFERENCES "public"."scenario_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_documents" ADD CONSTRAINT "scenario_documents_stakeholder_id_stakeholders_id_fk" FOREIGN KEY ("stakeholder_id") REFERENCES "public"."stakeholders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_package_versions" ADD CONSTRAINT "scenario_package_versions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_package_versions" ADD CONSTRAINT "scenario_package_versions_package_id_scenario_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."scenario_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_package_versions" ADD CONSTRAINT "scenario_package_versions_confirmed_by_user_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_packages" ADD CONSTRAINT "scenario_packages_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_packages" ADD CONSTRAINT "scenario_packages_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_turns" ADD CONSTRAINT "scenario_turns_package_version_id_scenario_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "public"."scenario_package_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_turns" ADD CONSTRAINT "scenario_turns_stakeholder_id_stakeholders_id_fk" FOREIGN KEY ("stakeholder_id") REFERENCES "public"."stakeholders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_variants" ADD CONSTRAINT "scenario_variants_package_version_id_scenario_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "public"."scenario_package_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seed_records" ADD CONSTRAINT "seed_records_package_version_id_scenario_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "public"."scenario_package_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stakeholders" ADD CONSTRAINT "stakeholders_package_version_id_scenario_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "public"."scenario_package_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sycophancy_probes" ADD CONSTRAINT "sycophancy_probes_package_version_id_scenario_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "public"."scenario_package_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sycophancy_probes" ADD CONSTRAINT "sycophancy_probes_claim_id_scenario_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."scenario_claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_claim_states" ADD CONSTRAINT "variant_claim_states_variant_id_scenario_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."scenario_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_claim_states" ADD CONSTRAINT "variant_claim_states_claim_id_scenario_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."scenario_claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "element_confirmations" ADD CONSTRAINT "element_confirmations_package_version_id_scenario_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "public"."scenario_package_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "element_confirmations" ADD CONSTRAINT "element_confirmations_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_package_version_id_scenario_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "public"."scenario_package_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "answer_space_positions_package_version_id_key_uidx" ON "answer_space_positions" USING btree ("package_version_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "defense_questions_package_version_id_key_uidx" ON "defense_questions" USING btree ("package_version_id","key");--> statement-breakpoint
CREATE INDEX "defense_questions_package_version_id_kind_idx" ON "defense_questions" USING btree ("package_version_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "named_fields_package_version_id_key_uidx" ON "named_fields" USING btree ("package_version_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "readiness_items_package_version_id_key_uidx" ON "readiness_items" USING btree ("package_version_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_claims_package_version_id_key_uidx" ON "scenario_claims" USING btree ("package_version_id","key");--> statement-breakpoint
CREATE INDEX "scenario_claims_package_version_id_position_idx" ON "scenario_claims" USING btree ("package_version_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_documents_package_version_id_key_uidx" ON "scenario_documents" USING btree ("package_version_id","key");--> statement-breakpoint
CREATE INDEX "scenario_documents_package_version_id_position_idx" ON "scenario_documents" USING btree ("package_version_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_package_versions_package_id_version_uidx" ON "scenario_package_versions" USING btree ("package_id","version");--> statement-breakpoint
CREATE INDEX "scenario_package_versions_package_id_status_idx" ON "scenario_package_versions" USING btree ("package_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_packages_organization_id_family_key_uidx" ON "scenario_packages" USING btree ("organization_id","family_key");--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_turns_package_version_id_uidx" ON "scenario_turns" USING btree ("package_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_variants_package_version_id_key_uidx" ON "scenario_variants" USING btree ("package_version_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "seed_records_package_version_id_uidx" ON "seed_records" USING btree ("package_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stakeholders_package_version_id_key_uidx" ON "stakeholders" USING btree ("package_version_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "sycophancy_probes_package_version_id_uidx" ON "sycophancy_probes" USING btree ("package_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "variant_claim_states_variant_id_claim_id_uidx" ON "variant_claim_states" USING btree ("variant_id","claim_id");--> statement-breakpoint
CREATE UNIQUE INDEX "element_confirmations_version_type_key_revision_uidx" ON "element_confirmations" USING btree ("package_version_id","element_type","element_key","revision");--> statement-breakpoint
CREATE INDEX "element_confirmations_package_version_id_decision_idx" ON "element_confirmations" USING btree ("package_version_id","decision");--> statement-breakpoint
CREATE INDEX "generation_runs_version_step_pass_idx" ON "generation_runs" USING btree ("package_version_id","step","pass_number");--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_package_version_id_scenario_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "public"."scenario_package_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_variant_id_scenario_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."scenario_variants"("id") ON DELETE no action ON UPDATE no action;