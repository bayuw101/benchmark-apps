import { targetUrl } from "@btb/contracts";
import { integrityCountsOf, integrityRequestPath, type IntegrityAdapter, type IntegrityWindow } from "@btb/core/integrity";

import type { Ctx } from "./context";
import { clusterService } from "./plan";

const INTEGRITY_TIMEOUT_MS = 10_000;

/**
 * The HTTP adapter (decided 2026-11-08 for the local mock, TBD-13 for real targets): a read-only GET on the
 * target's first host. In-cluster hosts go through the API server's service proxy, like the health probe.
 */
export function httpIntegrityAdapter(ctx: Ctx, host: string, path: string): IntegrityAdapter {
  return {
    source: `${host}${path.split("?")[0]}`,
    async check(w: IntegrityWindow) {
      const req = integrityRequestPath(path, w);
      const svc = clusterService(host);
      const text = svc
        ? await withTimeout(ctx.kube.serviceGetText(svc.namespace, svc.name, svc.port, req))
        : await fetch(`${targetUrl(host)}${req}`, { redirect: "manual", signal: AbortSignal.timeout(INTEGRITY_TIMEOUT_MS) }).then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.text();
          });
      return integrityCountsOf(JSON.parse(text));
    },
  };
}

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("integrity check timed out")), INTEGRITY_TIMEOUT_MS).unref())]);
}
