CREATE TYPE "public"."abort_reason" AS ENUM('emergency_stop', 'lease_expired', 'threshold', 'target_health', 'telemetry_lost', 'policy_breach', 'kubernetes_failure');--> statement-breakpoint
CREATE TYPE "public"."verdict_caveat" AS ENUM('measurement_gap', 'generator_saturated', 'integrity_not_verified');--> statement-breakpoint
CREATE TYPE "public"."approval_decision" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."load_model" AS ENUM('vus', 'rps');--> statement-breakpoint
CREATE TYPE "public"."network_profile" AS ENUM('stadium-4g', 'wifi-baseline');--> statement-breakpoint
CREATE TYPE "public"."preset" AS ENUM('smoke', 'baseline', 'peak', 'spike', 'soak', 'stress');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('viewer', 'engineer', 'approver', 'admin');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('draft', 'pending_approval', 'approved', 'queued', 'starting', 'running', 'stopping', 'completed', 'failed', 'aborted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."verdict" AS ENUM('pass', 'fail');--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" text NOT NULL,
	"user_id" uuid,
	"rule" text,
	"manifest_hash" text NOT NULL,
	"decision" "approval_decision" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "approvals_by_check" CHECK (("approvals"."user_id" IS NULL) <> ("approvals"."rule" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "audit_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"actor_name" text NOT NULL,
	"action" text NOT NULL,
	"detail" text,
	"project_id" text,
	"run_id" text,
	"data" jsonb,
	CONSTRAINT "audit_logs_id_at_pk" PRIMARY KEY("id","at")
) PARTITION BY RANGE ("at");
--> statement-breakpoint
CREATE TABLE "baselines" (
	"target_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"preset" "preset" NOT NULL,
	"run_id" text NOT NULL,
	"set_by" uuid NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "baselines_target_id_scenario_id_preset_pk" PRIMARY KEY("target_id","scenario_id","preset")
);
--> statement-breakpoint
CREATE TABLE "environments" (
	"id" text PRIMARY KEY NOT NULL,
	"namespace" text NOT NULL,
	"max_vus" integer NOT NULL,
	"max_rps" integer NOT NULL,
	"max_duration_sec" integer NOT NULL,
	"max_ramp_per_min" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "environments_namespace_unique" UNIQUE("namespace")
);
--> statement-breakpoint
CREATE TABLE "journeys" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"version" text NOT NULL,
	"browser" boolean NOT NULL,
	"steps" text[] NOT NULL,
	"params" jsonb NOT NULL,
	"budgets" jsonb NOT NULL,
	"image_tag" text NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "run_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" text NOT NULL,
	"name" text NOT NULL,
	"label" text NOT NULL,
	"s3_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_artifacts_s3_key_unique" UNIQUE("s3_key")
);
--> statement-breakpoint
CREATE TABLE "run_summaries" (
	"run_id" text PRIMARY KEY NOT NULL,
	"p50_ms" integer NOT NULL,
	"p95_ms" integer NOT NULL,
	"p99_ms" integer NOT NULL,
	"error_rate_pct" numeric(6, 3) NOT NULL,
	"peak_rps" integer NOT NULL,
	"max_vus" integer NOT NULL,
	"achieved_load" integer NOT NULL,
	"achieved_duration_sec" integer NOT NULL,
	"gap_sec" integer DEFAULT 0 NOT NULL,
	"browser" jsonb,
	"oversold_seats" integer,
	"double_charges" integer,
	"charged_no_ticket" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_summaries_integrity_check" CHECK (("run_summaries"."oversold_seats" IS NULL) = ("run_summaries"."double_charges" IS NULL) AND ("run_summaries"."oversold_seats" IS NULL) = ("run_summaries"."charged_no_ticket" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "runner_images" (
	"tag" text PRIMARY KEY NOT NULL,
	"digest" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Hand-added: run ids ("RUN-0421") come from a sequence; the table default below needs it first.
CREATE SEQUENCE "run_number";--> statement-breakpoint
CREATE FUNCTION next_run_id() RETURNS text LANGUAGE sql AS $$
  SELECT 'RUN-' || lpad(n::text, greatest(4, length(n::text)), '0') FROM nextval('run_number') AS n
$$;--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY DEFAULT next_run_id() NOT NULL,
	"project_id" text NOT NULL,
	"scenario_version_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"preset" "preset" NOT NULL,
	"network" "network_profile",
	"release_id" text,
	"status" "run_status" DEFAULT 'draft' NOT NULL,
	"manifest" jsonb NOT NULL,
	"manifest_hash" text NOT NULL,
	"duration_sec" integer NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"start_requested_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"preflight" jsonb,
	"queued_behind" text,
	"abort_reason" "abort_reason",
	"verdict" "verdict",
	"caveats" "verdict_caveat"[] DEFAULT '{}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runs_manifest_hash_check" CHECK ("runs"."manifest_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "runs_ended_after_started_check" CHECK ("runs"."ended_at" IS NULL OR "runs"."started_at" IS NULL OR "runs"."ended_at" >= "runs"."started_at")
);
--> statement-breakpoint
CREATE TABLE "scenario_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scenario_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"model" "load_model" NOT NULL,
	"browser" boolean NOT NULL,
	"p95_ms" integer,
	"error_rate_pct" numeric(5, 2),
	"image_tag" text NOT NULL,
	"params" jsonb NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scenario_versions_thresholds_check" CHECK (("scenario_versions"."p95_ms" IS NULL) = ("scenario_versions"."error_rate_pct" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"journey_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"environment" text NOT NULL,
	"peak_vus" integer NOT NULL,
	"peak_rps" integer NOT NULL,
	"hosts" text[] NOT NULL,
	"paths" text[] NOT NULL,
	"methods" text[] NOT NULL,
	"redirects" text[] DEFAULT '{}' NOT NULL,
	"health_path" text DEFAULT '/health' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_data_pools" (
	"target_id" uuid PRIMARY KEY NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"secret_path" text NOT NULL,
	"seed_hook" jsonb,
	"cleanup_hook" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entra_oid" text,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "role",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_target_id_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."targets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "baselines" ADD CONSTRAINT "baselines_set_by_users_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_image_tag_runner_images_tag_fk" FOREIGN KEY ("image_tag") REFERENCES "public"."runner_images"("tag") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_artifacts" ADD CONSTRAINT "run_artifacts_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_summaries" ADD CONSTRAINT "run_summaries_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_scenario_version_id_scenario_versions_id_fk" FOREIGN KEY ("scenario_version_id") REFERENCES "public"."scenario_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_target_id_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."targets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_environment_environments_id_fk" FOREIGN KEY ("environment") REFERENCES "public"."environments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_versions" ADD CONSTRAINT "scenario_versions_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_versions" ADD CONSTRAINT "scenario_versions_image_tag_runner_images_tag_fk" FOREIGN KEY ("image_tag") REFERENCES "public"."runner_images"("tag") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_versions" ADD CONSTRAINT "scenario_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "targets" ADD CONSTRAINT "targets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "targets" ADD CONSTRAINT "targets_environment_environments_id_fk" FOREIGN KEY ("environment") REFERENCES "public"."environments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_data_pools" ADD CONSTRAINT "test_data_pools_target_id_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."targets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_run_idx" ON "approvals" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_run_user_hash_idx" ON "approvals" USING btree ("run_id","user_id","manifest_hash") WHERE "approvals"."decision" = 'approved';--> statement-breakpoint
CREATE INDEX "audit_logs_run_idx" ON "audit_logs" USING btree ("run_id","at");--> statement-breakpoint
CREATE INDEX "audit_logs_project_at_idx" ON "audit_logs" USING btree ("project_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "run_artifacts_run_name_idx" ON "run_artifacts" USING btree ("run_id","name");--> statement-breakpoint
CREATE INDEX "runs_project_created_idx" ON "runs" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "runs_status_idx" ON "runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_one_active_per_target_idx" ON "runs" USING btree ("target_id") WHERE "runs"."status" IN ('starting', 'running', 'stopping');--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_versions_scenario_version_idx" ON "scenario_versions" USING btree ("scenario_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "scenarios_project_name_idx" ON "scenarios" USING btree ("project_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "targets_project_name_idx" ON "targets" USING btree ("project_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_entra_oid_idx" ON "users" USING btree ("entra_oid");