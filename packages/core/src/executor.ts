import type { RunnerConfig } from "@btb/contracts";

export { isLocalHost } from "@btb/contracts";

/*
 * Executor (PRD E5.1): where a run's runners execute. The worker drives every run through this interface;
 * `KubernetesExecutor` (k6-operator TestRun) is the real one, `DockerExecutor` is for local development only
 * (E5.5). Which one an environment uses is worker configuration, never something a run plan can choose.
 */

export type ExecutorKind = "kubernetes" | "docker";

export interface ExecutionSpec {
  runId: string;
  /** Kubernetes namespace, or the environment id for Docker; also what `owned` lists by. */
  scope: string;
  image: string;
  /** Runner count; never more than the executor's `maxRunners`. */
  runners: number;
  config: RunnerConfig;
  /** Prometheus remote-write endpoint as the runners reach it. */
  remoteWriteUrl: string;
}

/** `pending` = not started yet, `running` = load may be flowing, `finished` = every runner has an exit code. */
export type ExecutionStage = "pending" | "running" | "finished" | "failed";

export interface RunnerExit {
  /** Starts with the runner's hostname plus "-", which is how runner callbacks name themselves. */
  name: string;
  exitCode: number | null;
}

export interface ExecutionStatus {
  stage: ExecutionStage;
  /** Filled when `finished`. */
  runners: RunnerExit[];
  /** For timeouts and failures, e.g. the operator stage. */
  detail?: string;
}

export interface Executor {
  readonly kind: ExecutorKind;
  readonly maxRunners: number;
  /** Null when there is room for `runners`, else why not. */
  capacity(scope: string, runners: number, browser: boolean): Promise<string | null>;
  create(spec: ExecutionSpec): Promise<void>;
  /** Null = nothing exists for the run (never created, or deleted). */
  status(scope: string, runId: string): Promise<ExecutionStatus | null>;
  /** True if something existed. Idempotent. */
  delete(scope: string, runId: string): Promise<boolean>;
  runners(scope: string, runId: string): Promise<RunnerExit[]>;
  logTail(scope: string, runner: string, lines: number): Promise<string>;
  /** Run ids with something in this scope, for the orphan sweep. */
  owned(scope: string): Promise<{ runId: string; deleting: boolean }[]>;
  /** One line for the run timeline, e.g. "TestRun run-0001 in perf-staging: 2 runner pods, btb-runner:1.0". */
  describe(spec: ExecutionSpec): string;
}

