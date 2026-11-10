-- Guards the schema file can't express (see src/db/schema.ts): immutability, audit partitions, the app role, seeds.

-- Append-only tables: the trigger refuses changes for every role, owner included (E1.4, E2.3).
CREATE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (%)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END
$$;--> statement-breakpoint
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION forbid_change();--> statement-breakpoint
CREATE TRIGGER scenario_versions_immutable BEFORE UPDATE OR DELETE ON scenario_versions FOR EACH ROW EXECUTE FUNCTION forbid_change();--> statement-breakpoint

-- The app connects as a member of btb_app (NOLOGIN group; each environment creates its own login and GRANTs it):
-- full access to data, SELECT + INSERT only on audit_logs. Migrations run as the owner.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'btb_app') THEN CREATE ROLE btb_app NOLOGIN; END IF;
END
$$;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO btb_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO btb_app;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM btb_app;--> statement-breakpoint
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO btb_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO btb_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO btb_app;--> statement-breakpoint

-- Monthly audit partitions. Retention (1 year, D7) = drop old partitions: SELECT audit_logs_drop_before(now() - interval '1 year').
CREATE FUNCTION audit_logs_add_month(month date) RETURNS void LANGUAGE plpgsql AS $$
DECLARE first date := date_trunc('month', month)::date;
BEGIN
  EXECUTE format('CREATE TABLE IF NOT EXISTS audit_logs_%s PARTITION OF audit_logs FOR VALUES FROM (%L) TO (%L)',
    to_char(first, 'YYYY_MM'), first, first + interval '1 month');
  EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs_%s FROM btb_app', to_char(first, 'YYYY_MM'));
END
$$;--> statement-breakpoint
CREATE FUNCTION audit_logs_drop_before(cutoff timestamptz) RETURNS setof text LANGUAGE plpgsql AS $$
DECLARE p text;
BEGIN
  FOR p IN SELECT inhrelid::regclass::text FROM pg_inherits WHERE inhparent = 'audit_logs'::regclass
           AND inhrelid::regclass::text ~ '^audit_logs_\d{4}_\d{2}$'
           AND to_date(substr(inhrelid::regclass::text, 12, 7), 'YYYY_MM') + interval '1 month' <= cutoff
  LOOP
    EXECUTE format('DROP TABLE %I', p);
    RETURN NEXT p;
  END LOOP;
END
$$;--> statement-breakpoint
-- ponytail: 26 months pre-created; add more with audit_logs_add_month() (cron it when the worker exists).
DO $$
DECLARE m date := date '2026-11-01';
BEGIN
  WHILE m < date '2029-01-01' LOOP
    PERFORM audit_logs_add_month(m);
    m := m + interval '1 month';
  END LOOP;
END
$$;--> statement-breakpoint
-- Anything outside a monthly partition (clock skew, backfill) lands here instead of failing the transaction.
CREATE TABLE audit_logs_default PARTITION OF audit_logs DEFAULT;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs_default FROM btb_app;--> statement-breakpoint

-- The MVP's two environments (PRD policy decisions). Ceilings are placeholders until TBD-12.
INSERT INTO environments (id, namespace, max_vus, max_rps, max_duration_sec, max_ramp_per_min) VALUES
  ('staging', 'perf-staging', 10000, 8000, 14400, 8000),
  ('prod-like', 'perf-prod', 2000, 1500, 1800, 1000);
