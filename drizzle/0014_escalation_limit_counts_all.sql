DROP INDEX "run_escalations_run_id_counts_idx";--> statement-breakpoint
CREATE INDEX "run_escalations_run_id_idx" ON "run_escalations" USING btree ("run_id");