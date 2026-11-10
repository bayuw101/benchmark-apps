import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/*
 * Checks the guards the migrations add on a migrated database (vitest.config.ts picks the database).
 * Locally: docker compose up in infra/local, pnpm db:migrate, pnpm test.
 */
const url = process.env.DATABASE_URL;

describe.skipIf(!url)("database guards", () => {
  const c = new Client({ connectionString: url });
  beforeAll(async () => {
    await c.connect();
    await c.query("BEGIN");
  });
  afterAll(async () => {
    await c.query("ROLLBACK");
    await c.end();
  });

  it("numbers runs RUN-0001 style", async () => {
    const { rows } = await c.query("SELECT next_run_id() AS id");
    expect(rows[0].id).toMatch(/^RUN-\d{4,}$/);
  });

  it("keeps audit rows append-only and routes them to monthly partitions", async () => {
    const { rows } = await c.query("INSERT INTO audit_logs (actor_name, action) VALUES ('test', 'Tested') RETURNING id, at, tableoid::regclass AS part");
    expect(rows[0].part).toMatch(/^audit_logs_\d{4}_\d{2}$/);
    await c.query("SAVEPOINT s");
    await expect(c.query("UPDATE audit_logs SET action = 'x' WHERE id = $1", [rows[0].id])).rejects.toThrow(/append-only/);
    await c.query("ROLLBACK TO SAVEPOINT s");
    await expect(c.query("DELETE FROM audit_logs WHERE id = $1", [rows[0].id])).rejects.toThrow(/append-only/);
    await c.query("ROLLBACK TO SAVEPOINT s");
  });

  it("allows one active run per target", async () => {
    const hash = "a".repeat(64);
    await c.query(`
      INSERT INTO users (id, email, name, role) VALUES ('00000000-0000-0000-0000-000000000001', 't@example.com', 'T', 'engineer');
      INSERT INTO projects (id, name) VALUES ('t', 'T');
      INSERT INTO runner_images (tag) VALUES ('t');
      INSERT INTO journeys (id, title, description, version, browser, steps, params, budgets, image_tag) VALUES ('j', 'J', '', '1', false, '{}', '[]', '[]', 't');
      INSERT INTO targets (id, project_id, name, environment, peak_vus, peak_rps, hosts, paths, methods) VALUES ('00000000-0000-0000-0000-000000000002', 't', 'tg', 'staging', 1, 1, '{}', '{}', '{}');
      INSERT INTO scenarios (id, project_id, name, journey_id) VALUES ('00000000-0000-0000-0000-000000000003', 't', 's', 'j');
      INSERT INTO scenario_versions (id, scenario_id, version, model, browser, p95_ms, error_rate_pct, image_tag, params, created_by)
        VALUES ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', 1, 'vus', false, 800, 1, 't', '{}', '00000000-0000-0000-0000-000000000001');
    `);
    const run = (status: string) =>
      c.query(
        `INSERT INTO runs (project_id, scenario_version_id, target_id, environment, preset, status, manifest, manifest_hash, duration_sec, created_by)
         VALUES ('t', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000002', 'staging', 'smoke', $1, '{}', $2, 120, '00000000-0000-0000-0000-000000000001') RETURNING id`,
        [status, hash],
      );
    expect((await run("running")).rows[0].id).toMatch(/^RUN-/);
    await run("queued");
    await c.query("SAVEPOINT r");
    await expect(run("starting")).rejects.toThrow(/runs_one_active_per_target_idx/);
    await c.query("ROLLBACK TO SAVEPOINT r");
    await expect(c.query("UPDATE scenario_versions SET note = 'x'")).rejects.toThrow(/append-only/);
  });
});
