import type { Tone } from "@btb/contracts";

import type { DbOrTx } from "./db";
import { auditLogs } from "./db/schema";

/*
 * Audit log writes (E1.4). Call inside the transaction that makes the change, so the log and the change
 * commit together. Rows with a run id are also that run's timeline.
 */

export interface AuditEntry {
  /** Null for the system (worker). */
  actor: { id: string; name: string } | null;
  action: string;
  detail?: string | null;
  projectId?: string | null;
  runId?: string | null;
  tone?: Tone;
  data?: Record<string, unknown>;
}

export const SYSTEM_ACTOR = "System";

export async function writeAudit(db: DbOrTx, ...entries: AuditEntry[]) {
  if (!entries.length) return;
  // One timestamp for several rows would lose their order on the timeline; a millisecond apart keeps it.
  const base = Date.now();
  await db.insert(auditLogs).values(
    entries.map((e, i) => ({
      at: new Date(base + i),
      actorId: e.actor?.id ?? null,
      actorName: e.actor?.name ?? SYSTEM_ACTOR,
      action: e.action,
      detail: e.detail ?? null,
      projectId: e.projectId ?? null,
      runId: e.runId ?? null,
      data: e.tone || e.data ? { ...e.data, ...(e.tone ? { tone: e.tone } : {}) } : null,
    })),
  );
}
