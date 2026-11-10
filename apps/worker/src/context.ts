import type { Db } from "@btb/core/db";
import type { Executor } from "@btb/core/executor";
import type { Redis } from "ioredis";
import type { Pool } from "pg";

import type { ArtifactStore } from "./artifacts";
import type { WorkerConfig } from "./env";
import type { Kube } from "./kube";
import type { Prometheus } from "./prometheus";

/** Everything the dispatch / reconcile / live code talks to. */
export interface Ctx {
  cfg: WorkerConfig;
  db: Db;
  pool: Pool;
  redis: Redis;
  /** Service proxy (health, integrity, hooks) for in-cluster targets. Runs go through `placement`. */
  kube: Kube;
  executors: { kubernetes: Executor; docker: Executor };
  prom: Prometheus;
  artifacts: ArtifactStore;
}

/** Which executor runs an environment's runs, and its scope (namespace for Kubernetes, environment id for Docker). */
export function placement(ctx: Ctx, environment: string, namespace: string): { executor: Executor; scope: string } {
  return ctx.cfg.docker.environments.includes(environment) ? { executor: ctx.executors.docker, scope: environment } : { executor: ctx.executors.kubernetes, scope: namespace };
}
