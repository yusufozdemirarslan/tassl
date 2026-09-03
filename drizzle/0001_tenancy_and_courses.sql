CREATE TYPE "public"."action_type" AS ENUM('source_trace', 'replication_check', 'decomposition_check', 'stakeholder_interview');--> statement-breakpoint
CREATE TYPE "public"."agreement_purpose" AS ENUM('scoring_audit', 'scenario_calibration', 'drift_review');--> statement-breakpoint
CREATE TYPE "public"."band" AS ENUM('novice', 'developing', 'proficient', 'professional');--> statement-breakpoint
CREATE TYPE "public"."band_basis" AS ENUM('trace', 'defense_only', 'categorical_only', 'none');--> statement-breakpoint
CREATE TYPE "public"."band_decision" AS ENUM('confirmed', 'overridden', 'unassessed');--> statement-breakpoint
CREATE TYPE "public"."calibration_status" AS ENUM('uncalibrated', 'calibrated');--> statement-breakpoint
CREATE TYPE "public"."claim_importance" AS ENUM('load_bearing', 'supporting');--> statement-breakpoint
CREATE TYPE "public"."claim_source" AS ENUM('assistant', 'document');--> statement-breakpoint
CREATE TYPE "public"."confirmation_decision" AS ENUM('confirmed', 'edited', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."consequence_level" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."dimension" AS ENUM('framing', 'delegation', 'verification', 'calibration', 'decision_quality', 'adaptation', 'ownership');--> statement-breakpoint
CREATE TYPE "public"."document_role" AS ENUM('supporting', 'superseded', 'interpretation_as_fact', 'irrelevant');--> statement-breakpoint
CREATE TYPE "public"."draft_status" AS ENUM('drafted', 'unassessed');--> statement-breakpoint
CREATE TYPE "public"."element_type" AS ENUM('brief', 'document', 'stakeholder', 'answer_space_position', 'named_field', 'claim', 'variant_claim_state', 'probe', 'turn', 'defense_question', 'readiness_item', 'counterfactual', 'general_escalation_reply', 'clock_and_difficulty', 'seed_reskin');--> statement-breakpoint
CREATE TYPE "public"."evidence_status" AS ENUM('sound', 'defective');--> statement-breakpoint
CREATE TYPE "public"."export_reason" AS ENUM('initial', 'override', 'neutralization', 'mapping_change', 'unassessed');--> statement-breakpoint
CREATE TYPE "public"."failure_family" AS ENUM('near_neighbor', 'unstated_assumption', 'stale_evidence', 'uncomputed_number', 'extrapolation', 'reversal_to_agree', 'omitted_alternative', 'misapplied_method', 'misattributed_source', 'unacceptable_route');--> statement-breakpoint
CREATE TYPE "public"."generation_step" AS ENUM('reskin_brief_stakeholders', 'documents', 'answer_space_fields', 'claims_and_states', 'turn_and_probe', 'question_bank_and_counterfactual', 'readiness_items');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."llm_feature" AS ENUM('assistant', 'band_read', 'generation', 'trigger_classify', 'eval');--> statement-breakpoint
CREATE TYPE "public"."llm_outcome" AS ENUM('ok', 'validation_failed', 'repaired', 'timeout', 'error', 'budget_exceeded', 'circuit_open');--> statement-breakpoint
CREATE TYPE "public"."neutralization_reason" AS ENUM('unintended_defect', 'wrong_verification_result', 'misbehaving_material', 'adaptation_failed', 'record_lost', 'other');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('generation_complete', 'generation_failed', 'run_scored', 'run_held', 'bands_confirmed', 'invitation', 'export_ready');--> statement-breakpoint
CREATE TYPE "public"."outside_ai_policy" AS ENUM('open', 'declared', 'in_environment_only');--> statement-breakpoint
CREATE TYPE "public"."package_status" AS ENUM('draft', 'confirmed', 'retired');--> statement-breakpoint
CREATE TYPE "public"."pause_cause" AS ENUM('assistant_failure', 'document_failure', 'action_failure', 'connection');--> statement-breakpoint
CREATE TYPE "public"."plan_tier" AS ENUM('pilot', 'course_license', 'department', 'institution', 'practice_pass');--> statement-breakpoint
CREATE TYPE "public"."position_kind" AS ENUM('defensible', 'evidence_inconsistent');--> statement-breakpoint
CREATE TYPE "public"."question_kind" AS ENUM('provenance', 'figure_provenance', 'verification', 'assumption', 'confidence', 'frame_vs_response', 'counterfactual', 'default');--> statement-breakpoint
CREATE TYPE "public"."readiness_category" AS ENUM('foundation', 'defect_concept', 'ai_behavior');--> statement-breakpoint
CREATE TYPE "public"."run_event_type" AS ENUM('policy_displayed', 'lifecycle', 'readiness_item', 'readiness_skipped', 'document_open', 'document_close', 'frame_locked', 'delegation', 'claim_used', 'stance_set', 'action', 'escalation', 'outside_tool_declared', 'pause', 'resume', 'lock_refused', 'decision_locked', 'brief_opened', 'brief_closed', 'addendum', 'turn_delivered', 'turn_response_locked', 'defense_question', 'defense_answer', 'draft_band', 'band_decision', 'claim_neutralized', 'run_voided', 'run_reoffered', 'debrief_opened', 'debrief_answer', 'probe_fired');--> statement-breakpoint
CREATE TYPE "public"."run_mode" AS ENUM('guided', 'standard', 'open');--> statement-breakpoint
CREATE TYPE "public"."run_state" AS ENUM('assigned', 'readiness', 'framing', 'working', 'paused', 'decision_locked', 'turn_open', 'turn_locked', 'defense_pending', 'defense_complete', 'scored', 'confirmed', 'recorded', 'voided', 'abandoned', 'defense_missed', 'under_appeal', 'expired');--> statement-breakpoint
CREATE TYPE "public"."run_type" AS ENUM('decision', 'critique');--> statement-breakpoint
CREATE TYPE "public"."scoring_status" AS ENUM('idle', 'queued', 'running', 'held', 'done');--> statement-breakpoint
CREATE TYPE "public"."section_role" AS ENUM('student', 'instructor', 'ta');--> statement-breakpoint
CREATE TYPE "public"."stance" AS ENUM('accept', 'verify', 'challenge', 'reject', 'escalate');--> statement-breakpoint
CREATE TYPE "public"."surfaced_by" AS ENUM('delegation', 'document', 'turn', 'student');--> statement-breakpoint
CREATE TYPE "public"."turn_response" AS ENUM('hold', 'revise', 'reverse');--> statement-breakpoint
CREATE TYPE "public"."turn_voice" AS ENUM('stakeholder_message', 'corrected_number', 'supplier_notice', 'competitor_move', 'retracted_source', 'regulatory_note');--> statement-breakpoint
CREATE TYPE "public"."value_unit" AS ENUM('percent', 'ratio', 'months', 'usd', 'count', 'other');--> statement-breakpoint
CREATE TYPE "public"."variant_key" AS ENUM('defective', 'sound');--> statement-breakpoint
CREATE TYPE "public"."verification_cost" AS ENUM('cheap', 'moderate', 'expensive');--> statement-breakpoint
CREATE TYPE "public"."void_reason" AS ENUM('unscoreable', 'scoring_held', 'walkthrough', 'other');--> statement-breakpoint
CREATE TABLE "data_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"counterparty" text NOT NULL,
	"permitted_platform_roles" text[] NOT NULL,
	"purposes" "agreement_purpose"[] NOT NULL,
	"record_types_covered" text[] DEFAULT '{run_records,defense_transcripts,debriefs,instructor_decisions}'::text[] NOT NULL,
	"record_types_excluded" text[] DEFAULT '{accommodation_information,diagnostic_information,defense_audio}'::text[] NOT NULL,
	"retention_days" integer NOT NULL,
	"document_reference" text NOT NULL,
	"signed_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "data_agreements_purposes_check" CHECK (cardinality("data_agreements"."purposes") >= 1),
	CONSTRAINT "data_agreements_retention_days_check" CHECK ("data_agreements"."retention_days" > 0)
);
--> statement-breakpoint
CREATE TABLE "institution_settings" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"plan" "plan_tier" DEFAULT 'pilot' NOT NULL,
	"default_mapping" jsonb DEFAULT '{"novice":1,"developing":2,"proficient":3,"professional":4}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"section_id" uuid NOT NULL,
	"label" text NOT NULL,
	"run_type" "run_type" DEFAULT 'decision' NOT NULL,
	"package_version_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"working_clock_seconds" integer,
	"weight" numeric(6, 3),
	"is_walkthrough" boolean DEFAULT false NOT NULL,
	"opens_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "assignments_working_clock_seconds_check" CHECK ("assignments"."working_clock_seconds" is null or "assignments"."working_clock_seconds" > 0)
);
--> statement-breakpoint
CREATE TABLE "course_mapping_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"course_id" uuid NOT NULL,
	"old_mapping" jsonb NOT NULL,
	"new_mapping" jsonb NOT NULL,
	"changed_by" text NOT NULL,
	"affected_run_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"term" text NOT NULL,
	"outside_ai_policy" "outside_ai_policy" DEFAULT 'declared' NOT NULL,
	"mapping" jsonb DEFAULT '{"novice":1,"developing":2,"proficient":3,"professional":4}'::jsonb NOT NULL,
	"default_run_weight" numeric(6, 3) DEFAULT '2.5' NOT NULL,
	"critique_weight_factor" numeric(4, 3) DEFAULT '0.5' NOT NULL,
	"taught_concepts" text[] DEFAULT '{}'::text[] NOT NULL,
	"policy_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "section_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"section_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "section_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"course_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "data_agreements" ADD CONSTRAINT "data_agreements_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "institution_settings" ADD CONSTRAINT "institution_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_mapping_changes" ADD CONSTRAINT "course_mapping_changes_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_mapping_changes" ADD CONSTRAINT "course_mapping_changes_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_mapping_changes" ADD CONSTRAINT "course_mapping_changes_changed_by_user_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_memberships" ADD CONSTRAINT "section_memberships_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_memberships" ADD CONSTRAINT "section_memberships_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_memberships" ADD CONSTRAINT "section_memberships_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_agreements_organization_id_ends_at_idx" ON "data_agreements" USING btree ("organization_id","ends_at") WHERE "data_agreements"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "assignments_section_id_idx" ON "assignments" USING btree ("section_id") WHERE "assignments"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "assignments_package_version_id_idx" ON "assignments" USING btree ("package_version_id");--> statement-breakpoint
CREATE INDEX "course_mapping_changes_course_id_idx" ON "course_mapping_changes" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "courses_organization_id_idx" ON "courses" USING btree ("organization_id") WHERE "courses"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "section_memberships_section_id_user_id_uidx" ON "section_memberships" USING btree ("section_id","user_id");--> statement-breakpoint
CREATE INDEX "section_memberships_user_id_idx" ON "section_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "section_memberships_section_id_role_idx" ON "section_memberships" USING btree ("section_id","role");--> statement-breakpoint
CREATE INDEX "sections_course_id_idx" ON "sections" USING btree ("course_id");