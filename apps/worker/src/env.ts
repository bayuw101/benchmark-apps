import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { LEASE_PATH } from "@btb/contracts";
import { databaseUrl, leaseSecret, redisUrl } from "@btb/core/env";

/*
 * Worker settings. Dev defaults match `infra/local` + the kind cluster (`infra/kind/up.sh`); with
 * NODE_ENV=production every URL must be set.
 */

const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");

function fromEnv(name: string, devDefault: string) {
  const value = process.env[name];
  if (value) return value;
  if (process.env.NODE_ENV === "production") throw new Error(`${name} is not set`);
  return devDefault;
}

function intFromEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive integer`);
  return n;
}

/** Environments whose runs go to the Docker executor (local development only, E5.5). Refused in production. */
function dockerEnvironments() {
  const list = (process.env.WORKER_DOCKER_ENVIRONMENTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length && process.env.NODE_ENV === "production") throw new Error("WORKER_DOCKER_ENVIRONMENTS is for local development; it can't be set in production");
  return list;
}

export function loadConfig() {
  const prometheusUrl = fromEnv("PROMETHEUS_URL", "http://btb-control-plane:30090").replace(/\/$/, "");
  return {
    databaseUrl: databaseUrl(),
    redisUrl: redisUrl(),
    /** Kubeconfig of the btb-worker ServiceAccount (infra/kind/worker-kubeconfig.sh). */
    kubeconfig: fromEnv("KUBECONFIG", resolve(REPO_ROOT, "infra/kind/.kube/worker-host.yaml")),
    /** The cluster Prometheus the runners write to, as the worker reaches it (kind: NodePort 30090). */
    prometheusUrl,
    /** The same Prometheus as the runner pods reach it (remote-write receiver). */
    runnerRemoteWriteUrl: fromEnv("RUNNER_PROMETHEUS_RW_URL", "http://prometheus.monitoring.svc.cluster.local:9090/api/v1/write"),
    /** The web app's lease endpoint as runner pods reach it (kind: the btb-platform Service from up.sh). */
    runnerLeaseUrl: fromEnv("RUNNER_LEASE_URL", `http://btb-platform.btb-system.svc.cluster.local${LEASE_PATH}`),
    leaseSecret: leaseSecret(),
    /** Prefix for the runner image, e.g. "123.dkr.ecr.../"; empty on kind (images are loaded into the nodes). */
    runnerRegistry: process.env.RUNNER_REGISTRY ?? "",
    maxParallelism: intFromEnv("WORKER_MAX_PARALLELISM", 4),
    /** Active runs per namespace (PRD E3.5: 2). */
    perNamespace: intFromEnv("WORKER_RUNS_PER_NAMESPACE", 2),
    docker: {
      environments: dockerEnvironments(),
      /** Host networking: the runner reaches the loopback target, the web app and Prometheus as the worker does. */
      network: process.env.DOCKER_RUNNER_NETWORK || "host",
      leaseUrl: process.env.DOCKER_RUNNER_LEASE_URL || `http://127.0.0.1:3001${LEASE_PATH}`,
      /** The Prometheus the worker reads, so live samples and the summary see Docker runs too. */
      remoteWriteUrl: process.env.DOCKER_RUNNER_PROMETHEUS_RW_URL || `${prometheusUrl}/api/v1/write`,
    },
  };
}

export type WorkerConfig = ReturnType<typeof loadConfig>;
