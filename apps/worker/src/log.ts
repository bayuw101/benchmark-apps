/** One JSON line per event, for `docker compose logs` and any log shipper. */
type Level = "info" | "warn" | "error";

function write(level: Level, msg: string, fields?: Record<string, unknown>) {
  const line = JSON.stringify({ at: new Date().toISOString(), level, msg, ...fields });
  (level === "error" ? process.stderr : process.stdout).write(`${line}\n`);
}

export const log = {
  info: (msg: string, fields?: Record<string, unknown>) => write("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => write("error", msg, fields),
};

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
