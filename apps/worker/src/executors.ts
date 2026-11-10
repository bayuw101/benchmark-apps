import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { isLocalHost, type ExecutionSpec, type Executor, type RunnerExit } from "@btb/core/executor";

import type { Kube } from "./kube";
import { capacityNeed, capacityShortfall, DOCKER_SCOPE_LABEL, dockerRunArgs, dockerStatus, kubeStatus, RUN_ID_LABEL, testRunManifest, testRunName, type DockerPsRow } from "./plan";

/** The real executor (E5.1): one k6-operator TestRun per run, runner pods in the environment's namespace. */
export class KubernetesExecutor implements Executor {
  readonly kind = "kubernetes" as const;
  constructor(
    private readonly kube: Kube,
    readonly maxRunners: number,
  ) {}

  async capacity(namespace: string, runners: number, browser: boolean) {
    const short = capacityShortfall(await this.kube.quotas(namespace), capacityNeed(runners, browser));
    return short ? `Not enough room in ${namespace} (${short}).` : null;
  }

  async create(spec: ExecutionSpec) {
    await this.kube.createTestRun(spec.scope, testRunManifest({ runId: spec.runId, namespace: spec.scope, image: spec.image, parallelism: spec.runners, config: spec.config, remoteWriteUrl: spec.remoteWriteUrl }));
  }

  async status(namespace: string, runId: string) {
    const tr = await this.kube.getTestRun(namespace, testRunName(runId));
    // While started, the pods are checked too: one that died is caught at once, not by the telemetry guard 60 s later.
    const pods = tr?.stage === "finished" || tr?.stage === "started" ? await this.runners(namespace, runId) : [];
    return kubeStatus(tr, pods);
  }

  delete(namespace: string, runId: string) {
    return this.kube.deleteTestRun(namespace, testRunName(runId));
  }

  runners(namespace: string, runId: string): Promise<RunnerExit[]> {
    return this.kube.runnerPods(namespace, testRunName(runId));
  }

  logTail(namespace: string, runner: string, lines: number) {
    return this.kube.podLogTail(namespace, runner, lines);
  }

  async owned(namespace: string) {
    return (await this.kube.listTestRuns(namespace)).flatMap((tr) => (tr.runId ? [{ runId: tr.runId, deleting: tr.deleting }] : []));
  }

  describe(spec: ExecutionSpec) {
    return `TestRun ${testRunName(spec.runId)} in ${spec.scope}: ${spec.runners} runner pod${spec.runners === 1 ? "" : "s"}, ${spec.image}.`;
  }
}

const run = promisify(execFile);
const DOCKER_TIMEOUT_MS = 30_000;

/**
 * Local development only (E5.5): runner containers through the `docker` CLI on the worker's machine. Refused
 * in production (loadConfig) and for any target that isn't loopback (here, and in dispatch preflight).
 * One runner per run: no execution segments to split load across containers.
 */
export class DockerExecutor implements Executor {
  readonly kind = "docker" as const;
  readonly maxRunners = 1;
  constructor(private readonly network: string) {}

  private async docker(args: string[]) {
    const { stdout, stderr } = await run("docker", args, { timeout: DOCKER_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 });
    return { stdout: stdout.toString(), stderr: stderr.toString() };
  }

  private async ps(filter: string): Promise<DockerPsRow[]> {
    const { stdout } = await this.docker(["ps", "--all", `--filter=label=${filter}`, "--format={{json .}}"]);
    return stdout
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as DockerPsRow & { Labels?: string });
  }

  async capacity() {
    try {
      await this.docker(["info", "--format={{.ServerVersion}}"]);
      return null;
    } catch (e) {
      return `The Docker daemon isn't reachable (${e instanceof Error ? e.message.split("\n")[0] : String(e)}).`;
    }
  }

  async create(spec: ExecutionSpec) {
    const remote = spec.config.allowedHosts.filter((h) => !isLocalHost(h));
    if (remote.length) throw new Error(`The Docker executor only loads local targets; refused ${remote.join(", ")}.`);
    for (let i = 1; i <= Math.min(spec.runners, this.maxRunners); i++) await this.docker(dockerRunArgs(spec, this.network, i));
  }

  async status(_scope: string, runId: string) {
    return dockerStatus(await this.ps(`${RUN_ID_LABEL}=${runId}`));
  }

  async delete(_scope: string, runId: string) {
    const names = (await this.ps(`${RUN_ID_LABEL}=${runId}`)).map((r) => r.Names);
    if (names.length) await this.docker(["rm", "--force", ...names]);
    return names.length > 0;
  }

  async runners(_scope: string, runId: string) {
    return dockerStatus(await this.ps(`${RUN_ID_LABEL}=${runId}`))?.runners ?? [];
  }

  async logTail(_scope: string, runner: string, lines: number) {
    try {
      // k6 writes its log to stderr and handleSummary output to stdout; keep both.
      const { stdout, stderr } = await this.docker(["logs", `--tail=${lines}`, runner]);
      return `${stderr}${stdout}`;
    } catch {
      return "";
    }
  }

  async owned(scope: string) {
    const { stdout } = await this.docker(["ps", "--all", `--filter=label=${DOCKER_SCOPE_LABEL}=${scope}`, `--format={{.Label "${RUN_ID_LABEL}"}}`]);
    return [...new Set(stdout.split("\n").filter(Boolean))].map((runId) => ({ runId, deleting: false }));
  }

  describe(spec: ExecutionSpec) {
    return `Docker (local development): 1 runner container, ${spec.image}, network ${this.network}.`;
  }
}
