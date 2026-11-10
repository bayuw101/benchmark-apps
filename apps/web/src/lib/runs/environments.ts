import type { Environment } from "@btb/contracts";

/*
 * Environments (PRD E2.1, policy decisions). Each is its own Kubernetes namespace with its own policy.
 * The MVP has exactly two. Ceilings live in the environments table (admin-editable); labels and approval
 * rules stay in code.
 */

export type { Ceiling } from "@btb/contracts";

export interface EnvironmentInfo {
  id: Environment;
  label: string;
  namespace: string;
  approvals: string;
  note: string;
}

export const ENVIRONMENTS: EnvironmentInfo[] = [
  { id: "staging", label: "Staging", namespace: "perf-staging", approvals: "Auto for smoke, baseline, peak · 1 approver for spike, stress, soak", note: "All runs target staging until a prod-like environment exists." },
  { id: "prod-like", label: "Prod-like", namespace: "perf-prod", approvals: "2 different approvers for every run · no soak or stress", note: "Used for the weeks 13–16 pre-launch pilot." },
];
