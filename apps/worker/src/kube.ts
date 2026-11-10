import { request } from "node:https";

import { ApiException, CoreV1Api, CustomObjectsApi, KubeConfig } from "@kubernetes/client-node";

import { RUN_ID_LABEL, type QuotaStatus } from "./plan";

const GROUP = "k6.io";
const VERSION = "v1alpha1";
const PLURAL = "testruns";

/** k6-operator's TestRun stages. */
export type TestRunStage = "initialization" | "initialized" | "created" | "started" | "stopped" | "finished" | "error";

export interface TestRunInfo {
  name: string;
  runId: string | null;
  stage: TestRunStage | null;
  /** Runner pods the TestRun asked for. */
  parallelism: number;
  /** Delete issued; waiting for its jobs and pods to go (foreground deletion). */
  deleting: boolean;
}

const isNotFound = (e: unknown) => e instanceof ApiException && e.code === 404;

/**
 * Every Kubernetes call is bounded. The worker holds its state lock while it calls the API server, and a stop
 * waits for that lock: a hung API server must not hold up an emergency stop.
 */
export const KUBE_TIMEOUT_MS = 10_000;

export function withTimeout<T>(p: Promise<T>, ms: number, what = "Kubernetes API call"): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

const bounded = <T>(p: Promise<T>) => withTimeout(p, KUBE_TIMEOUT_MS);

/** Short text for the timeline: the API status + its message, not the whole response dump. */
export function kubeErrorMessage(e: unknown): string {
  if (!(e instanceof ApiException)) return e instanceof Error ? e.message : String(e);
  let message = "";
  try {
    message = (typeof e.body === "string" ? JSON.parse(e.body) : e.body)?.message ?? "";
  } catch {
    message = typeof e.body === "string" ? e.body.slice(0, 200) : "";
  }
  return `Kubernetes API ${e.code}${message ? `: ${message}` : ""}`;
}

/** The few Kubernetes calls the worker makes, as the btb-worker ServiceAccount (infra/kind/manifests/40-worker-rbac.yaml). */
export class Kube {
  private readonly custom: CustomObjectsApi;
  private readonly core: CoreV1Api;
  private readonly kc: KubeConfig;

  constructor(kubeconfigPath: string) {
    const kc = new KubeConfig();
    kc.loadFromFile(kubeconfigPath);
    this.kc = kc;
    this.custom = kc.makeApiClient(CustomObjectsApi);
    this.core = kc.makeApiClient(CoreV1Api);
  }

  async createTestRun(namespace: string, body: object) {
    await bounded(this.custom.createNamespacedCustomObject({ group: GROUP, version: VERSION, namespace, plural: PLURAL, body }));
  }

  async getTestRun(namespace: string, name: string): Promise<TestRunInfo | null> {
    try {
      const obj = await bounded(this.custom.getNamespacedCustomObject({ group: GROUP, version: VERSION, namespace, plural: PLURAL, name }));
      return info(obj);
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  /** True if it existed. Foreground: the runner jobs and pods go with it. */
  async deleteTestRun(namespace: string, name: string): Promise<boolean> {
    try {
      await bounded(this.custom.deleteNamespacedCustomObject({ group: GROUP, version: VERSION, namespace, plural: PLURAL, name, propagationPolicy: "Foreground" }));
      return true;
    } catch (e) {
      if (isNotFound(e)) return false;
      throw e;
    }
  }

  /** TestRuns this worker created (labelled with a run id). */
  async listTestRuns(namespace: string): Promise<TestRunInfo[]> {
    const list = (await bounded(this.custom.listNamespacedCustomObject({
      group: GROUP,
      version: VERSION,
      namespace,
      plural: PLURAL,
      labelSelector: RUN_ID_LABEL,
    }))) as { items: unknown[] };
    return list.items.map(info);
  }

  /** Runner pods (not the initializer/starter) with their k6 exit codes; null while still running. */
  async runnerPods(namespace: string, testRun: string) {
    const pods = await bounded(this.core.listNamespacedPod({ namespace, labelSelector: `k6_cr=${testRun},runner=true` }));
    return pods.items.map((p) => ({
      name: p.metadata?.name ?? "?",
      exitCode: p.status?.containerStatuses?.[0]?.state?.terminated?.exitCode ?? null,
    }));
  }

  async podLogTail(namespace: string, pod: string, lines = 20): Promise<string> {
    try {
      return await bounded(this.core.readNamespacedPodLog({ namespace, name: pod, tailLines: lines }));
    } catch {
      return "";
    }
  }

  async quotas(namespace: string): Promise<QuotaStatus[]> {
    const list = await bounded(this.core.listNamespacedResourceQuota({ namespace }));
    return list.items.map((q) => ({ hard: q.status?.hard ?? {}, used: q.status?.used ?? {} }));
  }

  /** GET through the API server's service proxy; throws on a non-2xx answer. */
  async serviceGet(namespace: string, service: string, port: number, path: string) {
    await bounded(this.core.connectGetNamespacedServiceProxyWithPath({ namespace, name: `${service}:${port}`, path: path.replace(/^\//, "") }));
  }

  /**
   * GET through the service proxy, returning the body; throws on a non-2xx answer. A raw request because the
   * generated client URL-encodes `?` in the path, which loses the query string.
   */
  async serviceGetText(namespace: string, service: string, port: number, pathAndQuery: string): Promise<string> {
    const server = this.kc.getCurrentCluster()?.server;
    if (!server) throw new Error("kubeconfig has no current cluster");
    const url = new URL(`${server.replace(/\/$/, "")}/api/v1/namespaces/${encodeURIComponent(namespace)}/services/${encodeURIComponent(`${service}:${port}`)}/proxy${pathAndQuery}`);
    const opts: Parameters<KubeConfig["applyToHTTPSOptions"]>[0] = { method: "GET" };
    await this.kc.applyToHTTPSOptions(opts);
    return bounded(
      new Promise<string>((resolve, reject) => {
        const req = request(url, opts as object, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf8");
            const status = res.statusCode ?? 0;
            if (status >= 200 && status < 300) resolve(body);
            else reject(new Error(`HTTP ${status}: ${body.slice(0, 200)}`));
          });
        });
        req.on("error", reject);
        req.end();
      }),
    );
  }

  /** A test-data hook call through the service proxy; throws on a non-2xx answer. */
  async serviceCall(method: "POST" | "PUT" | "DELETE", namespace: string, service: string, port: number, path: string) {
    const req = { namespace, name: `${service}:${port}`, path: path.replace(/^\//, "") };
    if (method === "POST") await bounded(this.core.connectPostNamespacedServiceProxyWithPath(req));
    else if (method === "PUT") await bounded(this.core.connectPutNamespacedServiceProxyWithPath(req));
    else await bounded(this.core.connectDeleteNamespacedServiceProxyWithPath(req));
  }
}

function info(obj: unknown): TestRunInfo {
  const o = obj as {
    metadata?: { name?: string; labels?: Record<string, string>; deletionTimestamp?: string };
    spec?: { parallelism?: number };
    status?: { stage?: TestRunStage };
  };
  return {
    name: o.metadata?.name ?? "",
    runId: o.metadata?.labels?.[RUN_ID_LABEL] ?? null,
    stage: o.status?.stage ?? null,
    parallelism: o.spec?.parallelism ?? 1,
    deleting: Boolean(o.metadata?.deletionTimestamp),
  };
}
