import type { RunStatus } from "@btb/contracts";

// The 11 run statuses from the PRD run lifecycle (E3) live in @btb/contracts.
export { RUN_STATUSES, type RunStatus } from "@btb/contracts";

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

// Live statuses share the info tone with `approved`; the pulsing dot and the word tell them apart.
// The brand-filled badge was avoided: white on brand is 3.7:1, below AA for 12px text.
export const RUN_STATUS_META: Record<RunStatus, { label: string; tone: Tone; live?: boolean }> = {
  draft: { label: "Draft", tone: "neutral" },
  pending_approval: { label: "Pending approval", tone: "warning" },
  approved: { label: "Approved", tone: "info" },
  queued: { label: "Queued", tone: "warning" },
  starting: { label: "Starting", tone: "info", live: true },
  running: { label: "Running", tone: "info", live: true },
  stopping: { label: "Stopping", tone: "info", live: true },
  completed: { label: "Completed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  aborted: { label: "Aborted", tone: "danger" },
  rejected: { label: "Rejected", tone: "danger" },
};
